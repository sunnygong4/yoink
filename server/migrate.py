"""Moving in from Spotify / Apple Music: their data exports read into a list of songs, then added in the background.

What's read (a .zip of any of these too, as the apps send it):
  Spotify "Download your data": YourLibrary.json (liked songs), Playlist*.json, StreamingHistory*.json
  Apple privacy.apple.com data: Apple Music Library Tracks.json, play history .csv ("Track Description": Artist - Title)
  The Music app / iTunes: Library.xml (File > Library > Export Library), a playlist's .txt or .xml export
  Any .csv with title + artist columns (Exportify, TuneMyMusic, Soundiiz...)
"""
import csv
import io
import json
import plistlib
import re
import threading
import time
import zipfile

import library as lib

TITLE = ("track", "trackname", "mastermetadatatrackname", "title", "name", "song", "songname", "tracktitle", "contentname")
ARTIST = ("artist", "artistname", "mastermetadataalbumartistname", "artistnames", "artists", "albumartist", "creator", "performer")
ALBUM = ("album", "albumname", "mastermetadataalbumalbumname", "albumtitle", "container")
MAX_FILE = 200 * 1024 * 1024


def _norm(k: str) -> str:
    return re.sub(r"[^a-z]", "", k.lower())


def _pick(d: dict, keys: tuple) -> str:
    by = {_norm(k): v for k, v in d.items() if isinstance(k, str)}
    for k in keys:
        v = by.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
        if isinstance(v, list) and v and isinstance(v[0], str):
            return v[0].strip()
    return ""


def _song(d: dict) -> dict | None:
    title, artist = _pick(d, TITLE), _pick(d, ARTIST)
    if not title and (desc := _pick(d, ("trackdescription",))) and " - " in desc:
        artist, title = desc.split(" - ", 1)   # Apple's play history: "Artist - Title"
    if not title or not artist:
        return None
    artist = re.split(r"\s*[,;]\s*", artist)[0] if _pick(d, ("artistnames",)) else artist   # Exportify: "A, B"
    s = {"title": title.strip(), "artist": artist.strip(), "album": _pick(d, ALBUM)}
    ms = next((d[k] for k in ("Total Time", "durationMs", "Duration (ms)", "Track Duration (ms)") if isinstance(d.get(k), (int, float, str))
               and str(d[k]).isdigit()), None)
    if ms:
        s["duration"] = int(ms) // 1000
    if str(n := d.get("Play Count") or "").isdigit():
        s["count"] = int(n)
    return s


def _walk(x, out: list, where: str):
    """Every song-shaped object in a JSON file (Spotify nests them: playlists > items > track)."""
    if isinstance(x, dict):
        if isinstance(x.get("playlists"), list):
            for p in x["playlists"]:
                _walk(p.get("items") or [], out, (p.get("name") or where) if isinstance(p, dict) else where)
            return
        if isinstance(x.get("track"), dict):
            return _walk(x["track"], out, where)
        if (s := _song(x)):
            s["from"] = where
            out.append(s)
            return
        for k, v in x.items():
            if isinstance(v, (list, dict)) and k not in ("albums", "artists", "shows", "episodes", "bannedArtists", "other"):
                _walk(v, out, where)
    elif isinstance(x, list):
        for v in x:
            _walk(v, out, where)


def _label(name: str) -> str:
    base = name.rsplit("/", 1)[-1]
    if re.match(r"(?i)(streaming_?history|.*play.?history|play activity)", base):
        return "history"
    if re.match(r"(?i)(yourlibrary|apple music library tracks|library)\b", base):
        return "library"
    return re.sub(r"\.[^.]+$", "", base)


def _text(raw: bytes) -> str:
    for enc in ("utf-8-sig", "utf-16"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            pass
    return raw.decode("latin-1")


def read_file(name: str, raw: bytes, out: list):
    low = name.lower()
    where = _label(name)
    if low.endswith(".zip"):
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            for info in z.infolist():
                n = info.filename.lower()
                if info.file_size < MAX_FILE and n.endswith((".json", ".csv", ".xml", ".txt")) and not n.startswith("__macosx") \
                        and re.search(r"music|playlist|library|streaming|track|spotify", n):
                    try:
                        read_file(info.filename, z.read(info), out)
                    except Exception as e:   # one odd file in the archive: the rest still count
                        print(f"[migrate] {info.filename}: {e}")
    elif low.endswith(".json"):
        _walk(json.loads(_text(raw)), out, where)
    elif low.endswith(".xml"):
        p = plistlib.loads(raw)
        tracks = p.get("Tracks", {})
        for t in tracks.values():
            if not (t.get("Podcast") or t.get("Movie") or t.get("TV Show")) and (s := _song(t)):
                s["from"] = where
                out.append(s)
        for pl in p.get("Playlists", []):   # the playlists (not the built-in ones: Library, Music, Downloaded...)
            if pl.get("Master") or pl.get("Distinguished Kind") or pl.get("Smart Info"):
                continue
            for it in pl.get("Playlist Items") or []:
                if (t := tracks.get(str(it.get("Track ID")))) and (s := _song(t)):
                    s["from"] = pl.get("Name") or where
                    out.append(s)
    elif low.endswith((".csv", ".txt", ".tsv")):
        text = _text(raw)
        first = text.split("\n", 1)[0]
        delim = "\t" if first.count("\t") > first.count(",") else ","
        for row in csv.DictReader(io.StringIO(text), delimiter=delim):
            if (s := _song({k: v for k, v in row.items() if k})):
                s["from"] = where
                out.append(s)


def parse(files: list[tuple[str, bytes]], user: dict) -> dict:
    """The songs in these files, one per song (a song in several playlists: listed once), plays counted."""
    found: list[dict] = []
    for name, raw in files:
        read_file(name, raw, found)
    songs: dict[tuple, dict] = {}
    for s in found:
        k = (s["artist"].casefold(), re.sub(r"\s*[\(\[（].*", "", s["title"]).casefold())
        count = s.pop("count", 1)
        plays = count if s["from"] == "history" else 0   # times played (the play history's rows)
        if k not in songs:
            songs[k] = {**s, "plays": 0, "lists": []}
        songs[k]["plays"] += plays
        if s["from"] != "history" and s["from"] not in songs[k]["lists"]:
            songs[k]["lists"].append(s["from"])
        for f in ("album", "duration"):
            songs[k][f] = songs[k].get(f) or s.get(f)
    rows = list(songs.values())
    pool, mine = lib.known(), lib.owned(user)
    for s in rows:
        d = lib.find(s, pool)
        s["have"] = bool(d and d["id"] in mine)
        s.pop("from", None)
    rows.sort(key=lambda s: (not s["lists"], -s["plays"]))
    return {"songs": rows}


# ---------- adding: one person's import at a time, in the background ----------

JOBS: dict[int, dict] = {}


def start(songs: list[dict], user: dict) -> dict:
    job = JOBS.get(user["id"])
    if job and not job["finished"]:
        job["todo"].extend(songs)
        job["total"] += len(songs)
        return status(user)
    job = JOBS[user["id"]] = {"total": len(songs), "done": 0, "added": 0, "failed": [], "current": None,
                              "finished": False, "todo": list(songs)}

    def run():
        while job["todo"]:
            s = job["todo"].pop(0)
            job["current"] = f"{s['title']} — {s['artist']}"
            try:
                lib.quick({"title": s["title"], "artist": s["artist"], "album": s.get("album") or None,
                           **({"duration": s["duration"]} if s.get("duration") else {})}, user)
                job["added"] += 1
            except Exception as e:
                job["failed"].append(job["current"])
                print(f"[migrate] {job['current']}: {e}")
            job["done"] += 1
            time.sleep(0.5)   # gentle on YouTube Music: hundreds of lookups in a row
        job["current"], job["finished"] = None, True

    threading.Thread(target=run, daemon=True).start()
    return status(user)


def status(user: dict) -> dict | None:
    job = JOBS.get(user["id"])
    return {k: v for k, v in job.items() if k != "todo"} if job else None

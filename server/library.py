"""The music side of the shared song store: the library is the songs people added; this downloads their audio.

Yoinker's fields on a song document are prefixed music_ (the karaoke site owns status/stage/progress):
    music_status   queued | working | ready | error
    music_progress 0-100, music_error, added_by (name), added_at
Songs added from the catalog also get display_title / display_artist / album / artwork (the real song's name and cover).
Recommended songs (smart play) are downloaded with music_radio set: playable, but not in the library until someone
keeps them.
"""
import hashlib
import json
import random
import os
import re
import shutil
import subprocess
import threading
import time
import traceback
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import httpx

from songstore import AUDIO, artist_title, open_store, work_key
from songstore.identify import identify
from songstore.keys import same_length, split_title

import catalog
import search as se
from db import DATA, conn

store = open_store(os.environ.get("SONGSTORE_ROOT") or DATA / "songstore")
APP = "music"
FFMPEG = shutil.which("ffmpeg") or "ffmpeg"
FFPROBE = shutil.which("ffprobe") or "ffprobe"
IN_LIBRARY = ("queued", "working", "ready", "error")


def song_id(source: str, vid: str) -> str:
    return {"youtube": "yt-", "bilibili": "bili-"}[source] + vid


def view(doc: dict) -> dict:
    artist, title = artist_title(doc)
    return {
        "id": doc["id"],
        "title": title or doc.get("title") or doc["id"],
        "artist": artist or doc.get("channel") or "",
        "album": doc.get("album"),
        "duration": doc.get("duration"),
        "thumbnail": doc.get("artwork") or doc.get("thumbnail"),
        "url": doc.get("url"),
        "source_title": doc.get("title"),
        "status": doc.get("music_status"),
        "progress": doc.get("music_progress"),
        "error": doc.get("music_error"),
        "error_code": doc.get("music_error_code"),
        "added_by": doc.get("added_by"),
        "added_at": doc.get("added_at") or doc.get("created"),
        "lyrics": store.file(doc["id"], "lyrics.json") is not None,
        "radio": bool(doc.get("music_radio")),
    }


# ---------- each person's library ----------

def owned(user: dict) -> dict[str, float]:
    """song id -> when this person added it."""
    return {r["song_id"]: r["added_at"] for r in conn().execute(
        "select song_id, added_at from user_songs where user_id = ?", (user["id"],))}


def own(sid: str, user: dict):
    conn().execute("insert or ignore into user_songs (user_id, song_id, added_at) values (?, ?, ?)",
                   (user["id"], sid, time.time()))


def disown(sid: str, user: dict):
    conn().execute("delete from user_songs where user_id = ? and song_id = ?", (user["id"], sid))


def view_for(doc: dict, user: dict, mine: dict[str, float] | None = None) -> dict:
    """A song as this person sees it: radio = not in their library (smart play brought it; ♥ keeps it)."""
    mine = owned(user) if mine is None else mine
    v = view(doc)
    v["radio"] = doc["id"] not in mine
    if doc["id"] in mine:
        v["added_at"] = mine[doc["id"]]
    return v


def library(user: dict) -> list[dict]:
    """This person's songs, plus the ones smart play fetched for them (radio: true, the library list hides those).
    Other people's songs and what the karaoke site has stay out of sight until they add them."""
    mine = owned(user)
    out = [view_for(d, user, mine) for d in store.all() if d.get("music_status") in IN_LIBRARY and (
        d["id"] in mine or (d.get("music_radio") and d.get("added_by") == user["name"]))]
    out.sort(key=lambda s: s["added_at"] or 0, reverse=True)
    return out


def adopt_owners():
    """First run with per-person libraries: each song goes to the library of whoever added it."""
    c = conn()
    if c.execute("select count(*) from user_songs").fetchone()[0]:
        return
    users = {r["name"]: r["id"] for r in c.execute("select id, name from users")}
    for d in store.all():
        if d.get("music_status") in IN_LIBRARY and not d.get("music_radio") and d.get("added_by") in users:
            c.execute("insert or ignore into user_songs (user_id, song_id, added_at) values (?, ?, ?)",
                      (users[d["added_by"]], d["id"], d.get("added_at") or time.time()))


def source_file(doc: dict) -> Path | None:
    """A media file another app already has for this song (karaoke's MV or an uploaded file)."""
    for name in (doc.get("video"), doc.get("file")):
        if name and name != AUDIO and (p := store.file(doc["id"], name)):
            return p
    return None


# ---------- catalog songs <-> the store ----------

def known() -> list[dict]:
    """Songs that can be listened to without downloading: the library, plus what the karaoke site has."""
    return [d for d in store.all() if d.get("music_status") in IN_LIBRARY or store.file(d["id"], AUDIO) or source_file(d)]


def find(song: dict, pool: list[dict] | None = None) -> dict | None:
    """The store's copy of a catalog song (same artist + title, about the same length, not a cover/live take)."""
    best = None
    want_live = bool(re.search(r"\blive\b|現場|现场|演唱會|演唱会", f"{song['title']} {song.get('album') or ''}", re.I))
    for d in known() if pool is None else pool:
        text = " ".join(str(d.get(k) or "") for k in ("display_title", "display_artist", "track", "artist", "title"))
        if not catalog.matches({"title": text, "channel": d.get("channel") or ""}, song["artist"], song["title"]):
            continue
        tags = set(se.tag({"title": d.get("title") or "", "channel": d.get("channel") or ""}))
        # a cover is never the song; a live take is only the song when a live take was asked for (and vice versa)
        if not same_length(d.get("duration"), song.get("duration")) or {"cover", "karaoke"} & tags \
                or ("live" in tags) != want_live:
            continue
        if d.get("music_status") in IN_LIBRARY:
            return d
        best = best or d
    return best


def canonical(song: dict | None) -> dict:
    """The catalog's name and cover for a song document (display_* are what both apps show)."""
    if not song:
        return {}
    return {"display_title": song["title"], "display_artist": song["artist"], "album": song.get("album"),
            "artwork": song.get("artwork")}


def add(r: dict, user: dict, song: dict | None = None, radio: bool = False) -> dict:
    """Add an upload (a search result) to the library, named after the catalog song it is, if given."""
    sid = song_id(r["source"], r["id"])
    doc = store.get(sid)
    if doc and doc.get("music_status") in ("queued", "working", "ready"):
        if radio:
            return view_for(doc, user)
        return keep(sid, user)
    fields = {k: r.get(k) for k in ("source", "url", "title", "channel", "duration", "thumbnail")}
    fields.update(canonical(song))
    missing = {k: v for k, v in fields.items() if v and not (doc or {}).get(k)}   # never overwrite karaoke's metadata
    return _queue(sid, missing, user, radio)


def quick(song: dict, user: dict) -> dict:
    """快速下载: reuse the store's copy of the song if there is one, else download the best upload of it."""
    if doc := find(song):
        if doc.get("music_status") in ("queued", "working", "ready"):
            return keep(doc["id"], user)
        return _queue(doc["id"], {k: v for k, v in canonical(song).items() if v and not doc.get(k)}, user)
    r = catalog.pick_source(song)
    if not r:
        raise LookupError("no reliable source")
    return add(r, user, song)


def keep(sid: str, user: dict) -> dict:
    """Into this person's library (a recommended song they liked, or one someone else already downloaded)."""
    own(sid, user)
    doc = store.get(sid)
    if doc.get("music_radio"):
        doc = store.update(sid, music_radio=False)
    return view_for(doc, user)


def recommend(seed: str, exclude: list[str], user: dict) -> dict | None:
    """Smart play: a song like `seed` that isn't in `exclude` (the queue, recently played), downloaded if needed.
    Picks at random among the closest few so the same seed doesn't always lead to the same song."""
    doc = store.get(seed)
    if not doc:
        return None
    skip = set(exclude) | {seed}
    skip_keys = {k for k in (work_key(store.get(s) or {}) for s in skip) if k}
    pool = known()
    options = []
    for r, song in catalog.radio(doc):
        sid = song_id(r["source"], r["id"])
        have = store.get(sid) if sid in store.ids() else find(song, pool)
        key = work_key(have) if have else work_key({"display_title": song["title"], "display_artist": song["artist"]})
        if sid in skip or (have and have["id"] in skip) or key in skip_keys:
            continue
        options.append((r, song, have))
        if len(options) >= 4:
            break
    if not options:
        return None
    r, song, have = random.choice(options)
    if not have:
        return add(r, user, song, radio=True)
    if have.get("music_status") in ("queued", "working", "ready"):
        return view_for(have, user)
    fields = {k: v for k, v in canonical(song).items() if v and not have.get(k)}
    return _queue(have["id"], fields, user, radio=True)


# ---------- importing people's own files ----------

IMPORT_TYPES = {".mp3", ".m4a", ".aac", ".flac", ".wav", ".ogg", ".oga", ".opus", ".wma", ".aif", ".aiff", ".alac",
                ".ape", ".wv", ".mp4", ".m4v", ".mov", ".mkv", ".webm"}
MAX_IMPORT = 100 * 1024 * 1024   # Cloudflare (free plan) rejects request bodies over 100 MB anyway


class ImportRejected(ValueError):
    """A file that can't be imported; .code says why (the web app words it)."""
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def probe(path: Path) -> dict:
    """Duration, embedded tags and whether there is audio / a cover picture in a media file."""
    r = subprocess.run([FFPROBE, "-v", "error", "-show_entries", "format=duration:format_tags:stream=codec_type:"
                        "stream_disposition=attached_pic", "-of", "json", str(path)],
                       capture_output=True, text=True, stdin=subprocess.DEVNULL)
    info = json.loads(r.stdout or "{}")
    fmt = info.get("format") or {}
    tags = {k.lower(): v for k, v in (fmt.get("tags") or {}).items()}
    streams = info.get("streams") or []
    return {
        "duration": round(float(fmt["duration"])) if fmt.get("duration") else None,
        "title": tags.get("title"), "artist": tags.get("artist") or tags.get("album_artist"), "album": tags.get("album"),
        "audio": any(s.get("codec_type") == "audio" for s in streams),
        "picture": any((s.get("disposition") or {}).get("attached_pic") for s in streams),
    }


def to_jpeg(src: Path, dst: Path):
    """A cover picture (any image, or the one embedded in a music file) as a JPEG no bigger than 1000 px."""
    subprocess.run([FFMPEG, "-nostdin", "-y", "-v", "error", "-i", str(src), "-an", "-frames:v", "1",
                    "-vf", "scale='min(1000,iw)':-2", str(dst)], check=True, capture_output=True, stdin=subprocess.DEVNULL)


def import_file(upload, filename: str, info: dict, cover, user: dict) -> dict:
    """Add someone's own music file. info: title / artist / album as typed (blank = the file's tags, then its name).
    Identical files are one song; the original is kept (it's what "download" gives back)."""
    ext = Path(filename).suffix.lower()
    if ext not in IMPORT_TYPES:
        raise ImportRejected("type")
    sha, size = hashlib.sha1(), 0
    for chunk in iter(lambda: upload.read(1 << 20), b""):
        sha.update(chunk)
        size += len(chunk)
        if size > MAX_IMPORT:
            raise ImportRejected("size")
    upload.seek(0)
    sid = "local-" + sha.hexdigest()[:12]
    doc = store.get(sid)
    if doc and doc.get("music_status") in ("queued", "working", "ready"):
        return keep(sid, user)
    d = store.song_dir(sid)
    d.mkdir(parents=True, exist_ok=True)
    src = d / f"source{ext}"
    with open(src, "wb") as f:
        shutil.copyfileobj(upload, f)
    p = probe(src)
    if not p["audio"]:
        shutil.rmtree(d, ignore_errors=True)
        raise ImportRejected("noaudio")
    guess_artist, guess_title = split_title(Path(filename).stem)
    title = (info.get("title") or "").strip() or p["title"] or guess_title or Path(filename).stem
    artist = (info.get("artist") or "").strip() or p["artist"] or guess_artist or ""
    album = (info.get("album") or "").strip() or p["album"]
    art = d / "cover.jpg"
    try:
        if cover is not None:
            tmp = d / "cover.upload"
            with open(tmp, "wb") as f:
                shutil.copyfileobj(cover, f)
            to_jpeg(tmp, art)
            tmp.unlink(missing_ok=True)
        elif p["picture"]:
            to_jpeg(src, art)
    except subprocess.CalledProcessError:
        art.unlink(missing_ok=True)   # an unreadable picture shouldn't stop the song
    fields = {"source": "local", "file": src.name, "title": Path(filename).stem, "duration": p["duration"],
              "display_title": title, "display_artist": artist, "album": album,
              "artwork": f"/api/songs/{sid}/cover" if art.is_file() else None}
    return _queue(sid, fields, user)


_YT_LINK = re.compile(r"(?:youtube\.com/(?:watch\?(?:.*&)?v=|shorts/|live/|embed/)|youtu\.be/)([\w-]{11})")
_BILI_LINK = re.compile(r"bilibili\.com/video/(BV\w+|av\d+)", re.I)


def resolve_link(url: str) -> dict:
    """A YouTube / Bilibili link (any of the usual forms, b23.tv short links too) as a search result."""
    import yt_dlp
    url = url.strip()
    if "b23.tv" in url:
        try:
            url = str(httpx.get(url, follow_redirects=True, timeout=10).url)
        except httpx.HTTPError:
            raise ImportRejected("notfound")
    if m := _YT_LINK.search(url):
        source, vid, page = "youtube", m[1], f"https://www.youtube.com/watch?v={m[1]}"
    elif m := _BILI_LINK.search(url):
        part = (parse_qs(urlparse(url).query).get("p") or ["1"])[0]
        part = part if part.isdigit() and part != "1" else ""   # multi-part videos: each part is its own song
        source, vid = "bilibili", m[1] + (f"_p{part}" if part else "")
        page = f"https://www.bilibili.com/video/{m[1]}" + (f"?p={part}" if part else "")
    else:
        raise ImportRejected("link")
    try:
        with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True, "noplaylist": True}) as ydl:
            info = ydl.extract_info(page, download=False)
    except Exception:
        # Bilibili currently answers yt-dlp with its anti-bot block (HTTP 412): say so rather than "not found"
        raise ImportRejected("bili" if source == "bilibili" else "notfound")
    if (info.get("duration") or 0) > se.MAX_DURATION:
        raise ImportRejected("long")
    return {"source": source, "id": vid, "url": page, "title": info.get("title") or "",
            "channel": info.get("channel") or info.get("uploader") or "", "duration": info.get("duration"),
            "thumbnail": info.get("thumbnail")}


def import_link(url: str, info: dict, user: dict) -> dict:
    """Add a video by its link. Typed details name the song; left blank, it is identified from the video."""
    r = resolve_link(url)
    title, artist, album = ((info.get(k) or "").strip() for k in ("title", "artist", "album"))
    song = None
    if title or artist or album:
        guess_artist, guess_title = split_title(r["title"], r["channel"])
        song = {"title": title or guess_title or r["title"], "artist": artist or guess_artist or r["channel"],
                "album": album or None, "artwork": None}
    return add(r, user, song)


def original(doc: dict) -> Path | None:
    """The file someone imported, as they uploaded it."""
    return store.file(doc["id"], doc["file"]) if doc.get("source") == "local" and doc.get("file") else None


def _queue(sid: str, fields: dict, user: dict, radio: bool = False) -> dict:
    doc = store.update(sid, **fields, music_status="queued", music_progress=0, music_error=None,
                       added_by=user["name"], added_at=time.time(), music_radio=radio)
    enqueue(sid)
    if not radio:
        own(sid, user)
    return view_for(doc, user)


# ---------- worker ----------

_cv = threading.Condition()
_todo: list[str] = []


def enqueue(sid: str):
    with _cv:
        if sid not in _todo:
            _todo.append(sid)
            _cv.notify()


def _worker():
    while True:
        with _cv:
            while not _todo:
                _cv.wait()
            sid = _todo.pop(0)
        try:
            store.update(sid, music_status="working", music_error=None)
            fetch(sid)
            store.hold(sid, APP)
            store.update(sid, music_status="ready", music_progress=100)
        except Exception as e:
            traceback.print_exc()
            code, msg = friendly_error(str(e))
            store.update(sid, music_status="error", music_error=msg, music_error_code=code)
            continue
        try:
            name_and_lyrics(sid)
        except Exception:
            traceback.print_exc()


def name_and_lyrics(sid: str):
    """Real artist/title (if the catalog didn't give one) and lyrics (when their timing fits), unless already there.
    Songs from the catalog are looked up by their real name, which finds the lyrics far more reliably."""
    doc = store.get(sid)
    if doc.get("identified") or (doc.get("display_title") and store.file(sid, "lyrics.json")):
        return
    query = {**doc, "track": doc.get("display_title") or doc.get("track"),
             "artist": doc.get("display_artist") or doc.get("artist")}
    found = identify(query)
    store.update(sid, identified=True)   # one try per song; the karaoke site's lyric matching can still fill it in later
    if not found:
        return
    if not doc.get("display_title"):
        store.update(sid, display_title=found["title"], display_artist=found["artist"])
    if found["synced"] and not store.file(sid, "lyrics.json"):
        keep = {k: found[k] for k in ("source", "id", "title", "artist", "duration", "lines")}
        (store.song_dir(sid) / "lyrics.json").write_text(json.dumps(keep, ensure_ascii=False, indent=1), encoding="utf-8")
        store.update(sid, lyrics_source=f"{found['source']}: {found['artist']} - {found['title']}")


def fetch(sid: str):
    if store.file(sid, AUDIO):
        return
    doc = store.get(sid)
    if src := source_file(doc):
        to_aac(src, store.song_dir(sid) / AUDIO)
    else:
        download(doc)


def download(doc: dict):
    import yt_dlp
    sid, d = doc["id"], store.song_dir(doc["id"])
    last = [-1]

    def hook(h):
        total = h.get("total_bytes") or h.get("total_bytes_estimate")
        if h.get("status") == "downloading" and total:
            p = int(90 * h.get("downloaded_bytes", 0) / total)
            if p // 5 != last[0]:   # every 5%: each update is a database write
                last[0] = p // 5
                store.update(sid, music_progress=p)

    opts = {
        "format": "bestaudio[ext=m4a]/bestaudio/best",
        "outtmpl": str(d / "dl.%(ext)s"),
        "progress_hooks": [hook],
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "ffmpeg_location": str(Path(FFMPEG).parent) if os.path.isabs(FFMPEG) else None,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(doc["url"], download=True)
    got = next(p for p in d.glob("dl.*") if not p.name.endswith((".part", ".ytdl")))
    to_aac(got, d / AUDIO)
    got.unlink(missing_ok=True)
    meta = {"track": info.get("track"), "artist": info.get("artist") or info.get("creator"),
            "duration": info.get("duration"), "thumbnail": info.get("thumbnail")}
    store.update(sid, **{k: v for k, v in meta.items() if v and not doc.get(k)})


def to_aac(src: Path, dst: Path):
    """dst = src's audio as AAC in .m4a: copied when it already is AAC (instant), otherwise re-encoded."""
    probe = subprocess.run([FFPROBE, "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name",
                            "-of", "json", str(src)], capture_output=True, text=True, check=True,
                           stdin=subprocess.DEVNULL)
    streams = json.loads(probe.stdout).get("streams") or []
    if not streams:
        raise RuntimeError("no audio track in the file")
    codec = ["-c:a", "copy"] if streams[0].get("codec_name") == "aac" else ["-c:a", "aac", "-b:a", "256k"]
    tmp = dst.with_name("audio.tmp.m4a")
    subprocess.run([FFMPEG, "-nostdin", "-y", "-v", "error", "-i", str(src), "-vn", "-map", "0:a:0", *codec,
                    "-movflags", "+faststart", str(tmp)], check=True, capture_output=True,
                   stdin=subprocess.DEVNULL)
    os.replace(tmp, dst)


def friendly_error(raw: str) -> tuple[str | None, str]:
    """(code, message): known problems get a code the web app shows in the viewer's language."""
    r = raw.lower()
    code = "age" if "confirm your age" in r or "age-restricted" in r else \
        "bot" if "not a bot" in r else \
        "bili" if "[bilibili]" in r else \
        "unavailable" if "private video" in r or "has been removed" in r or "unavailable" in r else None
    return code, re.sub(r"\s+", " ", raw.replace("ERROR:", "")).strip()[:140]


def tagged(sid: str) -> Path:
    """audio.m4a with the song's name, album and cover embedded, for saving to a device. Made on first download
    and remade when the song's details change after that."""
    doc, d = store.get(sid), store.song_dir(sid)
    out = d / "download.m4a"
    if out.is_file() and out.stat().st_mtime >= doc.get("updated", 0):
        return out
    s = view(doc)
    cover = d / "cover.jpg"
    if not cover.is_file() and s["thumbnail"]:
        try:
            r = httpx.get(s["thumbnail"], timeout=10, follow_redirects=True)
            if r.status_code == 200 and r.content[:3] == b"\xff\xd8\xff":   # JPEG only: what .m4a covers support
                cover.write_bytes(r.content)
        except httpx.HTTPError:
            pass
    pic = ["-i", str(cover), "-map", "0:a", "-map", "1", "-disposition:v:0", "attached_pic"] if cover.is_file() else []
    tags = [x for k in ("title", "artist", "album") if s.get(k) for x in ("-metadata", f"{k}={s[k]}")]
    tmp = d / "download.tmp.m4a"
    subprocess.run([FFMPEG, "-nostdin", "-y", "-v", "error", "-i", str(d / AUDIO), *pic, "-c", "copy", *tags,
                    "-movflags", "+faststart", str(tmp)], check=True, capture_output=True, stdin=subprocess.DEVNULL)
    os.replace(tmp, out)
    return out


def resume():
    """Pick up downloads a restart interrupted."""
    for doc in store.all():
        if doc.get("music_status") in ("queued", "working"):
            enqueue(doc["id"])


def start():
    adopt_owners()
    for _ in range(2):
        threading.Thread(target=_worker, daemon=True).start()
    resume()

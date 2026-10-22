"""The music side of the shared song store: the library is the songs people added; this downloads their audio.

Yoinker's fields on a song document are prefixed music_ (the karaoke site owns status/stage/progress):
    music_status   queued | working | ready | error
    music_progress 0-100, music_error, added_by (name), added_at
Songs added from the catalog also get display_title / display_artist / album / artwork (the real song's name and cover).
"""
import json
import os
import re
import shutil
import subprocess
import threading
import time
import traceback
from pathlib import Path

import httpx

from songstore import AUDIO, artist_title, open_store
from songstore.identify import identify
from songstore.keys import same_length

import catalog
import search as se
from db import DATA

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
    }


def library() -> list[dict]:
    """Only songs someone added here; what else the karaoke site has stays out of sight until someone asks for it."""
    out = [view(d) for d in store.all() if d.get("music_status") in IN_LIBRARY]
    out.sort(key=lambda s: s["added_at"] or 0, reverse=True)
    return out


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


def add(r: dict, user: dict, song: dict | None = None) -> dict:
    """Add an upload (a search result) to the library, named after the catalog song it is, if given."""
    sid = song_id(r["source"], r["id"])
    doc = store.get(sid)
    if doc and doc.get("music_status") in ("queued", "working", "ready"):
        return view(doc)
    fields = {k: r.get(k) for k in ("source", "url", "title", "channel", "duration", "thumbnail")}
    fields.update(canonical(song))
    keep = {k: v for k, v in fields.items() if v and not (doc or {}).get(k)}   # never overwrite karaoke's metadata
    return _queue(sid, keep, user)


def quick(song: dict, user: dict) -> dict:
    """快速下载: reuse the store's copy of the song if there is one, else download the best upload of it."""
    if doc := find(song):
        if doc.get("music_status") in ("queued", "working", "ready"):
            return view(doc)
        return _queue(doc["id"], {k: v for k, v in canonical(song).items() if v and not doc.get(k)}, user)
    r = catalog.pick_source(song)
    if not r:
        raise LookupError("no reliable source")
    return add(r, user, song)


def _queue(sid: str, fields: dict, user: dict) -> dict:
    doc = store.update(sid, **fields, music_status="queued", music_progress=0, music_error=None,
                       added_by=user["name"], added_at=time.time())
    enqueue(sid)
    return view(doc)


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
    codec = ["-c:a", "copy"] if streams[0].get("codec_name") == "aac" else ["-c:a", "aac", "-b:a", "192k"]
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
    for _ in range(2):
        threading.Thread(target=_worker, daemon=True).start()
    resume()

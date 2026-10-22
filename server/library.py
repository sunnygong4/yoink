"""The music side of the shared song store: download audio, and adopt songs the karaoke site already has.

Yoinker's fields on a song document are prefixed music_ (the karaoke site owns status/stage/progress):
    music_status   queued | working | ready | error
    music_progress 0-100, music_error, added_by (name), added_at
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

from songstore import AUDIO, artist_title, open_store
from songstore.keys import mentioned
from songstore.identify import identify

from db import DATA

store = open_store(os.environ.get("SONGSTORE_ROOT") or DATA / "songstore")
APP = "music"
FFMPEG = shutil.which("ffmpeg") or "ffmpeg"
FFPROBE = shutil.which("ffprobe") or "ffprobe"
SYNC_EVERY = 5 * 60


def song_id(source: str, vid: str) -> str:
    return {"youtube": "yt-", "bilibili": "bili-"}[source] + vid


def view(doc: dict) -> dict:
    artist, title = artist_title(doc)
    return {
        "id": doc["id"],
        "title": title or doc.get("title") or doc["id"],
        "artist": artist or doc.get("channel") or "",
        "duration": doc.get("duration"),
        "thumbnail": doc.get("thumbnail"),
        "url": doc.get("url"),
        "status": doc.get("music_status"),
        "progress": doc.get("music_progress"),
        "error": doc.get("music_error"),
        "added_by": doc.get("added_by"),
        "added_at": doc.get("added_at") or doc.get("created"),
        "lyrics": store.file(doc["id"], "lyrics.json") is not None,
    }


def library() -> list[dict]:
    out = [view(d) for d in store.all() if d.get("music_status")]
    out.sort(key=lambda s: s["added_at"] or 0, reverse=True)
    return out


def source_file(doc: dict) -> Path | None:
    """A media file another app already has for this song (karaoke's MV or an uploaded file)."""
    for name in (doc.get("video"), doc.get("file")):
        if name and name != AUDIO and (p := store.file(doc["id"], name)):
            return p
    return None


def candidates() -> list[dict]:
    """Songs a search result could turn out to be: the library, plus what the karaoke site has downloaded."""
    return [d for d in store.all() if d.get("music_status") in ("queued", "working", "ready") or source_file(d)]


def existing(r: dict, pool: list[dict] | None = None) -> dict | None:
    """The store's song for a search result: the same upload, or failing that the same song in the library."""
    if doc := store.get(song_id(r["source"], r["id"])):
        return doc
    if {"cover", "live", "karaoke"} & set(r.get("tags") or []):   # a different recording of the song
        return None
    text = f"{r.get('title') or ''} {r.get('channel') or ''}"
    return next((d for d in (candidates() if pool is None else pool) if mentioned(d, text, r.get("duration"))), None)


def add(r: dict, user: dict) -> dict:
    """Add a search result to the library. Reuses the song if the store already has it (or the same work)."""
    sid = song_id(r["source"], r["id"])
    fields = {k: r.get(k) for k in ("source", "url", "title", "channel", "duration", "thumbnail")}
    doc = existing(r)
    if doc and doc.get("music_status") in ("queued", "working", "ready"):
        return view(doc)
    sid = doc["id"] if doc else sid
    keep = {k: v for k, v in fields.items() if v and not (doc or {}).get(k)}   # never overwrite karaoke's metadata
    doc = store.update(sid, **keep, music_status="queued", music_progress=0, music_error=None,
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
            store.update(sid, music_status="error", music_error=friendly_error(str(e)))
            continue
        try:
            name_and_lyrics(sid)
        except Exception:
            traceback.print_exc()


def name_and_lyrics(sid: str):
    """Give an upload its real artist/title (and lyrics, when their timing fits) unless the karaoke site already did."""
    doc = store.get(sid)
    if doc.get("display_title") or doc.get("identified"):
        return
    found = identify(doc)
    store.update(sid, identified=True)   # one try per song; the karaoke site's lyric matching can still fill it in later
    if not found:
        return
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
        raise RuntimeError("这个文件里没有音轨")
    codec = ["-c:a", "copy"] if streams[0].get("codec_name") == "aac" else ["-c:a", "aac", "-b:a", "192k"]
    tmp = dst.with_name("audio.tmp.m4a")
    subprocess.run([FFMPEG, "-nostdin", "-y", "-v", "error", "-i", str(src), "-vn", "-map", "0:a:0", *codec,
                    "-movflags", "+faststart", str(tmp)], check=True, capture_output=True,
                   stdin=subprocess.DEVNULL)
    os.replace(tmp, dst)


def friendly_error(raw: str) -> str:
    r = raw.lower()
    if "confirm your age" in r or "age-restricted" in r:
        return "年龄限制：YouTube 要求登录，换一个版本吧"
    if "not a bot" in r:
        return "YouTube 暂时拦截了服务器，稍后重试"
    if "private video" in r or "has been removed" in r or "unavailable" in r:
        return "视频不可用，换一个版本吧"
    return re.sub(r"\s+", " ", raw.replace("ERROR:", "")).strip()[:140]


def sync():
    """Adopt songs the karaoke site downloaded (extracting their audio) and resume interrupted work."""
    for doc in store.all():
        status = doc.get("music_status")
        if status in ("queued", "working"):
            enqueue(doc["id"])
        elif status is None and source_file(doc):
            store.update(doc["id"], music_status="queued", music_progress=0,
                         added_by=doc.get("added_by") or "卡拉OK", added_at=doc.get("created") or time.time())
            enqueue(doc["id"])


def _syncer():
    while True:
        try:
            sync()
        except Exception:
            traceback.print_exc()
        time.sleep(SYNC_EVERY)


def start():
    for _ in range(2):
        threading.Thread(target=_worker, daemon=True).start()
    threading.Thread(target=_syncer, daemon=True).start()

"""Yoinker: a private, shared music library. Search -> the server downloads the audio -> everyone can listen."""
import asyncio
import json
import re
from pathlib import Path
from urllib.parse import urlparse

import httpx
from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from songstore import AUDIO

import auth
import i18n
import catalog as cat
import library as lib
import pages
import search as se

app = FastAPI(title="Yoinker")


@app.middleware("http")
async def _language(request: Request, call_next):
    i18n.set_lang(i18n.lang_of(request.headers))
    return await call_next(request)
WEB = Path(__file__).resolve().parent.parent / "web" / "dist"


@app.on_event("startup")
def _startup():
    lib.start()


@app.get("/api/healthz")
def healthz():
    return {"ok": True}


# ---------- accounts ----------

class Credentials(BaseModel):
    name: str
    password: str
    invite: str | None = None


@app.get("/api/me")
def me(user=Depends(auth.current_user)):
    return user


@app.get("/api/setup")
def setup():
    """Whether the site still needs its first (admin) account, which needs no invite."""
    from db import conn
    return {"first_user": conn().execute("select count(*) from users").fetchone()[0] == 0}


@app.post("/api/register")
def register(body: Credentials, resp: Response):
    user = auth.register(body.name, body.password, body.invite)
    auth.start_session(resp, user["id"])
    return user


@app.post("/api/login")
def login(body: Credentials, resp: Response):
    user = auth.login(body.name, body.password)
    auth.start_session(resp, user["id"])
    return user


@app.post("/api/logout")
def logout(req: Request, resp: Response):
    auth.end_session(req, resp)
    return {"ok": True}


class DeviceBody(BaseModel):
    name: str = "iPod"


@app.post("/api/devices")
def add_device(body: DeviceBody, user=Depends(auth.current_user)):
    """Pair an iPod (the browser extension): it gets its own token to fetch music with."""
    return auth.add_device(user, body.name)


@app.get("/api/devices")
def list_devices(user=Depends(auth.current_user)):
    return auth.devices(user)


@app.delete("/api/devices/{did}")
def remove_device(did: int, user=Depends(auth.current_user)):
    auth.remove_device(user, did)
    return {"ok": True}


@app.post("/api/invites")
def invite(user=Depends(auth.current_user)):
    return {"code": auth.create_invite(user["id"])}


# ---------- search + library ----------

class CatalogSong(BaseModel):
    title: str
    artist: str
    album: str | None = None
    duration: float | None = None
    artwork: str | None = None


@app.get("/api/catalog")
def catalog_search(q: str, user=Depends(auth.current_user)):
    """Songs by name (one per song per artist), each marked if it's in the library or can be added instantly."""
    if not q.strip():
        return []
    try:
        results = cat.search(q)
    except Exception as e:
        raise HTTPException(502, i18n.tr(f"Search failed: {e}", f"搜索失败：{e}"))
    return mark(results, user)


def mark(songs: list[dict], user: dict) -> list[dict]:
    """Catalog songs: which are in this person's library (song_id) and which the store has already (instant:
    someone else, or the karaoke site, downloaded it)."""
    pool = lib.known()
    mine = lib.owned(user)
    for r in songs:
        doc = lib.find(r, pool)
        in_lib = doc and doc["id"] in mine
        r["song_id"] = doc["id"] if in_lib else None
        r["instant"] = bool(doc) and not in_lib   # the karaoke site already has it: adding takes a second
    return songs


@app.get("/api/artist")
def artist_page(key: str, req: Request, user=Depends(auth.current_user)):
    """key: a slug (/artist/ZhouJieLun) or a name."""
    try:
        a = dict(pages.artist(pages.resolve("artist", key), i18n.lang_of(req.headers)))
    except Exception as e:
        raise HTTPException(502, i18n.tr(f"Couldn't load the artist: {e}", f"加载歌手失败：{e}"))
    a["top"] = mark([dict(s) for s in a["top"]], user)
    a["slug"] = pages.remember("artist", a["name"])
    return a


@app.post("/api/artist/media")
def artist_media_upload(name: str = Form(...), kind: str = Form(...), file: UploadFile = File(...),
                        _=Depends(auth.current_user)):
    """Someone's own logo / photo / background for an artist (Chinese bands rarely have a logo online)."""
    ext = Path(file.filename or "x.png").suffix.lower()
    if kind not in pages.MEDIA_KINDS or ext not in (".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"):
        raise HTTPException(400, i18n.tr("Upload a PNG, JPG, WebP, GIF or SVG image", "请上传 PNG、JPG、WebP、GIF 或 SVG 图片"))
    data = file.file.read(10 * 1024 * 1024 + 1)
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(400, i18n.tr("Images can be at most 10 MB", "图片最大 10 MB"))
    pages.save_media(name, kind, data, ext)
    return pages.overrides(name)


@app.get("/api/artist/media")
def artist_media(name: str, kind: str, _=Depends(auth.current_user)):
    f = pages.media_file(name, kind) if kind in pages.MEDIA_KINDS else None
    if not f:
        raise HTTPException(404, "no picture")
    headers = {"Cache-Control": "private, max-age=31536000"}   # the URL carries the file's version
    if f.suffix == ".svg":
        headers["Content-Security-Policy"] = "script-src 'none'"   # an uploaded SVG must not run scripts
    return FileResponse(f, headers=headers)


# covers come from other sites, which don't allow reading their pixels; the album page needs them for its colours
COVER_HOSTS = ("mzstatic.com", "ytimg.com", "theaudiodb.com", "dzcdn.net", "music.126.net", "wikimedia.org", "hdslb.com")
_covers = httpx.Client(timeout=10, follow_redirects=True, headers={"User-Agent": "Yoinker/1.0 (https://music.sunnygong.com)"})


@app.get("/api/cover")
def cover_proxy(url: str, _=Depends(auth.current_user)):
    host = (urlparse(url).hostname or "").lower()
    if urlparse(url).scheme != "https" or not any(host == h or host.endswith("." + h) for h in COVER_HOSTS):
        raise HTTPException(400, "not a cover")
    r = None
    for _attempt in range(2):   # image CDNs drop the odd connection
        try:
            r = _covers.get(url)
            if r.status_code == 200 and r.headers.get("content-type", "").startswith("image/"):
                break
        except httpx.HTTPError:
            r = None
    if r is None or r.status_code != 200 or not r.headers.get("content-type", "").startswith("image/"):
        raise HTTPException(502, "cover unavailable")
    return Response(r.content, media_type=r.headers["content-type"], headers={"Cache-Control": "private, max-age=604800"})


@app.get("/api/album")
def album_page(key: str, req: Request, user=Depends(auth.current_user)):
    """key: "<artist slug>/<album slug>" or "<artist name>/<album title>"."""
    artist, title = pages.resolve_album(key)
    try:
        a = pages.album(artist, title, i18n.lang_of(req.headers))
    except Exception as e:
        raise HTTPException(502, i18n.tr(f"Couldn't load the album: {e}", f"加载专辑失败：{e}"))
    if not a:
        raise HTTPException(404, i18n.tr("Album not found", "没找到这张专辑"))
    return {**a, "tracks": mark([dict(s) for s in a["tracks"]], user),
            "slug": pages.remember_album(a["artist"], a["title"]), "artist_slug": pages.remember("artist", a["artist"])}


@app.post("/api/songs/quick")
def quick_add(song: CatalogSong, user=Depends(auth.current_user)):
    """快速下载: the store's copy if there is one, else the best upload (YouTube Music's official track first)."""
    try:
        return lib.quick(song.model_dump(), user)
    except LookupError:
        raise HTTPException(404, i18n.tr("No reliable source found: try “Choose source”",
                                         "没找到靠谱的来源，试试「单独选取」"))


@app.post("/api/sources")
def sources(song: CatalogSong, where: str = "youtube", _=Depends(auth.current_user)):
    """单独选取: uploads of a song to choose from, best first."""
    try:
        return cat.candidates(song.model_dump(), where)
    except Exception as e:
        raise HTTPException(502, i18n.tr(f"Search failed: {e}", f"搜索失败：{e}"))


class AddSong(BaseModel):
    source: str
    id: str
    url: str
    title: str = ""
    channel: str = ""
    duration: float | None = None
    thumbnail: str | None = None
    song: CatalogSong | None = None   # the catalog song this upload was picked for (gives it its real name + cover)


@app.post("/api/songs")
def add_song(body: AddSong, user=Depends(auth.current_user)):
    if body.source not in ("youtube", "bilibili"):
        raise HTTPException(400, "bad source")
    if body.duration and body.duration > se.MAX_DURATION:
        raise HTTPException(400, i18n.tr("Too long to be a song", "太长了，不像是一首歌"))
    r = body.model_dump(exclude={"song"})
    return lib.add(r, user, body.song.model_dump() if body.song else None)


@app.get("/api/songs")
def songs(user=Depends(auth.current_user)):
    return lib.library(user)


def _doc_or_404(sid: str) -> dict:
    doc = lib.store.get(sid)
    if not doc or not doc.get("music_status"):
        raise HTTPException(404, i18n.tr("No such song", "没有这首歌"))
    return doc


class RadioRequest(BaseModel):
    seed: str | None = None   # none: something like a random song from their library
    exclude: list[str] = []


@app.post("/api/radio")
def radio(body: RadioRequest, user=Depends(auth.current_user)):
    """Smart play: the next song, like the seed one. It starts downloading now, so it's ready when it's its turn."""
    try:
        song = lib.recommend(body.seed, body.exclude[-200:], user)
    except Exception as e:
        raise HTTPException(502, i18n.tr(f"Recommendations failed: {e}", f"推荐失败：{e}"))
    if not song:
        raise HTTPException(404, i18n.tr("Nothing to recommend", "没有可推荐的歌"))
    return song


class Play(BaseModel):
    song_id: str


@app.post("/api/plays")
def played(body: Play, user=Depends(auth.current_user)):
    """The player reports a song as played (after 30 s, or at its end if shorter)."""
    lib.record_play(body.song_id, user)
    return {"ok": True}


@app.get("/api/plays")
def plays(user=Depends(auth.current_user)):
    return lib.history(user)


@app.post("/api/songs/{sid}/keep")
def keep(sid: str, user=Depends(auth.current_user)):
    """A recommended song goes into the library."""
    _doc_or_404(sid)
    return lib.keep(sid, user)


@app.delete("/api/songs/{sid}")
def remove(sid: str, user=Depends(auth.current_user)):
    """Out of this person's library (the download stays: someone else may have it, and adding it back is instant)."""
    lib.disown(sid, user)
    return {"ok": True}


@app.post("/api/songs/{sid}/retry")
def retry(sid: str, _=Depends(auth.current_user)):
    _doc_or_404(sid)
    lib.store.update(sid, music_status="queued", music_progress=0, music_error=None)
    lib.enqueue(sid)
    return {"ok": True}


@app.get("/api/songs/{sid}/audio")
def audio(sid: str, _=Depends(auth.current_user)):
    _doc_or_404(sid)
    f = lib.store.file(sid, AUDIO)
    if not f:
        raise HTTPException(404, i18n.tr("Not downloaded yet", "还没下载好"))
    return FileResponse(f, media_type="audio/mp4", headers={"Cache-Control": "private, max-age=86400"})


@app.get("/api/songs/{sid}/download")
def download(sid: str, _=Depends(auth.current_user)):
    """The song as a file to keep: tagged with its name, album and cover, named "Artist - Title.m4a"."""
    doc = _doc_or_404(sid)
    if not lib.store.file(sid, AUDIO):
        raise HTTPException(404, i18n.tr("Not downloaded yet", "还没下载好"))
    s = lib.view(doc)
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', " ", f"{s['artist']} - {s['title']}").strip() or sid
    if orig := lib.original(doc):   # someone's own file: give it back exactly as it was imported
        return FileResponse(orig, filename=f"{name[:150]}{orig.suffix}")
    return FileResponse(lib.tagged(sid), media_type="audio/mp4", filename=f"{name[:150]}.m4a")


@app.get("/api/songs/{sid}/cover")
def cover(sid: str, _=Depends(auth.current_user)):
    _doc_or_404(sid)
    f = lib.store.file(sid, "cover.jpg")
    if not f:
        raise HTTPException(404, "no cover")
    return FileResponse(f, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"})


class LinkImport(BaseModel):
    url: str
    title: str = ""
    artist: str = ""
    album: str = ""


@app.post("/api/songs/link")
def import_link(body: LinkImport, user=Depends(auth.current_user)):
    """Import from a YouTube / Bilibili link, with the song's details as typed (blank = worked out from the video)."""
    try:
        return lib.import_link(body.url, body.model_dump(exclude={"url"}), user)
    except lib.ImportRejected as e:
        raise HTTPException(400, _import_message(e.code))


def _import_message(code: str) -> str:
    return {
        "type": i18n.tr("That isn't a music file this can import", "不支持这种文件"),
        "size": i18n.tr("Files can be at most 100 MB", "文件最大 100 MB"),
        "noaudio": i18n.tr("There's no audio in that file", "这个文件里没有声音"),
        "link": i18n.tr("Only YouTube and Bilibili links work", "只支持 YouTube 和 B站链接"),
        "notfound": i18n.tr("Couldn't open that video", "打不开这个视频"),
        "long": i18n.tr("Too long to be a song", "太长了，不像是一首歌"),
        "bili": i18n.tr("Bilibili is blocking downloads right now: try a YouTube link", "B站暂时不让下载，换个 YouTube 链接试试"),
    }[code]


@app.post("/api/songs/upload")
def upload(file: UploadFile = File(...), title: str = Form(""), artist: str = Form(""), album: str = Form(""),
           cover: UploadFile | None = File(None), user=Depends(auth.current_user)):
    """Import: someone's own music file, with the song's details as they typed them (blank = the file's own tags)."""
    try:
        return lib.import_file(file.file, file.filename or "upload", {"title": title, "artist": artist, "album": album},
                               cover.file if cover and cover.filename else None, user)
    except lib.ImportRejected as e:
        raise HTTPException(400, _import_message(e.code))


@app.get("/api/songs/{sid}/lyrics")
def lyrics(sid: str, _=Depends(auth.current_user)):
    doc = _doc_or_404(sid)
    f = lib.store.file(sid, "lyrics.json")
    data = json.loads(f.read_text(encoding="utf-8")) if f else {"lines": []}
    data["offset"] = doc.get("lyrics_offset", 0)   # same convention as the karaoke site: line shows at t + offset
    return data


@app.get("/api/events")
async def events(req: Request, _=Depends(auth.current_user)):
    """Server-sent events: a message whenever the library changes (clients then refetch /api/songs)."""
    async def gen():
        last, idle = None, 0.0
        yield "retry: 2000\n\n"
        while not await req.is_disconnected():
            v = lib.store.version()
            if v != last:
                last, idle = v, 0
                yield f"data: {json.dumps({'version': v})}\n\n"
            else:
                idle += 0.5
                if idle >= 15:
                    idle = 0
                    yield ": ping\n\n"
            await asyncio.sleep(0.5)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------- web app ----------

if WEB.is_dir():
    app.mount("/assets", StaticFiles(directory=WEB / "assets"), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        f = (WEB / path).resolve()
        if path and WEB in f.parents and f.is_file():
            return FileResponse(f)
        return FileResponse(WEB / "index.html", headers={"Cache-Control": "no-cache"})

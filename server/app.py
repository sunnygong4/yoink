"""Yoinker: a private, shared music library. Search -> the server downloads the audio -> everyone can listen."""
import asyncio
import json
import re
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from songstore import AUDIO

import auth
import i18n
import catalog as cat
import library as lib
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
def catalog_search(q: str, _=Depends(auth.current_user)):
    """Songs by name (one per song per artist), each marked if it's in the library or can be added instantly."""
    if not q.strip():
        return []
    try:
        results = cat.search(q)
    except Exception as e:
        raise HTTPException(502, i18n.tr(f"Search failed: {e}", f"搜索失败：{e}"))
    pool = lib.known()
    for r in results:
        doc = lib.find(r, pool)
        in_lib = doc and doc.get("music_status") in lib.IN_LIBRARY
        r["song_id"] = doc["id"] if in_lib else None
        r["instant"] = bool(doc) and not in_lib   # the karaoke site already has it: adding takes a second
    return results


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
def songs(_=Depends(auth.current_user)):
    return lib.library()


def _doc_or_404(sid: str) -> dict:
    doc = lib.store.get(sid)
    if not doc or not doc.get("music_status"):
        raise HTTPException(404, i18n.tr("No such song", "没有这首歌"))
    return doc


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
    return FileResponse(lib.tagged(sid), media_type="audio/mp4", filename=f"{name[:150]}.m4a")


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

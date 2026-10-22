"""Yoinker: a private, shared music library. Search -> the server downloads the audio -> everyone can listen."""
import asyncio
import json
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from songstore import AUDIO

import auth
import library as lib
import search as se

app = FastAPI(title="Yoinker")
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

@app.get("/api/search")
def search(q: str, where: str = "youtube", _=Depends(auth.current_user)):
    if not q.strip():
        return []
    try:
        results = se.search(q, where)
    except Exception as e:
        raise HTTPException(502, f"搜索失败：{e}")
    pool = lib.candidates()
    for r in results:
        doc = lib.existing(r, pool)
        r["song_id"] = doc["id"] if doc and doc.get("music_status") else None   # already in the library
    return results


class AddSong(BaseModel):
    source: str
    id: str
    url: str
    title: str = ""
    channel: str = ""
    duration: float | None = None
    thumbnail: str | None = None


@app.post("/api/songs")
def add_song(body: AddSong, user=Depends(auth.current_user)):
    if body.source not in ("youtube", "bilibili"):
        raise HTTPException(400, "bad source")
    if body.duration and body.duration > se.MAX_DURATION:
        raise HTTPException(400, "太长了，不像是一首歌")
    return lib.add(body.model_dump(), user)


@app.get("/api/songs")
def songs(_=Depends(auth.current_user)):
    return lib.library()


def _doc_or_404(sid: str) -> dict:
    doc = lib.store.get(sid)
    if not doc or not doc.get("music_status"):
        raise HTTPException(404, "没有这首歌")
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
        raise HTTPException(404, "还没下载好")
    return FileResponse(f, media_type="audio/mp4", headers={"Cache-Control": "private, max-age=86400"})


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

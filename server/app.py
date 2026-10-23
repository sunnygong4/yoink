"""Yoinker: a private, shared music library. Search -> the server downloads the audio -> everyone can listen."""
import asyncio
import json
import re
import time
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
import social

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


@app.get("/api/admin")
def admin(user=Depends(auth.current_user)):
    """Everyone, for an admin: their libraries, listening and devices, and what was played lately. Anyone else
    gets a 404, as if there were no such page."""
    if not user["is_admin"]:
        raise HTTPException(404, "Not Found")
    from db import conn
    c = conn()
    people = []
    for u in c.execute("select u.id, u.name, u.is_admin, u.created, i.name as invited_by from users u "
                       "left join users i on i.id = u.invited_by order by u.created"):
        n_songs = c.execute("select count(*) from user_songs where user_id = ?", (u["id"],)).fetchone()[0]
        plays = c.execute("select count(*), max(played_at), sum(radio) from plays where user_id = ?", (u["id"],)).fetchone()
        week = c.execute("select count(*) from plays where user_id = ? and played_at > ?",
                         (u["id"], time.time() - 7 * 86400)).fetchone()[0]
        devices = [dict(d) for d in c.execute("select name, created, last_seen from devices where user_id = ?", (u["id"],))]
        top = [dict(r) for r in c.execute(
            "select artist, count(*) as n from plays where user_id = ? and artist is not null and artist != '' "
            "group by artist order by n desc limit 3", (u["id"],))]
        people.append({"id": u["id"], "name": u["name"], "is_admin": bool(u["is_admin"]), "created": u["created"],
                       "invited_by": u["invited_by"], "songs": n_songs, "plays": plays[0], "last_played": plays[1],
                       "smart_plays": plays[2] or 0, "plays_week": week, "devices": devices, "top_artists": top})
    recent = [dict(r) for r in c.execute(
        "select p.played_at, p.title, p.artist, p.radio, u.name as user from plays p join users u on u.id = p.user_id "
        "order by p.played_at desc limit 40")]
    store = [lib.store.get(sid) for sid in lib.store.ids()]
    songs = [d for d in store if d and d.get("music_status")]
    stats = {"store_songs": len(songs), "ready": sum(d.get("music_status") == "ready" for d in songs),
             "smart_songs": sum(bool(d.get("music_radio")) for d in songs),
             "invites_open": c.execute("select count(*) from invites where (used_by is null or reusable = 1) "
                                       "and (expires is null or expires > ?)", (time.time(),)).fetchone()[0]}
    return {"people": people, "recent": recent, "stats": stats, "invites": auth.invites()}


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
    return auth.create_invite(user["id"])


def _admin(user=Depends(auth.current_user)) -> dict:
    if not user["is_admin"]:
        raise HTTPException(404, "Not Found")   # as if there were no such page
    return user


class NewInvite(BaseModel):
    reusable: bool = False


@app.post("/api/admin/invites")
def admin_invite(body: NewInvite | None = None, user=Depends(_admin)):
    return auth.create_invite(user["id"], reusable=bool(body and body.reusable))


class InviteChange(BaseModel):
    reusable: bool


@app.patch("/api/admin/invites/{code}")
def admin_change_invite(code: str, body: InviteChange, _=Depends(_admin)):
    if not auth.set_reusable(code, body.reusable):
        raise HTTPException(404, i18n.tr("No such invite", "没有这个邀请码"))
    return {"ok": True}


@app.delete("/api/admin/invites/{code}")
def admin_delete_invite(code: str, _=Depends(_admin)):
    if not auth.delete_invite(code):
        raise HTTPException(409, i18n.tr("Already used (or gone)", "已经用过了（或已删除）"))
    return {"ok": True}


# ---------- search + library ----------

class CatalogSong(BaseModel):
    title: str
    artist: str
    album: str | None = None
    duration: float | None = None
    artwork: str | None = None


@app.get("/api/catalog")
def catalog_search(q: str, user=Depends(auth.current_user)):
    """Songs by name (one per song per artist), each marked if it's in the library or already downloaded; plus the
    artists and albums of that name, and the top result when the search is a name (an artist's or an album's)."""
    if not q.strip():
        return {"songs": [], "artists": [], "albums": [], "top": None}
    try:
        songs = cat.search(q)
        artists = cat.artists(q)
        albums = cat.albums(q)
    except Exception as e:
        raise HTTPException(502, i18n.tr(f"Search failed: {e}", f"搜索失败：{e}"))
    # songs that really are what was searched (all its words in the name, artist or album): few means the store
    # hardly knows it, and the web app looks on YouTube too
    matched = sum(cat.relevance(q, x["title"], x["artist"], x.get("album")) == 1 for x in songs)
    return {"songs": mark(songs, user), "artists": artists, "albums": albums, "top": cat.top_result(q, artists, albums, songs),
            "matched": matched}


class AlbumAdd(BaseModel):
    key: str


@app.post("/api/album/add")
def album_add(body: AlbumAdd, req: Request, user=Depends(auth.current_user)):
    """Every track of the album into the library, downloading what isn't on the server yet."""
    artist, title = pages.resolve_album(body.key)
    a = pages.album(artist, title, i18n.lang_of(req.headers))
    if not a:
        raise HTTPException(404, i18n.tr("Album not found", "没找到这张专辑"))
    mine = lib.owned(user)
    pool = lib.known()
    todo = [t for t in a["tracks"] if not ((d := lib.find(t, pool)) and d["id"] in mine)]
    return lib.add_album(todo, user)


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


@app.get("/api/foryou")
def for_you(fresh: bool = False, user=Depends(auth.current_user)):
    """猜你喜欢 (the search page before anything's searched)."""
    return mark(lib.for_you(user, fresh), user)


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


@app.get("/api/suggest")
def suggest(q: str, _=Depends(auth.current_user)):
    """While typing: artists whose name starts like this (the box adds the plain query itself)."""
    if not q.strip():
        return []
    try:
        return cat.suggest(q)
    except Exception:
        return []


@app.post("/api/songs/preview")
def preview(song: CatalogSong, user=Depends(auth.current_user)):
    """▶ on a song that isn't in the library: fetch it just to listen (it goes away later unless someone keeps it)."""
    try:
        return lib.quick(song.model_dump(), user, keep_it=False)
    except LookupError:
        raise HTTPException(404, i18n.tr("No reliable source found: try “Choose source”",
                                         "没找到靠谱的来源，试试「单独选取」"))


@app.post("/api/songs/quick")
def quick_add(song: CatalogSong, user=Depends(auth.current_user)):
    """快速下载: the store's copy if there is one, else the best upload (YouTube Music's official track first)."""
    try:
        return lib.quick(song.model_dump(), user)
    except LookupError:
        raise HTTPException(404, i18n.tr("No reliable source found: try “Choose source”",
                                         "没找到靠谱的来源，试试「单独选取」"))


@app.get("/api/uploads")
def uploads(q: str, user=Depends(auth.current_user)):
    """找不到的歌: YouTube Music songs and YouTube videos for the query; song_id when it's in the library."""
    if not q.strip():
        return []
    try:
        rows = cat.uploads(q)
    except Exception as e:
        raise HTTPException(502, i18n.tr(f"Search failed: {e}", f"搜索失败：{e}"))
    mine = lib.owned(user)
    for r in rows:
        sid = lib.song_id(r["source"], r["id"])
        r["song_id"] = sid if sid in mine else None
    return rows


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
    preview: bool = False             # just to listen (▶): not into the library


@app.post("/api/songs")
def add_song(body: AddSong, user=Depends(auth.current_user)):
    if body.source not in ("youtube", "bilibili"):
        raise HTTPException(400, "bad source")
    if body.duration and body.duration > se.MAX_DURATION:
        raise HTTPException(400, i18n.tr("Too long to be a song", "太长了，不像是一首歌"))
    r = body.model_dump(exclude={"song", "preview"})
    return lib.add(r, user, body.song.model_dump() if body.song else None, radio=body.preview)


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


@app.post("/api/clientlog")
async def client_log(req: Request, user=Depends(auth.current_user)):
    """What a phone's audio is doing (play failed, media errors), into the log: iPhone problems can't be seen otherwise."""
    try:
        body = (await req.body())[:2000].decode("utf-8", "replace")
    except Exception:
        body = "?"
    print(f"[client] {user['name']}: {body}", flush=True)
    return {"ok": True}


class Play(BaseModel):
    song_id: str


# ---------- people: pages, friends, playing now ----------

class NowPlaying(BaseModel):
    song_id: str | None = None
    playing: bool = False


@app.post("/api/now")
def now(body: NowPlaying, user=Depends(auth.current_user)):
    """The player says what it's on (song changes, play / pause), for friends' "playing now"."""
    social.set_now(user, body.song_id, body.playing)
    return {"ok": True}


@app.get("/api/users/{name}")
def user_page(name: str, user=Depends(auth.current_user)):
    return social.profile(user, name)


class ProfileSettings(BaseModel):
    bio: str = ""
    show: dict[str, str] = {}


@app.put("/api/profile")
def save_profile(body: ProfileSettings, user=Depends(auth.current_user)):
    return social.save_settings(user["id"], body.bio, body.show)


@app.get("/api/friends")
def friends(user=Depends(auth.current_user)):
    return social.friends(user)


@app.get("/api/people")
def people(q: str = "", user=Depends(auth.current_user)):
    return social.people(user, q)


@app.post("/api/friends/{name}")
def add_friend(name: str, user=Depends(auth.current_user)):
    return {"relation": social.add_friend(user, name)}


@app.delete("/api/friends/{name}")
def remove_friend(name: str, user=Depends(auth.current_user)):
    return {"relation": social.remove_friend(user, name)}


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
        "bili": i18n.tr("Bilibili changed its site and the downloader can't get through yet (it updates itself daily, so "
                        "this should start working again soon). Try a YouTube link for now",
                        "B站最近改了网站，下载工具暂时进不去（服务器每天会自动更新它，修好后就能用）。先换个 YouTube 链接吧"),
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


class LyricsOffset(BaseModel):
    offset: float


@app.post("/api/songs/{sid}/lyrics-offset")
def lyrics_offset(sid: str, body: LyricsOffset, _=Depends(auth.current_user)):
    """Lyrics a little early or late: the nudge is saved on the song (karaoke reads the same field)."""
    _doc_or_404(sid)
    off = round(max(-30.0, min(30.0, body.offset)), 2)
    lib.store.update(sid, lyrics_offset=off)
    return {"offset": off}


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

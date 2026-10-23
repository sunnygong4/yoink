"""People's pages (/usr/<name>), friends, and what each person is playing right now.

Each part of a page (playing now, recent plays, top artists, library, radio) is either on the page (everyone signed
in sees it), for friends only, or private, as its owner chose. Someone who isn't a friend sees only what's on the page:
with nothing there, just the name. People are found by searching for them, never by browsing a list."""
import json
import random
import threading
import time

from fastapi import HTTPException

import artists
import library as lib
from db import conn
from i18n import tr

SECTIONS = ("now", "recent", "top", "library", "radio")
AUDIENCES = ("everyone", "friends", "nobody")
DEFAULT_SHOW = {"now": "friends", "recent": "friends", "top": "friends", "library": "friends", "radio": "friends"}
NOW_FRESH = 15 * 60   # a song reported longer ago than this isn't "playing now" any more


# ---------- who's who ----------

def user_by_name(name: str) -> dict:
    row = conn().execute("select id, name, is_admin, created from users where name = ?", (name.strip(),)).fetchone()
    if not row:
        raise HTTPException(404, tr("No one by that name", "没有这个人"))
    return dict(row)


def _pair(x: int, y: int) -> tuple[int, int]:
    return (x, y) if x < y else (y, x)


def relation(viewer: int, other: int) -> str:
    """self / friends / sent (viewer asked) / received (they asked) / none."""
    if viewer == other:
        return "self"
    row = conn().execute("select * from friends where a = ? and b = ?", _pair(viewer, other)).fetchone()
    if not row:
        return "none"
    if row["accepted"]:
        return "friends"
    return "sent" if row["requested_by"] == viewer else "received"


def add_friend(viewer: dict, name: str) -> str:
    """Ask to be friends, or accept when they already asked."""
    other = user_by_name(name)
    rel = relation(viewer["id"], other["id"])
    if rel == "self":
        raise HTTPException(400, tr("That's you", "这是你自己"))
    a, b = _pair(viewer["id"], other["id"])
    if rel == "received":
        conn().execute("update friends set accepted = ? where a = ? and b = ?", (time.time(), a, b))
        return "friends"
    if rel == "none":
        conn().execute("insert into friends (a, b, requested_by, created) values (?, ?, ?, ?)", (a, b, viewer["id"], time.time()))
        return "sent"
    return rel


def remove_friend(viewer: dict, name: str) -> str:
    """Unfriend, take back a request, or turn one down."""
    other = user_by_name(name)
    conn().execute("delete from friends where a = ? and b = ?", _pair(viewer["id"], other["id"]))
    return "none"


# ---------- what's on each page ----------

def settings(uid: int) -> dict:
    row = conn().execute("select bio, show from profiles where user_id = ?", (uid,)).fetchone()
    show = dict(DEFAULT_SHOW)
    if row and row["show"]:
        try:
            show.update({k: v for k, v in json.loads(row["show"]).items() if k in SECTIONS and v in AUDIENCES})
        except ValueError:
            pass
    return {"bio": (row["bio"] if row else None) or "", "show": show}


def save_settings(uid: int, bio: str, show: dict) -> dict:
    clean = {k: v for k, v in show.items() if k in SECTIONS and v in AUDIENCES}
    conn().execute("insert into profiles (user_id, bio, show) values (?, ?, ?) on conflict(user_id) do update set "
                   "bio = excluded.bio, show = excluded.show", (uid, bio.strip()[:300], json.dumps({**DEFAULT_SHOW, **clean})))
    return settings(uid)


def _allowed(audience: str, rel: str) -> bool:
    return rel == "self" or audience == "everyone" or (audience == "friends" and rel == "friends")


# ---------- playing now (kept in memory: it only matters while it's true) ----------

_now: dict[int, dict] = {}
_now_lock = threading.Lock()


def set_now(user: dict, song_id: str | None, playing: bool):
    with _now_lock:
        if not song_id:
            _now.pop(user["id"], None)
            return
        _now[user["id"]] = {"song_id": song_id, "playing": playing, "at": time.time()}


def now_playing(uid: int, viewer: dict) -> dict | None:
    with _now_lock:
        n = _now.get(uid)
    if not n or time.time() - n["at"] > NOW_FRESH:
        return None
    doc = lib.store.get(n["song_id"])
    if not doc:
        return None
    return {"song": lib.view_for(doc, viewer), "playing": n["playing"], "at": n["at"]}


# ---------- pages ----------

def _plays(uid: int, limit: int):
    return conn().execute("select song_id, played_at, radio, title, artist, album, thumbnail from plays "
                          "where user_id = ? order by played_at desc limit ?", (uid, limit)).fetchall()


def _their_songs(uid: int, viewer: dict) -> list[dict]:
    mine = lib.owned(viewer)
    theirs = lib.owned({"id": uid})
    out = []
    for sid, added in theirs.items():
        doc = lib.store.get(sid)
        if doc and doc.get("music_status") == "ready":
            v = lib.view_for(doc, viewer, mine)
            v["their_added_at"] = added
            out.append(v)
    out.sort(key=lambda s: s["their_added_at"] or 0, reverse=True)
    return out


def profile(viewer: dict, name: str) -> dict:
    other = user_by_name(name)
    uid = other["id"]
    rel = relation(viewer["id"], uid)
    st = settings(uid)
    show = st["show"]
    c = conn()
    # how many songs / friends: for friends (and the library count when the library is on the page)
    counts = None
    if rel in ("self", "friends") or show["library"] == "everyone":
        counts = {"songs": c.execute("select count(*) from user_songs where user_id = ?", (uid,)).fetchone()[0],
                  "friends": c.execute("select count(*) from friends where (a = ? or b = ?) and accepted is not null",
                                       (uid, uid)).fetchone()[0] if rel in ("self", "friends") else None}
    out = {"name": other["name"], "joined": other["created"], "bio": st["bio"], "relation": rel, "counts": counts,
           "show": show if rel == "self" else None}
    if _allowed(show["now"], rel):
        out["now"] = now_playing(uid, viewer)
    if _allowed(show["recent"], rel):
        seen, recent = set(), []
        for r in _plays(uid, 200):   # each song once, at its latest play
            if r["song_id"] not in seen:
                seen.add(r["song_id"])
                recent.append(dict(r))
        out["recent"] = recent[:20]
    if _allowed(show["top"], rel):
        out["top"] = top_artists(uid, 8)
    songs = None
    if _allowed(show["library"], rel):
        songs = _their_songs(uid, viewer)
        out["library"] = songs
    if _allowed(show["radio"], rel):
        # their station: their own songs, shuffled (smart play carries on with songs like them)
        songs = songs if songs is not None else _their_songs(uid, viewer)
        out["radio"] = random.sample(songs, min(40, len(songs)))
    return out


def top_artists(uid: int, n: int, since_days: float = 90) -> list[dict]:
    """The artists someone played most lately, each counted once whatever the songs called them (邓丽君 = 鄧麗君)."""
    counts: dict[str, dict] = {}
    for r in conn().execute("select artist, thumbnail from plays where user_id = ? and played_at > ? and artist is not null "
                            "and artist != ''", (uid, time.time() - since_days * 86400)):
        name = artists.canonical(r["artist"])
        if name:
            x = counts.setdefault(name, {"artist": name, "n": 0, "thumbnail": None})
            x["n"] += 1
            x["thumbnail"] = x["thumbnail"] or r["thumbnail"]
    return sorted(counts.values(), key=lambda x: -x["n"])[:n]


def friends(viewer: dict) -> dict:
    """The viewer's friends (with what they're playing, where they show it), and requests both ways."""
    c = conn()
    rows = c.execute("select f.*, u.id as uid, u.name from friends f join users u on u.id = (case when f.a = ? then f.b else f.a end) "
                     "where f.a = ? or f.b = ? order by u.name collate nocase", (viewer["id"],) * 3).fetchall()
    out = {"friends": [], "incoming": [], "outgoing": []}
    for r in rows:
        if r["accepted"]:
            show = settings(r["uid"])["show"]
            last = c.execute("select max(played_at) from plays where user_id = ?", (r["uid"],)).fetchone()[0]
            out["friends"].append({"name": r["name"], "since": r["accepted"],
                                   "now": now_playing(r["uid"], viewer) if _allowed(show["now"], "friends") else None,
                                   "last_played": last if _allowed(show["recent"], "friends") else None})
        elif r["requested_by"] == viewer["id"]:
            out["outgoing"].append({"name": r["name"], "at": r["created"]})
        else:
            out["incoming"].append({"name": r["name"], "at": r["created"]})
    return out


def people(viewer: dict, q: str = "") -> list[dict]:
    """People whose name matches the search (to add as friends), with how they relate to the viewer. Only a search:
    nothing for a blank one, and two letters at least (or the whole name), so the list of members can't be read off."""
    q = q.strip()
    if not q:
        return []
    like = f"%{q.replace('%', '').replace('_', '')}%"
    rows = conn().execute("select id, name from users where id != ? and (name = ? or (length(?) >= 2 and name like ?)) "
                          "order by name collate nocase limit 10", (viewer["id"], q, q, like)).fetchall()
    return [{"name": r["name"], "relation": relation(viewer["id"], r["id"])} for r in rows]

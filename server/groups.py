"""听友群: groups of friends with a shared playlist, and listening to it together.

Only friends can be brought into a group (by a member who is their friend). The group's playlist is the songs its
members added, in the order they were added. Listening together: the group has one play state (which song, where
in it, playing or not); everyone who joined it hears the same thing, and any of them can play, pause, skip or seek
for all. The state lives in memory: it only matters while people listen."""
import threading
import time

from fastapi import HTTPException

import library as lib
import social
from db import conn
from i18n import tr

LISTENER_FRESH = 20   # seconds: a listener that hasn't checked in for longer has left


def _group(gid: int) -> dict:
    row = conn().execute("select * from groups where id = ?", (gid,)).fetchone()
    if not row:
        raise HTTPException(404, tr("No such group", "没有这个听友群"))
    return dict(row)


def _members(gid: int) -> list[dict]:
    return [dict(r) for r in conn().execute(
        "select u.id, u.name, m.joined from group_members m join users u on u.id = m.user_id where m.group_id = ? "
        "order by m.joined", (gid,))]


def _member_or_404(gid: int, user: dict) -> dict:
    g = _group(gid)
    if not conn().execute("select 1 from group_members where group_id = ? and user_id = ?", (gid, user["id"])).fetchone():
        raise HTTPException(404, tr("No such group", "没有这个听友群"))   # as if it didn't exist
    return g


def mine(user: dict) -> list[dict]:
    out = []
    for g in conn().execute("select g.* from groups g join group_members m on m.group_id = g.id where m.user_id = ? "
                            "order by g.created desc", (user["id"],)):
        gid = g["id"]
        out.append({"id": gid, "name": g["name"], "members": [m["name"] for m in _members(gid)],
                    "songs": conn().execute("select count(*) from group_songs where group_id = ?", (gid,)).fetchone()[0],
                    "listening": len(_listeners(gid))})
    return out


def create(user: dict, name: str) -> dict:
    name = name.strip()[:60]
    if not name:
        raise HTTPException(400, tr("Give the group a name", "给听友群起个名字"))
    c = conn()
    gid = c.execute("insert into groups (name, owner, created) values (?, ?, ?)", (name, user["id"], time.time())).lastrowid
    c.execute("insert into group_members (group_id, user_id, joined) values (?, ?, ?)", (gid, user["id"], time.time()))
    return {"id": gid}


def add_member(user: dict, gid: int, name: str):
    _member_or_404(gid, user)
    other = social.user_by_name(name)
    if social.relation(user["id"], other["id"]) != "friends":
        raise HTTPException(403, tr("Only your friends can join your groups", "只能拉好友进听友群"))
    conn().execute("insert or ignore into group_members (group_id, user_id, joined) values (?, ?, ?)",
                   (gid, other["id"], time.time()))


def leave(user: dict, gid: int, name: str | None = None):
    """Leave the group, or (the owner) take someone out of it. The last one out ends the group."""
    g = _member_or_404(gid, user)
    who = social.user_by_name(name) if name else user
    if who["id"] != user["id"] and g["owner"] != user["id"]:
        raise HTTPException(403, tr("Only the group's owner can take people out", "只有群主能把人移出去"))
    c = conn()
    c.execute("delete from group_members where group_id = ? and user_id = ?", (gid, who["id"]))
    rest = _members(gid)
    if not rest:
        c.execute("delete from group_songs where group_id = ?", (gid,))
        c.execute("delete from groups where id = ?", (gid,))
        with _lock:
            _sessions.pop(gid, None)
            _listening.pop(gid, None)
    elif g["owner"] == who["id"]:
        c.execute("update groups set owner = ? where id = ?", (rest[0]["id"], gid))   # the longest-standing member


def rename(user: dict, gid: int, name: str):
    _member_or_404(gid, user)
    if name.strip():
        conn().execute("update groups set name = ? where id = ?", (name.strip()[:60], gid))


# ---------- the shared playlist ----------

def _playlist(gid: int, viewer: dict) -> list[dict]:
    mine_ = lib.owned(viewer)
    out = []
    for r in conn().execute("select s.id as row_id, s.song_id, s.added_at, u.name as added_by from group_songs s "
                            "join users u on u.id = s.added_by where s.group_id = ? order by s.added_at, s.id", (gid,)):
        doc = lib.store.get(r["song_id"])
        if doc and doc.get("music_status") == "ready":
            v = lib.view_for(doc, viewer, mine_)
            out.append({**v, "row_id": r["row_id"], "added_by_name": r["added_by"], "added_to_group": r["added_at"]})
    return out


def add_song(user: dict, gid: int, song_id: str):
    _member_or_404(gid, user)
    doc = lib.store.get(song_id)
    if not doc or doc.get("music_status") != "ready":
        raise HTTPException(404, tr("That song isn't ready", "这首歌还没准备好"))
    c = conn()
    if c.execute("select 1 from group_songs where group_id = ? and song_id = ?", (gid, song_id)).fetchone():
        return
    c.execute("insert into group_songs (group_id, song_id, added_by, added_at) values (?, ?, ?, ?)",
              (gid, song_id, user["id"], time.time()))


def remove_song(user: dict, gid: int, row_id: int):
    _member_or_404(gid, user)
    conn().execute("delete from group_songs where group_id = ? and id = ?", (gid, row_id))


# ---------- listening together ----------

_lock = threading.Lock()
_sessions: dict[int, dict] = {}            # group id -> {index, song_id, playing, pos, at, by, rev}
_listening: dict[int, dict[int, float]] = {}   # group id -> {user id: last check-in}


def _listeners(gid: int) -> list[int]:
    now = time.time()
    with _lock:
        people = _listening.get(gid, {})
        return [uid for uid, at in people.items() if now - at < LISTENER_FRESH]


def _state(gid: int, viewer: dict) -> dict:
    with _lock:
        s = dict(_sessions.get(gid) or {})
    names = {m["id"]: m["name"] for m in _members(gid)}
    return {"session": s or None, "song": _song(s, viewer), "listeners": [names.get(u, "?") for u in _listeners(gid)],
            "listening": viewer["id"] in _listeners(gid), "now": time.time()}


def _song(s: dict | None, viewer: dict) -> dict | None:
    """The session's song as the viewer's player needs it (it may not be in their library)."""
    doc = lib.store.get(s["song_id"]) if s else None
    return lib.view_for(doc, viewer) if doc else None


def group(user: dict, gid: int) -> dict:
    g = _member_or_404(gid, user)
    owner = conn().execute("select name from users where id = ?", (g["owner"],)).fetchone()
    friends = [f["name"] for f in social.friends(user)["friends"]]
    members = _members(gid)
    return {"id": gid, "name": g["name"], "owner": owner["name"] if owner else None,
            "members": [{"name": m["name"], "joined": m["joined"]} for m in members],
            "can_add": [f for f in friends if f not in {m["name"] for m in members}],
            "playlist": _playlist(gid, user), **_state(gid, user)}


def session(user: dict, gid: int, heartbeat: bool) -> dict:
    """The play state, for a listener checking in (every couple of seconds) or someone just looking."""
    _member_or_404(gid, user)
    if heartbeat:
        with _lock:
            _listening.setdefault(gid, {})[user["id"]] = time.time()
    return _state(gid, user)


def stop_listening(user: dict, gid: int):
    with _lock:
        _listening.get(gid, {}).pop(user["id"], None)


def control(user: dict, gid: int, action: str, index: int | None = None, pos: float | None = None,
            from_index: int | None = None) -> dict:
    """play / pause / seek / jump (to a song) / next / prev, for everyone listening. "next" carries the song it was
    sent from, so when every listener's player reaches the end at once the group still moves on only once."""
    _member_or_404(gid, user)
    songs = _playlist(gid, user)
    if not songs:
        raise HTTPException(400, tr("The group's playlist is empty", "听友群的歌单还是空的"))
    now = time.time()
    with _lock:
        _listening.setdefault(gid, {})[user["id"]] = now
        s = _sessions.get(gid) or {"index": 0, "song_id": songs[0]["id"], "playing": False, "pos": 0.0, "at": now, "rev": 0}
        cur = s["pos"] + (now - s["at"] if s["playing"] else 0)
        # the playlist may have changed under the session: find its song again
        idx = next((i for i, x in enumerate(songs) if x["id"] == s["song_id"]), min(s["index"], len(songs) - 1))
        if action == "next" and from_index is not None and from_index != idx:
            return _state_unlocked(gid, s, user)   # someone else's "next" got there first
        if action in ("next", "prev", "jump"):
            idx = (idx + 1) % len(songs) if action == "next" else max(0, idx - 1) if action == "prev" else \
                max(0, min(len(songs) - 1, index or 0))
            s.update(index=idx, song_id=songs[idx]["id"], pos=0.0, playing=True)
        elif action == "play":
            s.update(index=idx, song_id=songs[idx]["id"], pos=cur, playing=True)
        elif action == "pause":
            s.update(pos=cur, playing=False)
        elif action == "seek":
            s.update(pos=max(0.0, pos or 0.0))
        else:
            raise HTTPException(400, "unknown action")
        s.update(at=now, by=user["name"], rev=s["rev"] + 1)
        _sessions[gid] = s
        return _state_unlocked(gid, s, user)


def _state_unlocked(gid: int, s: dict, viewer: dict) -> dict:
    now = time.time()
    people = _listening.get(gid, {})
    listeners = [uid for uid, at in people.items() if now - at < LISTENER_FRESH]
    names = {m["id"]: m["name"] for m in _members(gid)}
    return {"session": dict(s), "song": _song(s, viewer), "listeners": [names.get(u, "?") for u in listeners],
            "listening": viewer["id"] in listeners, "now": now}

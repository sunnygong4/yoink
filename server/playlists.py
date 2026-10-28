"""Playlists: each person's own lists of songs (from their library), in the order they put them."""
import time

from fastapi import HTTPException

import library as lib
from db import conn
from i18n import tr

conn().executescript("""
create table if not exists playlists (
    id integer primary key,
    user_id integer not null references users(id),
    name text not null,
    created real not null
);
create table if not exists playlist_songs (
    id integer primary key,
    playlist_id integer not null references playlists(id),
    song_id text not null,
    pos real not null,
    added_at real not null
);
""")


def _own(user: dict, pid: int) -> dict:
    row = conn().execute("select * from playlists where id = ? and user_id = ?", (pid, user["id"])).fetchone()
    if not row:
        raise HTTPException(404, tr("No such playlist", "没有这个播放列表"))
    return dict(row)


def mine(user: dict) -> list[dict]:
    return [{"id": r["id"], "name": r["name"], "songs": r["n"]} for r in conn().execute(
        "select p.id, p.name, count(s.id) as n from playlists p left join playlist_songs s on s.playlist_id = p.id "
        "where p.user_id = ? group by p.id order by p.created", (user["id"],))]


def create(user: dict, name: str) -> dict:
    name = name.strip()[:80]
    if not name:
        raise HTTPException(400, tr("Give the playlist a name", "给播放列表起个名字"))
    pid = conn().execute("insert into playlists (user_id, name, created) values (?, ?, ?)",
                         (user["id"], name, time.time())).lastrowid
    return {"id": pid, "name": name, "songs": 0}


def rename(user: dict, pid: int, name: str):
    _own(user, pid)
    if name.strip():
        conn().execute("update playlists set name = ? where id = ?", (name.strip()[:80], pid))


def delete(user: dict, pid: int):
    _own(user, pid)
    c = conn()
    c.execute("delete from playlist_songs where playlist_id = ?", (pid,))
    c.execute("delete from playlists where id = ?", (pid,))


def songs(user: dict, pid: int) -> dict:
    p = _own(user, pid)
    mine_ = lib.owned(user)
    out = []
    for r in conn().execute("select id, song_id from playlist_songs where playlist_id = ? order by pos, id", (pid,)):
        if doc := lib.store.get(r["song_id"]):
            out.append({**lib.view_for(doc, user, mine_), "row_id": r["id"]})
    return {"id": pid, "name": p["name"], "songs": out}


def add(user: dict, pid: int, ids: list[str]) -> dict:
    """At the end, in the order given; a song already on the list stays where it is."""
    _own(user, pid)
    c = conn()
    have = {r[0] for r in c.execute("select song_id from playlist_songs where playlist_id = ?", (pid,))}
    pos = (c.execute("select max(pos) from playlist_songs where playlist_id = ?", (pid,)).fetchone()[0] or 0) + 1
    added = 0
    for sid in dict.fromkeys(ids):
        if sid in have or not lib.store.get(sid):
            continue
        c.execute("insert into playlist_songs (playlist_id, song_id, pos, added_at) values (?, ?, ?, ?)",
                  (pid, sid, pos, time.time()))
        pos += 1
        added += 1
    return {"added": added}


def remove(user: dict, pid: int, row_id: int):
    _own(user, pid)
    conn().execute("delete from playlist_songs where playlist_id = ? and id = ?", (pid, row_id))


def move(user: dict, pid: int, row_id: int, to: int):
    """The row to index `to` (0-based) of the list."""
    _own(user, pid)
    c = conn()
    rows = [r[0] for r in c.execute("select id from playlist_songs where playlist_id = ? order by pos, id", (pid,))]
    if row_id not in rows:
        return
    rows.remove(row_id)
    rows.insert(max(0, min(to, len(rows))), row_id)
    for i, rid in enumerate(rows):
        c.execute("update playlist_songs set pos = ? where id = ?", (i + 1, rid))

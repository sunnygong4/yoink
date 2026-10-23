"""Yoinker's own data (people, invites, sessions). Songs live in the shared songstore, not here."""
import os
import sqlite3
import threading
from pathlib import Path

DATA = Path(os.environ.get("YOINKER_DATA") or Path(__file__).resolve().parent.parent / "data").resolve()
DATA.mkdir(parents=True, exist_ok=True)

_SCHEMA = """
create table if not exists users (
    id integer primary key,
    name text not null unique collate nocase,
    pw_hash text not null,
    is_admin integer not null default 0,
    invited_by integer references users(id),
    created real not null
);
create table if not exists invites (
    code text primary key,
    created_by integer not null references users(id),
    created real not null,
    used_by integer references users(id)
);
-- each person's library: the songs they added (the downloads themselves are shared, in the song store)
create table if not exists user_songs (
    user_id integer not null references users(id),
    song_id text not null,
    added_at real not null,
    primary key (user_id, song_id)
);
-- readable links: /artist/ZhouJieLun -> 周杰倫, /album/Queen/HotSpace -> ["Queen", "Hot Space"]
create table if not exists slugs (
    kind text not null,
    slug text not null,
    value text not null,
    primary key (kind, slug)
);
-- what each person played (a copy of the song's name: smart-play songs are deleted after a while)
create table if not exists plays (
    id integer primary key,
    user_id integer not null references users(id),
    song_id text not null,
    played_at real not null,
    radio integer not null default 0,   -- smart play brought it (it wasn't in their library)
    title text, artist text, album text, thumbnail text, source text, url text
);
create index if not exists plays_by_user on plays(user_id, played_at);
-- devices that carry music offline (the iPod browser extension); each has its own token
create table if not exists devices (
    id integer primary key,
    user_id integer not null references users(id),
    name text not null,
    token text not null unique,
    created real not null,
    last_seen real
);
-- friends: one row per pair (a < b); accepted is null while the request waits
create table if not exists friends (
    a integer not null references users(id),
    b integer not null references users(id),
    requested_by integer not null references users(id),
    created real not null,
    accepted real,
    primary key (a, b)
);
-- what each person's page shows, and to whom ({"now": "friends", ...}: everyone / friends / nobody)
create table if not exists profiles (
    user_id integer primary key references users(id),
    bio text,
    show text
);
create table if not exists sessions (
    token text primary key,
    user_id integer not null references users(id),
    created real not null
);
"""

_local = threading.local()


def conn() -> sqlite3.Connection:
    c = getattr(_local, "conn", None)
    if c is None:
        c = sqlite3.connect(DATA / "yoinker.db", timeout=10, isolation_level=None)
        c.row_factory = sqlite3.Row
        c.execute("pragma journal_mode=wal")
        c.execute("pragma foreign_keys=on")
        _local.conn = c
    return c


conn().executescript(_SCHEMA)
# invites that run out (added after the first invites, which have none: they never expire)
_cols = {r["name"] for r in conn().execute("pragma table_info(invites)")}
if "expires" not in _cols:
    conn().execute("alter table invites add column expires real")
# reusable invites: anyone may sign up with one until it expires (used_by is then the first who did)
if "reusable" not in _cols:
    conn().execute("alter table invites add column reusable integer not null default 0")
conn().execute("create table if not exists invite_uses (code text not null, user_id integer not null references users(id), "
               "at real not null)")
# uses from before invite_uses was kept: the one each used invite remembers (runs once per invite)
conn().execute("insert into invite_uses (code, user_id, at) select i.code, i.used_by, coalesce(u.created, i.created) "
               "from invites i left join users u on u.id = i.used_by "
               "where i.used_by is not null and i.code not in (select code from invite_uses)")

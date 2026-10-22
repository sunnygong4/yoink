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

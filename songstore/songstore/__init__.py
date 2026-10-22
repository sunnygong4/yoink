"""Shared song store: one catalog (SQLite) + one folder per song, used by both Yoinker and the karaoke site.

Layout under the root (SONGSTORE_ROOT):
    songs.db                 catalog: one JSON document per song + its work key
    library/<song id>/       the song's files, e.g. audio.m4a (music), video.mp4 + stems (karaoke), lyrics.json

Song ids are "<source>-<video id>" (yt-..., bili-..., local-...). The document is a flat dict; fields both
apps understand: id, source, url, title, channel, duration, thumbnail, track, artist, display_title,
display_artist, created, updated. Everything else belongs to whichever app wrote it.

Apps "hold" songs they still need; one app's cleanup never deletes files another app holds.
"""
import json
import os
import shutil
import sqlite3
import threading
import time
from pathlib import Path

from . import keys
from .keys import artist_title, work_key

__all__ = ["Store", "open_store", "keys", "artist_title", "work_key", "AUDIO"]

AUDIO = "audio.m4a"   # the music app's file; AAC so every browser (iOS Safari too) can play it

_SCHEMA = """
create table if not exists songs (
    id text primary key,
    work_key text,
    updated real not null,
    data text not null
);
create index if not exists songs_work_key on songs(work_key);
create table if not exists holds (
    song_id text not null,
    app text not null,
    since real not null,
    primary key (song_id, app)
);
"""


class Store:
    def __init__(self, root: str | os.PathLike):
        self.root = Path(root).resolve()
        self.library = self.root / "library"
        self.library.mkdir(parents=True, exist_ok=True)
        self.db_path = self.root / "songs.db"
        self._local = threading.local()
        self._conn().executescript(_SCHEMA)

    # ---------- plumbing ----------

    def _conn(self) -> sqlite3.Connection:
        c = getattr(self._local, "conn", None)
        if c is None:
            c = sqlite3.connect(self.db_path, timeout=10, isolation_level=None, check_same_thread=False)
            c.execute("pragma journal_mode=wal")
            c.execute("pragma synchronous=normal")
            self._local.conn = c
        return c

    class _Tx:
        def __init__(self, c):
            self.c = c

        def __enter__(self):
            self.c.execute("begin immediate")
            return self.c

        def __exit__(self, exc, *_):
            self.c.execute("rollback" if exc else "commit")

    def _tx(self):
        return self._Tx(self._conn())

    # ---------- songs ----------

    def song_dir(self, sid: str) -> Path:
        return self.library / sid

    def file(self, sid: str, name: str) -> Path | None:
        p = self.song_dir(sid) / name
        return p if p.is_file() else None

    def get(self, sid: str) -> dict | None:
        row = self._conn().execute("select data from songs where id = ?", (sid,)).fetchone()
        return json.loads(row[0]) if row else None

    def update(self, sid: str, **updates) -> dict:
        """Merge fields into the song's document (creating it if needed) and return the new document."""
        with self._tx() as c:
            row = c.execute("select data from songs where id = ?", (sid,)).fetchone()
            doc = json.loads(row[0]) if row else {"id": sid, "created": time.time()}
            doc.update(updates)
            doc["updated"] = time.time()
            c.execute("insert into songs (id, work_key, updated, data) values (?, ?, ?, ?) "
                      "on conflict(id) do update set work_key = excluded.work_key, updated = excluded.updated, "
                      "data = excluded.data",
                      (sid, work_key(doc), doc["updated"], json.dumps(doc, ensure_ascii=False)))
        self.song_dir(sid).mkdir(exist_ok=True)
        return doc

    def all(self) -> list[dict]:
        rows = self._conn().execute("select data from songs order by updated desc").fetchall()
        return [json.loads(r[0]) for r in rows]

    def ids(self) -> set[str]:
        return {r[0] for r in self._conn().execute("select id from songs")}

    def version(self) -> float:
        """Changes whenever any song changes (cheap polling for live updates)."""
        return self._conn().execute("select coalesce(max(updated), 0) from songs").fetchone()[0]

    def same_work(self, doc: dict) -> list[dict]:
        """Other songs that are the same recording (same work key, about the same length)."""
        key = work_key(doc)
        if not key:
            return []
        rows = self._conn().execute("select data from songs where work_key = ? and id != ?",
                                    (key, doc.get("id") or "")).fetchall()
        return [d for d in (json.loads(r[0]) for r in rows)
                if keys.same_length(d.get("duration"), doc.get("duration"))]

    def delete(self, sid: str):
        with self._tx() as c:
            c.execute("delete from songs where id = ?", (sid,))
            c.execute("delete from holds where song_id = ?", (sid,))
        shutil.rmtree(self.song_dir(sid), ignore_errors=True)

    # ---------- holds ----------

    def hold(self, sid: str, app: str):
        with self._tx() as c:
            c.execute("insert or ignore into holds (song_id, app, since) values (?, ?, ?)", (sid, app, time.time()))

    def release(self, sid: str, app: str):
        with self._tx() as c:
            c.execute("delete from holds where song_id = ? and app = ?", (sid, app))

    def holders(self, sid: str) -> set[str]:
        return {r[0] for r in self._conn().execute("select app from holds where song_id = ?", (sid,))}

    def held(self, app: str) -> set[str]:
        return {r[0] for r in self._conn().execute("select song_id from holds where app = ?", (app,))}

    # ---------- migration ----------

    def rekey(self) -> int:
        """Recompute every work key (after the normalisation rules change)."""
        with self._tx() as c:
            rows = c.execute("select id, data from songs").fetchall()
            for sid, data in rows:
                c.execute("update songs set work_key = ? where id = ?", (work_key(json.loads(data)), sid))
        return len(rows)

    def import_meta_json(self) -> int:
        """Adopt song folders that only have a karaoke-era meta.json (idempotent)."""
        known, n = self.ids(), 0
        for d in self.library.iterdir():
            p = d / "meta.json"
            if d.is_dir() and d.name not in known and p.is_file():
                try:
                    meta = json.loads(p.read_text(encoding="utf-8"))
                except ValueError:
                    continue
                meta["id"] = d.name
                self.update(d.name, **meta)
                n += 1
        return n


_stores: dict[Path, Store] = {}


def open_store(root: str | os.PathLike | None = None) -> Store:
    """The store at `root`, or $SONGSTORE_ROOT. One Store object per root per process."""
    root = Path(root or os.environ.get("SONGSTORE_ROOT") or "songstore").resolve()
    if root not in _stores:
        _stores[root] = Store(root)
    return _stores[root]

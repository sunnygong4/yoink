"""One name per artist, whatever a song calls them: 鄧麗君 / 邓丽君 / Teresa Teng / テレサ・テン, 周杰倫 / Jay Chou,
林俊傑 / JJ林俊傑. Every name an artist page finds (the stores' own spellings, NetEase's aliases, Wikidata's English
name) points at the name the page shows; songs, the library, artist pages and play counts all go by that."""
import re
import threading
import time

from songstore.keys import flat

from db import conn

conn().execute("create table if not exists artist_aliases (alias text primary key, canonical text not null, at real not null)")
conn().execute("create table if not exists artist_checked (name text primary key, at real not null)")

_lock = threading.Lock()
_alias: dict[str, str] = {}
_CJK = re.compile(r"[㐀-鿿぀-ヿ가-힣]+")
_SPLIT = re.compile(r"\s*(?:&|,|/|、| x | feat\.?| ft\.?)\s*", re.I)


def _load():
    with _lock:
        _alias.clear()
        _alias.update({r["alias"]: r["canonical"] for r in conn().execute("select alias, canonical from artist_aliases")})


_load()


def lead(artist: str) -> str:
    """The first credited artist: "Queen & David Bowie" -> "Queen"."""
    return _SPLIT.split(artist or "")[0].strip()


def is_group_credit(name: str) -> bool:
    """ "周杰倫 & Kobe Bryant", "A, B & C": several artists, not another name for one."""
    return len(_SPLIT.split(name or "")) > 1


def remember(canonical: str, names: list[str]):
    """These names are all the artist the page calls `canonical`."""
    if not canonical:
        return
    rows = {flat(n): canonical for n in [canonical, *names] if n and flat(n)}
    now = time.time()
    c = conn()
    for k, v in rows.items():
        c.execute("insert into artist_aliases (alias, canonical, at) values (?, ?, ?) on conflict(alias) do update set "
                  "canonical = excluded.canonical, at = excluded.at", (k, v, now))
    with _lock:
        _alias.update(rows)


def canonical(artist: str | None) -> str:
    """The artist's own name for a song's artist ("" when there's none). Unknown: the lead artist as written, or for
    a name in two scripts ("JJ林俊傑", "陳奕迅 Eason Chan") the part that's a known artist."""
    name = lead(artist or "")
    if not name:
        return ""
    with _lock:
        hit = _alias.get(flat(name))
        if hit:
            return hit
        for part in [*_CJK.findall(name), _CJK.sub(" ", name).strip()]:
            if part and (hit := _alias.get(flat(part))):
                return hit
    return name


def key(artist: str | None) -> str:
    """What "the same artist" is compared by."""
    return flat(canonical(artist))


# ---------- learning every artist on the server's names (in the background, once a week each) ----------

def checked_recently(name: str, days: float = 7) -> bool:
    row = conn().execute("select at from artist_checked where name = ?", (flat(name),)).fetchone()
    return bool(row) and time.time() - row["at"] < days * 86400


def mark_checked(name: str):
    conn().execute("insert into artist_checked (name, at) values (?, ?) on conflict(name) do update set at = excluded.at",
                   (flat(name), time.time()))


def learn(names: list[str], lookup):
    """Look up each artist page (which remembers its names) that hasn't been looked at lately, slowly."""
    for name in names:
        if not name or checked_recently(name):
            continue
        try:
            lookup(name)
        except Exception as e:   # one artist failing (a hiccup, or no such artist) doesn't stop the rest
            print(f"[artists] {name}: {e}")
        mark_checked(name)
        time.sleep(2)

"""Artist and album pages: who they are (photo, logo, bio), their albums, an album's tracks.

Sources: iTunes (albums, tracks, artwork), TheAudioDB (band photo, logo, biography; public test key "123"),
NetEase (Chinese-language artists: photo, other names), Wikidata (logo, photo), Deezer (photo). Names must
match exactly: a wrong artist's picture is worse than none. Everything is cached for a day; pictures people
upload (data/artists/<name>/) override all of it.
"""
import json
import re
import threading
import time
from pathlib import Path
from urllib.parse import quote, unquote, urlencode

import httpx
from songstore.keys import flat, norm

import catalog
from db import DATA, conn

_client = httpx.Client(timeout=10, headers={"User-Agent": "Mozilla/5.0"}, follow_redirects=True)
_cache: dict[tuple, tuple[float, object]] = {}
_lock = threading.Lock()
TTL = 24 * 3600
AUDIODB = "https://www.theaudiodb.com/api/v1/json/123"


def _cached(key: tuple, make):
    with _lock:
        hit = _cache.get(key)
    if hit and time.time() - hit[0] < TTL:
        return hit[1]
    value = make()
    with _lock:
        _cache[key] = (time.time(), value)
    return value


def _country(name: str) -> str:
    return "TW" if catalog._CJK.search(name) else "US"


def _art(url: str | None, size: int = 600) -> str | None:
    return url.replace("100x100bb", f"{size}x{size}bb") if url else None


def _song(t: dict) -> dict:
    """An iTunes track as a catalog song (what the search page shows and 快速下载 takes)."""
    title = catalog.clean_title(t["trackName"])
    return {"key": catalog.song_key(t["artistName"], t["trackName"]), "title": title, "artist": t["artistName"],
            "album": t.get("collectionName") or "", "duration": round((t.get("trackTimeMillis") or 0) / 1000) or None,
            "artwork": _art(t.get("artworkUrl100")), "year": (t.get("releaseDate") or "")[:4], "versions": 1,
            "track": t.get("trackNumber"), "disc": t.get("discNumber")}


# ---------- artist ----------

def _itunes_artist(name: str) -> dict | None:
    r = _client.get("https://itunes.apple.com/search",
                    params={"term": name, "entity": "musicArtist", "limit": 10, "country": _country(name)}).json()
    hits = r.get("results") or []
    return next((a for a in hits if flat(a["artistName"]) == flat(name)), hits[0] if hits else None)


def _same(a: str | None, b: str | None) -> bool:
    """Same artist name, ignoring case, spacing and traditional/simplified Chinese."""
    return bool(a and b) and norm(a) == norm(b)


def _audiodb(name: str) -> dict | None:
    try:
        rows = _client.get(f"{AUDIODB}/search.php", params={"s": name}).json().get("artists") or []
    except (httpx.HTTPError, ValueError):
        return None
    return next((a for a in rows if _same(a.get("strArtist"), name) or _same(a.get("strArtistAlternate"), name)), None)


def _deezer(name: str) -> dict | None:
    """The most-followed Deezer artist with exactly this name (there are many "Queen"s; and Deezer answers
    陳奕迅 with "Toto", so a near miss is worse than nothing)."""
    try:
        rows = _client.get("https://api.deezer.com/search/artist", params={"q": name}).json().get("data") or []
    except (httpx.HTTPError, ValueError):
        return None
    same = [a for a in rows if _same(a["name"], name)]
    return max(same, key=lambda a: a.get("nb_fan") or 0) if same else None


def _netease(name: str) -> dict | None:
    """NetEase knows Chinese-language artists best: their photo, and their other names (五月天 = Mayday)."""
    rows = []
    for attempt in range(2):   # NetEase now and then answers with nothing; once more usually works
        try:
            r = _client.get("https://music.163.com/api/search/get", params={"s": name, "type": 100, "limit": 5},
                            headers={"Referer": "https://music.163.com/"}).json()
            rows = (r.get("result") or {}).get("artists") or []
        except (httpx.HTTPError, ValueError):
            rows = []
        if rows:
            break
        time.sleep(0.6)
    return next((a for a in rows if _same(a.get("name"), name) or any(_same(x, name) for x in a.get("alias") or [])), None)


WIKI_FILE = "https://commons.wikimedia.org/wiki/Special:FilePath/{}?width=1200"
# Wikimedia refuses anonymous browser-like clients (403): say who we are
WIKI_HEADERS = {"User-Agent": "Yoinker/1.0 (https://music.sunnygong.com; private music library)"}


def _wikidata(names: list[str]) -> dict:
    """A logo (P154), a photo (P18) and the English name from Wikidata, for the first entity that is a music
    artist (has a MusicBrainz id) with one of these names."""
    for name in names:
        for lang in ("zh", "en"):
            try:
                hits = _client.get("https://www.wikidata.org/w/api.php", headers=WIKI_HEADERS, params={
                    "action": "wbsearchentities", "search": name, "language": lang, "format": "json", "limit": 3}).json()
            except (httpx.HTTPError, ValueError):
                return {}
            for e in hits.get("search") or []:
                if not (_same(e.get("label"), name) or _same((e.get("match") or {}).get("text"), name)):
                    continue
                try:
                    entity = _client.get(f"https://www.wikidata.org/wiki/Special:EntityData/{e['id']}.json",
                                         headers=WIKI_HEADERS).json()[
                        "entities"][e["id"]]
                except (httpx.HTTPError, ValueError, KeyError):
                    continue
                claims = entity.get("claims", {})
                if "P434" not in claims:   # no MusicBrainz artist id: not a musician (a film, a place...)
                    continue

                def first(prop):
                    return ((claims.get(prop) or [{}])[0].get("mainsnak", {}).get("datavalue") or {}).get("value")

                return {"logo": first("P154") and WIKI_FILE.format(first("P154")),
                        "photo": first("P18") and WIKI_FILE.format(first("P18")),
                        "english": ((entity.get("labels") or {}).get("en") or {}).get("value"),
                        "wikipedia": {lang: ((entity.get("sitelinks") or {}).get(f"{lang}wiki") or {}).get("title")
                                      for lang in ("zh", "en")}}
    return {}


INCOMPLETE_TTL = 600   # no photo found: likely a flaky source (NetEase), so look again in ten minutes


def _wikipedia(lang: str, title: str | None) -> str | None:
    """The opening of the artist's Wikipedia article (simplified Chinese for zh)."""
    if not title:
        return None
    try:
        r = _client.get(f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/{quote(title.replace(' ', '_'))}",
                        headers={**WIKI_HEADERS, "Accept-Language": "zh-CN" if lang == "zh" else "en"})
        return r.json().get("extract") if r.status_code == 200 else None
    except (httpx.HTTPError, ValueError):
        return None


def artist(name: str, lang: str) -> dict:
    key = ("artist", flat(name))
    with _lock:
        hit = _cache.get(key)
    if hit and not hit[1]["photo"] and time.time() - hit[0] > INCOMPLETE_TTL:
        with _lock:
            _cache.pop(key, None)
    a = dict(_cached(key, lambda: _artist(name)))
    bios = a.pop("bios")
    a["bio"] = (bios.get("zh") if lang == "zh" else None) or bios.get("en")
    return {**a, **overrides(a["name"])}


def _artist(name: str) -> dict:
    it = _itunes_artist(name)
    shown = it["artistName"] if it else name
    ne = _netease(shown)
    wiki = _wikidata([shown])
    # every name the artist goes by: the databases with logos and bios mostly know 周杰倫 as "Jay Chou"
    # (NetEase and Wikidata both know that; NetEase is the flakier of the two)
    names = [shown]
    for x in [*((ne or {}).get("alias") or []), wiki.get("english")]:
        if x and not any(_same(x, n) for n in names):
            names.append(x)
    deezer = next((d for d in map(_deezer, names) if d), None)
    adb = next((a for a in map(_audiodb, names) if a), None)
    pedia = wiki.get("wikipedia") or {}
    bios = {"en": (adb or {}).get("strBiographyEN") or _wikipedia("en", pedia.get("en")),
            "zh": (adb or {}).get("strBiographyCN") or _wikipedia("zh", pedia.get("zh"))}
    albums, top = [], []
    if it:
        rows = _client.get("https://itunes.apple.com/lookup", params={
            "id": it["artistId"], "entity": "album", "limit": 200, "country": _country(shown)}).json().get("results") or []
        seen = set()
        for a in rows:
            if a.get("wrapperType") != "collection":
                continue
            k = norm(catalog.clean_title(a["collectionName"]))
            if k in seen:
                continue
            seen.add(k)
            albums.append({"title": a["collectionName"], "artist": a.get("artistName") or shown,
                           "year": (a.get("releaseDate") or "")[:4], "artwork": _art(a.get("artworkUrl100"), 400),
                           "tracks": a.get("trackCount"),
                           "single": bool(re.search(r"\s-\s(single|ep)$", a["collectionName"], re.I)) or (a.get("trackCount") or 0) <= 3})
        albums.sort(key=lambda a: (a["single"], -int(a["year"] or 0)))
        songs = _client.get("https://itunes.apple.com/lookup", params={
            "id": it["artistId"], "entity": "song", "limit": 40, "country": _country(shown)}).json().get("results") or []
        keys = set()
        for t in songs:
            if t.get("wrapperType") != "track" or not t.get("trackName"):
                continue
            s = _song(t)
            if s["key"] not in keys:
                keys.add(s["key"])
                top.append(s)
        top.sort(key=lambda s: flat(s["artist"]) != flat(shown))   # stable: keeps iTunes' order within each group
        top = top[:15]
    deezer_photo = (deezer or {}).get("picture_xl")
    if deezer_photo and "/artist//" in deezer_photo:   # Deezer's placeholder when it has no picture
        deezer_photo = None
    netease_photo = (ne or {}).get("picUrl") or None
    if netease_photo:
        netease_photo = netease_photo.replace("http://", "https://") + "?param=800y800"
    photo = (adb or {}).get("strArtistThumb") or netease_photo or wiki.get("photo") or deezer_photo
    return {
        "name": shown,
        "aliases": names[1:],
        "photo": photo,
        "logo": (adb or {}).get("strArtistLogo") or wiki.get("logo"),
        "background": (adb or {}).get("strArtistFanart") or (adb or {}).get("strArtistWideThumb") or wiki.get("photo") or photo,
        "bios": bios,
        "genre": (adb or {}).get("strGenre") or (it or {}).get("primaryGenreName"),
        "formed": (adb or {}).get("intFormedYear"),
        "albums": albums,
        "top": top,
    }


# ---------- pictures people uploaded (a band's logo nobody has online...) ----------

MEDIA_KINDS = ("logo", "photo", "background")


def media_dir(name: str) -> Path:
    return DATA / "artists" / (norm(name) or "unknown")


def media_file(name: str, kind: str) -> Path | None:
    d = media_dir(name)
    return next(iter(sorted(d.glob(f"{kind}.*"))), None) if d.is_dir() else None


def overrides(name: str) -> dict:
    """Uploaded pictures win over what the databases have."""
    out = {}
    for kind in MEDIA_KINDS:
        if f := media_file(name, kind):
            out[kind] = f"/api/artist/media?{urlencode({'name': name, 'kind': kind, 'v': int(f.stat().st_mtime)})}"
    return out


def save_media(name: str, kind: str, data: bytes, ext: str):
    d = media_dir(name)
    d.mkdir(parents=True, exist_ok=True)
    for old in d.glob(f"{kind}.*"):
        old.unlink()
    (d / f"{kind}{ext}").write_bytes(data)


# ---------- album ----------

def album(artist_name: str, title: str, lang: str) -> dict | None:
    return _cached(("album", flat(artist_name), flat(title), lang), lambda: _album(artist_name, title, lang))


def _album(artist_name: str, title: str, lang: str) -> dict | None:
    rows = _client.get("https://itunes.apple.com/search", params={
        "term": f"{artist_name} {title}", "entity": "album", "limit": 25,
        "country": _country(f"{artist_name}{title}")}).json().get("results") or []
    want = flat(catalog.clean_title(title))
    lead = flat(catalog.lead_artist(artist_name))

    def score(a):
        t = flat(catalog.clean_title(a["collectionName"]))
        return (t == want) * 4 + (want in t) * 2 + (lead in flat(a.get("artistName"))) * 3 - ("deluxe" in t) * .5

    best = max(rows, key=score, default=None)
    if not best or score(best) < 4:
        return None
    tracks = _client.get("https://itunes.apple.com/lookup", params={
        "id": best["collectionId"], "entity": "song", "country": _country(f"{artist_name}{title}")}).json().get("results") or []
    songs = [_song(t) for t in tracks if t.get("wrapperType") == "track" and t.get("trackName")]
    songs.sort(key=lambda s: (s["disc"] or 1, s["track"] or 0))
    description = None
    try:
        a = (_client.get(f"{AUDIODB}/searchalbum.php", params={"s": best["artistName"], "a": best["collectionName"]})
             .json().get("album") or [None])[0]
        if a:
            description = (a.get("strDescriptionCN") if lang == "zh" else None) or a.get("strDescriptionEN")
    except (httpx.HTTPError, ValueError):
        pass
    return {"title": best["collectionName"], "artist": best["artistName"], "year": (best.get("releaseDate") or "")[:4],
            "artwork": _art(best.get("artworkUrl100")), "genre": best.get("primaryGenreName"),
            "copyright": best.get("copyright"), "description": description, "tracks": songs}


# ---------- readable links ----------

def slug(text: str) -> str:
    """"John Lennon" -> JohnLennon, "周杰倫" -> ZhouJieLun, "Hot Space (Deluxe Edition)" -> HotSpaceDeluxeEdition."""
    from pypinyin import lazy_pinyin
    words = []
    for part in lazy_pinyin(text):   # Chinese characters become pinyin syllables; other text passes through
        words += re.findall(r"[^\W_]+", part)
    return "".join(w[:1].upper() + w[1:] for w in words) or "x"


def remember(kind: str, name: str) -> str:
    """The slug for a name, stored so the link works for whoever opens it (pinyin can't be turned back)."""
    s = slug(name)
    conn().execute("insert or replace into slugs (kind, slug, value) values (?, ?, ?)", (kind, s, name))
    return s


def remember_album(artist_name: str, title: str) -> str:
    s = f"{slug(artist_name)}/{slug(title)}"
    conn().execute("insert or replace into slugs (kind, slug, value) values ('album', ?, ?)",
                   (s, json.dumps([artist_name, title], ensure_ascii=False)))
    return s


def resolve(kind: str, key: str) -> str:
    row = conn().execute("select value from slugs where kind = ? and slug = ?", (kind, key)).fetchone()
    if row:
        return row["value"]
    if re.fullmatch(r"[A-Za-z0-9]+", key) and re.search(r"[a-z][A-Z]", key):
        return re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", key)   # a slug we haven't seen: JohnLennon -> John Lennon
    return key


def resolve_album(key: str) -> tuple[str, str]:
    row = conn().execute("select value from slugs where kind = 'album' and slug = ?", (key,)).fetchone()
    if row:
        artist_name, title = json.loads(row["value"])
        return artist_name, title
    artist_key, _, title = (unquote(x) for x in key.partition("/"))   # names come URL-encoded, one per part
    return resolve("artist", artist_key), resolve("album-title", title)

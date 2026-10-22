"""Artist and album pages: who they are (photo, logo, bio), their albums, an album's tracks.

Sources: iTunes (albums, tracks, artwork), TheAudioDB (band photo, logo, biography; public test key "123"),
Deezer (artist photo when TheAudioDB has none). Everything is cached for a day.
"""
import re
import threading
import time

import httpx
from songstore.keys import flat, norm

import catalog

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


def _audiodb(name: str) -> dict | None:
    try:
        rows = _client.get(f"{AUDIODB}/search.php", params={"s": name}).json().get("artists") or []
    except (httpx.HTTPError, ValueError):
        return None
    return next((a for a in rows if flat(a.get("strArtist")) == flat(name)), rows[0] if rows else None)


def _deezer(name: str) -> dict | None:
    """The most-followed Deezer artist with this name (there are many "Queen"s)."""
    try:
        rows = _client.get("https://api.deezer.com/search/artist", params={"q": name}).json().get("data") or []
    except (httpx.HTTPError, ValueError):
        return None
    same = [a for a in rows if flat(a["name"]) == flat(name)] or rows[:1]
    return max(same, key=lambda a: a.get("nb_fan") or 0) if same else None


def artist(name: str, lang: str) -> dict:
    return _cached(("artist", flat(name), lang), lambda: _artist(name, lang))


def _artist(name: str, lang: str) -> dict:
    it = _itunes_artist(name)
    shown = it["artistName"] if it else name
    deezer = _deezer(shown)
    # TheAudioDB knows most bands by their English name: 周杰倫 is "Jay Chou" there (Deezer tells us that)
    adb = _audiodb(shown) or (deezer and flat(deezer["name"]) != flat(shown) and _audiodb(deezer["name"])) or None
    bio = None
    if adb:
        bio = (adb.get("strBiographyCN") if lang == "zh" else None) or adb.get("strBiographyEN")
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
    photo = (adb or {}).get("strArtistThumb") or deezer_photo
    return {
        "name": shown,
        "photo": photo,
        "logo": (adb or {}).get("strArtistLogo"),
        "background": (adb or {}).get("strArtistFanart") or (adb or {}).get("strArtistWideThumb") or photo,
        "bio": bio,
        "genre": (adb or {}).get("strGenre") or (it or {}).get("primaryGenreName"),
        "formed": (adb or {}).get("intFormedYear"),
        "albums": albums,
        "top": top,
    }


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

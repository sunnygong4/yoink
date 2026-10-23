"""Artist and album pages: who they are (photo, logo, bio), their albums, an album's tracks.

Sources: iTunes (albums, tracks, artwork), TheAudioDB (band photo, logo, biography; public test key "123"),
NetEase (Chinese-language artists: photo, other names), Wikidata (logo, photo), Deezer (photo). Names must
match exactly: a wrong artist's picture is worse than none. Everything is cached for a day; pictures people
upload (data/artists/<name>/) override all of it.
"""
import hashlib
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
TTL = {"artist": 7 * 24 * 3600, "album": 30 * 24 * 3600, "songs": 7 * 24 * 3600}   # on disk too: a restart doesn't refetch everything
CACHE_DIR = DATA / "cache" / "pages"
AUDIODB = "https://www.theaudiodb.com/api/v1/json/123"


def _cache_file(key: tuple) -> Path:
    return CACHE_DIR / (hashlib.sha1(json.dumps(key, ensure_ascii=False).encode()).hexdigest() + ".json")


def _cache_get(key: tuple) -> tuple[float, object] | None:
    with _lock:
        hit = _cache.get(key)
    if hit:
        return hit
    f = _cache_file(key)
    try:
        saved = json.loads(f.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    hit = (saved["t"], saved["v"])
    with _lock:
        _cache[key] = hit
    return hit


def _cache_drop(key: tuple):
    with _lock:
        _cache.pop(key, None)
    _cache_file(key).unlink(missing_ok=True)


def _cached(key: tuple, make):
    hit = _cache_get(key)
    if hit and time.time() - hit[0] < TTL[key[0]]:
        return hit[1]
    value = make()
    now = time.time()
    with _lock:
        _cache[key] = (now, value)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    tmp = _cache_file(key).with_suffix(".tmp")
    tmp.write_text(json.dumps({"t": now, "v": value}, ensure_ascii=False), encoding="utf-8")
    tmp.replace(_cache_file(key))
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


# ---------- an artist's songs, by language (鄧麗君 sang in Mandarin, Cantonese, Japanese, Taiwanese, English) ----------

LANGS = ("zh", "yue", "ja", "en", "ko", "nan", "other")   # 国语 粤语 日语 English 韩语 台语
_GENRE_LANG = [
    (re.compile(r"(?i)canto|粵語|粤语|廣東|广东|香港流行|広東"), "yue"),
    (re.compile(r"(?i)tai-pop|台語|台语|閩南|闽南"), "nan"),
    (re.compile(r"(?i)mando|華語|华语|國語|国语|マンドポップ|台灣流行|c-pop"), "zh"),
    (re.compile(r"(?i)j-pop|日本流行|歌謡曲|演歌|enka|anime|アニメ|j-rock"), "ja"),
    (re.compile(r"(?i)k-pop|韓國|韩国|韓国"), "ko"),
]
_KANA = re.compile(r"[぀-ヿ]")
_HANGUL = re.compile(r"[가-힣]")
_HAN = re.compile(r"[㐀-鿿]")
_KATAKANA_ONLY = re.compile(r"[゠-ヿ\s・ー\-()（）!?！？'’.,&]+")


def _lang_of(t: dict) -> str:
    """The language a track is sung in: kana / hangul in its name say so; else its genre (the stores file songs under
    Mandopop / Cantopop / J-Pop…); else an all-Latin name is English and a Chinese one Mandarin."""
    name = t.get("trackName") or ""
    if _KANA.search(name):
        return "ja"
    if _HANGUL.search(name):
        return "ko"
    genre = t.get("primaryGenreName") or ""
    for rx, lang in _GENRE_LANG:
        if rx.search(genre):
            return lang
    if _HAN.search(name):
        return "zh"
    return "en" if re.search(r"[A-Za-z]", name) else "other"


def artist_songs(name: str) -> dict:
    return _cached(("songs", flat(name)), lambda: _artist_songs(name))


def _artist_songs(name: str) -> dict:
    """Every song the stores have by the artist (each store knows its own part: Hong Kong the Cantonese songs, Japan the
    Japanese ones), one per song per language, in each store's own order (roughly how popular they are)."""
    it = _itunes_artist(name)
    if not it:
        return {"songs": [], "langs": {}}
    stores = list(dict.fromkeys((_country(name), "HK", "JP", "TW", "US", "KR")))

    def fetch(country):
        try:
            return _client.get("https://itunes.apple.com/lookup", params={
                "id": it["artistId"], "entity": "song", "limit": 200, "country": country}).json().get("results") or []
        except (httpx.HTTPError, ValueError):
            return []

    import concurrent.futures
    with concurrent.futures.ThreadPoolExecutor(len(stores)) as ex:
        lists = list(ex.map(fetch, stores))
    # one track is in several stores under each store's own name (Queen's in Japan: ドント・ストップ・ミー・ナウ;
    # her Japanese songs in Taiwan: 任時光自身畔流逝): merge by track, named by the store of the song's language
    home_of = {"ja": "JP", "yue": "HK", "zh": "TW", "nan": "TW", "ko": "KR", "en": "US"}
    tracks: dict[int, dict[str, dict]] = {}
    order: list[int] = []
    for country, rows in zip(stores, lists):
        for t in rows:
            if t.get("wrapperType") != "track" or not t.get("trackName") or t.get("artistId") != it["artistId"]:
                continue
            if t["trackId"] not in tracks:
                tracks[t["trackId"]] = {}
                order.append(t["trackId"])
            tracks[t["trackId"]][country] = t
    out, seen = [], {}
    for tid in order:
        by = tracks[tid]
        first = by[next(iter(by))]
        # the language from the store where the name is the song's own (kana in Japan's are Japanese only there)
        lang = _lang_of(by.get("US") or by.get("TW") or first) if len(by) > 1 else _lang_of(first)
        if "JP" in by and (_KANA.search(by["JP"]["trackName"]) and len(by) == 1 or _lang_of(by["JP"]) == "ja" and lang != "en"):
            lang = _lang_of(by["JP"])
        t = by.get(home_of.get(lang, "")) or first
        # a foreign song's name spelled in katakana by the Japanese store (Queen's ハマー・トゥ・フォール), filed as Rock,
        # not J-Pop: a Japanese release of a song the other stores have under its own name
        if _KATAKANA_ONLY.fullmatch(catalog.clean_title(t["trackName"])) and not any(rx.search(t.get("primaryGenreName") or "") for rx, _ in _GENRE_LANG):
            continue
        # ...and a track only the Japanese store has, filed under a foreign genre: a Japanese release of a foreign song
        # under a translated name (Queen's 伝説のチャンピオン)
        if set(by) == {"JP"} and not any(rx.search(t.get("primaryGenreName") or "") and lg == "ja" for rx, lg in _GENRE_LANG)                 and _lang_of({**t, "trackName": ""}) != "ja" and _country(name) != "JP":
            continue
        k = (lang, norm(catalog.clean_title(t["trackName"])))
        if k in seen:
            seen[k]["versions"] += 1
            continue
        song = {**_song(t), "lang": lang}
        seen[k] = song
        out.append(song)
    # Japanese songs under their Japanese names first (the Taiwan store sells some of hers with Chinese titles)
    out.sort(key=lambda x: x["lang"] == "ja" and not _KANA.search(x["title"]))
    langs = {}
    for s in out:
        langs[s["lang"]] = langs.get(s["lang"], 0) + 1
    return {"songs": out, "langs": dict(sorted(langs.items(), key=lambda kv: -kv[1]))}


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
    hit = _cache_get(key)
    if hit and not hit[1]["photo"] and time.time() - hit[0] > INCOMPLETE_TTL:
        _cache_drop(key)
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
    key = ("album", flat(artist_name), flat(title), lang)
    a = _cached(key, lambda: _album(artist_name, title, lang))
    if a is None:
        _cache_drop(key)   # not found may be a hiccup: ask again next time
    return a


# stores to try after the artist's own: Japanese / Korean / Chinese-language music often isn't in the US one
STORES = ("US", "JP", "TW", "KR", "GB")


def _album(artist_name: str, title: str, lang: str) -> dict | None:
    home = _country(f"{artist_name}{title}")
    want = flat(catalog.clean_title(title))
    lead = flat(catalog.lead_artist(artist_name))

    def score(a):
        t = flat(catalog.clean_title(a.get("collectionName") or ""))
        return (t == want) * 4 + (want in t) * 2 + (lead in flat(a.get("artistName"))) * 3 - ("deluxe" in t) * .5

    def search(country):
        return _client.get("https://itunes.apple.com/search", params={
            "term": f"{artist_name} {title}", "entity": "album", "limit": 25, "country": country}).json().get("results") or []

    rows = search(home)
    best = max(rows, key=score, default=None)
    if not best or score(best) < 4:
        # the store's search misses some albums its artist lists ("Fishmans Kuuchuu Camp" finds nothing in the US):
        # the artist's own album list (what the artist page shows), then the other stores' searches
        it = _itunes_artist(catalog.lead_artist(artist_name))
        if it:
            rows = [a for a in (_client.get("https://itunes.apple.com/lookup", params={
                "id": it["artistId"], "entity": "album", "limit": 200, "country": _country(artist_name)}).json().get("results") or [])
                if a.get("wrapperType") == "collection"]
            best = max(rows, key=score, default=None)
        for country in STORES:
            if best and score(best) >= 4:
                break
            if country != home:
                best = max(search(country), key=score, default=None)
    if not best or score(best) < 4:
        return None
    # the tracks: some stores list an album but not its songs (the US one has Kuuchuu Camp, without tracks)
    tracks = []
    for country in dict.fromkeys((home, *STORES)):
        tracks = [t for t in (_client.get("https://itunes.apple.com/lookup", params={
            "id": best["collectionId"], "entity": "song", "country": country}).json().get("results") or [])
            if t.get("wrapperType") == "track"]
        if tracks:
            break
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

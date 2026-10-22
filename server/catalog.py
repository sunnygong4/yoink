"""Song search by name: real songs (title + artist) from the iTunes catalog, one entry per song per artist.

"imagine" -> Imagine by John Lennon, Imagine by Ariana Grande, ... and never three John Lennon Imagines
(remasters, live takes and "Ultimate Mix"es collapse into one). Then a song is turned into a download:
pick_source() finds the YouTube/Bilibili upload that best matches it.
"""
import concurrent.futures
import re
import threading
import time

import httpx
from songstore import artist_title
from songstore.keys import flat, norm, same_length

import search as se

_client = httpx.Client(timeout=10, headers={"User-Agent": "Mozilla/5.0"})
_pool = concurrent.futures.ThreadPoolExecutor(max_workers=4)
_cache: dict[str, tuple[float, list[dict]]] = {}
_lock = threading.Lock()
CACHE_TTL = 3600   # iTunes allows ~20 searches a minute per IP

_CJK = re.compile(r"[぀-ヿ㐀-鿿가-힯]")
# not the song people mean: piano/guitar/instrumental/karaoke renditions by "relaxing music" accounts
_RENDITION = re.compile(r"instrumental|karaoke|伴奏|鋼琴|钢琴|吉他|piano\s*(ver|version)|guitar\s*(ver|version)|"
                        r"music\s*box|八音盒|純音樂|纯音乐|lullaby|bgm", re.I)
_SUFFIX = re.compile(r"\s+-\s+.*$")   # "Imagine - Remastered 2010"
_VERSION = re.compile(r"\blive\b|現場|现场|演唱會|演唱会|remaster|mix\b|version|ver\.|take\s*\d|demo|edit\b", re.I)


def _itunes(q: str, country: str) -> list[dict]:
    r = _client.get("https://itunes.apple.com/search",
                    params={"term": q, "entity": "song", "limit": 40, "country": country})
    out = []
    for t in r.json().get("results") or []:
        if not t.get("trackName") or not t.get("artistName"):
            continue
        art = t.get("artworkUrl100") or ""
        out.append({
            "title": t["trackName"],
            "artist": t["artistName"],
            "album": t.get("collectionName") or "",
            "duration": round((t.get("trackTimeMillis") or 0) / 1000) or None,
            "artwork": art.replace("100x100bb", "600x600bb"),
            "year": (t.get("releaseDate") or "")[:4],
        })
    return out


def song_key(artist: str, title: str) -> str:
    """Same song by the same artist: "Imagine (Remastered 2010)" and "Imagine - Ultimate Mix" -> one key."""
    return f"{norm(lead_artist(artist))}|{norm(_SUFFIX.sub('', title))}"


def clean_title(title: str) -> str:
    """'Imagine (Remastered 2010)' -> 'Imagine'; keeps titles that are only brackets."""
    t = _SUFFIX.sub("", title)
    t = re.sub(r"\s*[(\[（【][^)\]）】]*[)\]）】]\s*", " ", t).strip()
    return t or title


def search(q: str) -> list[dict]:
    q = q.strip()
    key = q.lower()
    with _lock:
        hit = _cache.get(key)
    if hit and time.time() - hit[0] < CACHE_TTL:
        return hit[1]
    # the Taiwan store knows Chinese-language music far better (周杰倫's 晴天 isn't in the US top results)
    countries = ("TW", "US") if _CJK.search(q) else ("US", "TW")
    lists = [f.result() for f in [_pool.submit(_itunes, q, c) for c in countries]]
    groups: dict[str, list[dict]] = {}
    order: list[str] = []
    for i in range(max(map(len, lists), default=0)):   # interleave: both stores' best results come first
        for lst in lists:
            if i < len(lst):
                t = lst[i]
                k = song_key(t["artist"], t["title"])
                if k not in groups:
                    groups[k] = []
                    order.append(k)
                groups[k].append(t)
    # the two stores name artists differently (陳奕迅 / Eason Chan): the same record (title, album, length) is one song
    seen: dict[tuple, str] = {}
    for k in list(order):
        t = groups[k][0]
        rec = (norm(clean_title(t["title"])), norm(t["album"]), round((t["duration"] or 0) / 4))
        if rec in seen:
            groups[seen[rec]] += groups.pop(k)
            order.remove(k)
        else:
            seen[rec] = k
    # ... and when the two stores' names are different scripts (班.普萊特 / Ben Platt), the same title + length is too
    for k in list(order):
        t = groups[k][0]
        for k2 in order[:order.index(k)]:
            t2 = groups[k2][0]
            same_record = norm(clean_title(t["title"])) == norm(clean_title(t2["title"])) \
                and abs((t["duration"] or 0) - (t2["duration"] or 0)) <= 1
            if same_record and bool(_CJK.search(t["artist"])) != bool(_CJK.search(t2["artist"])):
                groups[k2] += groups.pop(k)
                order.remove(k)
                break
    out = []
    for k in order:
        # show the plainest version: "Imagine" from "Imagine", not "Imagine (Ultimate Mix)" from a live album
        best = min(groups[k], key=lambda t: (bool(_VERSION.search(t["title"] + " " + t["album"])),
                                             t["title"] != clean_title(t["title"])))
        out.append({**best, "title": clean_title(best["title"]), "key": k, "versions": len(groups[k])})
    out.sort(key=lambda t: bool(_RENDITION.search(t["title"] + " " + t["artist"] + " " + t["album"])))
    with _lock:
        _cache[key] = (time.time(), out)
    return out


# ---------- from a song to an upload ----------

def lead_artist(artist: str) -> str:
    return re.split(r"\s*(?:&|,|/|、| x | feat\.?| ft\.?)\s*", artist, maxsplit=1, flags=re.I)[0]


def matches(r: dict, artist: str, title: str) -> bool:
    """Is this upload by the song's (lead) artist, with the song's title in it?"""
    if not flat(title) or flat(title) not in flat(r["title"] + " " + r["channel"]):
        return False
    if r["channel"].endswith(" - Topic"):   # YouTube Music: the channel *is* the artist ("John Lennon Experience" isn't)
        return flat(lead_artist(r["channel"][:-8])) == flat(lead_artist(artist))
    return flat(lead_artist(artist)) in flat(r["title"] + " " + r["channel"])


_MANGLED = re.compile(r"(8|16|32)\s*d|slowed|reverb|sped\s*up|nightcore|stereo\s*split|bass\s*boost|"
                      r"remix|8\s*bit|1\s*hour|一小时|循环", re.I)


def ytmusic(song: dict) -> list[dict]:
    """YouTube Music's official tracks for the song (the label's audio, exact album length), as search results."""
    from ytmusicapi import YTMusic   # default locale on purpose: localised result pages break its parser
    out = []
    for x in YTMusic().search(f"{song['artist']} {song['title']}", filter="songs", limit=10):
        if not x.get("videoId"):
            continue
        artists = ", ".join(a["name"] for a in x.get("artists") or [])
        out.append({
            "source": "youtube",
            "id": x["videoId"],
            "url": f"https://music.youtube.com/watch?v={x['videoId']}",
            "title": x.get("title") or "",
            "channel": artists,
            "album": (x.get("album") or {}).get("name"),
            "duration": x.get("duration_seconds"),
            "views": None,
            "thumbnail": f"https://i.ytimg.com/vi/{x['videoId']}/mqdefault.jpg",
            "tags": ["ytmusic"],
        })
    return out


def is_track(r: dict, song: dict) -> bool:
    """A YouTube Music track that is this song: the song's artist, its title, the record's length."""
    lead = flat(lead_artist(song["artist"]))
    by_artist = any(flat(a) == lead for a in re.split(r",\s*", r["channel"]))
    # slack: iTunes and YouTube Music sometimes carry different masters of the same record (千千闋歌: 296 s vs 301 s)
    return by_artist and flat(song["title"]) in flat(r["title"]) \
        and same_length(r["duration"], song.get("duration"), slack=6)


def candidates(song: dict, where: str = "youtube") -> list[dict]:
    """Uploads of this song, best first (what "单独选取" shows): official tracks, then videos."""
    if where == "youtube":
        try:
            tracks = ytmusic(song)
        except Exception as e:   # unofficial API: if it breaks, plain YouTube search still works
            print(f"[catalog] ytmusic failed: {e}")
            tracks = []
        for r in tracks:
            r["fit"] = 10.0 if is_track(r, song) else 0.0
        official = [r for r in tracks if r["fit"]]
    else:
        official = []
    videos = se.search(f"{song['artist']} {song['title']}", where)
    want_live = bool(re.search(r"live|現場|现场", song["title"], re.I))

    def score(i: int, r: dict) -> float:
        tags = set(r["tags"])
        s = 4.0 if matches(r, song["artist"], song["title"]) else 0.0
        if {"cover", "karaoke"} & tags or ("live" in tags and not want_live):
            s -= 6
        if _MANGLED.search(r["title"]):
            s -= 6   # "16D audio", "slowed + reverb", "1 hour loop"
        if song.get("duration") and r.get("duration"):
            d = abs(r["duration"] - song["duration"])
            # the record's exact length = the studio audio (and its lyrics line up); an MV with an intro runs longer
            s += 3 if d <= 2 else 1.5 if d <= 6 else 0 if same_length(r["duration"], song["duration"]) else -2
        if s >= 4:   # only for the right artist: a tribute band's Topic channel is no better than anyone else
            s += 3 * ("topic" in tags) + 1.5 * ("official" in tags) + 1 * ("audio" in tags)
        if _VERSION.search(r["title"]) and not _VERSION.search(song["title"]):
            s -= 1.5   # "Imagine (Ultimate Mix)", "(Take 1)" when the plain song was asked for
        return s - i * 0.05   # keep the site's relevance as a tie-breaker

    scored = sorted(((score(i, r), r) for i, r in enumerate(videos)), key=lambda x: x[0], reverse=True)
    for sc, r in scored:
        r["fit"] = round(sc, 1)
    seen = {r["id"] for r in official}
    return official + [r for _, r in scored if r["id"] not in seen]


def pick_source(song: dict) -> dict | None:
    """The upload "快速下载" uses: the official track, else the best video if it is clearly this song."""
    best = next(iter(candidates(song)), None)
    return best if best and best["fit"] >= 5 else None


# ---------- recommendations ----------

def _seconds(length: str | None) -> int | None:
    if not length:
        return None
    s = 0
    for part in length.split(":"):
        s = s * 60 + int(part or 0)
    return s


def seed_video(doc: dict) -> str | None:
    """A YouTube video id to start a radio from: the song's own, or its YouTube Music track."""
    if doc["id"].startswith("yt-"):
        return doc["id"][3:]
    artist, title = artist_title(doc)
    if not title:
        return None
    song = {"artist": artist or "", "title": title, "duration": doc.get("duration")}
    tracks = ytmusic(song)
    best = next((t for t in tracks if is_track(t, song)), tracks[0] if tracks else None)
    return best["id"] if best else None


def radio(doc: dict) -> list[tuple[dict, dict]]:
    """Songs like this one, from YouTube Music's radio: (upload, catalog-style song) pairs, best first."""
    from ytmusicapi import YTMusic
    vid = seed_video(doc)
    if not vid:
        return []
    out = []
    for t in (YTMusic().get_watch_playlist(videoId=vid, limit=25, radio=True).get("tracks") or [])[1:]:   # [0] is the seed
        if not t.get("videoId") or not t.get("title"):
            continue
        artists = [a["name"] for a in t.get("artists") or [] if a.get("name")]
        duration = _seconds(t.get("length"))
        thumbs = t.get("thumbnail") or []
        r = {"source": "youtube", "id": t["videoId"], "url": f"https://music.youtube.com/watch?v={t['videoId']}",
             "title": t["title"], "channel": ", ".join(artists), "duration": duration, "views": None,
             "thumbnail": f"https://i.ytimg.com/vi/{t['videoId']}/mqdefault.jpg", "tags": ["ytmusic"]}
        song = {"title": t["title"], "artist": artists[0] if artists else "", "album": (t.get("album") or {}).get("name"),
                "duration": duration,
                "artwork": re.sub(r"=w\d+-h\d+", "=w544-h544", thumbs[-1]["url"]) if thumbs else None}
        out.append((r, song))
    return out

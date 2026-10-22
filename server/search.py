"""Song search on YouTube and Bilibili (adapted from the karaoke site's search), ranked for listening:
official audio first, then MVs; covers, live recordings and karaoke tracks last."""
import math
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import httpx

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"
MAX_DURATION = 15 * 60  # skip compilations / full concerts

_TAGS = [
    ("karaoke", re.compile(r"karaoke|伴奏|instrumental|inst\.?\b|off\s*vocal|ktv|卡拉\s*ok|消音|纯音乐|純音樂", re.I)),
    ("cover", re.compile(r"cover|翻唱|翻自|covered|弹唱|彈唱", re.I)),
    ("live", re.compile(r"\blive\b|unplugged|現場|现场|演唱会|演唱會|concert|音乐节|音樂節|直播", re.I)),
    ("lyrics", re.compile(r"lyric|歌词|歌詞|pinyin|拼音|字幕", re.I)),
    ("audio", re.compile(r"official\s*audio|\baudio\b|音源|高音質|高音质|無損|无损", re.I)),
    ("mv", re.compile(r"(?<![a-z])(m/?v|pv)(?![a-z])|music\s*video|official\s*video|官方|音樂錄影帶|音乐录影带|mtv", re.I)),
]
_RANK = {"topic": 3.5, "official": 2.0, "audio": 1.5, "mv": 1.0, "lyrics": 0.3, "live": -2.0, "cover": -2.5, "karaoke": -4.0}


def tag(r: dict) -> list[str]:
    tags = [name for name, rx in _TAGS if rx.search(r["title"] or "")]
    if r["channel"].endswith(" - Topic"):   # YouTube Music upload: clean audio and real track metadata
        tags.append("topic")
    else:
        # the artist's own channel: "周杰倫 Jay Chou" posting "周杰倫 Jay Chou【晴天】"
        ch = _norm(re.sub(r"(?i)official|channel|vevo|官方|頻道|频道", "", r["channel"]))
        if len(ch) >= 2 and ch in _norm(r["title"]):
            tags.append("official")
    return tags


def _norm(s: str) -> str:
    return re.sub(r"[\W_]+", "", (s or "").lower())


def _rank(results: list[dict]) -> list[dict]:
    def score(i_r):
        i, r = i_r
        s = sum(_RANK.get(t, 0) for t in r["tags"])
        s += math.log10((r.get("views") or 0) + 10) * 0.35
        return s - i * 0.08  # keep the site's relevance as a tie-breaker
    return [r for _, r in sorted(enumerate(results), key=score, reverse=True)]


def _dur(v) -> int | None:
    if isinstance(v, (int, float)):
        return int(v)
    if isinstance(v, str) and ":" in v:
        s = 0
        for p in v.split(":"):
            s = s * 60 + int(p or 0)
        return s
    return None


def search_youtube(query: str, n: int = 20) -> list[dict]:
    import yt_dlp
    with yt_dlp.YoutubeDL({"quiet": True, "extract_flat": True, "no_warnings": True}) as ydl:
        info = ydl.extract_info(f"ytsearch{n}:{query}", download=False)
    out = []
    for e in info.get("entries") or []:
        d = _dur(e.get("duration"))
        if not e.get("id") or not d or d > MAX_DURATION:
            continue
        out.append({
            "source": "youtube",
            "id": e["id"],
            "url": f"https://www.youtube.com/watch?v={e['id']}",
            "title": e.get("title") or "",
            "channel": e.get("channel") or e.get("uploader") or "",
            "duration": d,
            "views": e.get("view_count"),
            "thumbnail": f"https://i.ytimg.com/vi/{e['id']}/mqdefault.jpg",
        })
    return out


_bili = None
_bili_lock = threading.Lock()


def _bili_client() -> httpx.Client:
    global _bili
    with _bili_lock:
        if _bili is None:
            _bili = httpx.Client(headers={"User-Agent": UA, "Referer": "https://www.bilibili.com/"},
                                 follow_redirects=True, timeout=10)
            _bili.get("https://www.bilibili.com/")  # sets the buvid3 cookie the search API wants
        return _bili


def search_bilibili(query: str) -> list[dict]:
    r = _bili_client().get("https://api.bilibili.com/x/web-interface/search/type",
                           params={"search_type": "video", "keyword": query, "page": 1})
    out = []
    for v in (r.json().get("data") or {}).get("result") or []:
        d = _dur(v.get("duration"))
        if not v.get("bvid") or not d or d > MAX_DURATION:
            continue
        pic = v.get("pic") or ""
        out.append({
            "source": "bilibili",
            "id": v["bvid"],
            "url": f"https://www.bilibili.com/video/{v['bvid']}",
            "title": re.sub(r"<[^>]+>", "", v.get("title") or ""),
            "channel": v.get("author") or "",
            "duration": d,
            "views": v.get("play") if isinstance(v.get("play"), int) else None,
            "thumbnail": ("https:" + pic if pic.startswith("//") else pic) + "@320w_180h_1c.webp",
        })
    return out


_cache: dict[tuple[str, str], tuple[float, list[dict]]] = {}
_both = ThreadPoolExecutor(max_workers=4)
CACHE_TTL = 30 * 60


def search(query: str, where: str = "youtube") -> list[dict]:
    query = query.strip()
    key = (query.lower(), where)
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < CACHE_TTL:
        return hit[1]
    if where == "bili":
        results = search_bilibili(query)
    else:
        # plain search + "<query> audio" in parallel, merged: the second one surfaces Topic / official audio uploads
        audio, plain = _both.submit(search_youtube, query + " audio"), _both.submit(search_youtube, query)
        seen, results = set(), []
        for r in plain.result() + audio.result():
            if r["id"] not in seen:
                seen.add(r["id"])
                results.append(r)
    for r in results:
        r["tags"] = tag(r)
    results = _rank(results)
    _cache[key] = (time.time(), results)
    return results

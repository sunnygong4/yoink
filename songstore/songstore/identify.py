"""Work out which song an upload is (canonical artist + title) and fetch its synced lyrics, from NetEase and LRCLIB.

A trimmed copy of the karaoke site's lyrics module, without the Whisper-based alignment: candidates are
accepted on title + length alone, so the lyrics' timing assumes the upload starts where the record does.
"""
import re
import time

import httpx

from .keys import _t2s, same_length

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"
_TS = re.compile(r"\[(\d+):(\d+(?:\.\d+)?)\]")
_PUNCT = re.compile(r"[\W_]+")


def parse_lrc(text: str) -> list[dict]:
    """Return [{t, text}] sorted by time. Skips metadata/JSON lines and empty lines."""
    out = []
    for raw in (text or "").splitlines():
        raw = raw.strip()
        if not raw or raw.startswith("{"):
            continue
        stamps = _TS.findall(raw)
        body = _TS.sub("", raw).strip()
        if not stamps or not body:
            continue
        for m, s in stamps:
            out.append({"t": int(m) * 60 + float(s), "text": body})
    out.sort(key=lambda x: x["t"])
    return out


def merge_translation(lines: list[dict], tlines: list[dict]) -> list[dict]:
    by_t = {round(l["t"], 1): l["text"] for l in tlines}
    for l in lines:
        tr = by_t.get(round(l["t"], 1))
        if tr and tr != l["text"]:
            l["tr"] = tr
    return lines


def _client():
    return httpx.Client(timeout=10, headers={"User-Agent": UA, "Referer": "https://music.163.com/"})


def search_netease(query: str, limit: int = 6) -> list[dict]:
    with _client() as c:
        r = c.get("https://music.163.com/api/search/get", params={"s": query, "type": 1, "limit": limit, "offset": 0})
        out = []
        for s in (r.json().get("result") or {}).get("songs") or []:
            try:
                lr = c.get("https://music.163.com/api/song/lyric", params={"id": s["id"], "lv": 1, "tv": -1}).json()
            except Exception:
                continue
            lines = parse_lrc((lr.get("lrc") or {}).get("lyric") or "")
            if len(lines) < 3:
                continue
            out.append({
                "source": "netease",
                "id": f"ne:{s['id']}",
                "title": s.get("name", ""),
                "artist": " / ".join(a.get("name", "") for a in s.get("artists", [])),
                "duration": (s.get("duration") or 0) / 1000,
                "lines": merge_translation(lines, parse_lrc((lr.get("tlyric") or {}).get("lyric") or "")),
            })
        return out


def search_lrclib(query: str, limit: int = 6) -> list[dict]:
    with _client() as c:
        r = c.get("https://lrclib.net/api/search", params={"q": query})
        items = r.json() if r.status_code == 200 else []
    out = []
    for it in items:
        lines = parse_lrc(it.get("syncedLyrics") or "")
        if len(lines) < 3:
            continue
        out.append({"source": "lrclib", "id": f"lrclib:{it['id']}", "title": it.get("trackName", ""),
                    "artist": it.get("artistName", ""), "duration": it.get("duration") or 0, "lines": lines})
        if len(out) >= limit:
            break
    return out


_NOISE = re.compile(
    r"official\s*(music\s*)?(video|mv|audio|lyric[s]?\s*video)?|music\s*video|lyric[s]?\s*video|lyrics?|"
    r"\bm/?v\b|\bhd\b|\b4k\b|\bhq\b|flac|完整版|官方|高清|高音質|高音质|無損音樂|无损音乐|無損|无损|純享|纯享|"
    r"歌词版?|歌詞版?|動態歌詞|动态歌词|中字|字幕|首播|完整|版本|\bfeat\b\.?|\bft\b\.?|\bprod\b\.?", re.I)


def clean_title(title: str) -> str:
    t = re.sub(r"[#＃]\S+", " ", title)
    t = re.sub(r"[(（][^)）]*[)）]", " ", t)  # (Official Video), (feat. X)
    # keep content inside 【】/「」/《》 (usually the song name) but drop the brackets
    t = re.sub(r"[【】「」『』《》\[\]()（）|｜/\\\-–—_~:：\"'“”]", " ", t)
    t = _NOISE.sub(" ", t)
    return re.sub(r"\s+", " ", t).strip()


_CJK = re.compile(r"[぀-ヿ㐀-鿿가-힯]")


def _cjk_part(s: str) -> str:
    """'告白氣球 Love Confession' -> '告白氣球' (keeps the CJK words when a title is bilingual)."""
    if not _CJK.search(s):
        return s.strip()
    return " ".join(w for w in s.split() if _CJK.search(w)).strip()


def build_queries(meta: dict) -> list[str]:
    title, channel = meta.get("title") or "", meta.get("channel") or ""
    qs = []
    if meta.get("track"):
        qs.append(f"{meta.get('artist') or ''} {meta['track']}".strip())
    if channel.endswith(" - Topic"):
        qs.append(f"{channel[:-8]} {title}")
    who = clean_title(meta.get("artist") or channel or re.split(r"[【「《『]", title)[0])
    who = re.sub(r"(?i)\b(official|channel|vevo|music|records?|entertainment)\b|官方|频道|頻道", " ", who).strip()
    for name in re.findall(r"[【「《『]([^】」》』]+)[】」》』]", title):   # song names are often bracketed
        if name := clean_title(name):
            qs += [f"{_cjk_part(who)} {_cjk_part(name)}".strip(), f"{who} {name}".strip()]
    parts = re.split(r"\s[-–—|｜]\s", re.sub(r"[(（][^)）]*[)）]", " ", title))
    if len(parts) >= 2:
        qs.append(clean_title(f"{parts[0]} {parts[1]}"))
    qs.append(clean_title(title))
    out = []
    for q in qs:
        q = re.sub(r"\s+", " ", _t2s(q)).strip()
        if q and q not in out:
            out.append(q)
    return out[:4]


def _norm(s: str) -> str:
    return _PUNCT.sub("", _t2s((s or "").lower()))


def title_matches(cand: dict, video_text: str) -> bool:
    """The candidate's title (minus "(Live)", "【Cover】" etc.) has to appear in the upload's title/channel."""
    core = _norm(re.sub(r"[（(\[【「『《].*?[)）\]】」』》]", " ", cand.get("title") or ""))
    return len(core) >= 2 and core in _norm(video_text)


def artist_matches(cand: dict, video_text: str) -> bool:
    """One of the candidate's artists appears in the upload's title/channel (a same-named song by someone else won't)."""
    names = [_norm(a) for a in re.split(r"\s*[/&,、]\s*", cand.get("artist") or "")]
    return any(len(n) >= 2 and n in _norm(video_text) for n in names)


def identify(meta: dict) -> dict | None:
    """Which song this upload is: the best NetEase/LRCLIB match {source, id, title, artist, duration, lines}, or None.
    "synced" on the result says whether its lyrics can be shown as-is: an MV with an intro is longer than the
    record, and without the karaoke site's audio alignment its lyrics would run early."""
    text = f"{meta.get('title') or ''} {meta.get('channel') or ''} {meta.get('track') or ''} {meta.get('artist') or ''}"
    for q in build_queries(meta):
        for fn in (search_netease, search_lrclib):
            try:
                cands = fn(q)
            except Exception as e:
                print(f"[identify] {fn.__name__} failed: {e}")
                time.sleep(1)
                continue
            for c in cands:
                if same_length(c["duration"], meta.get("duration")) and title_matches(c, text) and artist_matches(c, text):
                    c["synced"] = same_length(c["duration"], meta.get("duration"), slack=2.5)
                    # some LRCLIB entries are titled "Artist - Title"
                    c["title"] = re.sub(rf"^{re.escape(c['artist'])}\s*[-–—]\s*", "", c["title"]) or c["title"]
                    return c
    return None

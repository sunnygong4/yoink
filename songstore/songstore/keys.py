"""Work keys: one key per song (artist + title), so the MV the karaoke site downloaded and the
"official audio" upload the music app found are recognised as the same song."""
import re
import unicodedata

import opencc   # folds traditional/simplified Chinese together: both apps must compute the same keys

_t2s = opencc.OpenCC("t2s").convert

_NOISE = re.compile(
    r"official\s*(music\s*)?(video|audio|mv|lyric\s*video)?|music\s*video|lyric\s*video|lyrics?|"
    r"\bm/?v\b|\bpv\b|\bmtv\b|\bhd\b|\bhq\b|\b4k\b|\b1080p\b|\baudio\b|\bremaster(ed)?\b|"
    r"官方(完整)?(版)?|高清|高音質|高音质|歌词版|歌詞版|動態歌詞|动态歌词|完整版|純享版|纯享版|中字",
    re.I)
_BRACKETS = re.compile(r"[\[【(（〔「『][^\]】)）〕」』]*[\]】)）〕」』]")
_FEAT = re.compile(r"\s*(feat\.?|ft\.?|featuring)\s.*$", re.I)


def norm(s: str | None) -> str:
    s = unicodedata.normalize("NFKC", s or "").lower()
    stripped = _BRACKETS.sub("", s)   # "好久不见 (国)" -> 好久不见, unless the brackets are all there is
    s = _FEAT.sub("", _NOISE.sub("", _t2s(stripped if stripped.strip() else s)))
    return re.sub(r"[\W_]+", "", s)


def flat(s: str | None) -> str:
    """Lowercase, simplified Chinese, no spaces or punctuation; nothing else removed (for "does X appear in Y")."""
    return re.sub(r"[\W_]+", "", _t2s(unicodedata.normalize("NFKC", s or "").lower()))


def mentioned(meta: dict, text: str, duration: float | None) -> bool:
    """Is `text` (an upload's title + channel) plausibly this song? Its artist and title both appear in it and
    the lengths agree. Looser than the work key, for titles like 陳奕迅 Eason Chan《十年(國)》[Official MV]."""
    artist, title = (norm(x) for x in artist_title(meta))
    text = flat(text)
    return bool(artist) and len(title) >= 2 and artist in text and title in text         and same_length(meta.get("duration"), duration)


def split_title(title: str, channel: str = "") -> tuple[str | None, str | None]:
    """Best guess (artist, title) from an upload's title and channel."""
    t = title or ""
    if channel.endswith(" - Topic"):   # YouTube Music auto-generated uploads: the title is the track
        return channel[:-len(" - Topic")], t
    named = re.search(r"《([^》]+)》", t)   # 王菲《匆匆那年》
    if named:
        before = _NOISE.sub(" ", t[:named.start()]).strip(" -–—|")
        return before or None, named.group(1)
    t = _NOISE.sub(" ", _BRACKETS.sub(" ", t))
    parts = [p.strip() for p in re.split(r"\s+[-–—|｜]\s+", t, maxsplit=1) if p.strip()]
    if len(parts) == 2:
        return parts[0], parts[1]
    return None, parts[0] if parts else None


def artist_title(meta: dict) -> tuple[str | None, str | None]:
    if meta.get("display_title") and meta.get("display_artist"):
        return meta["display_artist"], meta["display_title"]
    if meta.get("track") and meta.get("artist"):
        return meta["artist"], meta["track"]
    return split_title(meta.get("title") or "", meta.get("channel") or "")


def work_key(meta: dict) -> str | None:
    artist, title = artist_title(meta)
    a, t = norm(artist), norm(title)
    return f"{a}|{t}" if a and t else None


def same_length(a: float | None, b: float | None, slack: float | None = None) -> bool:
    if not a or not b:
        return True
    return abs(a - b) <= (slack if slack is not None else max(6, 0.04 * max(a, b)))

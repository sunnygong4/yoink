from __future__ import annotations

import concurrent.futures
import html
import logging
import re
import secrets
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any
from urllib.parse import urlparse

import musicbrainzngs
import requests
from yt_dlp import YoutubeDL

from .. import schemas
from ..core.config import settings


logger = logging.getLogger("yoinker.discovery")
DEFAULT_BROWSER_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
)
_NOISE_KEYWORDS = {
    "cover",
    "remix",
    "live",
    "intro",
    "trailer",
    "teaser",
    "nightcore",
    "slowed",
    "sped",
    "edit",
    "version",
    "lofi",
    "rock",
    "metal",
    "karaoke",
}
_CLASSICAL_HINTS = {
    "mozart",
    "bach",
    "beethoven",
    "vivaldi",
    "haydn",
    "handel",
    "chopin",
    "schubert",
    "brahms",
    "tchaikovsky",
    "rachmaninoff",
    "requiem",
    "symphony",
    "concerto",
    "sonata",
    "orchestra",
    "mass",
    "opera",
}
_VERSION_CACHE_LOCK = threading.Lock()
_VERSION_SEARCH_CACHE: dict[str, tuple[datetime, schemas.SearchResponseStatus, list[schemas.DiscoveryVersionGroup]]] = {}


SEARCH_VARIANTS: dict[schemas.DiscoverySource, list[tuple[str, str]]] = {
    schemas.DiscoverySource.youtube: [
        ("ytsearch", "YouTube"),
    ],
    schemas.DiscoverySource.soundcloud: [("scsearch", "SoundCloud")],
    schemas.DiscoverySource.bilibili: [("bilisearch", "Bilibili")],
}


@dataclass(slots=True)
class StreamSession:
    token: str
    owner_id: int
    result: dict[str, Any]
    direct_url: str
    headers: dict[str, str]
    media_type: str
    expires_at: datetime


_STREAM_SESSIONS: dict[str, StreamSession] = {}
_STREAM_SESSIONS_LOCK = threading.Lock()


def _configure_musicbrainz():
    musicbrainzngs.set_useragent("yoinker", "1.0", "https://yoinker.local")
    logging.getLogger("musicbrainzngs").setLevel(logging.WARNING)


def _search_options() -> dict[str, Any]:
    return {
        "quiet": True,
        "no_warnings": True,
        "ignoreerrors": True,
        "skip_download": True,
        "extract_flat": "in_playlist",
        "default_search": "auto",
        "noplaylist": True,
        "socket_timeout": max(settings.PROVIDER_SEARCH_TIMEOUT_SECONDS, 4),
        "extractor_retries": 1,
    }


def _resolve_options() -> dict[str, Any]:
    return {
        "quiet": True,
        "no_warnings": True,
        "ignoreerrors": False,
        "skip_download": True,
        "default_search": "auto",
        "noplaylist": True,
    }


def _clean_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _coerce_duration(value: Any) -> int | None:
    if value in (None, "", "NA", "unknown"):
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _tokenize(value: str | None) -> set[str]:
    if not value:
        return set()
    return set(re.findall(r"[a-z0-9]+", value.lower()))


def _noise_penalty(text: str, query_tokens: set[str]) -> int:
    tokens = _tokenize(text)
    noisy_tokens = [token for token in _NOISE_KEYWORDS if token in tokens and token not in query_tokens]
    # Heavy penalty — "cover" alone should kill a result's score
    return 150 * len(noisy_tokens)


def _normalize_title_root(value: str | None) -> str:
    text = (value or "").lower()
    text = re.sub(r"\[[^\]]*\]|\([^)]*\)", " ", text)
    text = re.sub(r"\b(?:official|video|audio|lyrics?|visualizer|performance|mv)\b", " ", text)
    tokens = [
        token
        for token in re.findall(r"[a-z0-9]+", text)
        if token not in _NOISE_KEYWORDS and token not in {"the", "a", "an", "feat", "ft"}
    ]
    return " ".join(tokens[:8]).strip()


def _display_title_from_versions(items: list[schemas.DiscoverySearchResult]) -> str:
    for item in items:
        title = (item.title or "").strip()
        if title:
            return re.sub(r"\s+", " ", title)
    return "Untitled"


def _cache_key(
    *,
    query: str,
    source: schemas.DiscoverySource,
    artist_hint: str | None,
) -> str:
    return "|".join(
        [
            query.strip().lower(),
            source.value,
            (artist_hint or "").strip().lower(),
        ]
    )


def _cache_get(
    *,
    query: str,
    source: schemas.DiscoverySource,
    artist_hint: str | None,
) -> tuple[schemas.SearchResponseStatus, list[schemas.DiscoveryVersionGroup]] | None:
    key = _cache_key(query=query, source=source, artist_hint=artist_hint)
    with _VERSION_CACHE_LOCK:
        cached = _VERSION_SEARCH_CACHE.get(key)
        if not cached:
            return None
        expires_at, status, items = cached
        if expires_at <= datetime.utcnow():
            _VERSION_SEARCH_CACHE.pop(key, None)
            return None
        return status, items


def _cache_put(
    *,
    query: str,
    source: schemas.DiscoverySource,
    artist_hint: str | None,
    status: schemas.SearchResponseStatus,
    items: list[schemas.DiscoveryVersionGroup],
):
    key = _cache_key(query=query, source=source, artist_hint=artist_hint)
    with _VERSION_CACHE_LOCK:
        _VERSION_SEARCH_CACHE[key] = (
            datetime.utcnow() + timedelta(seconds=settings.SEARCH_CACHE_TTL_SECONDS),
            status,
            items,
        )


def _run_with_timeout(fn, *, timeout_seconds: int, fallback):
    executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
    future = executor.submit(fn)
    timed_out = False
    try:
        return False, future.result(timeout=max(timeout_seconds, 1))
    except concurrent.futures.TimeoutError:
        timed_out = True
        logger.warning("Timed out after %s seconds in discovery helper %s", timeout_seconds, getattr(fn, "__name__", "unknown"))
        return True, fallback
    except Exception:
        logger.exception("Discovery helper failed: %s", getattr(fn, "__name__", "unknown"))
        return False, fallback
    finally:
        executor.shutdown(wait=not timed_out, cancel_futures=timed_out)


def _hint_score_for_item(item: schemas.DiscoverySearchResult, hint: dict[str, Any]) -> int:
    score = 0
    item_title_tokens = _tokenize(item.title)
    item_artist_tokens = _tokenize(item.artist)
    item_album_tokens = _tokenize(item.album)

    hint_title_tokens = _tokenize(hint.get("title"))
    hint_artist_tokens = _tokenize(hint.get("artist"))
    hint_album_tokens = _tokenize(hint.get("album"))

    score += len(item_title_tokens & hint_title_tokens) * 28
    score += len(item_artist_tokens & hint_artist_tokens) * 36
    score += len(item_album_tokens & hint_album_tokens) * 12

    hint_title = (hint.get("title") or "").lower()
    hint_artist = (hint.get("artist") or "").lower()
    if hint_title and hint_title in (item.title or "").lower():
        score += 70
    if hint_artist and hint_artist in (item.artist or "").lower():
        score += 90

    # Penalize items with noise keywords in the title (covers, remixes, etc.)
    item_title_lower = (item.title or "").lower()
    for noise in ("cover", "remix", "karaoke", "nightcore", "lofi"):
        if noise in item_title_lower and noise not in hint_title:
            score -= 100

    return score


def _canonical_hints(query: str, artist_hint: str | None) -> list[dict[str, Any]]:
    _configure_musicbrainz()
    payload: dict[str, Any] = {
        "recording": query,
        "limit": 5,
        "offset": 0,
    }
    if artist_hint:
        payload["artist"] = artist_hint
    result = musicbrainzngs.search_recordings(**payload)
    recordings = result.get("recording-list") or []
    hints: list[dict[str, Any]] = []
    for recording in recordings:
        release = (recording.get("release-list") or [None])[0] or {}
        hints.append(
            {
                "id": _clean_text(recording.get("id")) or "",
                "title": _clean_text(recording.get("title")) or query,
                "artist": _clean_text(recording.get("artist-credit-phrase")) or artist_hint,
                "album": _clean_text(release.get("title")),
            }
        )
    return hints


def _group_key_for_item(item: schemas.DiscoverySearchResult, hints: list[dict[str, Any]]) -> tuple[str, dict[str, Any] | None]:
    best_hint: dict[str, Any] | None = None
    best_hint_score = 0
    for hint in hints:
        score = _hint_score_for_item(item, hint)
        if score > best_hint_score:
            best_hint_score = score
            best_hint = hint
    if best_hint and best_hint_score >= 80:
        return (f"hint:{best_hint.get('id') or _normalize_title_root(best_hint.get('title'))}", best_hint)

    base_title = _normalize_title_root(item.title)
    artist_tokens = sorted(_tokenize(item.artist))[:3]
    return (f"title:{base_title}|artist:{' '.join(artist_tokens)}", None)


def _compose_search_query(
    primary_query: str,
    *,
    search_type: schemas.DiscoverySearchType,
    secondary_query: str | None = None,
) -> str:
    primary = primary_query.strip()
    secondary = (secondary_query or "").strip()
    if search_type == schemas.DiscoverySearchType.album:
        pieces = [primary]
        if secondary:
            pieces.append(secondary)
        pieces.append("album")
        return " ".join(piece for piece in pieces if piece)
    if search_type == schemas.DiscoverySearchType.artist:
        return " ".join(piece for piece in [primary, secondary] if piece)
    # For song search: add artist + "official audio" to bias toward originals
    pieces = [primary]
    if secondary:
        pieces.append(secondary)
    pieces.append("official audio")
    return " ".join(piece for piece in pieces if piece)


def _score_result(
    query: str,
    item: schemas.DiscoverySearchResult,
    *,
    search_type: schemas.DiscoverySearchType = schemas.DiscoverySearchType.song,
    secondary_query: str | None = None,
) -> tuple[int, int, int, str]:
    query_text = query.lower().strip()
    query_tokens = _tokenize(query_text)
    secondary_tokens = _tokenize(secondary_query)
    title = item.title or ""
    artist = item.artist or ""
    album = item.album or ""

    title_tokens = _tokenize(title)
    artist_tokens = _tokenize(artist)
    album_tokens = _tokenize(album)
    all_tokens = title_tokens | artist_tokens | album_tokens

    coverage = len(query_tokens & all_tokens)
    overlap_title = len(query_tokens & title_tokens)
    overlap_artist = len(query_tokens & artist_tokens)
    overlap_album = len(query_tokens & album_tokens)
    secondary_artist_overlap = len(secondary_tokens & artist_tokens)
    secondary_album_overlap = len(secondary_tokens & album_tokens)

    score = 0
    if search_type == schemas.DiscoverySearchType.artist:
        score += coverage * 34
        score += overlap_artist * 50
        score += overlap_title * 10
        score += overlap_album * 6
    elif search_type == schemas.DiscoverySearchType.album:
        score += coverage * 34
        score += overlap_album * 48
        score += overlap_title * 12
        score += overlap_artist * 14
        score += secondary_artist_overlap * 26
        score += secondary_album_overlap * 10
    else:
        score += coverage * 40
        score += overlap_title * 18
        score += overlap_artist * 28
        score += overlap_album * 8

    if query_tokens and coverage == len(query_tokens):
        score += 140
    if query_text and query_text in title.lower():
        score += 40 if search_type == schemas.DiscoverySearchType.artist else 90
    if query_text and query_text in artist.lower():
        score += 95 if search_type == schemas.DiscoverySearchType.artist else 35
    if query_text and query_text in album.lower():
        score += 100 if search_type == schemas.DiscoverySearchType.album else 25
    if query_text and query_text in f"{artist} {title}".lower():
        score += 45
    if overlap_title and overlap_artist:
        score += 35
    if secondary_tokens:
        if secondary_artist_overlap == 0 and secondary_album_overlap == 0:
            score -= 90
        if secondary_artist_overlap:
            score += 64
        if secondary_album_overlap:
            score += 20

    noise_penalty = _noise_penalty(title, query_tokens) + _noise_penalty(album, query_tokens)
    score -= noise_penalty

    # Bonus for uploader/channel matching the artist query — strong signal for originals
    if secondary_tokens and artist_tokens:
        artist_match_ratio = len(secondary_tokens & artist_tokens) / max(len(secondary_tokens), 1)
        if artist_match_ratio >= 0.5:
            score += 120  # Big bonus: channel IS the artist
        # Penalty if artist name contains noise words (e.g. "Cover by John")
        artist_noise = _noise_penalty(artist, query_tokens)
        score -= artist_noise

    # Bonus for "official" or "topic" in channel name (YouTube auto-generated channels)
    artist_lower = artist.lower()
    if "official" in artist_lower or "- topic" in artist_lower or "vevo" in artist_lower:
        score += 60

    if search_type == schemas.DiscoverySearchType.song and query_tokens & _CLASSICAL_HINTS:
        classical_overlap = len(query_tokens & (title_tokens | artist_tokens | album_tokens))
        score += classical_overlap * 14
        if secondary_tokens and secondary_artist_overlap == 0 and any(
            keyword in (title + " " + album).lower() for keyword in ("cover", "remix", "lofi", "rock")
        ):
            score -= 120

    duration = item.duration_seconds or 0
    if search_type == schemas.DiscoverySearchType.song and duration:
        if duration < 35:
            score -= 80
        elif duration < 60:
            score -= 24

    source_bias = {
        schemas.DiscoverySource.youtube: 6,
        schemas.DiscoverySource.soundcloud: 4,
        schemas.DiscoverySource.bilibili: 2,
    }.get(item.source, 0)
    score += source_bias

    return (-score, -(overlap_title + overlap_artist), len(title), title.lower())


def _parse_duration_text(duration_text: str | None) -> int | None:
    if not duration_text:
        return None
    pieces = [piece for piece in duration_text.strip().split(":") if piece]
    if not pieces or any(not piece.isdigit() for piece in pieces):
        return None
    total = 0
    for piece in pieces:
        total = total * 60 + int(piece)
    return total


def _bilibili_html_headers() -> dict[str, str]:
    return {
        "User-Agent": DEFAULT_BROWSER_USER_AGENT,
        "Referer": "https://www.bilibili.com/",
        "Accept-Language": "en-US,en;q=0.9",
    }


def _normalize_thumbnail_url(url: str | None) -> str | None:
    if not url:
        return None
    cleaned = url.strip()
    if cleaned.startswith("//"):
        return f"https:{cleaned}"
    if cleaned.startswith("http://") or cleaned.startswith("https://"):
        return cleaned
    return None


def is_allowed_discovery_artwork_url(url: str) -> bool:
    try:
        hostname = (urlparse(url).hostname or "").lower()
    except Exception:
        return False
    allowed_fragments = (
        "ytimg.com",
        "ggpht.com",
        "sndcdn.com",
        "soundcloud.com",
        "hdslb.com",
        "bilibili.com",
    )
    return any(fragment in hostname for fragment in allowed_fragments)


def discovery_artwork_headers(url: str) -> dict[str, str]:
    try:
        hostname = (urlparse(url).hostname or "").lower()
    except Exception:
        return {}

    headers = {
        "User-Agent": DEFAULT_BROWSER_USER_AGENT,
        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }
    if "hdslb.com" in hostname or "bilibili.com" in hostname:
        headers["Referer"] = "https://www.bilibili.com/"
    return headers


def _bilibili_results_from_html(html_text: str, *, limit: int) -> list[dict[str, Any]]:
    blocks = re.findall(r'(<div class="bili-video-card"[\s\S]*?</div></div></div></div>)', html_text)
    results: list[dict[str, Any]] = []
    seen_urls: set[str] = set()
    for block in blocks:
        href_match = re.search(r'href="//www\.bilibili\.com/video/(?P<bvid>BV[^/"]+)/"', block)
        title_match = re.search(r'<h3 class="bili-video-card__info--tit" title="(?P<title>[^"]+)"', block)
        thumb_match = re.search(r'<img src="(?P<thumb>//[^"]+)"', block)
        duration_match = re.search(r'<span class="bili-video-card__stats__duration"[^>]*>(?P<duration>[^<]+)</span>', block)
        author_match = re.search(r'<span class="bili-video-card__info--author"[^>]*>(?P<author>[^<]+)</span>', block)
        if not href_match or not title_match:
            continue
        canonical_url = f"https://www.bilibili.com/video/{href_match.group('bvid')}/"
        if canonical_url in seen_urls:
            continue
        seen_urls.add(canonical_url)
        results.append(
            {
                "source": schemas.DiscoverySource.bilibili.value,
                "source_label": "Bilibili",
                "provider_id": href_match.group("bvid"),
                "canonical_source_url": canonical_url,
                "title": html.unescape(title_match.group("title")).replace("<em class=\"keyword\">", "").replace("</em>", ""),
                "artist": html.unescape(author_match.group("author")).strip() if author_match else None,
                "album": None,
                "duration_seconds": _parse_duration_text(duration_match.group("duration") if duration_match else None),
                "artwork_url": _normalize_thumbnail_url(thumb_match.group("thumb") if thumb_match else None),
            }
        )
        if len(results) >= limit:
            break
    return results


def _search_bilibili_via_html(query: str, *, limit: int) -> list[dict[str, Any]]:
    try:
        response = requests.get(
            "https://search.bilibili.com/all",
            params={"keyword": query},
            headers=_bilibili_html_headers(),
            timeout=30,
        )
        response.raise_for_status()
    except requests.RequestException:
        logger.exception("Bilibili HTML search failed")
        return []
    return _bilibili_results_from_html(response.text, limit=limit)


def _canonical_url(entry: dict[str, Any], source: schemas.DiscoverySource) -> str | None:
    webpage_url = _clean_text(entry.get("webpage_url")) or _clean_text(entry.get("original_url"))
    if webpage_url and webpage_url.startswith("http"):
        return webpage_url

    url_value = _clean_text(entry.get("url"))
    if url_value and url_value.startswith("http"):
        return url_value

    entry_id = _clean_text(entry.get("id"))
    if not entry_id:
        return None
    if source == schemas.DiscoverySource.youtube:
        return f"https://www.youtube.com/watch?v={entry_id}"
    return None


def _normalize_result(
    entry: dict[str, Any],
    *,
    source: schemas.DiscoverySource,
    source_label: str,
) -> dict[str, Any] | None:
    canonical_url = _canonical_url(entry, source)
    title = _clean_text(entry.get("title"))
    if not canonical_url or not title:
        return None
    return {
        "source": source.value,
        "source_label": source_label,
        "provider_id": _clean_text(entry.get("id")) or canonical_url,
        "canonical_source_url": canonical_url,
        "title": title,
        "artist": (
            _clean_text(entry.get("artist"))
            or _clean_text(entry.get("uploader"))
            or _clean_text(entry.get("channel"))
            or _clean_text(entry.get("creator"))
        ),
        "album": _clean_text(entry.get("album")) or _clean_text(entry.get("playlist_title")),
        "duration_seconds": _coerce_duration(entry.get("duration")),
        "artwork_url": _normalize_thumbnail_url(_clean_text(entry.get("thumbnail"))),
    }


def _search_source(
    *,
    query: str,
    source: schemas.DiscoverySource,
    limit: int,
) -> list[dict[str, Any]]:
    variants = SEARCH_VARIANTS[source]
    for prefix, label in variants:
        search_term = f"{prefix}{limit}:{query}"
        try:
            with YoutubeDL(_search_options()) as ydl:
                payload = ydl.extract_info(search_term, download=False)
            if not payload:
                continue
            entries = payload.get("entries") or []
            results = [
                item
                for item in (
                    _normalize_result(entry, source=source, source_label=label)
                    for entry in entries
                    if entry
                )
                if item
            ]
            if results:
                return results
        except Exception:
            logger.exception("Discovery search failed for %s using %s", source.value, prefix)
    if source == schemas.DiscoverySource.bilibili:
        return _search_bilibili_via_html(query, limit=limit)
    return []


def _default_source_label(source: schemas.DiscoverySource) -> str:
    variants = SEARCH_VARIANTS[source]
    return variants[0][1]


def search_catalog(
    *,
    query: str,
    sources: list[schemas.DiscoverySource],
    search_type: schemas.DiscoverySearchType = schemas.DiscoverySearchType.song,
    secondary_query: str | None = None,
    page: int = 1,
    page_size: int = 12,
) -> schemas.DiscoverySearchPage:
    cleaned_query = query.strip()
    if not cleaned_query:
        return schemas.DiscoverySearchPage(
            query="",
            sources=sources,
            items=[],
            page=page,
            page_size=page_size,
            total=0,
        )

    provider_query = _compose_search_query(
        cleaned_query,
        search_type=search_type,
        secondary_query=secondary_query,
    )
    fetch_limit = max(page * page_size, 5)
    combined: list[dict[str, Any]] = []
    for source in sources:
        combined.extend(_search_source(query=provider_query, source=source, limit=fetch_limit))

    deduped: dict[str, dict[str, Any]] = {}
    for item in combined:
        deduped.setdefault(item["canonical_source_url"], item)

    normalized_items: list[schemas.DiscoverySearchResult] = []
    for item in deduped.values():
        try:
            normalized_items.append(schemas.DiscoverySearchResult.model_validate(item))
        except Exception:
            logger.exception("Skipping malformed discovery result: %s", item)

    normalized_items.sort(
        key=lambda item: _score_result(
            cleaned_query,
            item,
            search_type=search_type,
            secondary_query=secondary_query,
        )
    )
    start = max((page - 1) * page_size, 0)
    end = start + page_size
    return schemas.DiscoverySearchPage(
        query=cleaned_query,
        sources=sources,
        items=normalized_items[start:end],
        page=page,
        page_size=page_size,
        total=len(normalized_items),
    )


def _version_rank(
    item: schemas.DiscoverySearchResult,
    *,
    query: str,
    artist_hint: str | None,
    hint: dict[str, Any] | None,
) -> tuple[int, int, int, int, str]:
    base_rank = _score_result(
        query,
        item,
        search_type=schemas.DiscoverySearchType.song,
        secondary_query=artist_hint,
    )
    hint_bonus = _hint_score_for_item(item, hint) if hint else 0
    return (
        base_rank[0] - hint_bonus,
        base_rank[1],
        base_rank[2],
        -(item.duration_seconds or 0),
        (item.title or "").lower(),
    )


def search_versions(
    *,
    query: str,
    source: schemas.DiscoverySource,
    artist_hint: str | None = None,
    page: int = 1,
    page_size: int = 8,
) -> schemas.DiscoveryVersionSearchPage:
    cleaned_query = query.strip()
    cleaned_artist_hint = _clean_text(artist_hint)
    if not cleaned_query:
        return schemas.DiscoveryVersionSearchPage(
            query="",
            source=source,
            status=schemas.SearchResponseStatus.ok,
            items=[],
            page=page,
            page_size=page_size,
            total=0,
        )

    cached = _cache_get(query=cleaned_query, source=source, artist_hint=cleaned_artist_hint)
    if cached:
        cached_status, cached_items = cached
        start = max((page - 1) * page_size, 0)
        end = start + page_size
        return schemas.DiscoveryVersionSearchPage(
            query=cleaned_query,
            source=source,
            status=cached_status,
            items=cached_items[start:end],
            page=page,
            page_size=page_size,
            total=len(cached_items),
        )

    provider_timed_out, provider_results = _run_with_timeout(
        lambda: _search_source(
            query=_compose_search_query(
                cleaned_query,
                search_type=schemas.DiscoverySearchType.song,
                secondary_query=cleaned_artist_hint,
            ),
            source=source,
            limit=max(page_size * 3, 12),
        ),
        timeout_seconds=settings.PROVIDER_SEARCH_TIMEOUT_SECONDS,
        fallback=[],
    )
    hint_timed_out, hints = _run_with_timeout(
        lambda: _canonical_hints(cleaned_query, cleaned_artist_hint),
        timeout_seconds=settings.CANONICAL_HINT_TIMEOUT_SECONDS,
        fallback=[],
    )

    status = schemas.SearchResponseStatus.ok
    if provider_timed_out and not provider_results:
        status = schemas.SearchResponseStatus.timeout
    elif provider_timed_out or hint_timed_out:
        status = schemas.SearchResponseStatus.partial

    grouped: dict[str, dict[str, Any]] = {}
    for payload in provider_results:
        try:
            item = schemas.DiscoverySearchResult.model_validate(payload)
        except Exception:
            logger.exception("Skipping malformed version-search result: %s", payload)
            continue
        group_key, matched_hint = _group_key_for_item(item, hints)
        bucket = grouped.setdefault(
            group_key,
            {
                "hint": matched_hint,
                "items": [],
            },
        )
        if matched_hint and not bucket.get("hint"):
            bucket["hint"] = matched_hint
        bucket["items"].append(item)

    version_groups: list[schemas.DiscoveryVersionGroup] = []
    for group_key, bucket in grouped.items():
        items = list(bucket["items"])
        hint = bucket.get("hint")
        items.sort(key=lambda item: _version_rank(item, query=cleaned_query, artist_hint=cleaned_artist_hint, hint=hint))
        selected_version = items[0]
        display_title = _clean_text((hint or {}).get("title")) or _display_title_from_versions(items)
        display_artist = _clean_text((hint or {}).get("artist")) or selected_version.artist
        artwork_url = selected_version.artwork_url
        top_hint_bonus = _hint_score_for_item(selected_version, hint) if hint else 0
        confidence = max(0.15, min(0.99, 0.42 + top_hint_bonus / 220))
        version_groups.append(
            schemas.DiscoveryVersionGroup(
                group_id=group_key,
                display_title=display_title,
                display_artist=display_artist,
                artwork_url=artwork_url,
                confidence=round(confidence, 2),
                selected_version=selected_version,
                alternate_versions=items[1:6],
            )
        )

    version_groups.sort(key=lambda group: (-group.confidence, (group.display_title or "").lower()))

    _cache_put(
        query=cleaned_query,
        source=source,
        artist_hint=cleaned_artist_hint,
        status=status,
        items=version_groups,
    )

    start = max((page - 1) * page_size, 0)
    end = start + page_size
    return schemas.DiscoveryVersionSearchPage(
        query=cleaned_query,
        source=source,
        status=status,
        items=version_groups[start:end],
        page=page,
        page_size=page_size,
        total=len(version_groups),
    )


def _best_audio_format(info: dict[str, Any]) -> dict[str, Any]:
    formats = info.get("formats") or []
    audio_formats = [
        fmt
        for fmt in formats
        if fmt
        and fmt.get("url")
        and fmt.get("acodec")
        and fmt.get("acodec") != "none"
    ]
    if not audio_formats:
        if info.get("url"):
            return info
        raise RuntimeError("Could not resolve a playable audio stream")
    audio_formats.sort(
        key=lambda fmt: (
            fmt.get("protocol") not in {"http", "https"},
            fmt.get("ext") not in {"mp3", "m4a", "mp4"},
            -(fmt.get("abr") or 0),
            -(fmt.get("tbr") or 0),
        )
    )
    return audio_formats[0]


def resolve_stream_target(source_url: str) -> tuple[str, dict[str, str], str]:
    with YoutubeDL(_resolve_options()) as ydl:
        info = ydl.extract_info(source_url, download=False)
    selected = _best_audio_format(info)
    direct_url = selected.get("url")
    if not direct_url:
        raise RuntimeError("Could not resolve a playable audio stream")
    headers = {
        str(key): str(value)
        for key, value in (selected.get("http_headers") or info.get("http_headers") or {}).items()
        if value is not None
    }
    ext = _clean_text(selected.get("ext")) or _clean_text(info.get("ext")) or "m4a"
    media_type = "audio/mp4" if ext in {"m4a", "mp4"} else "audio/mpeg" if ext == "mp3" else "audio/*"
    return direct_url, headers, media_type


def create_stream_session(owner_id: int, item: schemas.CreateDiscoveryStreamSessionRequest) -> StreamSession:
    direct_url, headers, media_type = resolve_stream_target(item.canonical_source_url)
    session = StreamSession(
        token=secrets.token_urlsafe(24),
        owner_id=owner_id,
        result=schemas.DiscoverySearchResult(
            source=item.source,
            source_label=_default_source_label(item.source),
            provider_id=item.provider_id,
            canonical_source_url=item.canonical_source_url,
            title=item.title,
            artist=item.artist,
            album=item.album,
            duration_seconds=item.duration_seconds,
            artwork_url=item.artwork_url,
        ).model_dump(),
        direct_url=direct_url,
        headers=headers,
        media_type=media_type,
        expires_at=datetime.utcnow() + timedelta(seconds=settings.DISCOVERY_STREAM_TTL_SECONDS),
    )
    with _STREAM_SESSIONS_LOCK:
        _purge_expired_locked()
        _STREAM_SESSIONS[session.token] = session
    return session


def _purge_expired_locked():
    now = datetime.utcnow()
    expired = [token for token, session in _STREAM_SESSIONS.items() if session.expires_at <= now]
    for token in expired:
        _STREAM_SESSIONS.pop(token, None)


def get_stream_session(token: str, *, owner_id: int) -> StreamSession | None:
    with _STREAM_SESSIONS_LOCK:
        _purge_expired_locked()
        session = _STREAM_SESSIONS.get(token)
        if not session or session.owner_id != owner_id:
            return None
        return session

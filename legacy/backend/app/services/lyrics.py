"""Synced lyrics fetching via LRCLIB (lrclib.net).

LRCLIB is a free, open, crowd-sourced lyrics database that provides
both plain-text and time-synced (LRC format) lyrics.

Flow:
  1. Try exact match by artist + track + duration (GET /api/get)
  2. Fall back to search by artist + track (GET /api/search), pick
     the best result that has synced lyrics
  3. Return both plain and synced lyrics if available
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import requests

logger = logging.getLogger("yoinker.lyrics")

LRCLIB_BASE = "https://lrclib.net/api"
LRCLIB_USER_AGENT = "Yoinker/1.0 (https://github.com/yoinker)"
_TIMEOUT = 10


@dataclass(slots=True)
class LyricsResult:
    """Container for lyrics fetched from LRCLIB."""
    track_name: str
    artist_name: str
    album_name: Optional[str]
    plain_lyrics: Optional[str]
    synced_lyrics: Optional[str]        # LRC format with [mm:ss.xx] timestamps
    duration: Optional[float]
    source_id: Optional[int] = None     # LRCLIB internal ID

    @property
    def has_synced(self) -> bool:
        return bool(self.synced_lyrics and self.synced_lyrics.strip())

    @property
    def has_any(self) -> bool:
        return bool(self.plain_lyrics or self.synced_lyrics)


def _headers() -> dict[str, str]:
    return {
        "User-Agent": LRCLIB_USER_AGENT,
        "Accept": "application/json",
    }


def _parse_response(data: dict) -> Optional[LyricsResult]:
    """Parse a single LRCLIB response object into a LyricsResult."""
    plain = data.get("plainLyrics")
    synced = data.get("syncedLyrics")
    if not plain and not synced:
        return None
    return LyricsResult(
        track_name=data.get("trackName") or data.get("name") or "",
        artist_name=data.get("artistName") or "",
        album_name=data.get("albumName") or None,
        plain_lyrics=plain or None,
        synced_lyrics=synced or None,
        duration=data.get("duration"),
        source_id=data.get("id"),
    )


def fetch_lyrics(
    *,
    track_name: str,
    artist_name: str,
    album_name: Optional[str] = None,
    duration_seconds: Optional[int] = None,
) -> Optional[LyricsResult]:
    """Fetch lyrics from LRCLIB.

    Strategy:
      1. Exact match (GET /api/get) — requires artist + track, duration helps
      2. Search fallback (GET /api/search) — picks best synced result
    """
    result = _try_exact_match(
        track_name=track_name,
        artist_name=artist_name,
        album_name=album_name,
        duration_seconds=duration_seconds,
    )
    if result and result.has_synced:
        return result

    # If exact match returned plain-only, keep it as fallback
    plain_fallback = result

    search_result = _try_search(
        track_name=track_name,
        artist_name=artist_name,
        duration_seconds=duration_seconds,
    )
    if search_result and search_result.has_synced:
        return search_result

    # Return whichever has any lyrics
    return search_result or plain_fallback


def _try_exact_match(
    *,
    track_name: str,
    artist_name: str,
    album_name: Optional[str] = None,
    duration_seconds: Optional[int] = None,
) -> Optional[LyricsResult]:
    """GET /api/get — exact match by metadata."""
    params: dict[str, str] = {
        "track_name": track_name.strip(),
        "artist_name": artist_name.strip(),
    }
    if album_name:
        params["album_name"] = album_name.strip()
    if duration_seconds and duration_seconds > 0:
        params["duration"] = str(duration_seconds)

    try:
        resp = requests.get(
            f"{LRCLIB_BASE}/get",
            params=params,
            headers=_headers(),
            timeout=_TIMEOUT,
        )
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        return _parse_response(resp.json())
    except requests.RequestException:
        logger.debug("LRCLIB exact match failed for %s - %s", artist_name, track_name)
        return None


def _try_search(
    *,
    track_name: str,
    artist_name: str,
    duration_seconds: Optional[int] = None,
) -> Optional[LyricsResult]:
    """GET /api/search — fuzzy search, pick best synced result."""
    params: dict[str, str] = {
        "track_name": track_name.strip(),
        "artist_name": artist_name.strip(),
    }

    try:
        resp = requests.get(
            f"{LRCLIB_BASE}/search",
            params=params,
            headers=_headers(),
            timeout=_TIMEOUT,
        )
        resp.raise_for_status()
        results = resp.json()
        if not isinstance(results, list) or not results:
            return None
    except requests.RequestException:
        logger.debug("LRCLIB search failed for %s - %s", artist_name, track_name)
        return None

    # Prefer results with synced lyrics
    synced_candidates = []
    plain_candidates = []
    for item in results:
        parsed = _parse_response(item)
        if not parsed:
            continue
        if parsed.has_synced:
            synced_candidates.append(parsed)
        elif parsed.plain_lyrics:
            plain_candidates.append(parsed)

    # Among synced candidates, prefer one whose duration is closest
    if synced_candidates:
        if duration_seconds and duration_seconds > 0:
            synced_candidates.sort(
                key=lambda r: abs((r.duration or 0) - duration_seconds)
            )
        return synced_candidates[0]

    return plain_candidates[0] if plain_candidates else None


def write_lrc_file(media_path: Path, lyrics: LyricsResult) -> Optional[Path]:
    """Write an .lrc sidecar file next to the media file.

    Returns the path to the written file, or None if no lyrics to write.
    """
    content = lyrics.synced_lyrics or lyrics.plain_lyrics
    if not content:
        return None

    lrc_path = media_path.with_suffix(".lrc")
    # Build LRC header
    header_lines = []
    if lyrics.track_name:
        header_lines.append(f"[ti:{lyrics.track_name}]")
    if lyrics.artist_name:
        header_lines.append(f"[ar:{lyrics.artist_name}]")
    if lyrics.album_name:
        header_lines.append(f"[al:{lyrics.album_name}]")

    # If content is already synced (has timestamps), write as-is
    if lyrics.has_synced:
        full_content = "\n".join(header_lines) + "\n" + content if header_lines else content
    else:
        # Plain lyrics — no timestamps
        full_content = "\n".join(header_lines) + "\n" + content if header_lines else content

    lrc_path.write_text(full_content, encoding="utf-8")
    return lrc_path


def embed_lyrics_in_mp3(mp3_path: Path, lyrics: LyricsResult) -> None:
    """Embed lyrics into the MP3 file's ID3 tags.

    - USLT frame: unsynchronized (plain) lyrics
    - SYLT frame: synchronized lyrics with timestamps (if available)
    """
    try:
        from mutagen.id3 import ID3, USLT, SYLT, Encoding, ID3NoHeaderError
    except ImportError:
        logger.debug("mutagen not available; skipping lyrics embed")
        return

    try:
        tags = ID3(str(mp3_path))
    except ID3NoHeaderError:
        tags = ID3()
    except Exception:
        logger.debug("Could not read ID3 tags from %s", mp3_path)
        return

    # Always embed plain lyrics as USLT
    plain = lyrics.plain_lyrics or lyrics.synced_lyrics
    if plain:
        # Remove existing USLT frames
        tags.delall("USLT")
        tags.add(USLT(
            encoding=Encoding.UTF8,
            lang="eng",
            desc="",
            text=_strip_timestamps(plain),
        ))

    # Embed synced lyrics as SYLT if available
    if lyrics.has_synced:
        tags.delall("SYLT")
        sylt_data = _parse_lrc_to_sylt(lyrics.synced_lyrics)
        if sylt_data:
            tags.add(SYLT(
                encoding=Encoding.UTF8,
                lang="eng",
                desc="",
                format=2,  # milliseconds
                type=1,    # lyrics
                text=sylt_data,
            ))

    try:
        tags.save(str(mp3_path))
    except Exception:
        logger.debug("Could not save ID3 tags with lyrics to %s", mp3_path)


def _strip_timestamps(text: str) -> str:
    """Remove [mm:ss.xx] timestamps from LRC text to get plain lyrics."""
    import re
    return re.sub(r"\[\d{2}:\d{2}\.\d{2,3}\]\s*", "", text).strip()


def _parse_lrc_to_sylt(lrc_text: str) -> list[tuple[str, int]]:
    """Convert LRC format to SYLT data: list of (text, timestamp_ms) tuples."""
    import re
    pattern = re.compile(r"\[(\d{2}):(\d{2})\.(\d{2,3})\]\s*(.*)")
    entries = []
    for line in lrc_text.split("\n"):
        match = pattern.match(line.strip())
        if not match:
            continue
        minutes = int(match.group(1))
        seconds = int(match.group(2))
        centiseconds = match.group(3)
        # Normalize to milliseconds
        if len(centiseconds) == 2:
            ms = int(centiseconds) * 10
        else:
            ms = int(centiseconds)
        timestamp_ms = (minutes * 60 + seconds) * 1000 + ms
        text = match.group(4).strip()
        if text:
            entries.append((text, timestamp_ms))
    return entries

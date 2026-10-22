from __future__ import annotations

import logging
from functools import lru_cache
from typing import Any

import musicbrainzngs

from .. import schemas


logger = logging.getLogger("yoinker.metadata")


@lru_cache(maxsize=1)
def _configure_musicbrainz():
    logging.getLogger("musicbrainzngs").setLevel(logging.WARNING)
    musicbrainzngs.set_useragent("yoinker", "1.0", "https://yoinker.local")


def _clean_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _first_release_title(recording: dict[str, Any]) -> str | None:
    releases = recording.get("release-list") or []
    if not releases:
        return None
    return _clean_text(releases[0].get("title"))


def _search_musicbrainz(title: str | None, artist: str | None) -> dict[str, str] | None:
    if not title:
        return None
    try:
        _configure_musicbrainz()
        payload = {"recording": title, "limit": 5}
        if artist:
            payload["artist"] = artist
        result = musicbrainzngs.search_recordings(**payload)
        recordings = result.get("recording-list") or []
        if not recordings:
            return None
        top = recordings[0]
        return {
            "title": _clean_text(top.get("title")) or title,
            "artist": _clean_text(top.get("artist-credit-phrase")) or artist,
            "album": _first_release_title(top),
        }
    except Exception:
        logger.exception("MusicBrainz enrichment failed for %s / %s", title, artist)
        return None


def normalize_import_metadata(
    *,
    source_title: str | None,
    source_artist: str | None,
    source_album: str | None,
    override_title: str | None = None,
    override_artist: str | None = None,
    override_album: str | None = None,
    enrich_metadata: bool = True,
) -> dict[str, str | None]:
    raw_title = _clean_text(source_title) or "Untitled"
    raw_artist = _clean_text(source_artist) or "Unknown uploader"
    raw_album = _clean_text(source_album)

    normalized_title = _clean_text(override_title) or raw_title
    normalized_artist = _clean_text(override_artist) or raw_artist
    normalized_album = _clean_text(override_album) or raw_album
    metadata_status = schemas.MetadataStatus.override.value if any(
        _clean_text(value) for value in (override_title, override_artist, override_album)
    ) else schemas.MetadataStatus.source.value

    if enrich_metadata:
        enriched = _search_musicbrainz(raw_title, raw_artist)
        if enriched:
            normalized_title = _clean_text(override_title) or enriched.get("title") or normalized_title
            normalized_artist = _clean_text(override_artist) or enriched.get("artist") or normalized_artist
            normalized_album = _clean_text(override_album) or enriched.get("album") or normalized_album
            metadata_status = (
                schemas.MetadataStatus.enriched_override.value
                if metadata_status == schemas.MetadataStatus.override.value
                else schemas.MetadataStatus.enriched.value
            )

    return {
        "raw_title": raw_title,
        "raw_artist": raw_artist,
        "raw_album": raw_album,
        "title": normalized_title,
        "artist": normalized_artist,
        "album": normalized_album,
        "metadata_status": metadata_status,
    }

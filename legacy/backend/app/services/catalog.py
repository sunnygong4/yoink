from __future__ import annotations

import logging
import re
from functools import lru_cache
from typing import Any

import musicbrainzngs
from sqlalchemy.orm import Session

from .. import crud, schemas
from .discovery import search_catalog as search_provider_catalog


logger = logging.getLogger("yoinker.catalog")
DEFAULT_MATCH_SOURCES = [
    schemas.DiscoverySource.youtube,
]
_NOISY_TRACK_TOKENS = {
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
}


@lru_cache(maxsize=1)
def _configure_musicbrainz():
    logging.getLogger("musicbrainzngs").setLevel(logging.WARNING)
    musicbrainzngs.set_useragent("yoinker", "1.0", "https://yoinker.local")


def _clean_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _tokenize(value: str | None) -> set[str]:
    if not value:
        return set()
    return set(re.findall(r"[a-z0-9]+", value.lower()))


def _noise_penalty(text: str, query_tokens: set[str]) -> int:
    tokens = _tokenize(text)
    return 32 * sum(1 for token in _NOISY_TRACK_TOKENS if token in tokens and token not in query_tokens)


def _score_recording_candidate(
    recording: dict[str, Any],
    *,
    query_tokens: set[str],
    query_text: str,
    secondary_tokens: set[str],
) -> tuple[int, int, str]:
    title = _clean_text(recording.get("title")) or ""
    artist = _clean_text(recording.get("artist-credit-phrase")) or ""
    album_title, _, _ = _first_release_info(recording)
    album = album_title or ""

    title_tokens = _tokenize(title)
    artist_tokens = _tokenize(artist)
    album_tokens = _tokenize(album)
    all_tokens = title_tokens | artist_tokens | album_tokens
    coverage = len(query_tokens & all_tokens)

    score = 0
    score += coverage * 44
    score += len(query_tokens & title_tokens) * 20
    score += len(query_tokens & artist_tokens) * 34
    score += len(query_tokens & album_tokens) * 12

    if query_tokens and coverage == len(query_tokens):
        score += 120
    if query_text and query_text in title.lower():
        score += 80
    if query_text and query_text in artist.lower():
        score += 65
    if query_text and query_text in album.lower():
        score += 40

    secondary_artist_overlap = len(secondary_tokens & artist_tokens)
    secondary_album_overlap = len(secondary_tokens & album_tokens)
    if secondary_tokens:
        if secondary_artist_overlap == 0 and secondary_album_overlap == 0:
            score -= 85
        if secondary_artist_overlap:
            score += 64
        if secondary_album_overlap:
            score += 28

    score -= _noise_penalty(title, query_tokens)
    score -= _noise_penalty(album, query_tokens)
    return (-score, len(title), title.lower())


def _first_release_info(recording: dict[str, Any]) -> tuple[str | None, str | None, str | None]:
    release = (recording.get("release-list") or [None])[0] or {}
    return (
        _clean_text(release.get("title")),
        _clean_text(release.get("id")),
        _clean_text(release.get("date")),
    )


def _release_year(value: str | None) -> str | None:
    if not value:
        return None
    return value.split("-", 1)[0].strip() or None


def _cover_art_url(release_id: str | None) -> str | None:
    if not release_id:
        return None
    return f"https://coverartarchive.org/release/{release_id}/front-250"


def _release_track_count(release: dict[str, Any]) -> int | None:
    raw_count = release.get("medium-track-count")
    if raw_count:
        try:
            return int(raw_count)
        except (TypeError, ValueError):
            pass

    total = 0
    for medium in release.get("medium-list") or []:
        count = medium.get("track-count")
        try:
            total += int(count)
        except (TypeError, ValueError):
            continue
    return total or None


def _best_track_matches(
    *,
    title: str,
    artist: str | None,
    page_size: int = 3,
) -> tuple[schemas.DiscoverySearchResult | None, list[schemas.DiscoverySearchResult]]:
    search_sources = list(DEFAULT_MATCH_SOURCES)
    provider_page = search_provider_catalog(
        query=title,
        secondary_query=artist,
        search_type=schemas.DiscoverySearchType.song,
        sources=search_sources,
        page=1,
        page_size=max(page_size * 4, 8),
    )
    matches = list(provider_page.items)
    if not matches:
        fallback_sources = [source for source in schemas.DiscoverySource if source not in search_sources]
        if fallback_sources:
            fallback_page = search_provider_catalog(
                query=title,
                secondary_query=artist,
                search_type=schemas.DiscoverySearchType.song,
                sources=fallback_sources,
                page=1,
                page_size=max(page_size * 4, 8),
            )
            matches = list(fallback_page.items)
    return (matches[0] if matches else None, matches[1:])


def search_music_catalog(
    *,
    query: str,
    search_type: schemas.CatalogSearchType,
    secondary_query: str | None = None,
    page: int = 1,
    page_size: int = 8,
) -> schemas.CatalogSearchPage:
    _configure_musicbrainz()
    cleaned_query = (query or "").strip()
    cleaned_secondary = _clean_text(secondary_query)
    if not cleaned_query:
        return schemas.CatalogSearchPage(
            query="",
            secondary_query=cleaned_secondary,
            search_type=search_type,
            items=[],
            page=page,
            page_size=page_size,
            total=0,
        )

    offset = max(page - 1, 0) * page_size
    items: list[schemas.CatalogSearchResult] = []

    if search_type == schemas.CatalogSearchType.song:
        payload: dict[str, Any] = {"recording": cleaned_query, "limit": max(page_size * 4, 16), "offset": offset}
        if cleaned_secondary:
            payload["artist"] = cleaned_secondary
        result = musicbrainzngs.search_recordings(**payload)
        recordings = list(result.get("recording-list") or [])
        query_tokens = _tokenize(cleaned_query)
        secondary_tokens = _tokenize(cleaned_secondary)
        recordings.sort(
            key=lambda recording: _score_recording_candidate(
                recording,
                query_tokens=query_tokens,
                query_text=cleaned_query.lower(),
                secondary_tokens=secondary_tokens,
            )
        )
        recordings = recordings[:page_size]
        for recording in recordings:
            album_title, release_id, release_date = _first_release_info(recording)
            artist_name = _clean_text(recording.get("artist-credit-phrase"))
            items.append(
                schemas.CatalogSearchResult(
                    result_type=schemas.CatalogResultType.track,
                    catalog_id=_clean_text(recording.get("id")) or f"recording-{len(items) + 1}",
                    title=_clean_text(recording.get("title")) or cleaned_query,
                    artist=artist_name,
                    album=album_title,
                    year=_release_year(release_date),
                    artwork_url=_cover_art_url(release_id),
                    best_match=None,
                    alternate_matches=[],
                )
            )
        total = int(result.get("recording-count") or len(items))
    else:
        payload: dict[str, Any] = {"limit": page_size, "offset": offset}
        if search_type == schemas.CatalogSearchType.album:
            payload["release"] = cleaned_query
            if cleaned_secondary:
                payload["artist"] = cleaned_secondary
        else:
            payload["artist"] = cleaned_query
            if cleaned_secondary:
                payload["release"] = cleaned_secondary
        result = musicbrainzngs.search_releases(**payload)
        releases = result.get("release-list") or []
        for release in releases:
            release_id = _clean_text(release.get("id"))
            release_title = _clean_text(release.get("title")) or "Untitled Album"
            items.append(
                schemas.CatalogSearchResult(
                    result_type=schemas.CatalogResultType.album,
                    catalog_id=release_id or f"release-{len(items) + 1}",
                    title=release_title,
                    artist=_clean_text(release.get("artist-credit-phrase")) or cleaned_query,
                    album=release_title,
                    year=_release_year(_clean_text(release.get("date"))),
                    track_count=_release_track_count(release),
                    artwork_url=_cover_art_url(release_id),
                )
            )
        total = int(result.get("release-count") or len(items))

    return schemas.CatalogSearchPage(
        query=cleaned_query,
        secondary_query=cleaned_secondary,
        search_type=search_type,
        items=items,
        page=page,
        page_size=page_size,
        total=total,
    )


def _build_import_request(
    *,
    match: schemas.DiscoverySearchResult,
    title: str,
    artist: str | None,
    album: str | None,
    artwork_url: str | None,
    enrich_metadata: bool,
    download_to_device: bool,
    audio_bitrate_kbps: int | None,
) -> schemas.CreateDiscoveryImportRequest:
    return schemas.CreateDiscoveryImportRequest(
        source=match.source,
        canonical_source_url=match.canonical_source_url,
        title=title,
        artist=artist,
        album=album,
        duration_seconds=match.duration_seconds,
        artwork_url=artwork_url or match.artwork_url,
        provider_id=match.provider_id,
        metadata_overrides=None,
        enrich_metadata=enrich_metadata,
        download_to_device=download_to_device,
        audio_bitrate_kbps=audio_bitrate_kbps,
    )


def import_catalog_track(
    db: Session,
    *,
    user_id: int,
    payload: schemas.CatalogTrackImportRequest,
) -> schemas.DownloadJobRead:
    preferred_match = payload.preferred_match
    if not preferred_match:
        best_match, _ = _best_track_matches(title=payload.title, artist=payload.artist)
        preferred_match = (
            schemas.CreateDiscoveryImportRequest(
                source=best_match.source,
                canonical_source_url=best_match.canonical_source_url,
                title=best_match.title,
                artist=best_match.artist,
                album=best_match.album,
                duration_seconds=best_match.duration_seconds,
                artwork_url=best_match.artwork_url,
                provider_id=best_match.provider_id,
                enrich_metadata=payload.enrich_metadata,
                download_to_device=payload.download_to_device,
                audio_bitrate_kbps=payload.audio_bitrate_kbps,
            )
            if best_match
            else None
        )
    if not preferred_match:
        raise RuntimeError("No playable source match found for this track")

    import_request = schemas.CreateDiscoveryImportRequest(
        source=preferred_match.source,
        canonical_source_url=preferred_match.canonical_source_url,
        title=payload.title,
        artist=payload.artist,
        album=payload.album,
        duration_seconds=preferred_match.duration_seconds,
        artwork_url=payload.artwork_url or preferred_match.artwork_url,
        provider_id=preferred_match.provider_id,
        metadata_overrides=None,
        enrich_metadata=payload.enrich_metadata,
        download_to_device=payload.download_to_device,
        audio_bitrate_kbps=payload.audio_bitrate_kbps,
    )
    return crud.create_discovery_import_job(db, user_id=user_id, import_in=import_request)


def _release_tracks(release_id: str) -> list[dict[str, Any]]:
    _configure_musicbrainz()
    release = musicbrainzngs.get_release_by_id(
        release_id,
        includes=["recordings", "artists", "release-groups", "media"],
    )["release"]

    album_title = _clean_text(release.get("title"))
    album_artist = _clean_text(release.get("artist-credit-phrase"))
    year = _release_year(_clean_text(release.get("date")))
    tracks: list[dict[str, Any]] = []
    for medium in release.get("medium-list") or []:
        for track in medium.get("track-list") or []:
            recording = track.get("recording") or {}
            tracks.append(
                {
                    "title": _clean_text(track.get("title")) or _clean_text(recording.get("title")) or "Untitled",
                    "artist": _clean_text(recording.get("artist-credit-phrase")) or album_artist,
                    "album": album_title,
                    "year": year,
                }
            )
    return tracks


def import_catalog_album(
    db: Session,
    *,
    user_id: int,
    payload: schemas.CatalogAlbumImportRequest,
) -> schemas.CatalogAlbumImportRead:
    # Auto-resolve album artwork from CoverArtArchive if not provided
    if not payload.artwork_url and payload.release_id:
        payload.artwork_url = _cover_art_url(payload.release_id)

    tracks = _release_tracks(payload.release_id)
    jobs: list[schemas.DownloadJobRead] = []
    unmatched_tracks: list[str] = []

    for track in tracks:
        best_match, _ = _best_track_matches(title=track["title"], artist=track["artist"])
        if not best_match:
            unmatched_tracks.append(track["title"])
            continue

        import_request = _build_import_request(
            match=best_match,
            title=track["title"],
            artist=track["artist"] or payload.artist,
            album=payload.title or track.get("album"),
            artwork_url=payload.artwork_url,
            enrich_metadata=payload.enrich_metadata,
            download_to_device=payload.download_to_device,
            audio_bitrate_kbps=payload.audio_bitrate_kbps,
        )
        jobs.append(crud.create_discovery_import_job(db, user_id=user_id, import_in=import_request))

    queued_jobs = sum(1 for job in jobs if job.status in {schemas.JobStatus.queued.value, schemas.JobStatus.running.value})
    completed_jobs = sum(1 for job in jobs if job.status == schemas.JobStatus.completed.value)
    return schemas.CatalogAlbumImportRead(
        release_id=payload.release_id,
        title=payload.title,
        artist=payload.artist,
        total_tracks=len(tracks),
        queued_jobs=queued_jobs,
        completed_jobs=completed_jobs,
        unmatched_tracks=unmatched_tracks,
        jobs=jobs,
    )

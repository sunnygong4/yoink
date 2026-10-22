import json
import re
import secrets
from datetime import datetime
from typing import Optional
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from . import models, schemas
from .core.security import get_password_hash


def get_user_by_username(db: Session, username: str) -> Optional[models.User]:
    return db.query(models.User).filter(models.User.username == username).first()


def get_user_by_id(db: Session, user_id: int) -> Optional[models.User]:
    return db.query(models.User).filter(models.User.id == user_id).first()


def create_user(db: Session, user_in: schemas.UserCreate) -> models.User:
    user = models.User(
        username=user_in.username,
        email=user_in.email,
        hashed_password=get_password_hash(user_in.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def normalize_source_url(url: str | None) -> str:
    cleaned = (url or "").strip()
    if not cleaned:
        return ""
    try:
        parsed = urlparse(cleaned)
    except Exception:
        return cleaned

    scheme = parsed.scheme or "https"
    netloc = (parsed.netloc or "").lower()
    if netloc.startswith("www."):
        netloc = netloc[4:]
    path = parsed.path or ""
    query_pairs = dict(parse_qsl(parsed.query, keep_blank_values=False))

    if netloc == "youtu.be":
        video_id = path.strip("/")
        if video_id:
            return f"https://youtube.com/watch?v={video_id}"

    if netloc.endswith("youtube.com"):
        video_id = query_pairs.get("v")
        if video_id:
            return f"https://youtube.com/watch?v={video_id}"
        return urlunparse((scheme, netloc, path.rstrip("/"), "", "", ""))

    if netloc.endswith("soundcloud.com"):
        return urlunparse((scheme, netloc, path.rstrip("/"), "", "", ""))

    if netloc.endswith("bilibili.com"):
        normalized_path = path.rstrip("/")
        if normalized_path:
            normalized_path = f"{normalized_path}/"
        normalized_netloc = "www.bilibili.com" if netloc == "bilibili.com" else netloc
        return urlunparse((scheme, normalized_netloc, normalized_path, "", "", ""))

    normalized_query = urlencode(sorted(query_pairs.items()))
    return urlunparse((scheme, netloc, path.rstrip("/"), "", normalized_query, ""))


def _find_duplicate_job(
    db: Session,
    *,
    user_id: int,
    source_url: str,
    mode: str,
) -> Optional[models.DownloadJob]:
    normalized = normalize_source_url(source_url)
    if not normalized:
        return None
    candidates = (
        _job_query_for_user(db, user_id)
        .filter(models.DownloadJob.mode == mode)
        .order_by(models.DownloadJob.created_at.desc())
        .all()
    )
    for candidate in candidates:
        if normalize_source_url(candidate.source_url) != normalized:
            continue
        if candidate.status in {schemas.JobStatus.queued.value, schemas.JobStatus.running.value}:
            return candidate
        if candidate.status == schemas.JobStatus.completed.value and (
            candidate.media_files or candidate.media_file_id
        ):
            return candidate
    return None


def _find_existing_media_for_source(
    db: Session,
    *,
    user_id: int,
    source_url: str,
    media_type: str,
) -> Optional[models.MediaFile]:
    normalized = normalize_source_url(source_url)
    if not normalized:
        return None
    candidates = (
        db.query(models.MediaFile)
        .filter(models.MediaFile.owner_id == user_id, models.MediaFile.media_type == media_type)
        .order_by(models.MediaFile.created_at.desc())
        .all()
    )
    for candidate in candidates:
        if normalize_source_url(candidate.source_url) == normalized:
            return candidate
    return None


def _override_status(current_status: str | None) -> str:
    if current_status == schemas.MetadataStatus.enriched.value:
        return schemas.MetadataStatus.enriched_override.value
    if current_status == schemas.MetadataStatus.enriched_override.value:
        return schemas.MetadataStatus.enriched_override.value
    return schemas.MetadataStatus.override.value


def _get_or_create_duplicate_completed_job(
    db: Session,
    *,
    user_id: int,
    source_url: str,
    mode: str,
    media: models.MediaFile,
    audio_bitrate_kbps: int | None,
    video_quality: str | None,
    allow_playlist: bool,
    import_source: str | None = None,
    enrich_metadata: bool = True,
    download_to_device: bool = False,
) -> models.DownloadJob:
    existing_job = (
        _job_query_for_user(db, user_id)
        .filter(models.DownloadJob.media_file_id == media.id)
        .order_by(models.DownloadJob.created_at.desc())
        .first()
    )
    if existing_job:
        return existing_job

    now = datetime.utcnow()
    job = models.DownloadJob(
        owner_id=user_id,
        source_url=normalize_source_url(source_url) or source_url,
        mode=mode,
        media_file_id=media.id,
        audio_bitrate_kbps=audio_bitrate_kbps if mode == schemas.MediaMode.audio.value else None,
        video_quality=video_quality if mode == schemas.MediaMode.video.value else None,
        allow_playlist=allow_playlist,
        import_source=import_source,
        enrich_metadata=enrich_metadata,
        download_to_device=download_to_device,
        status=schemas.JobStatus.completed.value,
        progress_percent=100,
        progress_message="Already in library",
        updated_at=now,
        started_at=now,
        completed_at=now,
    )
    db.add(job)
    db.commit()
    return get_job_for_user(db, user_id, job.id)


def _create_job_record(
    db: Session,
    *,
    user_id: int,
    source_url: str,
    mode: str,
    audio_bitrate_kbps: int | None,
    video_quality: str | None,
    allow_playlist: bool,
    import_source: str | None = None,
    metadata_overrides: dict | None = None,
    enrich_metadata: bool = True,
    download_to_device: bool = False,
) -> models.DownloadJob:
    normalized_source_url = normalize_source_url(source_url) or source_url
    job = models.DownloadJob(
        owner_id=user_id,
        source_url=normalized_source_url,
        mode=mode,
        audio_bitrate_kbps=audio_bitrate_kbps if mode == schemas.MediaMode.audio.value else None,
        video_quality=video_quality if mode == schemas.MediaMode.video.value else None,
        allow_playlist=allow_playlist,
        import_source=import_source,
        metadata_overrides_json=json.dumps(metadata_overrides) if metadata_overrides else None,
        enrich_metadata=enrich_metadata,
        download_to_device=download_to_device,
        status=schemas.JobStatus.queued.value,
        progress_percent=0,
        progress_message="Queued",
        updated_at=datetime.utcnow(),
    )
    db.add(job)
    db.commit()
    return job


def create_job(db: Session, user_id: int, job_in: schemas.CreateJobRequest) -> models.DownloadJob:
    existing_job = _find_duplicate_job(
        db,
        user_id=user_id,
        source_url=job_in.url,
        mode=job_in.mode.value,
    )
    if existing_job:
        return existing_job

    existing_media = _find_existing_media_for_source(
        db,
        user_id=user_id,
        source_url=job_in.url,
        media_type=job_in.mode.value,
    )
    if existing_media:
        return _get_or_create_duplicate_completed_job(
            db,
            user_id=user_id,
            source_url=job_in.url,
            mode=job_in.mode.value,
            media=existing_media,
            audio_bitrate_kbps=job_in.audio_bitrate_kbps,
            video_quality=job_in.video_quality,
            allow_playlist=job_in.allow_playlist,
        )

    job = _create_job_record(
        db,
        user_id=user_id,
        source_url=job_in.url,
        mode=job_in.mode.value,
        audio_bitrate_kbps=job_in.audio_bitrate_kbps,
        video_quality=job_in.video_quality,
        allow_playlist=job_in.allow_playlist,
        metadata_overrides=(
            {
                "source": {},
                "override": job_in.metadata_overrides.model_dump(exclude_none=True),
            }
            if job_in.metadata_overrides
            else None
        ),
    )
    return get_job_for_user(db, user_id, job.id)


def create_discovery_import_job(
    db: Session,
    *,
    user_id: int,
    import_in: schemas.CreateDiscoveryImportRequest,
) -> models.DownloadJob:
    existing_job = _find_duplicate_job(
        db,
        user_id=user_id,
        source_url=import_in.canonical_source_url,
        mode=schemas.MediaMode.audio.value,
    )
    if existing_job:
        return existing_job

    existing_media = _find_existing_media_for_source(
        db,
        user_id=user_id,
        source_url=import_in.canonical_source_url,
        media_type=schemas.MediaMode.audio.value,
    )
    if existing_media:
        return _get_or_create_duplicate_completed_job(
            db,
            user_id=user_id,
            source_url=import_in.canonical_source_url,
            mode=schemas.MediaMode.audio.value,
            media=existing_media,
            audio_bitrate_kbps=import_in.audio_bitrate_kbps,
            video_quality=None,
            allow_playlist=False,
            import_source=import_in.source.value,
            enrich_metadata=import_in.enrich_metadata,
            download_to_device=import_in.download_to_device,
        )

    metadata_overrides = {
        "source": {
            "title": import_in.title,
            "artist": import_in.artist,
            "album": import_in.album,
            "artwork_url": import_in.artwork_url,
            "duration_seconds": import_in.duration_seconds,
            "provider_id": import_in.provider_id,
        },
        "override": (import_in.metadata_overrides.model_dump(exclude_none=True) if import_in.metadata_overrides else {}),
    }
    job = _create_job_record(
        db,
        user_id=user_id,
        source_url=import_in.canonical_source_url,
        mode=schemas.MediaMode.audio.value,
        audio_bitrate_kbps=import_in.audio_bitrate_kbps,
        video_quality=None,
        allow_playlist=False,
        import_source=import_in.source.value,
        metadata_overrides=metadata_overrides,
        enrich_metadata=import_in.enrich_metadata,
        download_to_device=import_in.download_to_device,
    )
    return get_job_for_user(db, user_id, job.id)


def parse_job_metadata_overrides(job: models.DownloadJob) -> dict:
    if not job.metadata_overrides_json:
        return {}
    try:
        payload = json.loads(job.metadata_overrides_json)
        return payload if isinstance(payload, dict) else {}
    except Exception:
        return {}


def _job_query_for_user(db: Session, user_id: int):
    return (
        db.query(models.DownloadJob)
        .options(selectinload(models.DownloadJob.media_files))
        .filter(models.DownloadJob.owner_id == user_id)
    )


def get_job_for_user(db: Session, user_id: int, job_id: int) -> Optional[models.DownloadJob]:
    return _job_query_for_user(db, user_id).filter(models.DownloadJob.id == job_id).first()


def list_jobs_for_user(db: Session, user_id: int) -> list[models.DownloadJob]:
    return _job_query_for_user(db, user_id).order_by(models.DownloadJob.created_at.desc()).all()


def request_job_cancel(db: Session, user_id: int, job_id: int) -> Optional[models.DownloadJob]:
    job = get_job_for_user(db, user_id, job_id)
    if not job:
        return None
    job.cancel_requested = True
    if job.status == schemas.JobStatus.queued.value:
        job.status = schemas.JobStatus.cancelled.value
        job.progress_message = "Cancelled before start"
        job.completed_at = datetime.utcnow()
    job.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(job)
    return job


def list_pending_device_downloads(db: Session, user_id: int) -> list[models.DownloadJob]:
    return (
        _job_query_for_user(db, user_id)
        .filter(
            models.DownloadJob.download_to_device.is_(True),
            models.DownloadJob.device_downloaded.is_(False),
            models.DownloadJob.status == schemas.JobStatus.completed.value,
            models.DownloadJob.media_file_id.isnot(None),
        )
        .order_by(models.DownloadJob.completed_at.desc())
        .all()
    )


def mark_job_downloaded(db: Session, user_id: int, job_id: int) -> Optional[models.DownloadJob]:
    job = get_job_for_user(db, user_id, job_id)
    if not job:
        return None
    job.device_downloaded = True
    job.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(job)
    return job


def list_media_for_user(
    db: Session,
    user_id: int,
    *,
    media_type: Optional[str] = None,
    query: Optional[str] = None,
    sort: str = schemas.LibrarySort.recent.value,
    page: int = 1,
    page_size: int = 24,
) -> tuple[list[models.MediaFile], int]:
    filters = [models.MediaFile.owner_id == user_id]
    if media_type:
        filters.append(models.MediaFile.media_type == media_type)
    if query:
        search = f"%{query.lower()}%"
        filters.append(
            func.lower(
                func.coalesce(models.MediaFile.title, "")
                + " "
                + func.coalesce(models.MediaFile.uploader, "")
                + " "
                + func.coalesce(models.MediaFile.album, "")
            ).like(search)
        )

    base_query = db.query(models.MediaFile).filter(*filters)
    total = base_query.count()
    if sort == schemas.LibrarySort.title.value:
        order_clause = func.lower(func.coalesce(models.MediaFile.title, "")).asc()
    elif sort == schemas.LibrarySort.duration.value:
        order_clause = func.coalesce(models.MediaFile.duration_seconds, 0).desc()
    else:
        order_clause = models.MediaFile.created_at.desc()
    items = (
        base_query.order_by(order_clause, models.MediaFile.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return items, total


def list_recent_media_for_user(db: Session, user_id: int, *, limit: int = 12) -> list[models.MediaFile]:
    return (
        db.query(models.MediaFile)
        .filter(models.MediaFile.owner_id == user_id)
        .order_by(models.MediaFile.created_at.desc(), models.MediaFile.id.desc())
        .limit(limit)
        .all()
    )


def list_album_groups_for_user(db: Session, user_id: int) -> list[schemas.AlbumGroupRead]:
    media_items = (
        db.query(models.MediaFile)
        .filter(models.MediaFile.owner_id == user_id, models.MediaFile.media_type == schemas.MediaMode.audio.value)
        .order_by(models.MediaFile.created_at.desc(), models.MediaFile.id.desc())
        .all()
    )
    grouped: dict[tuple[str, str], list[models.MediaFile]] = {}
    for media in media_items:
        album_title = (media.album or media.raw_album or "").strip()
        if not album_title:
            continue
        artist_name = (media.uploader or media.raw_uploader or "").strip()
        key = (album_title.lower(), artist_name.lower())
        grouped.setdefault(key, []).append(media)

    album_groups: list[schemas.AlbumGroupRead] = []
    for items in grouped.values():
        ordered_items = sorted(items, key=lambda media: (media.created_at, media.id), reverse=True)
        first = ordered_items[0]
        artwork_media = next((media for media in ordered_items if media.artwork_relative_path), first)
        total_duration = sum(media.duration_seconds or 0 for media in ordered_items) or None
        album_groups.append(
            schemas.AlbumGroupRead(
                title=first.album or first.raw_album or "Untitled Album",
                artist=first.uploader or first.raw_uploader,
                track_count=len(ordered_items),
                total_duration_seconds=total_duration,
                artwork_media_id=artwork_media.id if artwork_media.artwork_relative_path else None,
                items=sorted(ordered_items, key=lambda media: (media.title.lower(), media.id)),
            )
        )

    album_groups.sort(
        key=lambda group: (
            -(max((item.created_at.timestamp() for item in group.items), default=0)),
            group.title.lower(),
        )
    )
    return album_groups


def get_media_for_user(db: Session, user_id: int, media_id: int) -> Optional[models.MediaFile]:
    return (
        db.query(models.MediaFile)
        .filter(models.MediaFile.owner_id == user_id, models.MediaFile.id == media_id)
        .first()
    )


def get_media_by_id(db: Session, media_id: int) -> Optional[models.MediaFile]:
    return db.query(models.MediaFile).filter(models.MediaFile.id == media_id).first()


def update_media_metadata_for_user(
    db: Session,
    *,
    user_id: int,
    media_id: int,
    update_in: schemas.UpdateMediaMetadataRequest,
) -> Optional[models.MediaFile]:
    media = get_media_for_user(db, user_id, media_id)
    if not media:
        return None

    if update_in.title is not None:
        media.raw_title = media.raw_title or media.title
        media.title = update_in.title
    if update_in.artist is not None:
        media.raw_uploader = media.raw_uploader or media.uploader
        media.uploader = update_in.artist
    if update_in.album is not None:
        media.raw_album = media.raw_album or media.album
        media.album = update_in.album

    if any(value is not None for value in (update_in.title, update_in.artist, update_in.album)):
        media.metadata_status = _override_status(media.metadata_status)

    db.commit()
    db.refresh(media)
    return media


def bulk_update_media_metadata_for_user(
    db: Session,
    *,
    user_id: int,
    media_ids: list[int],
    album: str | None = None,
    artist: str | None = None,
) -> list[models.MediaFile]:
    if album is None and artist is None:
        return []

    media_items = (
        db.query(models.MediaFile)
        .filter(models.MediaFile.owner_id == user_id, models.MediaFile.id.in_(media_ids))
        .all()
    )
    for media in media_items:
        if artist is not None:
            media.raw_uploader = media.raw_uploader or media.uploader
            media.uploader = artist
        if album is not None:
            media.raw_album = media.raw_album or media.album
            media.album = album
        media.metadata_status = _override_status(media.metadata_status)

    db.commit()
    for media in media_items:
        db.refresh(media)
    return media_items


def delete_media_for_user(db: Session, user_id: int, media_id: int) -> Optional[models.MediaFile]:
    media = get_media_for_user(db, user_id, media_id)
    if not media:
        return None

    playlist_ids = {item.playlist_id for item in media.playlist_items}
    for playlist_item in list(media.playlist_items):
        db.delete(playlist_item)

    db.query(models.DownloadJob).filter(models.DownloadJob.media_file_id == media.id).update(
        {models.DownloadJob.media_file_id: None},
        synchronize_session=False,
    )

    for playlist_id in playlist_ids:
        playlist = db.query(models.Playlist).filter(models.Playlist.id == playlist_id).first()
        if playlist:
            playlist.updated_at = datetime.utcnow()

    db.flush()

    for playlist_id in playlist_ids:
        remaining = (
            db.query(models.PlaylistItem)
            .filter(models.PlaylistItem.playlist_id == playlist_id)
            .order_by(models.PlaylistItem.position.asc(), models.PlaylistItem.id.asc())
            .all()
        )
        for index, playlist_item in enumerate(remaining, start=1):
            playlist_item.position = index

    db.delete(media)
    db.commit()
    return media


def _playlist_query():
    return [
        selectinload(models.Playlist.items).selectinload(models.PlaylistItem.media_file),
    ]


def list_playlists_for_user(db: Session, user_id: int, *, limit: Optional[int] = None) -> list[models.Playlist]:
    query = (
        db.query(models.Playlist)
        .options(*_playlist_query())
        .filter(models.Playlist.owner_id == user_id)
        .order_by(models.Playlist.updated_at.desc())
    )
    if limit:
        query = query.limit(limit)
    return query.all()


def get_playlist_for_user(db: Session, user_id: int, playlist_id: int) -> Optional[models.Playlist]:
    return (
        db.query(models.Playlist)
        .options(*_playlist_query())
        .filter(models.Playlist.owner_id == user_id, models.Playlist.id == playlist_id)
        .first()
    )


def create_playlist(db: Session, user_id: int, playlist_in: schemas.CreatePlaylistRequest) -> models.Playlist:
    now = datetime.utcnow()
    playlist = models.Playlist(
        owner_id=user_id,
        title=playlist_in.title.strip(),
        description=(playlist_in.description or "").strip() or None,
        visibility=schemas.PlaylistVisibility.private.value,
        updated_at=now,
    )
    db.add(playlist)
    db.commit()
    return get_playlist_for_user(db, user_id, playlist.id)


def add_playlist_item(
    db: Session,
    *,
    user_id: int,
    playlist_id: int,
    media_file_id: int,
) -> Optional[models.Playlist]:
    playlist = get_playlist_for_user(db, user_id, playlist_id)
    if not playlist:
        return None

    media = get_media_for_user(db, user_id, media_file_id)
    if not media:
        return None

    existing = (
        db.query(models.PlaylistItem)
        .filter(models.PlaylistItem.playlist_id == playlist_id, models.PlaylistItem.media_file_id == media_file_id)
        .first()
    )
    if existing:
        return get_playlist_for_user(db, user_id, playlist_id)

    max_position = (
        db.query(func.max(models.PlaylistItem.position))
        .filter(models.PlaylistItem.playlist_id == playlist_id)
        .scalar()
    )
    item = models.PlaylistItem(
        playlist_id=playlist_id,
        media_file_id=media_file_id,
        position=(max_position or 0) + 1,
    )
    db.add(item)
    playlist.updated_at = datetime.utcnow()
    db.commit()
    return get_playlist_for_user(db, user_id, playlist_id)


def remove_playlist_item(db: Session, *, user_id: int, playlist_id: int, item_id: int) -> Optional[models.Playlist]:
    playlist = get_playlist_for_user(db, user_id, playlist_id)
    if not playlist:
        return None

    item = (
        db.query(models.PlaylistItem)
        .filter(models.PlaylistItem.id == item_id, models.PlaylistItem.playlist_id == playlist_id)
        .first()
    )
    if not item:
        return None

    db.delete(item)
    remaining = (
        db.query(models.PlaylistItem)
        .filter(models.PlaylistItem.playlist_id == playlist_id)
        .order_by(models.PlaylistItem.position.asc(), models.PlaylistItem.id.asc())
        .all()
    )
    for index, playlist_item in enumerate(remaining, start=1):
        playlist_item.position = index
    playlist.updated_at = datetime.utcnow()
    db.commit()
    return get_playlist_for_user(db, user_id, playlist_id)


def set_playlist_share_state(
    db: Session,
    *,
    user_id: int,
    playlist_id: int,
    enabled: bool,
    regenerate: bool = False,
) -> Optional[models.Playlist]:
    playlist = get_playlist_for_user(db, user_id, playlist_id)
    if not playlist:
        return None

    if enabled:
        if regenerate or not playlist.share_token:
            playlist.share_token = secrets.token_urlsafe(24)
        playlist.visibility = schemas.PlaylistVisibility.shared_link.value
    else:
        playlist.share_token = None
        playlist.visibility = schemas.PlaylistVisibility.private.value

    playlist.updated_at = datetime.utcnow()
    db.commit()
    return get_playlist_for_user(db, user_id, playlist_id)


def get_shared_playlist_by_token(db: Session, share_token: str) -> Optional[models.Playlist]:
    return (
        db.query(models.Playlist)
        .options(*_playlist_query())
        .filter(
            models.Playlist.share_token == share_token,
            models.Playlist.visibility == schemas.PlaylistVisibility.shared_link.value,
        )
        .first()
    )


def get_shared_playlist_item(
    db: Session,
    *,
    share_token: str,
    item_id: int,
) -> Optional[models.PlaylistItem]:
    playlist = get_shared_playlist_by_token(db, share_token)
    if not playlist:
        return None
    for item in playlist.items:
        if item.id == item_id:
            return item
    return None


def list_radio_channels_for_user(db: Session, user_id: int, *, limit: Optional[int] = None) -> list[models.RadioChannel]:
    query = (
        db.query(models.RadioChannel)
        .options(
            selectinload(models.RadioChannel.playlist)
            .selectinload(models.Playlist.items)
            .selectinload(models.PlaylistItem.media_file)
        )
        .filter(models.RadioChannel.owner_id == user_id)
        .order_by(models.RadioChannel.updated_at.desc())
    )
    if limit:
        query = query.limit(limit)
    return query.all()


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "station"


def _unique_radio_slug(db: Session, base_value: str) -> str:
    base_slug = _slugify(base_value)
    slug = base_slug
    counter = 2
    while db.query(models.RadioChannel).filter(models.RadioChannel.slug == slug).first():
        slug = f"{base_slug}-{counter}"
        counter += 1
    return slug


def get_radio_channel_for_user(db: Session, user_id: int, radio_id: int) -> Optional[models.RadioChannel]:
    return (
        db.query(models.RadioChannel)
        .options(
            selectinload(models.RadioChannel.playlist)
            .selectinload(models.Playlist.items)
            .selectinload(models.PlaylistItem.media_file)
        )
        .filter(models.RadioChannel.owner_id == user_id, models.RadioChannel.id == radio_id)
        .first()
    )


def create_radio_channel(
    db: Session,
    *,
    user_id: int,
    radio_in: schemas.CreateRadioRequest,
) -> Optional[models.RadioChannel]:
    playlist = get_playlist_for_user(db, user_id, radio_in.playlist_id)
    if not playlist:
        return None

    raw_title = (radio_in.title or f"{playlist.title} Radio").strip()
    slug = _unique_radio_slug(db, radio_in.slug or raw_title)
    share_token = secrets.token_urlsafe(24) if radio_in.enabled else None
    now = datetime.utcnow()
    radio = models.RadioChannel(
        owner_id=user_id,
        playlist_id=playlist.id,
        slug=slug,
        title=raw_title,
        share_token=share_token,
        is_active=radio_in.enabled,
        updated_at=now,
    )
    db.add(radio)
    db.commit()
    return get_radio_channel_for_user(db, user_id, radio.id)


def set_radio_share_state(
    db: Session,
    *,
    user_id: int,
    radio_id: int,
    enabled: bool,
    regenerate: bool = False,
) -> Optional[models.RadioChannel]:
    radio = get_radio_channel_for_user(db, user_id, radio_id)
    if not radio:
        return None

    radio.is_active = enabled
    if enabled:
        if regenerate or not radio.share_token:
            radio.share_token = secrets.token_urlsafe(24)
    else:
        radio.share_token = None
    radio.updated_at = datetime.utcnow()
    db.commit()
    return get_radio_channel_for_user(db, user_id, radio.id)


def get_public_radio_channel(db: Session, *, slug: str, share_token: str) -> Optional[models.RadioChannel]:
    return (
        db.query(models.RadioChannel)
        .options(
            selectinload(models.RadioChannel.playlist)
            .selectinload(models.Playlist.items)
            .selectinload(models.PlaylistItem.media_file)
        )
        .filter(
            models.RadioChannel.slug == slug,
            models.RadioChannel.share_token == share_token,
            models.RadioChannel.is_active.is_(True),
        )
        .first()
    )


def get_library_home_for_user(db: Session, user_id: int) -> schemas.LibraryHomeRead:
    return schemas.LibraryHomeRead(
        recent_items=list_recent_media_for_user(db, user_id, limit=12),
        playlists=list_playlists_for_user(db, user_id, limit=8),
        radio_channels=list_radio_channels_for_user(db, user_id, limit=8),
    )

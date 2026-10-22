import logging
import multiprocessing
import time
from datetime import datetime
import hashlib
from pathlib import Path

from sqlalchemy.orm import Session

from .core.bootstrap import ensure_repo_root_on_path

ensure_repo_root_on_path()

from yoinker_core import DownloadCancelled, DownloadOptions, download_url  # noqa: E402

from . import crud, models, schemas
from .core.config import settings
from .database import SessionLocal, init_db
from .services.metadata import normalize_import_metadata


logger = logging.getLogger("yoinker.worker")


def _compute_file_sha256(file_path: Path) -> str:
    digest = hashlib.sha256()
    with file_path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            if chunk:
                digest.update(chunk)
    return digest.hexdigest()


def _safe_remove(path: Path | None):
    if not path:
        return
    try:
        if path.exists():
            path.unlink()
    except Exception:
        logger.warning("Could not remove duplicate file artifact %s", path, exc_info=True)


def _fetch_and_attach_lyrics(media: models.MediaFile) -> None:
    """Attempt to fetch synced lyrics from LRCLIB and attach to the media file."""
    try:
        from .services.lyrics import fetch_lyrics, write_lrc_file, embed_lyrics_in_mp3

        result = fetch_lyrics(
            track_name=media.title,
            artist_name=media.uploader or "",
            album_name=media.album,
            duration_seconds=media.duration_seconds,
        )
        if not result or not result.has_any:
            logger.debug("No lyrics found for %s - %s", media.uploader, media.title)
            return

        media_path = settings.media_root_path / Path(media.relative_path)
        lrc_path = write_lrc_file(media_path, result)
        if lrc_path:
            try:
                rel = str(lrc_path.resolve().relative_to(settings.media_root_path)).replace("\\", "/")
                media.lyrics_relative_path = rel
            except ValueError:
                pass

        # Embed lyrics into the MP3 ID3 tags
        if media_path.suffix.lower() == ".mp3":
            embed_lyrics_in_mp3(media_path, result)

        status = "synced" if result.has_synced else "plain"
        logger.info("Attached %s lyrics for %s - %s", status, media.uploader, media.title)
    except Exception:
        logger.debug("Lyrics fetch failed for %s", media.title, exc_info=True)


def _find_duplicate_media(db: Session, *, owner_id: int, item) -> models.MediaFile | None:
    normalized_source = crud.normalize_source_url(item.webpage_url or item.source_url)
    candidates = (
        db.query(models.MediaFile)
        .filter(
            models.MediaFile.owner_id == owner_id,
            models.MediaFile.media_type == item.media_type,
        )
        .order_by(models.MediaFile.created_at.desc())
        .all()
    )

    if normalized_source:
        for candidate in candidates:
            candidate_path = settings.media_root_path / Path(candidate.relative_path)
            if candidate_path.exists() and crud.normalize_source_url(candidate.source_url) == normalized_source:
                return candidate

    new_hash = _compute_file_sha256(item.file_path)
    for candidate in candidates:
        if candidate.size_bytes and item.size_bytes and candidate.size_bytes != item.size_bytes:
            continue
        if candidate.duration_seconds and item.duration_seconds and abs(candidate.duration_seconds - item.duration_seconds) > 2:
            continue
        candidate_path = settings.media_root_path / Path(candidate.relative_path)
        if not candidate_path.exists():
            continue
        try:
            if _compute_file_sha256(candidate_path) == new_hash:
                return candidate
        except Exception:
            logger.warning("Could not hash existing media %s during dedupe", candidate_path, exc_info=True)
    return None


def _get_job(db: Session, job_id: int) -> models.DownloadJob | None:
    return db.query(models.DownloadJob).filter(models.DownloadJob.id == job_id).first()


def claim_next_job(db: Session) -> models.DownloadJob | None:
    job = (
        db.query(models.DownloadJob)
        .filter(models.DownloadJob.status == schemas.JobStatus.queued.value)
        .order_by(models.DownloadJob.created_at.asc())
        .first()
    )
    if not job:
        return None
    job.status = schemas.JobStatus.running.value
    job.progress_message = "Starting download"
    job.started_at = datetime.utcnow()
    job.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(job)
    return job


def _is_cancel_requested(job_id: int) -> bool:
    db = SessionLocal()
    try:
        job = _get_job(db, job_id)
        return bool(job and job.cancel_requested)
    finally:
        db.close()


def _update_job_progress(job_id: int, payload: dict):
    db = SessionLocal()
    try:
        job = _get_job(db, job_id)
        if not job or job.status != schemas.JobStatus.running.value:
            return
        job.progress_percent = int(payload.get("percent") or 0)
        job.progress_message = payload.get("status") or "Downloading"
        job.updated_at = datetime.utcnow()
        db.commit()
    finally:
        db.close()


def _mark_job_cancelled(job_id: int, message: str = "Cancelled"):
    db = SessionLocal()
    try:
        job = _get_job(db, job_id)
        if not job:
            return
        if job.status in {schemas.JobStatus.completed.value, schemas.JobStatus.failed.value, schemas.JobStatus.cancelled.value}:
            return
        job.status = schemas.JobStatus.cancelled.value
        job.progress_message = message
        job.error_message = None
        job.completed_at = datetime.utcnow()
        job.updated_at = datetime.utcnow()
        db.commit()
    finally:
        db.close()


def _mark_job_failed(job_id: int, message: str):
    db = SessionLocal()
    try:
        job = _get_job(db, job_id)
        if not job:
            return
        if job.status in {schemas.JobStatus.completed.value, schemas.JobStatus.failed.value, schemas.JobStatus.cancelled.value}:
            return
        job.status = schemas.JobStatus.failed.value
        job.error_message = message
        job.progress_message = "Failed"
        job.completed_at = datetime.utcnow()
        job.updated_at = datetime.utcnow()
        db.commit()
    finally:
        db.close()


def _mark_job_completed(job_id: int, items):
    db = SessionLocal()
    try:
        job = _get_job(db, job_id)
        if not job:
            return
        if job.status != schemas.JobStatus.running.value:
            return

        created_media = []
        reused_media = []
        for item in items:
            duplicate_media = _find_duplicate_media(db, owner_id=job.owner_id, item=item)
            if duplicate_media:
                reused_media.append(duplicate_media)
                _safe_remove(item.file_path)
                _safe_remove(getattr(item, "artwork_path", None))
                continue

            artwork_path = getattr(item, "artwork_path", None)
            try:
                relative_path = item.file_path.resolve().relative_to(settings.media_root_path)
            except ValueError:
                relative_path = item.file_path.name
            media = models.MediaFile(
                owner_id=job.owner_id,
                job_id=job.id,
                media_type=item.media_type,
                relative_path=str(relative_path).replace("\\", "/"),
                source_url=item.webpage_url,
                source_site=item.source_site,
                title=item.title,
                uploader=item.uploader,
                album=getattr(item, "album", None),
                raw_title=getattr(item, "raw_title", item.title),
                raw_uploader=getattr(item, "raw_uploader", item.uploader),
                raw_album=getattr(item, "raw_album", None),
                metadata_status=getattr(item, "metadata_status", schemas.MetadataStatus.source.value),
                artwork_relative_path=(
                    str(artwork_path.resolve().relative_to(settings.media_root_path)).replace("\\", "/")
                    if artwork_path
                    else None
                ),
                size_bytes=item.size_bytes,
                duration_seconds=item.duration_seconds,
            )
            db.add(media)
            created_media.append(media)

        db.flush()

        # Fetch synced lyrics for newly created audio tracks
        for media in created_media:
            if media.media_type == "audio":
                _fetch_and_attach_lyrics(media)

        if created_media:
            job.media_file_id = created_media[0].id
        elif reused_media:
            job.media_file_id = reused_media[0].id
        job.status = schemas.JobStatus.completed.value
        job.progress_percent = 100
        if created_media and reused_media:
            job.progress_message = (
                f"Completed ({len(created_media)} new, {len(reused_media)} already in library)"
            )
        elif created_media:
            job.progress_message = f"Completed ({len(created_media)} file{'s' if len(created_media) != 1 else ''})"
        elif reused_media:
            job.progress_message = "Already in library"
        else:
            job.progress_message = "Completed"
        job.error_message = None
        job.completed_at = datetime.utcnow()
        job.updated_at = datetime.utcnow()
        db.commit()
    finally:
        db.close()


def process_job(job_id: int):
    db = SessionLocal()
    try:
        job = _get_job(db, job_id)
        if not job:
            return
        if job.status == schemas.JobStatus.queued.value:
            job.status = schemas.JobStatus.running.value
            job.progress_message = "Starting download"
            job.started_at = job.started_at or datetime.utcnow()
            job.updated_at = datetime.utcnow()
            db.commit()
            db.refresh(job)
        metadata_payload = crud.parse_job_metadata_overrides(job)
        source_metadata = metadata_payload.get("source") if isinstance(metadata_payload, dict) else {}
        override_metadata = metadata_payload.get("override") if isinstance(metadata_payload, dict) else {}
        normalized_metadata = normalize_import_metadata(
            source_title=(source_metadata or {}).get("title"),
            source_artist=(source_metadata or {}).get("artist"),
            source_album=(source_metadata or {}).get("album"),
            override_title=(override_metadata or {}).get("title"),
            override_artist=(override_metadata or {}).get("artist"),
            override_album=(override_metadata or {}).get("album"),
            enrich_metadata=job.enrich_metadata,
        )
        output_dir = settings.media_root_path / str(job.owner_id) / job.mode
        output_dir.mkdir(parents=True, exist_ok=True)
        options = DownloadOptions(
            url=job.source_url,
            output_dir=output_dir,
            mode=job.mode,
            allow_playlist=job.allow_playlist,
            audio_bitrate_kbps=job.audio_bitrate_kbps,
            video_quality=job.video_quality or "best",
            ffmpeg_location=settings.FFMPEG_LOCATION or None,
            metadata_payload={
                "source": source_metadata or {},
                "override": override_metadata or {},
                "normalized": normalized_metadata,
            },
        )
    finally:
        db.close()

    try:
        _update_job_progress(job_id, {"percent": 1, "status": "Resolving source"})
        items = download_url(
            options,
            progress_callback=lambda payload: _update_job_progress(job_id, payload),
            should_cancel=lambda: _is_cancel_requested(job_id),
        )
        _mark_job_completed(job_id, items)
    except DownloadCancelled:
        _mark_job_cancelled(job_id)
    except Exception as exc:
        logger.exception("Job %s failed", job_id)
        _mark_job_failed(job_id, str(exc))


def _run_job_in_child_process(job_id: int):
    process_job(job_id)


def _process_job_with_timeout(job_id: int):
    timeout_seconds = max(settings.WORKER_JOB_TIMEOUT_SECONDS, 60)
    child = multiprocessing.Process(target=_run_job_in_child_process, args=(job_id,))
    child.start()
    child.join(timeout_seconds)

    if child.is_alive():
        logger.error("Job %s timed out after %s seconds. Terminating worker child process.", job_id, timeout_seconds)
        child.terminate()
        child.join(10)
        _mark_job_failed(job_id, f"Timed out after {timeout_seconds} seconds")
        return

    if child.exitcode and child.exitcode != 0:
        logger.error("Job %s worker subprocess exited with code %s", job_id, child.exitcode)
        _mark_job_failed(job_id, "Worker subprocess exited unexpectedly")


def _recover_orphaned_running_jobs():
    db = SessionLocal()
    try:
        orphaned = (
            db.query(models.DownloadJob)
            .filter(models.DownloadJob.status == schemas.JobStatus.running.value)
            .all()
        )
        if not orphaned:
            return
        now = datetime.utcnow()
        for job in orphaned:
            job.status = schemas.JobStatus.failed.value
            job.error_message = "Worker restarted before job completion"
            job.progress_message = "Failed"
            job.completed_at = now
            job.updated_at = now
        db.commit()
        logger.warning("Recovered %s orphaned running job(s) after worker restart", len(orphaned))
    finally:
        db.close()


def run_worker_forever():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    settings.media_root_path.mkdir(parents=True, exist_ok=True)
    init_db()
    _recover_orphaned_running_jobs()
    logger.info("Worker started. Polling every %s seconds", settings.WORKER_POLL_INTERVAL_SECONDS)
    while True:
        db = SessionLocal()
        try:
            job = claim_next_job(db)
        finally:
            db.close()
        if job:
            _process_job_with_timeout(job.id)
            continue
        time.sleep(settings.WORKER_POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    run_worker_forever()

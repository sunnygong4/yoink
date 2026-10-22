from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .. import crud, schemas
from ..database import get_db
from ..deps import get_current_user


router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.post("", response_model=schemas.DownloadJobRead)
def create_job(
    request: schemas.CreateJobRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    return crud.create_job(db, current_user.id, request)


@router.get("", response_model=list[schemas.DownloadJobRead])
def list_jobs(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    return crud.list_jobs_for_user(db, current_user.id)


@router.get("/pending-downloads", response_model=list[schemas.DownloadJobRead])
def list_pending_downloads(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """List completed jobs with download_to_device=True that have media files.

    The EXE/desktop client polls this to find files ready to download.
    """
    return crud.list_pending_device_downloads(db, current_user.id)


@router.get("/{job_id}", response_model=schemas.DownloadJobRead)
def get_job(
    job_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    job = crud.get_job_for_user(db, current_user.id, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.post("/{job_id}/cancel", response_model=schemas.DownloadJobRead)
def cancel_job(
    job_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    job = crud.request_job_cancel(db, current_user.id, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.post("/{job_id}/mark-downloaded", response_model=schemas.DownloadJobRead)
def mark_job_downloaded(
    job_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Mark a download_to_device job as fetched so it no longer appears in pending-downloads."""
    job = crud.mark_job_downloaded(db, current_user.id, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job

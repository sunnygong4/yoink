from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from .. import crud, schemas
from ..core.config import settings
from ..database import get_db
from ..deps import get_current_user, get_current_user_for_stream
from ..services.library_metadata import retag_media_file
from ..streaming import build_stream_response


router = APIRouter(prefix="/library", tags=["library"])


@router.get("", response_model=schemas.MediaLibraryPage)
def read_library(
    media_type: Optional[schemas.MediaMode] = Query(default=None),
    q: Optional[str] = Query(default=None, max_length=200),
    sort: schemas.LibrarySort = Query(default=schemas.LibrarySort.recent),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=24, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    items, total = crud.list_media_for_user(
        db,
        current_user.id,
        media_type=media_type.value if media_type else None,
        query=q,
        sort=sort.value,
        page=page,
        page_size=page_size,
    )
    return schemas.MediaLibraryPage(items=items, total=total, page=page, page_size=page_size)


@router.get("/home", response_model=schemas.LibraryHomeRead)
def read_library_home(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    return crud.get_library_home_for_user(db, current_user.id)


@router.get("/albums", response_model=list[schemas.AlbumGroupRead])
def read_library_albums(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    return crud.list_album_groups_for_user(db, current_user.id)


@router.patch("/albums/metadata", response_model=list[schemas.MediaFileRead])
def update_album_metadata(
    payload: schemas.BulkAlbumMetadataUpdateRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    items = crud.bulk_update_media_metadata_for_user(
        db,
        user_id=current_user.id,
        media_ids=payload.media_ids,
        album=payload.album,
        artist=payload.artist,
    )
    for media in items:
        absolute_path = settings.media_root_path / Path(media.relative_path)
        if absolute_path.exists():
            try:
                retag_media_file(
                    absolute_path,
                    title=media.title,
                    artist=media.uploader,
                    album=media.album,
                )
            except Exception:
                continue
    return items


@router.patch("/{media_id}/metadata", response_model=schemas.MediaFileRead)
def update_media_metadata(
    media_id: int,
    payload: schemas.UpdateMediaMetadataRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    media = crud.update_media_metadata_for_user(
        db,
        user_id=current_user.id,
        media_id=media_id,
        update_in=payload,
    )
    if not media:
        raise HTTPException(status_code=404, detail="Media file not found")

    absolute_path = settings.media_root_path / Path(media.relative_path)
    if absolute_path.exists():
        try:
            retag_media_file(
                absolute_path,
                title=media.title,
                artist=media.uploader,
                album=media.album,
            )
        except Exception:
            pass
    return media


@router.get("/{media_id}/stream")
def stream_media(
    media_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user_for_stream),
):
    media = crud.get_media_for_user(db, current_user.id, media_id)
    if not media:
        raise HTTPException(status_code=404, detail="Media file not found")

    absolute_path = settings.media_root_path / Path(media.relative_path)
    return build_stream_response(absolute_path, request)


@router.get("/{media_id}/artwork")
def get_media_artwork(
    media_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user_for_stream),
):
    media = crud.get_media_for_user(db, current_user.id, media_id)
    if not media:
        raise HTTPException(status_code=404, detail="Media file not found")
    if not media.artwork_relative_path:
        raise HTTPException(status_code=404, detail="Artwork not available")

    absolute_path = settings.media_root_path / Path(media.artwork_relative_path)
    return build_stream_response(absolute_path, request)


@router.get("/{media_id}/download")
def download_media(
    media_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    media = crud.get_media_for_user(db, current_user.id, media_id)
    if not media:
        raise HTTPException(status_code=404, detail="Media file not found")

    absolute_path = settings.media_root_path / Path(media.relative_path)
    if not absolute_path.exists():
        raise HTTPException(status_code=404, detail="Stored file missing on disk")

    return FileResponse(path=absolute_path, filename=absolute_path.name, media_type="application/octet-stream")


@router.delete("/{media_id}", status_code=204)
def delete_media(
    media_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    media = crud.delete_media_for_user(db, current_user.id, media_id)
    if not media:
        raise HTTPException(status_code=404, detail="Media file not found")

    paths_to_remove = [settings.media_root_path / Path(media.relative_path)]
    if media.artwork_relative_path:
        paths_to_remove.append(settings.media_root_path / Path(media.artwork_relative_path))

    for absolute_path in paths_to_remove:
        try:
            if absolute_path.exists():
                absolute_path.unlink()
        except Exception:
            continue

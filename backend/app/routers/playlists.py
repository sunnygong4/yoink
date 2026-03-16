from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from .. import crud, schemas
from ..core.config import settings
from ..database import get_db
from ..deps import get_current_user
from ..streaming import build_stream_response


router = APIRouter(prefix="/playlists", tags=["playlists"])
shared_router = APIRouter(prefix="/shared", tags=["shared"])


def _build_playlist_share_url(share_token: str | None) -> str | None:
    if not share_token:
        return None
    return f"{settings.PUBLIC_WEB_URL.rstrip('/')}/shared/{share_token}"


@router.post("", response_model=schemas.PlaylistRead)
def create_playlist(
    request: schemas.CreatePlaylistRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    return crud.create_playlist(db, current_user.id, request)


@router.get("", response_model=list[schemas.PlaylistRead])
def list_playlists(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    return crud.list_playlists_for_user(db, current_user.id)


@router.get("/{playlist_id}", response_model=schemas.PlaylistRead)
def get_playlist(
    playlist_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    playlist = crud.get_playlist_for_user(db, current_user.id, playlist_id)
    if not playlist:
        raise HTTPException(status_code=404, detail="Playlist not found")
    return playlist


@router.post("/{playlist_id}/items", response_model=schemas.PlaylistRead)
def add_item_to_playlist(
    playlist_id: int,
    request: schemas.AddPlaylistItemRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    playlist = crud.add_playlist_item(
        db,
        user_id=current_user.id,
        playlist_id=playlist_id,
        media_file_id=request.media_file_id,
    )
    if not playlist:
        raise HTTPException(status_code=404, detail="Playlist or media file not found")
    return playlist


@router.delete("/{playlist_id}/items/{item_id}", response_model=schemas.PlaylistRead)
def remove_item_from_playlist(
    playlist_id: int,
    item_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    playlist = crud.remove_playlist_item(db, user_id=current_user.id, playlist_id=playlist_id, item_id=item_id)
    if not playlist:
        raise HTTPException(status_code=404, detail="Playlist item not found")
    return playlist


@router.post("/{playlist_id}/share", response_model=schemas.PlaylistShareRead)
def share_playlist(
    playlist_id: int,
    request: schemas.PlaylistShareRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    playlist = crud.set_playlist_share_state(
        db,
        user_id=current_user.id,
        playlist_id=playlist_id,
        enabled=request.enabled,
        regenerate=request.regenerate,
    )
    if not playlist:
        raise HTTPException(status_code=404, detail="Playlist not found")
    return schemas.PlaylistShareRead(
        visibility=playlist.visibility,
        share_token=playlist.share_token,
        share_url=_build_playlist_share_url(playlist.share_token),
    )


@shared_router.get("/playlists/{share_token}", response_model=schemas.PlaylistRead)
def get_shared_playlist(share_token: str, db: Session = Depends(get_db)):
    playlist = crud.get_shared_playlist_by_token(db, share_token)
    if not playlist:
        raise HTTPException(status_code=404, detail="Shared playlist not found")
    return playlist


@shared_router.get("/playlists/{share_token}/items/{item_id}/stream")
def stream_shared_playlist_item(
    share_token: str,
    item_id: int,
    request: Request,
    db: Session = Depends(get_db),
):
    item = crud.get_shared_playlist_item(db, share_token=share_token, item_id=item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Shared playlist item not found")

    media = item.media_file
    absolute_path = settings.media_root_path / Path(media.relative_path)
    return build_stream_response(absolute_path, request)


@shared_router.get("/playlists/{share_token}/items/{item_id}/artwork")
def shared_playlist_item_artwork(
    share_token: str,
    item_id: int,
    request: Request,
    db: Session = Depends(get_db),
):
    item = crud.get_shared_playlist_item(db, share_token=share_token, item_id=item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Shared playlist item not found")
    if not item.media_file.artwork_relative_path:
        raise HTTPException(status_code=404, detail="Artwork not available")

    absolute_path = settings.media_root_path / Path(item.media_file.artwork_relative_path)
    return build_stream_response(absolute_path, request)

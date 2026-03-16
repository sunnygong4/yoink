from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from .. import crud, schemas
from ..core.config import settings
from ..database import get_db
from ..deps import get_current_user
from ..streaming import build_stream_response


router = APIRouter(prefix="/radio", tags=["radio"])
public_router = APIRouter(prefix="/radio", tags=["radio-public"])


def _build_radio_stream_url(slug: str, share_token: str | None) -> str | None:
    if not share_token:
        return None
    return f"{settings.API_BASE_URL.rstrip('/')}/radio/{slug}/index.m3u8?token={share_token}"


@router.post("", response_model=schemas.RadioChannelWithPlaylistRead)
def create_radio_channel(
    request: schemas.CreateRadioRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    radio = crud.create_radio_channel(db, user_id=current_user.id, radio_in=request)
    if not radio:
        raise HTTPException(status_code=404, detail="Playlist not found")
    return radio


@router.get("", response_model=list[schemas.RadioChannelWithPlaylistRead])
def list_radio_channels(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    return crud.list_radio_channels_for_user(db, current_user.id)


@router.get("/{radio_id}", response_model=schemas.RadioChannelWithPlaylistRead)
def get_radio_channel(
    radio_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    radio = crud.get_radio_channel_for_user(db, current_user.id, radio_id)
    if not radio:
        raise HTTPException(status_code=404, detail="Radio channel not found")
    return radio


@router.post("/{radio_id}/share", response_model=schemas.RadioShareRead)
def share_radio_channel(
    radio_id: int,
    request: schemas.RadioShareRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    radio = crud.set_radio_share_state(
        db,
        user_id=current_user.id,
        radio_id=radio_id,
        enabled=request.enabled,
        regenerate=request.regenerate,
    )
    if not radio:
        raise HTTPException(status_code=404, detail="Radio channel not found")
    return schemas.RadioShareRead(
        slug=radio.slug,
        is_active=radio.is_active,
        share_token=radio.share_token,
        stream_url=_build_radio_stream_url(radio.slug, radio.share_token),
    )


def _get_public_radio_or_404(db: Session, slug: str, share_token: str | None):
    if not share_token:
        raise HTTPException(status_code=401, detail="Missing radio token")
    radio = crud.get_public_radio_channel(db, slug=slug, share_token=share_token)
    if not radio:
        raise HTTPException(status_code=404, detail="Radio channel not found")
    return radio


@public_router.get("/{slug}/index.m3u8")
def get_radio_playlist(
    slug: str,
    token: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    radio = _get_public_radio_or_404(db, slug, token)
    audio_items = [item for item in radio.playlist.items if item.media_file.media_type == schemas.MediaMode.audio.value]
    if not audio_items:
        raise HTTPException(status_code=404, detail="Radio playlist has no audio items")

    lines = ["#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-TARGETDURATION:300", "#EXT-X-MEDIA-SEQUENCE:0"]
    for _ in range(12):
        for item in audio_items:
            duration = item.media_file.duration_seconds or 0
            lines.append(f"#EXTINF:{duration},{item.media_file.title}")
            lines.append(
                f"{settings.API_BASE_URL.rstrip('/')}/radio/{radio.slug}/tracks/{item.id}?token={radio.share_token}"
            )
    return PlainTextResponse("\n".join(lines) + "\n", media_type="application/vnd.apple.mpegurl")


@public_router.get("/{slug}/tracks/{item_id}")
def stream_radio_track(
    slug: str,
    item_id: int,
    request: Request,
    token: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    radio = _get_public_radio_or_404(db, slug, token)
    media = next(
        (item.media_file for item in radio.playlist.items if item.id == item_id and item.media_file.media_type == "audio"),
        None,
    )
    if not media:
        raise HTTPException(status_code=404, detail="Radio track not found")
    absolute_path = settings.media_root_path / Path(media.relative_path)
    return build_stream_response(absolute_path, request)

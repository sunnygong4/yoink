from __future__ import annotations

import logging
from urllib.parse import unquote

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from .. import crud, schemas
from ..core.config import settings
from ..database import get_db
from ..deps import get_current_user, get_current_user_for_stream
from ..services.discovery import (
    create_stream_session,
    discovery_artwork_headers,
    get_stream_session,
    is_allowed_discovery_artwork_url,
    search_catalog,
    search_versions,
)
from ..streaming import build_remote_stream_response


router = APIRouter(prefix="/search", tags=["search"])
logger = logging.getLogger("yoinker.search")


def _parse_sources_param(raw_sources: str | None) -> list[schemas.DiscoverySource]:
    if not raw_sources:
        return list(schemas.DiscoverySource)
    values: list[schemas.DiscoverySource] = []
    for part in raw_sources.split(","):
        cleaned = part.strip().lower()
        if not cleaned:
            continue
        try:
            values.append(schemas.DiscoverySource(cleaned))
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=f"Unsupported discovery source: {cleaned}") from exc
    return values or list(schemas.DiscoverySource)


@router.get("", response_model=schemas.DiscoverySearchPage)
def search_music_catalog(
    q: str = Query(min_length=1, max_length=240),
    sources: str | None = Query(default=None, description="Comma-separated list of discovery sources"),
    search_type: schemas.DiscoverySearchType = Query(default=schemas.DiscoverySearchType.song),
    secondary_q: str | None = Query(default=None, max_length=240),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=12, ge=1, le=30),
    current_user=Depends(get_current_user),
):
    del current_user
    try:
        return search_catalog(
            query=q,
            sources=_parse_sources_param(sources),
            search_type=search_type,
            secondary_query=secondary_q,
            page=page,
            page_size=page_size,
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Discovery search failed for query %s", q)
        raise HTTPException(status_code=502, detail="Discovery providers are temporarily unavailable") from exc


@router.get("/versions", response_model=schemas.DiscoveryVersionSearchPage)
def search_song_versions(
    q: str = Query(min_length=1, max_length=240),
    source: schemas.DiscoverySource = Query(default=schemas.DiscoverySource.youtube),
    artist_hint: str | None = Query(default=None, max_length=240),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=8, ge=1, le=20),
    current_user=Depends(get_current_user),
):
    del current_user
    try:
        return search_versions(
            query=q,
            source=source,
            artist_hint=artist_hint,
            page=page,
            page_size=page_size,
        )
    except Exception as exc:
        logger.exception("Version search failed for query %s", q)
        raise HTTPException(status_code=502, detail="Version search is temporarily unavailable") from exc


@router.post("/stream-session", response_model=schemas.DiscoveryStreamSessionRead)
def create_discovery_session(
    payload: schemas.CreateDiscoveryStreamSessionRequest,
    current_user=Depends(get_current_user),
):
    session = create_stream_session(current_user.id, payload)
    return schemas.DiscoveryStreamSessionRead(
        session_token=session.token,
        expires_at=session.expires_at,
        stream_url=f"{settings.API_V1_STR}/search/stream/{session.token}",
        item=schemas.DiscoverySearchResult.model_validate(session.result),
    )


@router.get("/stream/{session_token}")
def stream_discovery_session(
    session_token: str,
    request: Request,
    current_user=Depends(get_current_user_for_stream),
):
    session = get_stream_session(session_token, owner_id=current_user.id)
    if not session:
        raise HTTPException(status_code=404, detail="Discovery stream session not found or expired")
    return build_remote_stream_response(
        source_url=session.direct_url,
        request=request,
        upstream_headers=session.headers,
        media_type=session.media_type,
        disposition="inline",
    )


@router.post("/import", response_model=schemas.DownloadJobRead)
def import_discovery_result(
    payload: schemas.CreateDiscoveryImportRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    return crud.create_discovery_import_job(db, user_id=current_user.id, import_in=payload)


@router.get("/artwork")
def proxy_discovery_artwork(
    request: Request,
    url: str = Query(min_length=1, max_length=4096),
    current_user=Depends(get_current_user_for_stream),
):
    del current_user
    decoded_url = unquote(url)
    if not is_allowed_discovery_artwork_url(decoded_url):
        raise HTTPException(status_code=400, detail="Unsupported discovery artwork URL")
    return build_remote_stream_response(
        source_url=decoded_url,
        request=request,
        upstream_headers=discovery_artwork_headers(decoded_url),
        media_type="image/*",
        disposition="inline",
    )

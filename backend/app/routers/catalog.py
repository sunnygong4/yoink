from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .. import schemas
from ..database import get_db
from ..deps import get_current_user
from ..services import catalog


router = APIRouter(prefix="/catalog", tags=["catalog"])


@router.get("/search", response_model=schemas.CatalogSearchPage)
def search_music_catalog(
    q: str = Query(min_length=1, max_length=240),
    search_type: schemas.CatalogSearchType = Query(default=schemas.CatalogSearchType.song),
    secondary_q: str | None = Query(default=None, max_length=240),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=8, ge=1, le=20),
    current_user=Depends(get_current_user),
):
    del current_user
    try:
        return catalog.search_music_catalog(
            query=q,
            search_type=search_type,
            secondary_query=secondary_q,
            page=page,
            page_size=page_size,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Music catalog search is temporarily unavailable") from exc


@router.post("/import-track", response_model=schemas.DownloadJobRead)
def import_catalog_track(
    payload: schemas.CatalogTrackImportRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    try:
        return catalog.import_catalog_track(db, user_id=current_user.id, payload=payload)
    except RuntimeError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/import-album", response_model=schemas.CatalogAlbumImportRead)
def import_catalog_album(
    payload: schemas.CatalogAlbumImportRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    try:
        return catalog.import_catalog_album(db, user_id=current_user.id, payload=payload)
    except RuntimeError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

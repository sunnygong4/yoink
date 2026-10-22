from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from .core.bootstrap import ensure_repo_root_on_path

ensure_repo_root_on_path()

from .core.config import settings  # noqa: E402
from .database import SessionLocal, init_db  # noqa: E402
from .routers import auth, catalog, jobs, library, playlists, radio, search  # noqa: E402


init_db()
settings.media_root_path.mkdir(parents=True, exist_ok=True)

app = FastAPI(title=settings.PROJECT_NAME)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix=settings.API_V1_STR)
app.include_router(jobs.router, prefix=settings.API_V1_STR)
app.include_router(library.router, prefix=settings.API_V1_STR)
app.include_router(catalog.router, prefix=settings.API_V1_STR)
app.include_router(search.router, prefix=settings.API_V1_STR)
app.include_router(playlists.router, prefix=settings.API_V1_STR)
app.include_router(playlists.shared_router, prefix=settings.API_V1_STR)
app.include_router(radio.router, prefix=settings.API_V1_STR)
app.include_router(radio.public_router)


@app.get("/")
def read_root():
    return {
        "message": "Welcome to Yoinker API",
        "docs": "/docs",
        "api_base": settings.API_V1_STR,
    }


@app.get(f"{settings.API_V1_STR}/healthz")
def read_health():
    db = SessionLocal()
    try:
        db.execute(text("SELECT 1"))
    except Exception as exc:  # pragma: no cover - exercised in deployment/runtime
        raise HTTPException(status_code=503, detail="Database unavailable") from exc
    finally:
        db.close()

    return {
        "status": "ok",
        "project": settings.PROJECT_NAME,
        "time": datetime.now(timezone.utc).isoformat(),
    }

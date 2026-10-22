Yoinker is now a website-first personal media platform.

- `backend/` hosts the authenticated FastAPI API, stream endpoints, playlist sharing, radio playlist feeds, and the background download worker.
- `client-web/` is the main browser experience for phones and laptops: queue jobs, stream your library, manage playlists, and open shared playlist pages.
- `yoinker.py` remains the desktop companion for remote job submission and auto-pulling files to a local folder.
- `yoinker_core/` contains the shared yt-dlp and ffmpeg download pipeline used by both the worker and the desktop app.

## What It Does

1. A user signs into the web app or desktop app.
2. They submit a YouTube or Bilibili URL to the API.
3. The worker downloads and finalizes media on the server.
4. Finished audio and video land in the user's private library.
5. The browser can stream files directly from the server.
6. Users can build playlists, share playlist pages, and expose a simple HLS radio feed from a playlist.

## Local Development

### Backend API

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

### Backend Worker

Run this in a second terminal:

```bash
cd backend
source .venv/bin/activate
python run_worker.py
```

### Web Client

```bash
cd client-web
npm install
cp .env.example .env
npm run dev
```

Set `VITE_API_BASE_URL` if your API is not `http://localhost:8000`.

Optional beta env:

- `VITE_FEEDBACK_URL` adds a visible “Leave beta feedback” button in the web app and login page.

### FFmpeg

- Production audio jobs should have FFmpeg installed so the server can produce MP3 output.
- Local development can still fall back to source audio containers such as `.m4a` if FFmpeg is missing.
- On Ubuntu: `sudo apt update && sudo apt install -y ffmpeg`

## Core HTTP Surface

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/token`
- `GET /api/v1/auth/me`
- `POST /api/v1/jobs`
- `GET /api/v1/jobs`
- `GET /api/v1/library`
- `GET /api/v1/library/{media_id}/stream`
- `GET /api/v1/library/{media_id}/download`
- `POST /api/v1/playlists`
- `GET /api/v1/playlists`
- `POST /api/v1/playlists/{id}/share`
- `GET /api/v1/shared/playlists/{share_token}`
- `POST /api/v1/radio`
- `GET /radio/{slug}/index.m3u8`

## Production on Ubuntu

The repo now includes:

- `docker-compose.yml`
- `backend/Dockerfile`
- `client-web/Dockerfile`
- `deploy/Caddyfile`
- `.env.production.example`

Typical production flow:

```bash
cp .env.production.example .env
docker compose build
docker compose up -d
```

The compose stack runs `postgres`, `api`, `worker`, `web`, and `caddy`. Caddy terminates HTTPS and routes `/api/*` and `/radio/*` to the API while serving the browser app for everything else.

For Docker production, FFmpeg is already bundled into the backend image, so the Ubuntu host does not need a separate FFmpeg install.

Useful beta verification URLs after deploy:

- `https://your-domain`
- `https://your-domain/login`
- `https://your-domain/docs`
- `https://your-domain/api/v1/healthz`

## Tests

Backend:

```bash
python -m unittest discover -s backend/tests
```

Web build:

```bash
cd client-web
npm run build
```

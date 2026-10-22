# Yoinker Ubuntu Deployment

This deployment guide assumes a single Ubuntu server in British Columbia that should serve the website, API, worker, and private media library over HTTPS.

## 1. Server Prerequisites

Install Docker:

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-plugin
sudo systemctl enable --now docker
```

## 2. Copy the Project

From your local machine:

```bash
scp -r yoink user@your-server:~/yoink
```

Then SSH into the server:

```bash
ssh user@your-server
cd ~/yoink
```

## 3. Configure Production Environment

Create the production env file:

```bash
cp .env.production.example .env
```

Set at least:

```env
YOINKER_DOMAIN=yoink.yourdomain.com
POSTGRES_DB=yoinker
POSTGRES_USER=yoinker
POSTGRES_PASSWORD=replace-this
SECRET_KEY=replace-this
VITE_FEEDBACK_URL=https://your-feedback-form-or-notion-page
```

The compose stack automatically points the API and worker at:

- Postgres inside Docker
- `MEDIA_ROOT=/app/backend/media`
- `FFMPEG_LOCATION=/usr/bin/ffmpeg`
- public HTTPS URLs based on `YOINKER_DOMAIN`

The backend image already includes FFmpeg, so you do not need to install FFmpeg on the Ubuntu host when using the Docker deployment path.

## 4. Start the Stack

```bash
docker compose build
docker compose up -d
docker compose ps
```

Services started:

- `postgres`
- `api`
- `worker`
- `web`
- `caddy`

## 5. Verify

Check container health:

```bash
docker compose ps
docker compose logs api --tail=100
docker compose logs worker --tail=100
```

Open:

- `https://your-domain/docs`
- `https://your-domain`
- `https://your-domain/api/v1/healthz`

## 6. Beta Rollout Tips

Before inviting friends:

- verify login/register works in the browser
- search and stream one song from Home
- add one song to the library and confirm it appears under Library
- create one playlist and open its shared page
- confirm `https://your-domain/api/v1/healthz` returns `{"status":"ok", ...}`
- set `VITE_FEEDBACK_URL` so testers have a clear place to leave comments

## 7. Data and Persistence

Compose keeps persistent volumes for:

- PostgreSQL data
- media files
- Caddy certificates

Back up both the database and the media volume. The worker stores files under per-user folders inside the media volume, and all playlist/share/radio metadata lives in Postgres.

## 8. Notes

- The browser app is now the main listening surface. Users do not need the desktop app to stream from private or shared playlists.
- Private library streaming stays authenticated.
- Shared playlists and radio feeds are limited to explicit share tokens.
- For higher global traffic later, move media storage to S3-compatible object storage and add a CDN in front of download and stream traffic.

# Yoinker Resume Notes

## Best Resume Version

### Option A: Strong 1-liner
Built a website-first personal media platform that lets users queue YouTube and Bilibili downloads on a server, stream audio and video in the browser, manage private libraries, share playlists, and publish playlist-backed radio streams.

### Option B: Resume Bullets
- Built a full-stack personal media platform with FastAPI, React, SQLAlchemy, yt-dlp, FFmpeg, and Docker that turns a desktop downloader into a multi-user web streaming service.
- Designed and implemented a server-side job queue and worker system for YouTube and Bilibili ingestion, including progress tracking, cancellation, per-user ownership, private media storage, and authenticated file delivery.
- Added browser-first playback with byte-range audio/video streaming, shareable playlist pages, playlist-backed HLS radio feeds, JWT auth, and private-by-default user libraries.
- Containerized the stack for Ubuntu deployment with Postgres, Caddy HTTPS routing, a dedicated background worker, production env configuration, and persistent media/database volumes.
- Wrote backend tests and validated the web build, including auth, job lifecycle, user isolation, stream endpoints, shared playlists, and radio manifest generation.

### Option C: Slightly More Senior Version
- Refactored a local media-downloader app into a production-oriented web platform with authenticated APIs, async worker processing, browser streaming, playlist sharing, and deployment automation.
- Unified downloader logic into a shared Python core used by both the server worker and desktop companion, improving reuse across yt-dlp extraction, FFmpeg conversion, metadata tagging, and final media packaging.
- Expanded the product from "download to device" into a browser-accessible personal media service with per-user libraries, streamable MP3/MP4 playback, public share links, and token-scoped playlist/radio distribution.

## Short Portfolio Summary

Yoinker started as a local downloader and was transformed into a website-first personal media platform. Users can log in from a phone or laptop, submit YouTube or Bilibili URLs, let the server handle the heavy download/transcode work, stream their private library in the browser, build playlists, share playlist pages, and publish simple radio-style streams backed by those playlists. A desktop app still exists for richer local sync workflows, but the website is now the main listening surface.

## What Was Built

### Product Scope
- Turned Yoinker from a primarily local downloader into a remote multi-user media platform.
- Kept the FastAPI backend as the public API.
- Kept the React app as the browser client for phones and laptops.
- Kept the desktop app as an optional companion for remote job submission and local auto-pull.
- Made the website usable without requiring users to install the desktop app.
- Added direct browser playback so finished media can be streamed instead of only downloaded.
- Added private libraries for each authenticated user.
- Added shareable playlists that open directly in a browser.
- Added playlist-backed radio-style streaming via HLS manifests.

### Backend and API
- Built authenticated API routes under `/api/v1`.
- Kept auth endpoints for register, login, and current-user lookup.
- Replaced fire-and-forget download handling with a database-backed job model.
- Added job creation, job listing, job detail, and job cancellation APIs.
- Added library listing with filtering, pagination, and ownership checks.
- Added authenticated media download endpoints.
- Added authenticated media streaming endpoints for browser playback.
- Added playlist creation, playlist listing, playlist detail, playlist item add/remove, and playlist share routes.
- Added public shared-playlist routes scoped to a share token.
- Added radio channel creation and radio sharing routes.
- Added public HLS playlist generation and per-track radio stream endpoints.

### Data Modeling
- Kept `User`, `DownloadJob`, and `MediaFile` as core records.
- Expanded the schema for durable, per-user media ownership.
- Added playlist models with owner, title, description, visibility, share token, and timestamps.
- Added playlist item models with ordering and media references.
- Added radio channel models with owner, source playlist, slug, share token, active state, and timestamps.
- Preserved private-by-default access rules for media files.
- Scoped all jobs, media, playlists, and radio channels to a specific user.

### Media Pipeline and Worker
- Reused the existing downloader strengths instead of replacing them.
- Shared downloader logic across the worker and desktop app through `yoinker_core`.
- Used yt-dlp for YouTube and Bilibili extraction.
- Used FFmpeg for production audio conversion and finalization.
- Kept graceful fallback to source audio containers such as `.m4a` in local/dev environments when FFmpeg is missing.
- Preserved metadata handling, filename sanitization, and final media packaging flow.
- Ran downloads through a dedicated worker process instead of the API request thread.
- Added progress tracking from the downloader into persistent job state.
- Added cancellation support for queued and running jobs.
- Stored finished files under user-scoped folders inside the media root.

### Streaming Features
- Added server-side browser streaming for owned media.
- Implemented HTTP byte-range support so browsers can seek within MP3 and MP4 files.
- Supported direct `<audio>` and `<video>` playback from the API.
- Added token-aware stream access so browser media elements can authenticate safely.
- Added public share playback without full account access.
- Added playlist-backed HLS radio manifest generation.
- Added public stream URLs for shared radio playback.

### Frontend and Web App
- Turned the web app from a queue-and-download panel into the main product surface.
- Kept login and registration in the browser.
- Added a browser player for audio and video.
- Added a streaming queue with next/previous controls.
- Added library search, filtering, and pagination.
- Added per-item actions for play, queue, and download.
- Added playlist creation in the web app.
- Added "add to playlist" flows directly from the library.
- Added playlist playback and shuffle playback.
- Added playlist sharing controls and link copying.
- Added public shared playlist pages that work without login.
- Added radio creation and radio share link copying from the web UI.
- Preserved server job submission and status tracking in the same interface.

### Security and Access Control
- Used JWT-based authentication.
- Removed reliance on unauthenticated static media serving for real usage.
- Kept library access ownership-checked.
- Kept job access ownership-checked.
- Scoped playlist management to the owning user.
- Scoped raw media downloads to authenticated owners.
- Exposed shared playlists only through explicit share tokens.
- Exposed radio streams only through explicit share tokens.
- Avoided making entire user libraries public.

### Deployment and Operations
- Added production-oriented deployment assets for Ubuntu.
- Added Docker support for the backend API.
- Added Docker support for the React web app.
- Added Docker Compose orchestration for the full stack.
- Added Postgres support for production deployment.
- Added Caddy reverse-proxy configuration for HTTPS and routing.
- Routed `/api/*` and `/radio/*` to the API while serving the website for everything else.
- Added persistent volumes for Postgres data, media storage, and Caddy state.
- Added production env examples and documentation.
- Kept FFmpeg explicitly configured in production via `/usr/bin/ffmpeg`.

## Major Technical Decisions

### Architecture Decisions
- Chose a website-first architecture instead of requiring a desktop install.
- Kept the API and worker as separate processes on the same host.
- Kept the desktop app optional rather than removing it.
- Used a shared downloader core to avoid duplicating yt-dlp and FFmpeg logic in multiple places.
- Kept private user libraries as the default product model.
- Used token-scoped public sharing instead of public-by-default libraries.
- Chose browser streaming for normal listening and downloads only when the user explicitly wants a file.

### Format Decisions
- Treated MP3 as the preferred production output for audio due to broad playback compatibility across browsers, phones, cars, and mixed client environments.
- Kept `.m4a` as a fallback path when FFmpeg is unavailable during local development.
- Kept MP4 as the owned-browser playback target for video.

### Sharing Decisions
- Chose share-by-link playlists instead of public user profiles.
- Kept radio as a playlist-backed stream rather than a live DJ broadcast system.
- Scoped sharing to explicit entities instead of exposing an entire user account or library.

## Debugging and Problems Solved

### Configuration and Environment
- Fixed a `CORS_ORIGINS` parsing crash caused by environment value decoding.
- Moved CORS handling to a safer comma-separated string parsing flow.
- Added `FFMPEG_LOCATION` support in config so FFmpeg can be explicitly configured instead of relying only on `PATH`.

### Database and Schema
- Diagnosed local SQLite schema drift when an older DB file did not contain newly expected columns such as `users.created_at`.
- Reset the local dev DB and aligned the schema with the new models.
- Added Alembic migration support for the new streaming/playlist/radio tables instead of leaving growth entirely to `create_all()`.

### Downloader and Media Finalization
- Diagnosed worker failures caused by missing FFmpeg and absent final output files.
- Prevented local audio jobs from failing outright when FFmpeg is not installed by falling back to the original downloaded audio container.
- Preserved the path to true MP3 output in production when FFmpeg is available.

### Browser Playback
- Solved the problem of browser media elements needing access to protected streams by supporting authenticated stream access through token-aware endpoints.
- Implemented byte-range responses so browser playback can seek and partially load files correctly.

## Testing and Verification

### Automated Verification
- Ran backend unit/integration tests with `python -m unittest discover -s backend/tests`.
- Kept the original auth and job lifecycle coverage.
- Updated tests for the new paginated library response shape.
- Added tests for authenticated media streaming with HTTP `Range` requests.
- Added tests for user isolation in the new library shape.
- Added tests for playlist creation, playlist sharing, shared playlist playback, radio channel creation, and HLS manifest generation.
- Built the web app successfully with `npm run build`.

### Local Functional Validation
- Verified the API can start locally with FastAPI/Uvicorn.
- Verified the worker can run separately and process queued jobs.
- Verified the website can run locally via Vite.
- Verified users can register, log in, queue jobs, and browse the resulting library.
- Verified the browser player and shared playlist pages compile successfully.

## Stack and Tools

### Backend
- Python
- FastAPI
- SQLAlchemy
- Pydantic
- Alembic
- JWT auth
- Uvicorn
- yt-dlp
- FFmpeg
- Mutagen

### Frontend
- React
- Vite
- React Router
- Axios
- Tailwind CSS

### Infra and Storage
- Docker
- Docker Compose
- PostgreSQL
- Caddy
- Persistent media volumes

## Resume Keywords

FastAPI, React, Python, SQLAlchemy, PostgreSQL, Docker, Docker Compose, JWT, media streaming, byte-range requests, HLS, FFmpeg, yt-dlp, background workers, REST API design, multi-user access control, React Router, Tailwind CSS, Caddy, deployment automation, private media libraries, playlist sharing

## Interview Talking Points

### Good "Tell Me About It" Version
I took a local downloader-style app and turned it into a real web media platform. The biggest shift was moving from "download on this machine" to "submit jobs to a server, process them in a worker, store results per user, and stream them securely in the browser." That meant designing a job queue, a shared download core, private library ownership, byte-range streaming, share-token-based playlist access, and a production deployment story with Postgres, Docker, and HTTPS routing.

### Strong Engineering Story
One of the more interesting parts was handling the gap between local development and production media processing. In production I wanted MP3 output because it is the easiest format to play everywhere, but local machines may not always have FFmpeg installed. I changed the pipeline so the worker still succeeds locally by keeping the original container such as `.m4a`, while production can explicitly point to FFmpeg and finalize to MP3. That let development keep moving without weakening the production design.

### Product Story
I also deliberately made the website the main product. Instead of forcing people to install a desktop app, users can listen directly in the browser, share playlist pages, and even expose a simple radio-style stream. The desktop app still adds value for local sync, but the core experience now works from any device with a browser.

## Suggested Resume Entry Format

### Title Ideas
- Full Stack Developer - Yoinker
- Software Engineer - Yoinker Media Platform
- Independent Developer - Web Streaming Platform

### Entry Template
**Yoinker | Full Stack Media Platform**
Built a website-first personal media service that lets users queue YouTube/Bilibili ingestion jobs on a server, stream private audio/video libraries in the browser, manage shareable playlists, and publish playlist-backed HLS radio feeds. Implemented FastAPI APIs, a background worker, shared yt-dlp/FFmpeg media pipeline, React streaming UI, Postgres-backed production deployment, and token-scoped sharing with per-user access control.

## If You Want Even Stronger Resume Bullets Later

Add measurable outcomes if you can, such as:
- number of users
- number of playlists or downloads handled
- time saved versus local/manual workflows
- deployment uptime
- library size or media volume handled

Even without hard numbers, this is already a strong full-stack systems project because it spans product design, media processing, auth, background jobs, secure streaming, frontend UX, and production deployment.

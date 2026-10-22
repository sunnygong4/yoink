## Yoinker Beta Checklist

Run this after `docker compose up -d` on the server.

### Core checks

- Open `https://your-domain/api/v1/healthz` and confirm it returns `status: ok`
- Open `https://your-domain` and confirm the login page loads over HTTPS
- Register a fresh test account
- Search for a song from Home and confirm results appear only after pressing `Search`
- Stream a result in the browser
- Add the selected version to the library and confirm the job progresses
- Open Library and confirm the imported track streams from your server

### Sharing checks

- Create a playlist
- Add at least one track
- Share the playlist
- Open the shared link in a private/incognito window and verify playback works

### Tester readiness

- Set `VITE_FEEDBACK_URL` in `.env` so friends can leave comments quickly
- Keep `docker compose logs api --tail=100` and `docker compose logs worker --tail=100` handy during the first test session
- Back up both the Postgres volume and the media volume before expanding beyond the first beta group

import time
from pathlib import Path
from typing import Any, Optional
from urllib.parse import quote

import requests


class RemoteClientError(RuntimeError):
    pass


class YoinkerRemoteClient:
    def __init__(self, base_url: str = "http://localhost:8000"):
        self.base_url = base_url.rstrip("/")

    def set_base_url(self, base_url: str):
        self.base_url = base_url.rstrip("/")

    def _api_url(self, path: str) -> str:
        return f"{self.base_url}/api/v1{path}"

    def _headers(self, token: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {token}"}

    def _raise_for_status(self, response: requests.Response):
        try:
            response.raise_for_status()
        except requests.HTTPError as exc:
            detail = None
            try:
                payload = response.json()
                detail = payload.get("detail")
            except Exception:
                detail = response.text.strip() or str(exc)
            raise RemoteClientError(detail or str(exc)) from exc

    # ── Auth ──────────────────────────────────────────────────────────

    def login(self, username: str, password: str) -> str:
        response = requests.post(
            self._api_url("/auth/token"),
            data={"username": username, "password": password},
            timeout=30,
        )
        self._raise_for_status(response)
        return response.json()["access_token"]

    def get_me(self, token: str) -> dict[str, Any]:
        response = requests.get(self._api_url("/auth/me"), headers=self._headers(token), timeout=30)
        self._raise_for_status(response)
        return response.json()

    # ── Jobs ──────────────────────────────────────────────────────────

    def create_job(self, token: str, payload: dict[str, Any]) -> dict[str, Any]:
        response = requests.post(
            self._api_url("/jobs"),
            json=payload,
            headers=self._headers(token),
            timeout=30,
        )
        self._raise_for_status(response)
        return response.json()

    def get_job(self, token: str, job_id: int) -> dict[str, Any]:
        response = requests.get(
            self._api_url(f"/jobs/{job_id}"),
            headers=self._headers(token),
            timeout=30,
        )
        self._raise_for_status(response)
        return response.json()

    def list_jobs(self, token: str) -> list[dict[str, Any]]:
        response = requests.get(self._api_url("/jobs"), headers=self._headers(token), timeout=30)
        self._raise_for_status(response)
        return response.json()

    def cancel_job(self, token: str, job_id: int) -> dict[str, Any]:
        response = requests.post(
            self._api_url(f"/jobs/{job_id}/cancel"),
            headers=self._headers(token),
            timeout=30,
        )
        self._raise_for_status(response)
        return response.json()

    def list_pending_downloads(self, token: str) -> list[dict[str, Any]]:
        """List completed jobs with download_to_device=True that haven't been fetched yet."""
        response = requests.get(
            self._api_url("/jobs/pending-downloads"),
            headers=self._headers(token),
            timeout=30,
        )
        self._raise_for_status(response)
        return response.json()

    def mark_job_downloaded(self, token: str, job_id: int) -> dict[str, Any]:
        """Mark a job as downloaded to device so it no longer appears in pending-downloads."""
        response = requests.post(
            self._api_url(f"/jobs/{job_id}/mark-downloaded"),
            headers=self._headers(token),
            timeout=30,
        )
        self._raise_for_status(response)
        return response.json()

    def poll_job_until_done(
        self,
        token: str,
        job_id: int,
        *,
        interval: float = 2.0,
        timeout: float = 600.0,
        progress_callback: Optional[callable] = None,
    ) -> dict[str, Any]:
        """Poll a job until it reaches a terminal state (completed/failed/cancelled).

        Returns the final job dict.  Raises RemoteClientError on timeout.
        If *progress_callback* is provided it is called with the job dict on
        every poll so the caller can update a progress bar.
        """
        terminal_states = {"completed", "failed", "cancelled"}
        deadline = time.monotonic() + timeout
        while True:
            job = self.get_job(token, job_id)
            if progress_callback:
                progress_callback(job)
            if job["status"] in terminal_states:
                return job
            if time.monotonic() >= deadline:
                raise RemoteClientError(f"Job {job_id} did not finish within {timeout}s")
            time.sleep(interval)

    # ── Library ───────────────────────────────────────────────────────

    def get_library_home(self, token: str) -> dict[str, Any]:
        response = requests.get(self._api_url("/library/home"), headers=self._headers(token), timeout=30)
        self._raise_for_status(response)
        return response.json()

    def list_library(self, token: str, params: Optional[dict[str, Any]] = None) -> dict[str, Any]:
        response = requests.get(
            self._api_url("/library"),
            headers=self._headers(token),
            params=params or {},
            timeout=30,
        )
        self._raise_for_status(response)
        return response.json()

    def list_albums(self, token: str) -> list[dict[str, Any]]:
        response = requests.get(self._api_url("/library/albums"), headers=self._headers(token), timeout=30)
        self._raise_for_status(response)
        return response.json()

    def update_media_metadata(self, token: str, media_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        response = requests.patch(
            self._api_url(f"/library/{media_id}/metadata"),
            headers=self._headers(token),
            json=payload,
            timeout=30,
        )
        self._raise_for_status(response)
        return response.json()

    def update_album_metadata(self, token: str, payload: dict[str, Any]) -> dict[str, Any]:
        response = requests.patch(
            self._api_url("/library/albums/metadata"),
            headers=self._headers(token),
            json=payload,
            timeout=30,
        )
        self._raise_for_status(response)
        return response.json()

    def delete_media(self, token: str, media_id: int) -> None:
        response = requests.delete(
            self._api_url(f"/library/{media_id}"),
            headers=self._headers(token),
            timeout=30,
        )
        self._raise_for_status(response)

    def download_media(self, token: str, media_id: int, destination_dir: Path) -> Path:
        destination_dir.mkdir(parents=True, exist_ok=True)
        response = requests.get(
            self._api_url(f"/library/{media_id}/download"),
            headers=self._headers(token),
            timeout=300,
            stream=True,
        )
        self._raise_for_status(response)

        filename = self._filename_from_response(response) or f"media-{media_id}"
        output_path = self._unique_path(destination_dir / filename)
        with open(output_path, "wb") as file_handle:
            for chunk in response.iter_content(chunk_size=1024 * 128):
                if chunk:
                    file_handle.write(chunk)
        return output_path

    # ── Discovery search (multi-source yt-dlp search) ────────────────

    def search_discovery(
        self,
        token: str,
        *,
        query: str,
        sources: Optional[list[str]] = None,
        search_type: str = "song",
        secondary_query: Optional[str] = None,
        page: int = 1,
        page_size: int = 12,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {
            "q": query,
            "search_type": search_type,
            "page": page,
            "page_size": page_size,
        }
        if sources:
            params["sources"] = ",".join(sources)
        if secondary_query:
            params["secondary_q"] = secondary_query
        response = requests.get(
            self._api_url("/search"),
            headers=self._headers(token),
            params=params,
            timeout=30,
        )
        self._raise_for_status(response)
        return response.json()

    def search_versions(
        self,
        token: str,
        *,
        query: str,
        source: str = "youtube",
        artist_hint: Optional[str] = None,
        page: int = 1,
        page_size: int = 8,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {
            "q": query,
            "source": source,
            "page": page,
            "page_size": page_size,
        }
        if artist_hint:
            params["artist_hint"] = artist_hint
        response = requests.get(
            self._api_url("/search/versions"),
            headers=self._headers(token),
            params=params,
            timeout=30,
        )
        self._raise_for_status(response)
        return response.json()

    def create_discovery_stream_session(self, token: str, payload: dict[str, Any]) -> dict[str, Any]:
        response = requests.post(
            self._api_url("/search/stream-session"),
            json=payload,
            headers=self._headers(token),
            timeout=30,
        )
        self._raise_for_status(response)
        return response.json()

    def import_discovery_result(self, token: str, payload: dict[str, Any]) -> dict[str, Any]:
        response = requests.post(
            self._api_url("/search/import"),
            json=payload,
            headers=self._headers(token),
            timeout=30,
        )
        self._raise_for_status(response)
        return response.json()

    # ── Catalog search (MusicBrainz-backed) ──────────────────────────

    def search_catalog(
        self,
        token: str,
        *,
        query: str,
        search_type: str = "song",
        secondary_query: Optional[str] = None,
        page: int = 1,
        page_size: int = 8,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {
            "q": query,
            "search_type": search_type,
            "page": page,
            "page_size": page_size,
        }
        if secondary_query:
            params["secondary_q"] = secondary_query
        response = requests.get(
            self._api_url("/catalog/search"),
            headers=self._headers(token),
            params=params,
            timeout=30,
        )
        self._raise_for_status(response)
        return response.json()

    def import_catalog_track(self, token: str, payload: dict[str, Any]) -> dict[str, Any]:
        response = requests.post(
            self._api_url("/catalog/import-track"),
            headers=self._headers(token),
            json=payload,
            timeout=60,
        )
        self._raise_for_status(response)
        return response.json()

    def import_catalog_album(self, token: str, payload: dict[str, Any]) -> dict[str, Any]:
        response = requests.post(
            self._api_url("/catalog/import-album"),
            headers=self._headers(token),
            json=payload,
            timeout=120,
        )
        self._raise_for_status(response)
        return response.json()

    # ── Playlists ─────────────────────────────────────────────────────

    def list_playlists(self, token: str) -> list[dict[str, Any]]:
        response = requests.get(self._api_url("/playlists"), headers=self._headers(token), timeout=30)
        self._raise_for_status(response)
        return response.json()

    def share_playlist(self, token: str, playlist_id: int, payload: Optional[dict[str, Any]] = None) -> dict[str, Any]:
        response = requests.post(
            self._api_url(f"/playlists/{playlist_id}/share"),
            headers=self._headers(token),
            json=payload or {},
            timeout=30,
        )
        self._raise_for_status(response)
        return response.json()

    # ── Radio ─────────────────────────────────────────────────────────

    def list_radio_channels(self, token: str) -> list[dict[str, Any]]:
        response = requests.get(self._api_url("/radio"), headers=self._headers(token), timeout=30)
        self._raise_for_status(response)
        return response.json()

    def create_radio_channel(self, token: str, payload: dict[str, Any]) -> dict[str, Any]:
        response = requests.post(
            self._api_url("/radio"),
            headers=self._headers(token),
            json=payload,
            timeout=30,
        )
        self._raise_for_status(response)
        return response.json()

    def share_radio_channel(self, token: str, radio_id: int, payload: Optional[dict[str, Any]] = None) -> dict[str, Any]:
        response = requests.post(
            self._api_url(f"/radio/{radio_id}/share"),
            headers=self._headers(token),
            json=payload or {},
            timeout=30,
        )
        self._raise_for_status(response)
        return response.json()

    # ── URL helpers ───────────────────────────────────────────────────

    def get_media_stream_url(self, token: str, media_id: int) -> str:
        return f"{self._api_url(f'/library/{media_id}/stream')}?access_token={quote(token)}"

    def get_discovery_stream_url(self, token: str, session_token: str) -> str:
        return f"{self._api_url(f'/search/stream/{session_token}')}?access_token={quote(token)}"

    def get_media_artwork_url(self, token: str, media_id: int) -> str:
        return f"{self._api_url(f'/library/{media_id}/artwork')}?access_token={quote(token)}"

    def get_media_lyrics(self, token: str, media_id: int) -> dict[str, Any]:
        """Fetch synced lyrics for a media file. Returns dict with format, lyrics, synced keys."""
        return self._get(f"/library/{media_id}/lyrics", token)

    # ── High-level helpers ────────────────────────────────────────────

    def import_and_download(
        self,
        token: str,
        import_payload: dict[str, Any],
        destination_dir: Path,
        *,
        poll_interval: float = 2.0,
        timeout: float = 600.0,
        progress_callback: Optional[callable] = None,
    ) -> Path:
        """Import a discovery result and download the file once the server finishes.

        This is the full "search → import → wait → download to laptop" flow
        that the EXE and desktop clients use.

        Returns the path to the downloaded file.
        """
        job = self.import_discovery_result(token, import_payload)
        job_id = job["id"]

        if job["status"] not in {"completed", "failed", "cancelled"}:
            job = self.poll_job_until_done(
                token,
                job_id,
                interval=poll_interval,
                timeout=timeout,
                progress_callback=progress_callback,
            )

        if job["status"] != "completed":
            raise RemoteClientError(
                f"Job {job_id} ended with status {job['status']}: "
                f"{job.get('error_message') or 'unknown error'}"
            )

        media_files = job.get("media_files") or []
        if not media_files:
            raise RemoteClientError(f"Job {job_id} completed but produced no media files")

        media_id = media_files[0]["id"]
        downloaded_path = self.download_media(token, media_id, destination_dir)
        try:
            self.mark_job_downloaded(token, job_id)
        except RemoteClientError:
            pass  # non-critical; file is already saved
        return downloaded_path

    # ── Internal helpers ──────────────────────────────────────────────

    @staticmethod
    def _filename_from_response(response: requests.Response) -> Optional[str]:
        disposition = response.headers.get("Content-Disposition", "")
        for part in disposition.split(";"):
            part = part.strip()
            if part.lower().startswith("filename="):
                return part.split("=", 1)[1].strip().strip('"')
        return None

    @staticmethod
    def _unique_path(path: Path) -> Path:
        if not path.exists():
            return path
        counter = 2
        while True:
            candidate = path.with_name(f"{path.stem} ({counter}){path.suffix}")
            if not candidate.exists():
                return candidate
            counter += 1

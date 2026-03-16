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

    def list_jobs(self, token: str) -> list[dict[str, Any]]:
        response = requests.get(self._api_url("/jobs"), headers=self._headers(token), timeout=30)
        self._raise_for_status(response)
        return response.json()

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

    def create_job(self, token: str, payload: dict[str, Any]) -> dict[str, Any]:
        response = requests.post(
            self._api_url("/jobs"),
            json=payload,
            headers=self._headers(token),
            timeout=30,
        )
        self._raise_for_status(response)
        return response.json()

    def search_catalog(
        self,
        token: str,
        *,
        query: str,
        sources: Optional[list[str]] = None,
        page: int = 1,
        page_size: int = 12,
    ) -> dict[str, Any]:
        params = {
            "q": query,
            "page": page,
            "page_size": page_size,
        }
        if sources:
            params["sources"] = ",".join(sources)
        response = requests.get(
            self._api_url("/search"),
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

    def cancel_job(self, token: str, job_id: int) -> dict[str, Any]:
        response = requests.post(
            self._api_url(f"/jobs/{job_id}/cancel"),
            headers=self._headers(token),
            timeout=30,
        )
        self._raise_for_status(response)
        return response.json()

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

    def get_media_stream_url(self, token: str, media_id: int) -> str:
        return f"{self._api_url(f'/library/{media_id}/stream')}?access_token={quote(token)}"

    def get_discovery_stream_url(self, token: str, session_token: str) -> str:
        return f"{self._api_url(f'/search/stream/{session_token}')}?access_token={quote(token)}"

    def get_media_artwork_url(self, token: str, media_id: int) -> str:
        return f"{self._api_url(f'/library/{media_id}/artwork')}?access_token={quote(token)}"

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

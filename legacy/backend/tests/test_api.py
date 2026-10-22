import os
import shutil
import sys
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

TEST_DIR = Path(tempfile.mkdtemp(prefix="yoinker-api-tests-"))
DB_PATH = TEST_DIR / "test.db"
MEDIA_ROOT = TEST_DIR / "media"

os.environ["DATABASE_URL"] = f"sqlite:///{DB_PATH.as_posix()}"
os.environ["MEDIA_ROOT"] = str(MEDIA_ROOT)
os.environ["SECRET_KEY"] = "test-secret"

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from fastapi.testclient import TestClient
from fastapi.responses import PlainTextResponse

from app import database, models, schemas, worker
from app.main import app


class ApiTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(TEST_DIR, ignore_errors=True)

    def setUp(self):
        database.Base.metadata.drop_all(bind=database.engine)
        database.Base.metadata.create_all(bind=database.engine)
        MEDIA_ROOT.mkdir(parents=True, exist_ok=True)

    def register_and_login(self, username: str):
        register_response = self.client.post(
            "/api/v1/auth/register",
            json={"username": username, "password": "secret123"},
        )
        self.assertEqual(register_response.status_code, 200)

        token_response = self.client.post(
            "/api/v1/auth/token",
            data={"username": username, "password": "secret123"},
        )
        self.assertEqual(token_response.status_code, 200)
        return token_response.json()["access_token"]

    def auth_headers(self, token: str):
        return {"Authorization": f"Bearer {token}"}

    def discovery_match(self, *, title: str, artist: str, album: str | None = None, source_url: str = "https://youtube.com/watch?v=demo", provider_id: str = "demo"):
        return schemas.DiscoverySearchResult(
            source=schemas.DiscoverySource.youtube,
            source_label="YouTube Music",
            provider_id=provider_id,
            canonical_source_url=source_url,
            title=title,
            artist=artist,
            album=album,
            duration_seconds=180,
            artwork_url="https://img.youtube.com/vi/demo/default.jpg",
        )

    def test_register_login_and_me(self):
        token = self.register_and_login("alice")

        me_response = self.client.get("/api/v1/auth/me", headers=self.auth_headers(token))
        self.assertEqual(me_response.status_code, 200)
        self.assertEqual(me_response.json()["username"], "alice")

        invalid_response = self.client.get("/api/v1/auth/me", headers=self.auth_headers("bad-token"))
        self.assertEqual(invalid_response.status_code, 401)

    def test_health_endpoint(self):
        response = self.client.get("/api/v1/healthz")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")

    def test_job_lifecycle_and_library_download(self):
        token = self.register_and_login("bob")

        job_response = self.client.post(
            "/api/v1/jobs",
            json={
                "url": "https://www.youtube.com/watch?v=test",
                "mode": "audio",
                "audio_bitrate_kbps": 192,
                "allow_playlist": False,
            },
            headers=self.auth_headers(token),
        )
        self.assertEqual(job_response.status_code, 200)
        job_id = job_response.json()["id"]

        job_owner_dir = MEDIA_ROOT / "1" / "audio"
        job_owner_dir.mkdir(parents=True, exist_ok=True)
        downloaded_file = job_owner_dir / "example.mp3"
        artwork_file = job_owner_dir / "example.cover.jpg"
        downloaded_file.write_bytes(b"fake mp3")
        artwork_file.write_bytes(b"fake cover")

        fake_item = type(
            "FakeItem",
            (),
            {
                "file_path": downloaded_file,
                "webpage_url": "https://www.youtube.com/watch?v=test",
                "source_site": "youtube",
                "title": "Example Song",
                "uploader": "Uploader",
                "artwork_path": artwork_file,
                "size_bytes": downloaded_file.stat().st_size,
                "duration_seconds": 120.75,
                "media_type": "audio",
            },
        )()

        with patch("app.worker.download_url", return_value=[fake_item]):
            worker.process_job(job_id)

        jobs_response = self.client.get("/api/v1/jobs", headers=self.auth_headers(token))
        self.assertEqual(jobs_response.status_code, 200)
        job = jobs_response.json()[0]
        self.assertEqual(job["status"], "completed")
        self.assertEqual(job["progress_percent"], 100)
        self.assertEqual(len(job["media_files"]), 1)

        library_response = self.client.get("/api/v1/library", headers=self.auth_headers(token))
        self.assertEqual(library_response.status_code, 200)
        media = library_response.json()["items"][0]
        self.assertEqual(media["title"], "Example Song")
        self.assertEqual(media["artwork_relative_path"], "1/audio/example.cover.jpg")
        self.assertEqual(media["duration_seconds"], 120)

        home_response = self.client.get("/api/v1/library/home", headers=self.auth_headers(token))
        self.assertEqual(home_response.status_code, 200)
        self.assertEqual(home_response.json()["recent_items"][0]["title"], "Example Song")
        self.assertEqual(home_response.json()["recent_items"][0]["duration_seconds"], 120)

        stream_response = self.client.get(
            f"/api/v1/library/{media['id']}/stream?access_token={token}",
            headers={"Range": "bytes=0-3"},
        )
        self.assertEqual(stream_response.status_code, 206)
        self.assertEqual(stream_response.content, b"fake")

        artwork_response = self.client.get(
            f"/api/v1/library/{media['id']}/artwork?access_token={token}",
            headers={"Range": "bytes=0-3"},
        )
        self.assertEqual(artwork_response.status_code, 206)
        self.assertEqual(artwork_response.content, b"fake")

        download_response = self.client.get(
            f"/api/v1/library/{media['id']}/download",
            headers=self.auth_headers(token),
        )
        self.assertEqual(download_response.status_code, 200)
        self.assertEqual(download_response.content, b"fake mp3")

        duplicate_job_response = self.client.post(
            "/api/v1/jobs",
            json={
                "url": "https://www.youtube.com/watch?v=test",
                "mode": "audio",
                "audio_bitrate_kbps": 192,
                "allow_playlist": False,
            },
            headers=self.auth_headers(token),
        )
        self.assertEqual(duplicate_job_response.status_code, 200)
        self.assertEqual(duplicate_job_response.json()["id"], job_id)

        delete_response = self.client.delete(
            f"/api/v1/library/{media['id']}",
            headers=self.auth_headers(token),
        )
        self.assertEqual(delete_response.status_code, 204)

        deleted_library_response = self.client.get("/api/v1/library", headers=self.auth_headers(token))
        self.assertEqual(deleted_library_response.status_code, 200)
        self.assertEqual(deleted_library_response.json()["items"], [])
        self.assertFalse(downloaded_file.exists())
        self.assertFalse(artwork_file.exists())

    def test_unicode_media_names_stream_without_header_encoding_error(self):
        token = self.register_and_login("unicode-user")
        headers = self.auth_headers(token)

        audio_name = "\u534e\u8bed\u4e50\u575b\u699c\u4e0a\u699c.mp3"
        artwork_name = "\u59da\u8001\u677f.cover.jpg"
        media_dir = MEDIA_ROOT / "1" / "audio"
        media_dir.mkdir(parents=True, exist_ok=True)
        audio_path = media_dir / audio_name
        artwork_path = media_dir / artwork_name
        audio_path.write_bytes(b"abcdef")
        artwork_path.write_bytes(b"cover-bytes")

        db = database.SessionLocal()
        try:
            media = models.MediaFile(
                owner_id=1,
                media_type="audio",
                relative_path=f"1/audio/{audio_name}",
                source_url="https://youtube.com/watch?v=unicode",
                source_site="youtube",
                title="\u534e\u8bed\u4e50\u575b\u699c\u4e0a\u699c",
                uploader="\u59da\u653f",
                artwork_relative_path=f"1/audio/{artwork_name}",
                size_bytes=audio_path.stat().st_size,
                duration_seconds=10,
            )
            db.add(media)
            db.commit()
            db.refresh(media)
            media_id = media.id
        finally:
            db.close()

        stream_response = self.client.get(
            f"/api/v1/library/{media_id}/stream",
            headers={**headers, "Range": "bytes=0-2"},
        )
        self.assertEqual(stream_response.status_code, 206)
        self.assertEqual(stream_response.content, b"abc")
        self.assertIn("filename*=", stream_response.headers["content-disposition"])

        artwork_response = self.client.get(
            f"/api/v1/library/{media_id}/artwork",
            headers=headers,
        )
        self.assertEqual(artwork_response.status_code, 200)
        self.assertIn("filename*=", artwork_response.headers["content-disposition"])

        invalid_range_response = self.client.get(
            f"/api/v1/library/{media_id}/stream",
            headers={**headers, "Range": "bytes=abc-def"},
        )
        self.assertEqual(invalid_range_response.status_code, 416)

    def test_user_isolation_and_cancel(self):
        alice_token = self.register_and_login("alice")
        bob_token = self.register_and_login("bob")

        job_response = self.client.post(
            "/api/v1/jobs",
            json={
                "url": "https://www.bilibili.com/video/BV1xx411c7mD",
                "mode": "video",
                "video_quality": "720p",
                "allow_playlist": False,
            },
            headers=self.auth_headers(alice_token),
        )
        job_id = job_response.json()["id"]

        cancel_response = self.client.post(
            f"/api/v1/jobs/{job_id}/cancel",
            headers=self.auth_headers(alice_token),
        )
        self.assertEqual(cancel_response.status_code, 200)
        self.assertEqual(cancel_response.json()["status"], "cancelled")

        other_user_job = self.client.get(f"/api/v1/jobs/{job_id}", headers=self.auth_headers(bob_token))
        self.assertEqual(other_user_job.status_code, 404)

        other_user_library = self.client.get("/api/v1/library", headers=self.auth_headers(bob_token))
        self.assertEqual(other_user_library.status_code, 200)
        self.assertEqual(other_user_library.json()["items"], [])

    def test_catalog_song_search_and_track_import(self):
        token = self.register_and_login("searcher")
        headers = self.auth_headers(token)

        with patch("app.services.catalog.musicbrainzngs.search_recordings") as search_recordings:
            search_recordings.return_value = {
                "recording-count": 1,
                "recording-list": [
                    {
                        "id": "recording-1",
                        "title": "Lacrimosa",
                        "artist-credit-phrase": "Mozart",
                        "release-list": [{"id": "release-1", "title": "Requiem", "date": "1791-01-01"}],
                    }
                ],
            }

            search_response = self.client.get(
                "/api/v1/catalog/search",
                params={"q": "Lacrimosa", "search_type": "song"},
                headers=headers,
            )

        self.assertEqual(search_response.status_code, 200)
        payload = search_response.json()
        self.assertEqual(payload["items"][0]["result_type"], "track")
        self.assertIsNone(payload["items"][0]["best_match"])

        import_response = self.client.post(
            "/api/v1/catalog/import-track",
            json={
                "title": "Lacrimosa",
                "artist": "Mozart",
                "album": "Requiem",
                "preferred_match": {
                    "source": "youtube",
                    "canonical_source_url": "https://youtube.com/watch?v=demo",
                    "title": "Lacrimosa",
                    "artist": "Mozart",
                    "album": "Requiem",
                    "duration_seconds": 180,
                    "artwork_url": "https://img.youtube.com/vi/demo/default.jpg",
                    "provider_id": "demo",
                    "audio_bitrate_kbps": 192,
                    "enrich_metadata": True,
                    "download_to_device": False,
                },
            },
            headers=headers,
        )
        self.assertEqual(import_response.status_code, 200)
        self.assertEqual(import_response.json()["status"], "queued")
        self.assertEqual(import_response.json()["source_url"], "https://youtube.com/watch?v=demo")

    def test_catalog_album_import_queues_tracks(self):
        token = self.register_and_login("albumfan")
        headers = self.auth_headers(token)

        side_effect_matches = [
            (self.discovery_match(title="Introitus", artist="Mozart", album="Requiem", source_url="https://youtube.com/watch?v=one", provider_id="one"), []),
            (self.discovery_match(title="Dies Irae", artist="Mozart", album="Requiem", source_url="https://youtube.com/watch?v=two", provider_id="two"), []),
        ]

        with patch("app.services.catalog._release_tracks") as release_tracks, patch(
            "app.services.catalog._best_track_matches"
        ) as best_track_matches:
            release_tracks.return_value = [
                {"title": "Introitus", "artist": "Mozart", "album": "Requiem", "year": "1791"},
                {"title": "Dies Irae", "artist": "Mozart", "album": "Requiem", "year": "1791"},
            ]
            best_track_matches.side_effect = side_effect_matches

            response = self.client.post(
                "/api/v1/catalog/import-album",
                json={
                    "release_id": "release-1",
                    "title": "Requiem",
                    "artist": "Mozart",
                    "audio_bitrate_kbps": 192,
                },
                headers=headers,
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["total_tracks"], 2)
        self.assertEqual(payload["queued_jobs"], 2)
        self.assertEqual(payload["completed_jobs"], 0)
        self.assertEqual(len(payload["jobs"]), 2)

    def test_album_groups_and_metadata_editing(self):
        token = self.register_and_login("collector")
        headers = self.auth_headers(token)

        media_dir = MEDIA_ROOT / "1" / "audio"
        media_dir.mkdir(parents=True, exist_ok=True)
        track_one = media_dir / "album-track-one.mp3"
        track_two = media_dir / "album-track-two.mp3"
        track_one.write_bytes(b"fake album one")
        track_two.write_bytes(b"fake album two")

        db = database.SessionLocal()
        try:
            media_one = models.MediaFile(
                owner_id=1,
                media_type="audio",
                relative_path="1/audio/album-track-one.mp3",
                source_url="https://example.com/album/1",
                source_site="youtube",
                title="Track One",
                uploader="Composer",
                album="Album Name",
                size_bytes=track_one.stat().st_size,
                duration_seconds=101,
            )
            media_two = models.MediaFile(
                owner_id=1,
                media_type="audio",
                relative_path="1/audio/album-track-two.mp3",
                source_url="https://example.com/album/2",
                source_site="youtube",
                title="Track Two",
                uploader="Composer",
                album="Album Name",
                size_bytes=track_two.stat().st_size,
                duration_seconds=102,
            )
            db.add_all([media_one, media_two])
            db.commit()
            db.refresh(media_one)
            db.refresh(media_two)
            media_one_id = media_one.id
            media_two_id = media_two.id
        finally:
            db.close()

        albums_response = self.client.get("/api/v1/library/albums", headers=headers)
        self.assertEqual(albums_response.status_code, 200)
        albums_payload = albums_response.json()
        self.assertEqual(len(albums_payload), 1)
        self.assertEqual(albums_payload[0]["track_count"], 2)
        self.assertEqual(albums_payload[0]["title"], "Album Name")

        bulk_update_response = self.client.patch(
            "/api/v1/library/albums/metadata",
            headers=headers,
            json={
                "media_ids": [media_one_id, media_two_id],
                "album": "Album Name (Edited)",
                "artist": "Composer Ensemble",
            },
        )
        self.assertEqual(bulk_update_response.status_code, 200)
        self.assertEqual(bulk_update_response.json()[0]["album"], "Album Name (Edited)")
        self.assertEqual(bulk_update_response.json()[0]["uploader"], "Composer Ensemble")

        track_update_response = self.client.patch(
            f"/api/v1/library/{media_one_id}/metadata",
            headers=headers,
            json={
                "title": "Track One (Edited)",
                "artist": "Composer Ensemble",
                "album": "Album Name (Edited)",
            },
        )
        self.assertEqual(track_update_response.status_code, 200)
        self.assertEqual(track_update_response.json()["title"], "Track One (Edited)")
        self.assertEqual(track_update_response.json()["metadata_status"], "override")

    def test_playlist_share_and_radio_stream(self):
        token = self.register_and_login("curator")
        headers = self.auth_headers(token)

        job_owner_dir = MEDIA_ROOT / "1" / "audio"
        job_owner_dir.mkdir(parents=True, exist_ok=True)
        track_one = job_owner_dir / "track-one.mp3"
        track_two = job_owner_dir / "track-two.mp3"
        track_one.write_bytes(b"track one audio")
        track_two.write_bytes(b"track two audio")

        db = database.SessionLocal()
        try:
            media_one = models.MediaFile(
                owner_id=1,
                media_type="audio",
                relative_path="1/audio/track-one.mp3",
                source_url="https://example.com/1",
                source_site="youtube",
                title="Track One",
                uploader="Artist",
                size_bytes=track_one.stat().st_size,
                duration_seconds=90,
            )
            media_two = models.MediaFile(
                owner_id=1,
                media_type="audio",
                relative_path="1/audio/track-two.mp3",
                source_url="https://example.com/2",
                source_site="youtube",
                title="Track Two",
                uploader="Artist",
                size_bytes=track_two.stat().st_size,
                duration_seconds=120,
            )
            db.add_all([media_one, media_two])
            db.commit()
            db.refresh(media_one)
            db.refresh(media_two)
            media_one_id = media_one.id
            media_two_id = media_two.id
        finally:
            db.close()

        playlist_response = self.client.post(
            "/api/v1/playlists",
            json={"title": "Road Trip", "description": "Shared in browser"},
            headers=headers,
        )
        self.assertEqual(playlist_response.status_code, 200)
        playlist_id = playlist_response.json()["id"]

        add_one = self.client.post(
            f"/api/v1/playlists/{playlist_id}/items",
            json={"media_file_id": media_one_id},
            headers=headers,
        )
        self.assertEqual(add_one.status_code, 200)

        add_two = self.client.post(
            f"/api/v1/playlists/{playlist_id}/items",
            json={"media_file_id": media_two_id},
            headers=headers,
        )
        self.assertEqual(add_two.status_code, 200)

        share_response = self.client.post(
            f"/api/v1/playlists/{playlist_id}/share",
            json={"enabled": True},
            headers=headers,
        )
        self.assertEqual(share_response.status_code, 200)
        share_token = share_response.json()["share_token"]
        self.assertTrue(share_token)

        shared_playlist = self.client.get(f"/api/v1/shared/playlists/{share_token}")
        self.assertEqual(shared_playlist.status_code, 200)
        self.assertEqual(len(shared_playlist.json()["items"]), 2)

        public_item_id = shared_playlist.json()["items"][0]["id"]
        public_stream = self.client.get(
            f"/api/v1/shared/playlists/{share_token}/items/{public_item_id}/stream",
            headers={"Range": "bytes=0-4"},
        )
        self.assertEqual(public_stream.status_code, 206)
        self.assertEqual(public_stream.content, b"track")

        radio_response = self.client.post(
            "/api/v1/radio",
            json={"playlist_id": playlist_id, "title": "Road Trip Radio"},
            headers=headers,
        )
        self.assertEqual(radio_response.status_code, 200)
        radio_id = radio_response.json()["id"]
        radio_slug = radio_response.json()["slug"]

        radio_share = self.client.post(
            f"/api/v1/radio/{radio_id}/share",
            json={"enabled": True},
            headers=headers,
        )
        self.assertEqual(radio_share.status_code, 200)
        radio_token = radio_share.json()["share_token"]

        m3u8_response = self.client.get(f"/radio/{radio_slug}/index.m3u8?token={radio_token}")
        self.assertEqual(m3u8_response.status_code, 200)
        self.assertIn("#EXTM3U", m3u8_response.text)
        self.assertIn(f"/radio/{radio_slug}/tracks/", m3u8_response.text)

    def test_pending_downloads_and_mark_downloaded(self):
        token = self.register_and_login("device-user")
        headers = self.auth_headers(token)

        pending_before = self.client.get("/api/v1/jobs/pending-downloads", headers=headers)
        self.assertEqual(pending_before.status_code, 200)
        self.assertEqual(pending_before.json(), [])

        job_owner_dir = MEDIA_ROOT / "1" / "audio"
        job_owner_dir.mkdir(parents=True, exist_ok=True)
        downloaded_file = job_owner_dir / "device-song.mp3"
        downloaded_file.write_bytes(b"fake device mp3")

        fake_item = type(
            "FakeItem",
            (),
            {
                "file_path": downloaded_file,
                "webpage_url": "https://www.youtube.com/watch?v=device",
                "source_site": "youtube",
                "title": "Device Song",
                "uploader": "Uploader",
                "artwork_path": None,
                "size_bytes": downloaded_file.stat().st_size,
                "duration_seconds": 180,
                "media_type": "audio",
            },
        )()

        import_response = self.client.post(
            "/api/v1/search/import",
            headers=headers,
            json={
                "source": "youtube",
                "canonical_source_url": "https://youtube.com/watch?v=device",
                "title": "Device Song",
                "artist": "Uploader",
                "provider_id": "device",
                "download_to_device": True,
                "enrich_metadata": False,
                "audio_bitrate_kbps": 192,
            },
        )
        self.assertEqual(import_response.status_code, 200)
        job_id = import_response.json()["id"]
        self.assertTrue(import_response.json()["download_to_device"])

        with patch("app.worker.download_url", return_value=[fake_item]):
            worker.process_job(job_id)

        pending_after = self.client.get("/api/v1/jobs/pending-downloads", headers=headers)
        self.assertEqual(pending_after.status_code, 200)
        self.assertEqual(len(pending_after.json()), 1)
        self.assertEqual(pending_after.json()[0]["id"], job_id)

        mark_response = self.client.post(f"/api/v1/jobs/{job_id}/mark-downloaded", headers=headers)
        self.assertEqual(mark_response.status_code, 200)
        self.assertTrue(mark_response.json()["device_downloaded"])

        pending_final = self.client.get("/api/v1/jobs/pending-downloads", headers=headers)
        self.assertEqual(pending_final.status_code, 200)
        self.assertEqual(pending_final.json(), [])

    @patch("app.routers.search.build_remote_stream_response")
    @patch("app.routers.search.get_stream_session")
    @patch("app.routers.search.create_stream_session")
    @patch("app.routers.search.search_catalog")
    def test_discovery_search_stream_and_import(
        self,
        search_catalog_mock,
        create_stream_session_mock,
        get_stream_session_mock,
        build_remote_stream_response_mock,
    ):
        token = self.register_and_login("discovery-user")
        headers = self.auth_headers(token)

        discovery_result = {
            "source": "youtube",
            "source_label": "YouTube Music",
            "provider_id": "abc123",
            "canonical_source_url": "https://www.youtube.com/watch?v=abc123",
            "title": "Luv Sic",
            "artist": "Nujabes",
            "album": "Modal Soul",
            "duration_seconds": 245,
            "artwork_url": "https://i.ytimg.com/vi/abc123/hqdefault.jpg",
        }

        search_catalog_mock.return_value = {
            "query": "Nujabes",
            "sources": ["youtube", "soundcloud"],
            "items": [discovery_result],
            "page": 1,
            "page_size": 12,
            "total": 1,
        }

        search_response = self.client.get(
            "/api/v1/search",
            headers=headers,
            params={"q": "Nujabes", "sources": "youtube,soundcloud"},
        )
        self.assertEqual(search_response.status_code, 200)
        self.assertEqual(search_response.json()["items"][0]["artist"], "Nujabes")

        create_stream_session_mock.return_value = type(
            "Session",
            (),
            {
                "token": "session-123",
                "expires_at": datetime.utcnow() + timedelta(minutes=10),
                "result": discovery_result,
                "direct_url": "https://cdn.example.com/audio.m4a",
                "headers": {"User-Agent": "test"},
                "media_type": "audio/mp4",
            },
        )()

        create_session_response = self.client.post(
            "/api/v1/search/stream-session",
            headers=headers,
            json=discovery_result,
        )
        self.assertEqual(create_session_response.status_code, 200)
        self.assertEqual(create_session_response.json()["session_token"], "session-123")

        get_stream_session_mock.return_value = create_stream_session_mock.return_value
        build_remote_stream_response_mock.return_value = PlainTextResponse("stream ok")
        stream_response = self.client.get("/api/v1/search/stream/session-123", params={"access_token": token})
        self.assertEqual(stream_response.status_code, 200)
        self.assertEqual(stream_response.text, "stream ok")

        artwork_response = self.client.get(
            "/api/v1/search/artwork",
            params={"url": discovery_result["artwork_url"], "access_token": token},
        )
        self.assertEqual(artwork_response.status_code, 200)
        self.assertEqual(artwork_response.text, "stream ok")
        self.assertIn("User-Agent", build_remote_stream_response_mock.call_args.kwargs["upstream_headers"])

        import_response = self.client.post(
            "/api/v1/search/import",
            headers=headers,
            json={
                **discovery_result,
                "enrich_metadata": True,
                "download_to_device": True,
                "audio_bitrate_kbps": 192,
            },
        )
        self.assertEqual(import_response.status_code, 200)
        self.assertEqual(import_response.json()["import_source"], "youtube")
        self.assertTrue(import_response.json()["download_to_device"])

    @patch("app.routers.search.search_versions")
    def test_version_search_endpoint(self, search_versions_mock):
        token = self.register_and_login("version-user")
        headers = self.auth_headers(token)

        search_versions_mock.return_value = {
            "query": "California Dreamin",
            "source": "youtube",
            "status": "ok",
            "page": 1,
            "page_size": 8,
            "total": 1,
            "items": [
                {
                    "group_id": "group-1",
                    "display_title": "California Dreamin'",
                    "display_artist": "The Mamas & The Papas",
                    "artwork_url": "https://i.ytimg.com/example.jpg",
                    "confidence": 0.93,
                    "selected_version": {
                        "source": "youtube",
                        "source_label": "YouTube Music",
                        "provider_id": "original",
                        "canonical_source_url": "https://youtube.com/watch?v=original",
                        "title": "California Dreamin'",
                        "artist": "The Mamas & The Papas",
                        "album": "If You Can Believe Your Eyes and Ears",
                        "duration_seconds": 160,
                        "artwork_url": "https://i.ytimg.com/example.jpg",
                    },
                    "alternate_versions": [
                        {
                            "source": "youtube",
                            "source_label": "YouTube Music",
                            "provider_id": "cover",
                            "canonical_source_url": "https://youtube.com/watch?v=cover",
                            "title": "California Dreamin' (Cover)",
                            "artist": "Cover Artist",
                            "album": None,
                            "duration_seconds": 165,
                            "artwork_url": "https://i.ytimg.com/cover.jpg",
                        }
                    ],
                }
            ],
        }

        response = self.client.get(
            "/api/v1/search/versions",
            headers=headers,
            params={"q": "California Dreamin", "source": "youtube"},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["items"][0]["selected_version"]["artist"], "The Mamas & The Papas")
        self.assertEqual(len(payload["items"][0]["alternate_versions"]), 1)


if __name__ == "__main__":
    unittest.main()

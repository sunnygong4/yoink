import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from yoinker_core.downloader import DownloadItem, DownloadOptions, _make_format, download_url, sanitize


class DownloaderCoreTestCase(unittest.TestCase):
    def test_sanitize_and_format_mapping(self):
        self.assertEqual(sanitize('A:/B*?" Song'), "A - B Song")

        audio_options = DownloadOptions(
            url="https://www.youtube.com/watch?v=test",
            output_dir=Path(tempfile.gettempdir()),
            mode="audio",
            audio_bitrate_kbps=192,
        )
        self.assertIn("abr<=192", _make_format(audio_options))

        video_options = DownloadOptions(
            url="https://www.youtube.com/watch?v=test",
            output_dir=Path(tempfile.gettempdir()),
            mode="video",
            video_quality="1080p",
        )
        self.assertIn("height<=1080", _make_format(video_options))

    @patch("yoinker_core.downloader._finalize_download")
    @patch("yoinker_core.downloader._extract_with_retries")
    @patch("yoinker_core.downloader.YoutubeDL")
    def test_playlist_download_dispatches_each_entry(self, ydl_cls, extract_mock, finalize_mock):
        temp_dir = Path(tempfile.mkdtemp(prefix="yoinker-core-tests-"))
        options = DownloadOptions(
            url="https://www.youtube.com/playlist?list=test",
            output_dir=temp_dir,
            mode="audio",
            allow_playlist=True,
            audio_bitrate_kbps=192,
        )

        probe = MagicMock()
        probe.extract_info.return_value = {
            "_type": "playlist",
            "entries": [
                {"webpage_url": "https://www.youtube.com/watch?v=1"},
                {"webpage_url": "https://www.youtube.com/watch?v=2"},
            ],
        }
        ydl_cls.return_value.__enter__.return_value = probe

        extract_mock.side_effect = [
            ({"title": "Track 1", "webpage_url": "https://www.youtube.com/watch?v=1"}, "default"),
            ({"title": "Track 2", "webpage_url": "https://www.youtube.com/watch?v=2"}, "default"),
        ]
        finalize_mock.side_effect = [
            DownloadItem(
                source_url=options.url,
                webpage_url="https://www.youtube.com/watch?v=1",
                title="Track 1",
                uploader="Artist",
                source_site="youtube",
                media_type="audio",
                file_path=temp_dir / "track1.mp3",
                size_bytes=1,
                duration_seconds=100,
            ),
            DownloadItem(
                source_url=options.url,
                webpage_url="https://www.youtube.com/watch?v=2",
                title="Track 2",
                uploader="Artist",
                source_site="youtube",
                media_type="audio",
                file_path=temp_dir / "track2.mp3",
                size_bytes=1,
                duration_seconds=120,
            ),
        ]

        items = download_url(options)
        self.assertEqual(len(items), 2)
        self.assertEqual(extract_mock.call_count, 2)


if __name__ == "__main__":
    unittest.main()

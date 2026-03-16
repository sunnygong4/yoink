import unittest

from app import schemas
from app.services.discovery import _best_audio_format, _bilibili_results_from_html, _coerce_duration, _score_result, discovery_artwork_headers


class DiscoveryServiceTestCase(unittest.TestCase):
    def test_bilibili_html_parser_extracts_video_card(self):
        html = """
        <div class="bili-video-card">
          <div class="bili-video-card__wrap">
            <a href="//www.bilibili.com/video/BV15AZ2Y6EAM/" class="" target="_blank">
              <div class="bili-video-card__image">
                <div class="bili-video-card__image--wrap">
                  <picture class="v-img bili-video-card__cover">
                    <img src="//i1.hdslb.com/bfs/archive/example.jpg" alt="Mozart Requiem">
                  </picture>
                </div>
                <div class="bili-video-card__mask">
                  <div class="bili-video-card__stats">
                    <span class="bili-video-card__stats__duration">52:57</span>
                  </div>
                </div>
              </div>
            </a>
            <div class="bili-video-card__info">
              <div class="bili-video-card__info--right">
                <a href="//www.bilibili.com/video/BV15AZ2Y6EAM/" target="_blank">
                  <h3 class="bili-video-card__info--tit" title="Mozart Requiem"></h3>
                </a>
                <div class="bili-video-card__info--bottom">
                  <a class="bili-video-card__info--owner" href="//space.bilibili.com/3442208" target="_blank">
                    <span class="bili-video-card__info--author">Lynn</span>
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div></div></div></div>
        """
        results = _bilibili_results_from_html(html, limit=5)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["provider_id"], "BV15AZ2Y6EAM")
        self.assertEqual(results[0]["artist"], "Lynn")
        self.assertEqual(results[0]["duration_seconds"], 3177)
        self.assertEqual(results[0]["artwork_url"], "https://i1.hdslb.com/bfs/archive/example.jpg")

    def test_scoring_prefers_artist_and_title_coverage(self):
        query = "requiem mozart"
        generic = schemas.DiscoverySearchResult(
            source=schemas.DiscoverySource.soundcloud,
            source_label="SoundCloud",
            provider_id="1",
            canonical_source_url="https://soundcloud.com/example/requiem",
            title="REQUIEM",
            artist=None,
            album=None,
            duration_seconds=300,
            artwork_url=None,
        )
        matched = schemas.DiscoverySearchResult(
            source=schemas.DiscoverySource.soundcloud,
            source_label="SoundCloud",
            provider_id="2",
            canonical_source_url="https://soundcloud.com/example/requiem-mozart",
            title="Requiem in D minor",
            artist="Wolfgang Amadeus Mozart",
            album=None,
            duration_seconds=300,
            artwork_url=None,
        )
        self.assertLess(_score_result(query, matched), _score_result(query, generic))

    def test_artist_search_scoring_prefers_artist_match(self):
        query = "mozart"
        title_match = schemas.DiscoverySearchResult(
            source=schemas.DiscoverySource.youtube,
            source_label="YouTube",
            provider_id="1",
            canonical_source_url="https://example.com/title",
            title="Mozart piano sonata",
            artist="Random Performer",
            album=None,
            duration_seconds=120,
            artwork_url=None,
        )
        artist_match = schemas.DiscoverySearchResult(
            source=schemas.DiscoverySource.youtube,
            source_label="YouTube",
            provider_id="2",
            canonical_source_url="https://example.com/artist",
            title="Requiem",
            artist="Wolfgang Amadeus Mozart",
            album=None,
            duration_seconds=120,
            artwork_url=None,
        )
        self.assertLess(
            _score_result(query, artist_match, search_type=schemas.DiscoverySearchType.artist),
            _score_result(query, title_match, search_type=schemas.DiscoverySearchType.artist),
        )

    def test_song_scoring_penalizes_cover_and_lofi_noise(self):
        query = "mozart requiem"
        clean = schemas.DiscoverySearchResult(
            source=schemas.DiscoverySource.youtube,
            source_label="YouTube Music",
            provider_id="clean",
            canonical_source_url="https://example.com/clean",
            title="Mozart Requiem Lacrimosa",
            artist="Wolfgang Amadeus Mozart",
            album="Requiem",
            duration_seconds=300,
            artwork_url=None,
        )
        noisy = schemas.DiscoverySearchResult(
            source=schemas.DiscoverySource.youtube,
            source_label="YouTube Music",
            provider_id="noisy",
            canonical_source_url="https://example.com/noisy",
            title="Mozart Requiem Lofi Rock Cover",
            artist="Random Channel",
            album=None,
            duration_seconds=160,
            artwork_url=None,
        )
        self.assertLess(_score_result(query, clean), _score_result(query, noisy))

    def test_best_audio_format_prefers_direct_http_over_hls(self):
        info = {
            "formats": [
                {
                    "format_id": "hls_mp3",
                    "ext": "mp3",
                    "protocol": "m3u8_native",
                    "abr": 128,
                    "acodec": "mp3",
                    "vcodec": "none",
                    "url": "https://example.com/playlist.m3u8",
                },
                {
                    "format_id": "http_mp3",
                    "ext": "mp3",
                    "protocol": "http",
                    "abr": 128,
                    "acodec": "mp3",
                    "vcodec": "none",
                    "url": "https://example.com/audio.mp3",
                },
            ]
        }
        selected = _best_audio_format(info)
        self.assertEqual(selected["format_id"], "http_mp3")

    def test_coerce_duration_handles_numeric_strings_and_floats(self):
        self.assertEqual(_coerce_duration("245.9"), 245)
        self.assertEqual(_coerce_duration(300), 300)
        self.assertIsNone(_coerce_duration("unknown"))

    def test_discovery_artwork_headers_add_bilibili_referer(self):
        bilibili_headers = discovery_artwork_headers("https://i1.hdslb.com/bfs/archive/example.jpg")
        self.assertEqual(bilibili_headers["Referer"], "https://www.bilibili.com/")
        self.assertIn("User-Agent", bilibili_headers)

        soundcloud_headers = discovery_artwork_headers("https://i1.sndcdn.com/artworks-000000.jpg")
        self.assertNotIn("Referer", soundcloud_headers)
        self.assertIn("Accept", soundcloud_headers)


if __name__ == "__main__":
    unittest.main()

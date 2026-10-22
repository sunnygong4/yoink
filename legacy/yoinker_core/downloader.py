import logging
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Optional

import requests
from mutagen.easyid3 import EasyID3
from mutagen.id3 import APIC, ID3
from mutagen.mp3 import MP3
from yt_dlp import DownloadError, YoutubeDL


logger = logging.getLogger("yoinker.core")

DEFAULT_BROWSER_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
)


class DownloadCancelled(Exception):
    pass


@dataclass(slots=True)
class DownloadOptions:
    url: str
    output_dir: Path
    mode: str = "audio"
    allow_playlist: bool = False
    audio_bitrate_kbps: Optional[int] = 192
    video_quality: str = "best"
    ffmpeg_location: Optional[str] = None
    cookies_from_browser: Optional[str] = None
    metadata_payload: Optional[dict[str, Any]] = None


@dataclass(slots=True)
class DownloadItem:
    source_url: str
    webpage_url: str
    title: str
    uploader: str
    source_site: str
    media_type: str
    file_path: Path
    size_bytes: int
    duration_seconds: Optional[int]
    album: Optional[str] = None
    raw_title: Optional[str] = None
    raw_uploader: Optional[str] = None
    raw_album: Optional[str] = None
    metadata_status: str = "source"
    artwork_path: Optional[Path] = None


class YTDLPLogger:
    def __init__(self, name: str = "yt-dlp"):
        self._logger = logging.getLogger(name)

    def debug(self, msg):
        self._logger.debug(msg)

    def info(self, msg):
        self._logger.info(msg)

    def warning(self, msg):
        self._logger.warning(msg)

    def error(self, msg):
        self._logger.error(msg)


def sanitize(name: str) -> str:
    if not name:
        return "untitled"
    name = name.strip().replace(":", " - ")
    name = re.sub(r'[<>:"/\\|?*\x00-\x1F]', "", name)
    name = re.sub(r"\s+", " ", name)
    return name[:180] or "untitled"


def _coerce_duration_seconds(value: Any) -> int | None:
    if value in (None, "", "NA", "unknown"):
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def get_cookies_browser() -> Optional[str]:
    for browser in ("chrome", "edge", "firefox"):
        try:
            with YoutubeDL({"cookiesfrombrowser": (browser,)}) as ydl:
                del ydl
            return browser
        except Exception:
            continue
    return None


def _which_ffmpeg(ffmpeg_location: Optional[str]) -> Optional[str]:
    if ffmpeg_location:
        configured_path = Path(ffmpeg_location)
        candidates: list[Path] = []
        if configured_path.is_dir():
            candidates.extend([configured_path / "ffmpeg", configured_path / "ffmpeg.exe"])
        else:
            candidates.append(configured_path)
            if configured_path.suffix == "":
                candidates.append(configured_path.with_suffix(".exe"))
        for candidate in candidates:
            if candidate.exists():
                return str(candidate)
    return shutil.which("ffmpeg")


def _default_http_headers(source_url: str) -> dict[str, str]:
    lower_url = (source_url or "").lower()
    if "bilibili.com" in lower_url or "b23.tv" in lower_url:
        return {
            "User-Agent": DEFAULT_BROWSER_USER_AGENT,
            "Referer": "https://www.bilibili.com/",
            "Accept-Language": "en-US,en;q=0.9",
        }
    return {"User-Agent": DEFAULT_BROWSER_USER_AGENT}


def tag_mp3(
    file_path: Path,
    *,
    title: Optional[str] = None,
    artist: Optional[str] = None,
    album: Optional[str] = None,
    cover_bytes: Optional[bytes] = None,
):
    audio = MP3(file_path.as_posix(), ID3=ID3)
    if audio.tags is None:
        audio.add_tags()

    tags = EasyID3(file_path.as_posix())
    if title:
        tags["title"] = str(title)
    if artist:
        tags["artist"] = str(artist)
    if album:
        tags["album"] = str(album)
    tags.save()

    if cover_bytes:
        audio = MP3(file_path.as_posix(), ID3=ID3)
        for key in list(audio.tags.keys()):
            if key.startswith("APIC"):
                del audio.tags[key]
        audio.tags.add(
            APIC(
                encoding=3,
                mime="image/jpeg",
                type=3,
                desc="Cover",
                data=cover_bytes,
            )
        )
        audio.save()


def fetch_image_bytes(url: Optional[str]) -> Optional[bytes]:
    if not (isinstance(url, str) and url.startswith("http")):
        return None
    try:
        response = requests.get(url, timeout=20)
        if response.ok and response.content:
            return response.content
    except Exception:
        logger.exception("Image fetch failed: %s", url)
    return None


def fetch_thumbnail_bytes(info: dict) -> Optional[bytes]:
    return fetch_image_bytes(info.get("thumbnail"))


def _unique_path(path: Path) -> Path:
    if not path.exists():
        return path
    counter = 2
    while True:
        candidate = path.with_name(f"{path.stem} ({counter}){path.suffix}")
        if not candidate.exists():
            return candidate
        counter += 1


def _make_format(options: DownloadOptions) -> str:
    if options.mode == "video":
        if options.video_quality and options.video_quality.lower() != "best":
            quality_map = {
                "480p": "480",
                "720p": "720",
                "1080p": "1080",
                "1440p": "1440",
                "2160p": "2160",
            }
            height = quality_map.get(options.video_quality.lower(), "720")
            return (
                f"bestvideo[height<={height}][ext=mp4]+bestaudio[ext=m4a]/"
                f"best[height<={height}][ext=mp4]/best"
            )
        return "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"

    if options.audio_bitrate_kbps:
        return (
            f"bestaudio[ext=m4a][abr<={options.audio_bitrate_kbps}]/"
            "bestaudio[ext=m4a]/bestaudio/best"
        )
    return "bestaudio[ext=m4a]/bestaudio/best"


def _make_ydl_options(
    options: DownloadOptions,
    *,
    allow_playlist: bool,
    progress_hooks: Optional[list] = None,
    log_name: str = "yt-dlp",
    extractor_args: Optional[dict] = None,
    format_override: Optional[str] = None,
) -> dict:
    postprocessors = []
    ffmpeg_available = bool(_which_ffmpeg(options.ffmpeg_location))
    if options.mode == "audio":
        if ffmpeg_available:
            postprocessors = [
                {
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": "mp3",
                    "preferredquality": str(options.audio_bitrate_kbps or 0),
                },
                {"key": "FFmpegMetadata"},
            ]

    ydl_options = {
        "format": format_override or _make_format(options),
        "quiet": True,
        "verbose": True,
        "no_warnings": False,
        "noplaylist": not allow_playlist,
        "ignoreerrors": True,
        "logger": YTDLPLogger(log_name),
        "extractor_args": extractor_args or {},
        "retries": 3,
        "extractor_retries": 2,
        "fragment_retries": 2,
        "socket_timeout": 30,
        "nopart": True,
        "default_search": "auto",
        "postprocessors": postprocessors,
        "http_headers": _default_http_headers(options.url),
    }
    if progress_hooks:
        ydl_options["progress_hooks"] = progress_hooks
    if options.ffmpeg_location and ffmpeg_available:
        ydl_options["ffmpeg_location"] = _which_ffmpeg(options.ffmpeg_location)
    if options.cookies_from_browser:
        ydl_options["cookiesfrombrowser"] = (options.cookies_from_browser,)
    return ydl_options


def _variants_for_yt() -> list[tuple[str, dict]]:
    return [
        ("default", {}),
        ("force_m4a", {"format_override": "bestaudio[ext=m4a]/bestaudio/best"}),
        ("android_client", {"extractor_args": {"youtube": {"player_client": ["android"]}}}),
        (
            "android_m4a",
            {
                "format_override": "bestaudio[ext=m4a]/bestaudio/best",
                "extractor_args": {"youtube": {"player_client": ["android"]}},
            },
        ),
        ("tv_client", {"extractor_args": {"youtube": {"player_client": ["tv"]}}}),
        ("web_music", {"extractor_args": {"youtube": {"player_client": ["web_music"]}}}),
    ]


def _resolve_downloaded_paths(info: dict, root: Path) -> list[Path]:
    paths: list[Path] = []
    for key in ("requested_downloads", "requested_formats"):
        if info.get(key):
            for item in info[key]:
                file_path = item.get("filepath") or item.get("filename")
                if file_path:
                    paths.append(Path(file_path))
    if not paths:
        for key in ("filepath", "filename"):
            if info.get(key):
                paths.append(Path(info[key]))

    resolved: list[Path] = []
    for path in paths:
        if path.exists():
            resolved.append(path)
        else:
            candidate = root / path.name
            if candidate.exists():
                resolved.append(candidate)
    return resolved


def _extract_with_retries(url: str, options: DownloadOptions, progress_hooks: list) -> tuple[dict, str]:
    last_error: Optional[Exception] = None
    for note, extra in _variants_for_yt():
        with tempfile.TemporaryDirectory() as tmpdir:
            temp_root = Path(tmpdir)
            ydl_options = _make_ydl_options(
                options,
                allow_playlist=False,
                progress_hooks=progress_hooks,
                log_name=f"yt-dlp:{note}",
                extractor_args=extra.get("extractor_args"),
                format_override=extra.get("format_override"),
            )
            ydl_options["outtmpl"] = str(temp_root / "%(title)s.%(ext)s")
            try:
                with YoutubeDL(ydl_options) as ydl:
                    info = ydl.extract_info(url, download=True)
                if not info:
                    raise DownloadError("yt-dlp returned no metadata for this download")
                for downloaded_file in temp_root.rglob("*"):
                    if not downloaded_file.is_file():
                        continue
                    destination = options.output_dir / downloaded_file.name
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    final_path = _unique_path(destination)
                    shutil.move(str(downloaded_file), str(final_path))
                    if info.get("requested_downloads"):
                        info["requested_downloads"][0]["filepath"] = str(final_path)
                    info["filepath"] = str(final_path)
                return info, note
            except DownloadCancelled:
                raise
            except DownloadError as exc:
                last_error = exc
                logger.warning("yt-dlp variant failed (%s): %s", note, exc)
            except Exception as exc:
                last_error = exc
                logger.exception("yt-dlp variant error (%s)", note)
    raise last_error or RuntimeError("All yt-dlp variants failed")


def _ensure_mp3_from_any(source_path: Path, ffmpeg_location: Optional[str], target_dir: Path) -> Path:
    if source_path.suffix.lower() == ".mp3":
        return source_path
    ffmpeg = _which_ffmpeg(ffmpeg_location)
    if not ffmpeg:
        raise FileNotFoundError("ffmpeg not found to transcode non-mp3 audio")
    output_path = _unique_path(target_dir / f"{source_path.stem}.mp3")
    subprocess.run(
        [
            ffmpeg,
            "-y",
            "-i",
            source_path.as_posix(),
            "-vn",
            "-c:a",
            "libmp3lame",
            "-q:a",
            "0",
            output_path.as_posix(),
        ],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return output_path


def _write_artwork_sidecar(
    media_path: Path,
    cover_bytes: Optional[bytes],
    *,
    album_name: Optional[str] = None,
) -> Optional[Path]:
    if not cover_bytes:
        return None
    if album_name:
        artwork_path = media_path.parent / f"{sanitize(album_name)}.cover.jpg"
        if not artwork_path.exists():
            artwork_path.write_bytes(cover_bytes)
    else:
        artwork_path = media_path.with_name(f"{media_path.stem}.cover.jpg")
        artwork_path.write_bytes(cover_bytes)
    return artwork_path


def _progress_hook_factory(
    progress_callback: Optional[Callable[[dict], None]],
    should_cancel: Optional[Callable[[], bool]],
    *,
    item_index: int,
    item_total: int,
):
    def _hook(data: dict):
        if should_cancel and should_cancel():
            raise DownloadCancelled("Download cancelled by caller")
        if not progress_callback:
            return
        total = data.get("total_bytes") or data.get("total_bytes_estimate") or 0
        downloaded = data.get("downloaded_bytes") or 0
        file_percent = int(downloaded * 100 / total) if total else 0
        overall_percent = int(((item_index - 1) * 100 + file_percent) / max(item_total, 1))
        payload = dict(data)
        payload["item_index"] = item_index
        payload["item_total"] = item_total
        payload["percent"] = overall_percent
        progress_callback(payload)

    return _hook


def _finalize_download(info_entry: dict, options: DownloadOptions) -> DownloadItem:
    metadata_payload = options.metadata_payload or {}
    source_metadata = metadata_payload.get("source") or {}
    override_metadata = metadata_payload.get("override") or {}
    normalized_metadata = metadata_payload.get("normalized") or {}

    raw_title = (
        info_entry.get("title")
        or source_metadata.get("title")
        or normalized_metadata.get("raw_title")
        or "Untitled"
    )
    webpage_url = info_entry.get("webpage_url") or options.url
    raw_uploader = (
        info_entry.get("uploader")
        or info_entry.get("channel")
        or source_metadata.get("artist")
        or normalized_metadata.get("raw_artist")
        or "Unknown Channel"
    )
    raw_album = info_entry.get("album") or info_entry.get("playlist_title") or source_metadata.get("album")

    final_title = override_metadata.get("title") or normalized_metadata.get("title") or raw_title
    final_uploader = override_metadata.get("artist") or normalized_metadata.get("artist") or raw_uploader
    final_album = override_metadata.get("album") or normalized_metadata.get("album") or raw_album
    metadata_status = normalized_metadata.get("metadata_status") or "source"

    lower_url = webpage_url.lower()
    if "youtu" in lower_url:
        source_site = "youtube"
    elif "soundcloud" in lower_url:
        source_site = "soundcloud"
    elif "bili" in lower_url:
        source_site = "bilibili"
    else:
        source_site = "unknown"
    paths = _resolve_downloaded_paths(info_entry, options.output_dir)
    cover_bytes = fetch_image_bytes(override_metadata.get("artwork_url")) or fetch_thumbnail_bytes(info_entry)
    artwork_path: Optional[Path] = None

    if options.mode == "video":
        produced = next(
            (path for path in paths if path.suffix.lower() in (".mp4", ".mkv", ".webm")),
            None,
        )
        if not produced:
            raise FileNotFoundError("Output video not found after download.")
        extension = produced.suffix or ".mp4"
        final_path = _unique_path(options.output_dir / f"{sanitize(final_title)}{extension}")
        produced.replace(final_path)
        artwork_path = _write_artwork_sidecar(final_path, cover_bytes, album_name=final_album)
    else:
        produced = next((path for path in paths if path.suffix.lower() == ".mp3"), None)
        if not produced:
            transcode_candidate = next(
                (
                    path
                    for path in paths
                    if path.suffix.lower() in (".m4a", ".webm", ".opus", ".mp4")
                ),
                None,
            )
            if not transcode_candidate:
                raise FileNotFoundError("Output audio not found after download.")
            ffmpeg_available = bool(_which_ffmpeg(options.ffmpeg_location))
            if ffmpeg_available:
                produced = _ensure_mp3_from_any(
                    transcode_candidate,
                    options.ffmpeg_location,
                    options.output_dir,
                )
                # Remove the source file after successful transcode
                try:
                    transcode_candidate.unlink(missing_ok=True)
                except OSError:
                    logger.warning("Could not remove source file %s", transcode_candidate)
            else:
                produced = transcode_candidate

        audio_suffix = ".mp3" if produced.suffix.lower() == ".mp3" else (produced.suffix or ".m4a")
        final_path = _unique_path(options.output_dir / f"{sanitize(final_title)}{audio_suffix}")
        produced.replace(final_path)
        artwork_path = _write_artwork_sidecar(final_path, cover_bytes, album_name=final_album)
        if final_path.suffix.lower() == ".mp3":
            try:
                tag_mp3(
                    final_path,
                    title=final_title,
                    artist=final_uploader,
                    album=final_album or info_entry.get("playlist_title") or "From URL",
                    cover_bytes=cover_bytes,
                )
            except Exception:
                logger.exception("Failed to tag mp3 %s", final_path)
        else:
            logger.warning(
                "FFmpeg unavailable; keeping audio in source container for %s",
                final_path.name,
            )

    return DownloadItem(
        source_url=options.url,
        webpage_url=webpage_url,
        title=final_title,
        uploader=final_uploader,
        album=final_album,
        raw_title=raw_title,
        raw_uploader=raw_uploader,
        raw_album=raw_album,
        metadata_status=metadata_status,
        source_site=source_site,
        media_type=options.mode,
        file_path=final_path,
        artwork_path=artwork_path,
        size_bytes=final_path.stat().st_size,
        duration_seconds=_coerce_duration_seconds(info_entry.get("duration")),
    )


def download_url(
    options: DownloadOptions,
    *,
    progress_callback: Optional[Callable[[dict], None]] = None,
    should_cancel: Optional[Callable[[], bool]] = None,
) -> list[DownloadItem]:
    options.output_dir.mkdir(parents=True, exist_ok=True)
    if progress_callback:
        progress_callback({"percent": 1, "status": "Resolving source"})

    probe_options = _make_ydl_options(
        options,
        allow_playlist=options.allow_playlist,
        log_name="yt-dlp:probe",
    )
    with YoutubeDL(probe_options) as ydl:
        info = ydl.extract_info(options.url, download=False)
    if not info:
        raise DownloadError("yt-dlp returned no metadata for this URL")

    if should_cancel and should_cancel():
        raise DownloadCancelled("Download cancelled by caller")
    if progress_callback:
        progress_callback({"percent": 5, "status": "Starting download"})

    if info and info.get("_type") == "playlist" and info.get("entries") and options.allow_playlist:
        entries = [entry for entry in info["entries"] if entry]
        items: list[DownloadItem] = []
        total = len(entries) or 1
        for index, entry in enumerate(entries, start=1):
            target_url = entry.get("webpage_url") or entry.get("url")
            if not target_url:
                continue
            progress_hook = _progress_hook_factory(
                progress_callback,
                should_cancel,
                item_index=index,
                item_total=total,
            )
            downloaded_info, _variant = _extract_with_retries(target_url, options, [progress_hook])
            items.append(_finalize_download(downloaded_info, options))
        return items

    progress_hook = _progress_hook_factory(
        progress_callback,
        should_cancel,
        item_index=1,
        item_total=1,
    )
    downloaded_info, _variant = _extract_with_retries(options.url, options, [progress_hook])
    return [_finalize_download(downloaded_info, options)]

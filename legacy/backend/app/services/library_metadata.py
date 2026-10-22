from __future__ import annotations

import logging
from pathlib import Path

from mutagen.easyid3 import EasyID3
from mutagen.id3 import ID3
from mutagen.mp3 import MP3
from mutagen.mp4 import MP4


logger = logging.getLogger("yoinker.library-metadata")


def retag_media_file(
    file_path: Path,
    *,
    title: str | None = None,
    artist: str | None = None,
    album: str | None = None,
):
    suffix = file_path.suffix.lower()
    if suffix == ".mp3":
        audio = MP3(file_path.as_posix(), ID3=ID3)
        if audio.tags is None:
            audio.add_tags()
            audio.save()

        tags = EasyID3(file_path.as_posix())
        if title is not None:
            tags["title"] = [title]
        if artist is not None:
            tags["artist"] = [artist]
        if album is not None:
            tags["album"] = [album]
        tags.save()
        return

    if suffix in {".m4a", ".mp4"}:
        tags = MP4(file_path.as_posix())
        if title is not None:
            tags["\xa9nam"] = [title]
        if artist is not None:
            tags["\xa9ART"] = [artist]
        if album is not None:
            tags["\xa9alb"] = [album]
        tags.save()
        return

    logger.info("Skipping unsupported metadata retag for %s", file_path.name)

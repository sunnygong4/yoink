from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from .database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    email = Column(String, unique=True, index=True, nullable=True)
    hashed_password = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    media_files = relationship("MediaFile", back_populates="owner")
    jobs = relationship("DownloadJob", back_populates="owner")
    playlists = relationship("Playlist", back_populates="owner")
    radio_channels = relationship("RadioChannel", back_populates="owner")


class MediaFile(Base):
    __tablename__ = "media_files"

    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    job_id = Column(Integer, ForeignKey("download_jobs.id"), nullable=True, index=True)
    media_type = Column(String, nullable=False, index=True)
    relative_path = Column(String, nullable=False)
    source_url = Column(Text, nullable=False)
    source_site = Column(String, nullable=False, index=True)
    title = Column(String, nullable=False, index=True)
    uploader = Column(String, nullable=True, index=True)
    album = Column(String, nullable=True, index=True)
    raw_title = Column(String, nullable=True)
    raw_uploader = Column(String, nullable=True)
    raw_album = Column(String, nullable=True)
    metadata_status = Column(String, nullable=False, default="source", index=True)
    artwork_relative_path = Column(String, nullable=True)
    lyrics_relative_path = Column(String, nullable=True)
    size_bytes = Column(Integer, nullable=False, default=0)
    duration_seconds = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    owner = relationship("User", back_populates="media_files")
    job = relationship("DownloadJob", back_populates="media_files", foreign_keys=[job_id])
    playlist_items = relationship("PlaylistItem", back_populates="media_file")


class DownloadJob(Base):
    __tablename__ = "download_jobs"

    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    media_file_id = Column(
        Integer,
        ForeignKey("media_files.id", use_alter=True, name="fk_download_jobs_media_file_id_media_files"),
        nullable=True,
    )
    source_url = Column(Text, nullable=False)
    mode = Column(String, nullable=False, index=True)
    audio_bitrate_kbps = Column(Integer, nullable=True)
    video_quality = Column(String, nullable=True)
    allow_playlist = Column(Boolean, nullable=False, default=False)
    import_source = Column(String, nullable=True, index=True)
    metadata_overrides_json = Column(Text, nullable=True)
    enrich_metadata = Column(Boolean, nullable=False, default=True)
    download_to_device = Column(Boolean, nullable=False, default=False)
    device_downloaded = Column(Boolean, nullable=False, default=False)
    status = Column(String, nullable=False, default="queued", index=True)
    progress_percent = Column(Integer, nullable=False, default=0)
    progress_message = Column(String, nullable=True)
    error_message = Column(Text, nullable=True)
    cancel_requested = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)

    owner = relationship("User", back_populates="jobs")
    media_files = relationship(
        "MediaFile",
        back_populates="job",
        foreign_keys=[MediaFile.job_id],
    )


class Playlist(Base):
    __tablename__ = "playlists"

    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    title = Column(String, nullable=False, index=True)
    description = Column(Text, nullable=True)
    visibility = Column(String, nullable=False, default="private", index=True)
    share_token = Column(String, nullable=True, unique=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    owner = relationship("User", back_populates="playlists")
    items = relationship(
        "PlaylistItem",
        back_populates="playlist",
        order_by="PlaylistItem.position",
        cascade="all, delete-orphan",
    )
    radio_channels = relationship("RadioChannel", back_populates="playlist")


class PlaylistItem(Base):
    __tablename__ = "playlist_items"

    id = Column(Integer, primary_key=True, index=True)
    playlist_id = Column(Integer, ForeignKey("playlists.id"), nullable=False, index=True)
    media_file_id = Column(Integer, ForeignKey("media_files.id"), nullable=False, index=True)
    position = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    playlist = relationship("Playlist", back_populates="items")
    media_file = relationship("MediaFile", back_populates="playlist_items")


class RadioChannel(Base):
    __tablename__ = "radio_channels"

    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    playlist_id = Column(Integer, ForeignKey("playlists.id"), nullable=False, index=True)
    slug = Column(String, nullable=False, unique=True, index=True)
    title = Column(String, nullable=False)
    share_token = Column(String, nullable=True, unique=True, index=True)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    owner = relationship("User", back_populates="radio_channels")
    playlist = relationship("Playlist", back_populates="radio_channels")

from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


class MediaMode(str, Enum):
    audio = "audio"
    video = "video"


class DiscoverySource(str, Enum):
    youtube = "youtube"
    soundcloud = "soundcloud"
    bilibili = "bilibili"


class DiscoverySearchType(str, Enum):
    song = "song"
    artist = "artist"
    album = "album"


class SearchResponseStatus(str, Enum):
    ok = "ok"
    partial = "partial"
    timeout = "timeout"


class CatalogSearchType(str, Enum):
    song = "song"
    album = "album"
    artist = "artist"


class CatalogResultType(str, Enum):
    track = "track"
    album = "album"


class PlaylistVisibility(str, Enum):
    private = "private"
    shared_link = "shared_link"


class LibrarySort(str, Enum):
    recent = "recent"
    title = "title"
    duration = "duration"


class JobStatus(str, Enum):
    queued = "queued"
    running = "running"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"


class MetadataStatus(str, Enum):
    source = "source"
    enriched = "enriched"
    override = "override"
    enriched_override = "enriched_override"


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class TokenData(BaseModel):
    username: Optional[str] = None


class UserBase(BaseModel):
    username: str
    email: Optional[str] = None


class UserCreate(UserBase):
    password: str = Field(min_length=3)


class UserRead(UserBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime


def _normalize_duration_seconds(value):
    if value in (None, "", "NA", "unknown"):
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _normalize_optional_text(value):
    if value is None:
        return None
    text = str(value).strip()
    return text or None


class MediaFileRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    owner_id: int
    job_id: Optional[int] = None
    media_type: MediaMode
    relative_path: str
    source_url: str
    source_site: str
    title: str
    uploader: Optional[str] = None
    album: Optional[str] = None
    raw_title: Optional[str] = None
    raw_uploader: Optional[str] = None
    raw_album: Optional[str] = None
    metadata_status: MetadataStatus = MetadataStatus.source
    artwork_relative_path: Optional[str] = None
    size_bytes: int
    duration_seconds: Optional[int] = None
    created_at: datetime

    @field_validator("duration_seconds", mode="before")
    @classmethod
    def validate_duration_seconds(cls, value):
        return _normalize_duration_seconds(value)


class MediaLibraryPage(BaseModel):
    items: list[MediaFileRead] = Field(default_factory=list)
    total: int
    page: int
    page_size: int


class AlbumGroupRead(BaseModel):
    title: str
    artist: Optional[str] = None
    track_count: int
    total_duration_seconds: Optional[int] = None
    artwork_media_id: Optional[int] = None
    items: list[MediaFileRead] = Field(default_factory=list)


class CreateJobRequest(BaseModel):
    url: str
    mode: MediaMode = MediaMode.audio
    audio_bitrate_kbps: Optional[int] = Field(default=192)
    video_quality: Optional[str] = Field(default="best")
    allow_playlist: bool = False
    metadata_overrides: Optional["MetadataOverrideRequest"] = None

    @field_validator("audio_bitrate_kbps")
    @classmethod
    def validate_audio_bitrate(cls, value: Optional[int]) -> Optional[int]:
        if value is None:
            return value
        allowed = {96, 128, 160, 192, 256, 320}
        if value not in allowed:
            raise ValueError("audio_bitrate_kbps must be one of 96, 128, 160, 192, 256, 320")
        return value

    @field_validator("video_quality")
    @classmethod
    def validate_video_quality(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        normalized = value.lower()
        allowed = {"480p", "720p", "1080p", "1440p", "2160p", "best"}
        if normalized not in allowed:
            raise ValueError("video_quality must be one of 480p, 720p, 1080p, 1440p, 2160p, best")
        return normalized


class DownloadJobRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    owner_id: int
    media_file_id: Optional[int] = None
    source_url: str
    mode: MediaMode
    audio_bitrate_kbps: Optional[int] = None
    video_quality: Optional[str] = None
    allow_playlist: bool
    import_source: Optional[DiscoverySource] = None
    enrich_metadata: bool = True
    download_to_device: bool = False
    status: JobStatus
    progress_percent: int
    progress_message: Optional[str] = None
    error_message: Optional[str] = None
    cancel_requested: bool
    created_at: datetime
    updated_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    media_files: list[MediaFileRead] = Field(default_factory=list)


class CreatePlaylistRequest(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, max_length=1000)


class AddPlaylistItemRequest(BaseModel):
    media_file_id: int


class PlaylistShareRequest(BaseModel):
    enabled: bool = True
    regenerate: bool = False


class PlaylistShareRead(BaseModel):
    visibility: PlaylistVisibility
    share_token: Optional[str] = None
    share_url: Optional[str] = None


class PlaylistItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    position: int
    created_at: datetime
    media_file: MediaFileRead


class PlaylistRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    owner_id: int
    title: str
    description: Optional[str] = None
    visibility: PlaylistVisibility
    share_token: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    items: list[PlaylistItemRead] = Field(default_factory=list)


class CreateRadioRequest(BaseModel):
    playlist_id: int
    title: Optional[str] = Field(default=None, max_length=120)
    slug: Optional[str] = Field(default=None, max_length=160)
    enabled: bool = True


class RadioShareRequest(BaseModel):
    enabled: bool = True
    regenerate: bool = False


class RadioChannelRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    owner_id: int
    playlist_id: int
    slug: str
    title: str
    is_active: bool
    share_token: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class RadioChannelWithPlaylistRead(RadioChannelRead):
    playlist: PlaylistRead


class RadioShareRead(BaseModel):
    slug: str
    is_active: bool
    share_token: Optional[str] = None
    stream_url: Optional[str] = None


class LibraryHomeRead(BaseModel):
    recent_items: list[MediaFileRead] = Field(default_factory=list)
    playlists: list[PlaylistRead] = Field(default_factory=list)
    radio_channels: list[RadioChannelWithPlaylistRead] = Field(default_factory=list)


class MetadataOverrideRequest(BaseModel):
    title: Optional[str] = Field(default=None, max_length=240)
    artist: Optional[str] = Field(default=None, max_length=240)
    album: Optional[str] = Field(default=None, max_length=240)
    artwork_url: Optional[str] = Field(default=None, max_length=2048)

    @field_validator("title", "artist", "album", "artwork_url", mode="before")
    @classmethod
    def validate_optional_text(cls, value):
        return _normalize_optional_text(value)


class UpdateMediaMetadataRequest(BaseModel):
    title: Optional[str] = Field(default=None, max_length=240)
    artist: Optional[str] = Field(default=None, max_length=240)
    album: Optional[str] = Field(default=None, max_length=240)

    @field_validator("title", "artist", "album", mode="before")
    @classmethod
    def validate_optional_text(cls, value):
        return _normalize_optional_text(value)


class BulkAlbumMetadataUpdateRequest(BaseModel):
    media_ids: list[int] = Field(min_length=1)
    artist: Optional[str] = Field(default=None, max_length=240)
    album: Optional[str] = Field(default=None, max_length=240)

    @field_validator("artist", "album", mode="before")
    @classmethod
    def validate_optional_text(cls, value):
        return _normalize_optional_text(value)


class DiscoverySearchResult(BaseModel):
    source: DiscoverySource
    source_label: str
    provider_id: str
    canonical_source_url: str
    title: str
    artist: Optional[str] = None
    album: Optional[str] = None
    duration_seconds: Optional[int] = None
    artwork_url: Optional[str] = None

    @field_validator("duration_seconds", mode="before")
    @classmethod
    def validate_duration_seconds(cls, value):
        return _normalize_duration_seconds(value)


class DiscoverySearchPage(BaseModel):
    query: str
    sources: list[DiscoverySource]
    items: list[DiscoverySearchResult] = Field(default_factory=list)
    page: int
    page_size: int
    total: int


class DiscoveryVersionGroup(BaseModel):
    group_id: str
    display_title: str
    display_artist: Optional[str] = None
    artwork_url: Optional[str] = None
    confidence: float = 0.0
    selected_version: DiscoverySearchResult
    alternate_versions: list[DiscoverySearchResult] = Field(default_factory=list)


class DiscoveryVersionSearchPage(BaseModel):
    query: str
    source: DiscoverySource
    status: SearchResponseStatus = SearchResponseStatus.ok
    items: list[DiscoveryVersionGroup] = Field(default_factory=list)
    page: int
    page_size: int
    total: int


class CreateDiscoveryStreamSessionRequest(BaseModel):
    source: DiscoverySource
    canonical_source_url: str = Field(min_length=1, max_length=2048)
    title: str = Field(min_length=1, max_length=240)
    artist: Optional[str] = Field(default=None, max_length=240)
    album: Optional[str] = Field(default=None, max_length=240)
    duration_seconds: Optional[int] = None
    artwork_url: Optional[str] = Field(default=None, max_length=2048)
    provider_id: str = Field(min_length=1, max_length=240)

    @field_validator("duration_seconds", mode="before")
    @classmethod
    def validate_duration_seconds(cls, value):
        return _normalize_duration_seconds(value)


class DiscoveryStreamSessionRead(BaseModel):
    session_token: str
    expires_at: datetime
    stream_url: str
    item: DiscoverySearchResult


class CreateDiscoveryImportRequest(BaseModel):
    source: DiscoverySource
    canonical_source_url: str = Field(min_length=1, max_length=2048)
    title: str = Field(min_length=1, max_length=240)
    artist: Optional[str] = Field(default=None, max_length=240)
    album: Optional[str] = Field(default=None, max_length=240)
    duration_seconds: Optional[int] = None
    artwork_url: Optional[str] = Field(default=None, max_length=2048)
    provider_id: str = Field(min_length=1, max_length=240)
    metadata_overrides: Optional[MetadataOverrideRequest] = None
    enrich_metadata: bool = True
    download_to_device: bool = False
    audio_bitrate_kbps: Optional[int] = Field(default=192)

    @field_validator("audio_bitrate_kbps")
    @classmethod
    def validate_import_audio_bitrate(cls, value: Optional[int]) -> Optional[int]:
        if value is None:
            return value
        allowed = {96, 128, 160, 192, 256, 320}
        if value not in allowed:
            raise ValueError("audio_bitrate_kbps must be one of 96, 128, 160, 192, 256, 320")
        return value

    @field_validator("duration_seconds", mode="before")
    @classmethod
    def validate_duration_seconds(cls, value):
        return _normalize_duration_seconds(value)


class CatalogSearchResult(BaseModel):
    result_type: CatalogResultType
    catalog_id: str = Field(min_length=1, max_length=240)
    title: str
    artist: Optional[str] = None
    album: Optional[str] = None
    year: Optional[str] = None
    track_count: Optional[int] = None
    artwork_url: Optional[str] = None
    best_match: Optional[DiscoverySearchResult] = None
    alternate_matches: list[DiscoverySearchResult] = Field(default_factory=list)


class CatalogSearchPage(BaseModel):
    query: str
    secondary_query: Optional[str] = None
    search_type: CatalogSearchType
    items: list[CatalogSearchResult] = Field(default_factory=list)
    page: int
    page_size: int
    total: int


class CatalogTrackImportRequest(BaseModel):
    title: str = Field(min_length=1, max_length=240)
    artist: Optional[str] = Field(default=None, max_length=240)
    album: Optional[str] = Field(default=None, max_length=240)
    artwork_url: Optional[str] = Field(default=None, max_length=2048)
    preferred_match: Optional[CreateDiscoveryImportRequest] = None
    audio_bitrate_kbps: Optional[int] = Field(default=192)
    enrich_metadata: bool = True
    download_to_device: bool = False

    @field_validator("title", "artist", "album", "artwork_url", mode="before")
    @classmethod
    def validate_optional_text(cls, value):
        return _normalize_optional_text(value)

    @field_validator("audio_bitrate_kbps")
    @classmethod
    def validate_catalog_audio_bitrate(cls, value: Optional[int]) -> Optional[int]:
        if value is None:
            return value
        allowed = {96, 128, 160, 192, 256, 320}
        if value not in allowed:
            raise ValueError("audio_bitrate_kbps must be one of 96, 128, 160, 192, 256, 320")
        return value


class CatalogAlbumImportRequest(BaseModel):
    release_id: str = Field(min_length=1, max_length=240)
    title: str = Field(min_length=1, max_length=240)
    artist: Optional[str] = Field(default=None, max_length=240)
    artwork_url: Optional[str] = Field(default=None, max_length=2048)
    audio_bitrate_kbps: Optional[int] = Field(default=192)
    enrich_metadata: bool = True
    download_to_device: bool = False

    @field_validator("title", "artist", "artwork_url", mode="before")
    @classmethod
    def validate_album_optional_text(cls, value):
        return _normalize_optional_text(value)

    @field_validator("audio_bitrate_kbps")
    @classmethod
    def validate_album_audio_bitrate(cls, value: Optional[int]) -> Optional[int]:
        if value is None:
            return value
        allowed = {96, 128, 160, 192, 256, 320}
        if value not in allowed:
            raise ValueError("audio_bitrate_kbps must be one of 96, 128, 160, 192, 256, 320")
        return value


class CatalogAlbumImportRead(BaseModel):
    release_id: str
    title: str
    artist: Optional[str] = None
    total_tracks: int
    queued_jobs: int
    completed_jobs: int
    unmatched_tracks: list[str] = Field(default_factory=list)
    jobs: list[DownloadJobRead] = Field(default_factory=list)

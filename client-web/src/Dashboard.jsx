import { startTransition, useDeferredValue, useEffect, useRef, useState } from 'react';
import {
  Disc3,
  Home,
  Library,
  ListMusic,
  LogOut,
  Pause,
  Play,
  Radio,
  Search,
  SkipBack,
  SkipForward,
  UploadCloud,
} from 'lucide-react';
import {
  addPlaylistItem,
  cancelJob,
  createDiscoveryStreamSession,
  createJob,
  createPlaylist,
  createRadioChannel,
  deleteMedia,
  getDiscoveryArtworkUrl,
  getDiscoveryStreamUrl,
  importCatalogAlbum,
  importCatalogTrack,
  getLibraryAlbums,
  getJobs,
  getLibrary,
  getLibraryHome,
  getMediaArtworkUrl,
  getMediaStreamUrl,
  getPlaylists,
  getRadioChannels,
  getRadioStreamUrl,
  importDiscoveryResult,
  searchDiscoveryCatalog,
  searchMusicCatalog,
  searchVersionGroups,
  sharePlaylist,
  shareRadioChannel,
  updateAlbumMetadata,
  updateMediaMetadata,
} from './api';
import { useAuth } from './auth';

const NAV_ITEMS = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'library', label: 'Library', icon: Library },
  { id: 'playlists', label: 'Playlists', icon: ListMusic },
  { id: 'radio', label: 'Radio', icon: Radio },
  { id: 'yb', label: 'Y/B', icon: UploadCloud },
];

const SOURCE_OPTIONS = [
  { id: 'youtube', label: 'YouTube' },
  { id: 'soundcloud', label: 'SoundCloud' },
  { id: 'bilibili', label: 'Bilibili' },
];

const HOME_SEARCH_MODE_OPTIONS = [
  { id: 'song', label: 'Song' },
  { id: 'artist', label: 'Artist' },
  { id: 'album', label: 'Album' },
];

const MANUAL_MODE_OPTIONS = [
  { id: 'provider', label: 'Provider search' },
  { id: 'url', label: 'Direct URL' },
];

const URL_RE = /^https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be|bilibili\.com|soundcloud\.com)\//i;

function formatDuration(seconds) {
  if (!seconds) return '--:--';
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor((total % 3600) / 60);
  const hours = Math.floor(total / 3600);
  const remainder = total % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}` : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function artUrl(media, token) {
  return media.artwork_relative_path ? getMediaArtworkUrl(media.id, token) : null;
}

function trackFromMedia(media, token) {
  return {
    key: `media-${media.id}`,
    mediaType: media.media_type,
    title: media.title,
    uploader: media.uploader,
    album: media.album,
    durationSeconds: media.duration_seconds,
    sourceSite: media.source_site,
    artworkUrl: artUrl(media, token),
    streamUrl: getMediaStreamUrl(media.id, token),
  };
}

function trackFromDiscovery(session, token) {
  return {
    key: `discovery-${session.session_token}`,
    mediaType: 'audio',
    title: session.item.title,
    uploader: session.item.artist,
    album: session.item.album,
    durationSeconds: session.item.duration_seconds,
    sourceSite: session.item.source,
    artworkUrl: getDiscoveryArtworkUrl(session.item.artwork_url, token),
    streamUrl: getDiscoveryStreamUrl(session.session_token, token),
  };
}

function Artwork({ src, title, className }) {
  if (!src) {
    return (
      <div className={`grid place-items-center rounded-[1.4rem] bg-[linear-gradient(145deg,_rgba(16,185,129,0.24),_rgba(59,130,246,0.18),_rgba(10,10,10,0.92))] ${className}`}>
        <Disc3 className="h-9 w-9 text-white/80" />
      </div>
    );
  }
  return <img src={src} alt={title} className={`rounded-[1.4rem] object-cover ${className}`} />;
}

function DiscoveryCard({ item, token, busy, onPlay, onQueue, onAdd }) {
  return (
    <article className="rounded-[1.75rem] border border-white/10 bg-white/[0.04] p-4">
      <Artwork src={getDiscoveryArtworkUrl(item.artwork_url, token)} title={item.title} className="h-52 w-full" />
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="rounded-full bg-white/[0.06] px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-stone-300">{item.source_label}</p>
        <p className="text-sm text-stone-400">{formatDuration(item.duration_seconds)}</p>
      </div>
      <h3 className="mt-3 line-clamp-2 text-lg font-medium text-white">{item.title}</h3>
      <p className="mt-1 truncate text-sm text-stone-300">{item.artist || 'Unknown artist'}</p>
      <p className="mt-1 truncate text-xs uppercase tracking-[0.22em] text-stone-500">{item.album || 'Single or source metadata only'}</p>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <button type="button" onClick={onPlay} disabled={busy} className="rounded-full bg-emerald-300 px-4 py-2 text-sm font-semibold text-stone-950 disabled:opacity-60">Stream</button>
        <button type="button" onClick={onQueue} disabled={busy} className="rounded-full border border-white/15 px-4 py-2 text-sm text-stone-100 disabled:opacity-60">Queue</button>
        <button type="button" onClick={onAdd} disabled={busy} className="rounded-full border border-white/15 px-4 py-2 text-sm text-stone-100 disabled:opacity-60">Add to library</button>
      </div>
    </article>
  );
}

function CatalogTrackCard({ item, token, busy, onPlay, onAdd }) {
  return (
    <article className="rounded-[1.75rem] border border-white/10 bg-white/[0.04] p-4">
      <Artwork src={item.artwork_url || null} title={item.title} className="h-52 w-full" />
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-[11px] uppercase tracking-[0.24em] text-stone-400">Track</p>
        <p className="rounded-full bg-white/[0.06] px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-stone-300">
          {item.best_match?.source_label || 'Need match'}
        </p>
      </div>
      <h3 className="mt-2 line-clamp-2 text-lg font-medium text-white">{item.title}</h3>
      <p className="mt-1 truncate text-sm text-stone-300">{item.artist || 'Unknown artist'}</p>
      <p className="mt-1 truncate text-xs uppercase tracking-[0.22em] text-stone-500">
        {item.album || 'Standalone track'}{item.year ? ` • ${item.year}` : ''}
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={onPlay}
          disabled={busy || !item.best_match}
          className="rounded-full bg-emerald-300 px-4 py-2 text-sm font-semibold text-stone-950 disabled:opacity-50"
        >
          Preview
        </button>
        <button
          type="button"
          onClick={onAdd}
          disabled={busy || !item.best_match}
          className="rounded-full border border-white/15 px-4 py-2 text-sm text-stone-100 disabled:opacity-50"
        >
          Add to library
        </button>
      </div>
    </article>
  );
}

function VersionGroupCard({ group, token, busy, onPlay, onChoose }) {
  const alternateCount = group.alternate_versions?.length || 0;
  const totalVersions = 1 + alternateCount;
  return (
    <article className="rounded-[1.75rem] border border-white/10 bg-white/[0.04] p-4">
      <Artwork
        src={getDiscoveryArtworkUrl(group.artwork_url || group.selected_version?.artwork_url, token)}
        title={group.display_title}
        className="h-52 w-full"
      />
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-[11px] uppercase tracking-[0.24em] text-stone-400">Song match</p>
        <p className="rounded-full bg-emerald-300/15 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-emerald-100">
          Preselected: {group.selected_version?.source_label || group.selected_version?.source || 'Source'}
        </p>
      </div>
      <h3 className="mt-2 line-clamp-2 text-lg font-medium text-white">{group.display_title}</h3>
      <p className="mt-1 truncate text-sm text-stone-300">{group.display_artist || group.selected_version?.artist || 'Unknown artist'}</p>
      <p className="mt-1 truncate text-xs uppercase tracking-[0.22em] text-stone-500">
        {totalVersions} version{totalVersions === 1 ? '' : 's'} available
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={onPlay}
          disabled={busy || !group.selected_version}
          className="rounded-full bg-emerald-300 px-4 py-2 text-sm font-semibold text-stone-950 disabled:opacity-50"
        >
          Preview
        </button>
        <button
          type="button"
          onClick={onChoose}
          disabled={busy || !group.selected_version}
          className="rounded-full border border-white/15 px-4 py-2 text-sm text-stone-100 disabled:opacity-50"
        >
          Choose version
        </button>
      </div>
    </article>
  );
}

function CatalogAlbumCard({ item, token, busy, onAdd }) {
  return (
    <article className="rounded-[1.75rem] border border-white/10 bg-white/[0.04] p-4">
      <Artwork src={item.artwork_url || null} title={item.title} className="h-52 w-full" />
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-[11px] uppercase tracking-[0.24em] text-stone-400">Album</p>
        <p className="text-sm text-stone-400">{item.track_count ? `${item.track_count} tracks` : 'Track list on import'}</p>
      </div>
      <h3 className="mt-2 line-clamp-2 text-lg font-medium text-white">{item.title}</h3>
      <p className="mt-1 truncate text-sm text-stone-300">{item.artist || 'Unknown artist'}</p>
      <p className="mt-1 truncate text-xs uppercase tracking-[0.22em] text-stone-500">{item.year || 'Release year unknown'}</p>
      <div className="mt-4">
        <button
          type="button"
          onClick={onAdd}
          disabled={busy}
          className="w-full rounded-full bg-emerald-300 px-4 py-2 text-sm font-semibold text-stone-950 disabled:opacity-50"
        >
          Add album to library
        </button>
      </div>
    </article>
  );
}

function MetadataModal({ title, subtitle, fields, values, onChange, onCancel, onSave, saving }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4">
      <div className="w-full max-w-xl rounded-[2rem] border border-white/10 bg-[#101314] p-6 shadow-2xl">
        <p className="text-[11px] uppercase tracking-[0.28em] text-emerald-200/65">Metadata editor</p>
        <h3 className="mt-3 text-2xl font-semibold text-white">{title}</h3>
        {subtitle ? <p className="mt-2 text-sm text-stone-400">{subtitle}</p> : null}
        <div className="mt-6 grid gap-4">
          {fields.map((field) => (
            <label key={field.id} className="grid gap-2">
              <span className="text-sm text-stone-300">{field.label}</span>
              <input
                value={values[field.id] || ''}
                onChange={(event) => onChange(field.id, event.target.value)}
                placeholder={field.placeholder}
                className="rounded-[1.2rem] border border-white/10 bg-black/25 px-4 py-3 text-white outline-none"
              />
            </label>
          ))}
        </div>
        <div className="mt-6 flex gap-3">
          <button type="button" onClick={onCancel} className="flex-1 rounded-full border border-white/15 px-4 py-3 text-sm text-stone-200">
            Cancel
          </button>
          <button type="button" onClick={onSave} disabled={saving} className="flex-1 rounded-full bg-white px-4 py-3 text-sm font-semibold text-stone-950 disabled:bg-stone-700 disabled:text-stone-300">
            {saving ? 'Saving...' : 'Save metadata'}
          </button>
        </div>
      </div>
    </div>
  );
}

function VersionPickerModal({
  group,
  token,
  selectedVersionId,
  onSelect,
  onCancel,
  onConfirm,
  saving,
}) {
  if (!group) return null;
  const versions = [group.selected_version, ...(group.alternate_versions || [])];
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4">
      <div className="w-full max-w-3xl rounded-[2rem] border border-white/10 bg-[#101314] p-6 shadow-2xl">
        <p className="text-[11px] uppercase tracking-[0.28em] text-emerald-200/65">Choose version</p>
        <h3 className="mt-3 text-2xl font-semibold text-white">{group.display_title}</h3>
        <p className="mt-2 text-sm text-stone-400">
          {group.display_artist || 'Unknown artist'} - pick the exact version before adding it to your library.
        </p>
        <div className="mt-6 grid gap-3">
          {versions.map((version, index) => {
            const versionKey = version.canonical_source_url;
            const selected = selectedVersionId === versionKey;
            return (
              <button
                key={versionKey}
                type="button"
                onClick={() => onSelect(versionKey)}
                className={`grid gap-3 rounded-[1.4rem] border p-4 text-left ${
                  selected ? 'border-emerald-300/60 bg-emerald-300/10' : 'border-white/10 bg-black/20'
                }`}
              >
                <div className="flex items-start gap-4">
                  <Artwork
                    src={getDiscoveryArtworkUrl(version.artwork_url || group.artwork_url, token)}
                    title={version.title}
                    className="h-16 w-16 flex-none rounded-[1rem]"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-base font-medium text-white">{version.title}</p>
                      {index === 0 ? <span className="rounded-full bg-emerald-300/15 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-emerald-100">Recommended</span> : null}
                    </div>
                    <p className="mt-1 truncate text-sm text-stone-300">{version.artist || 'Unknown artist'}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.22em] text-stone-500">
                      {[version.album, version.source_label || version.source, formatDuration(version.duration_seconds)].filter(Boolean).join(' | ')}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        <div className="mt-6 flex gap-3">
          <button type="button" onClick={onCancel} className="flex-1 rounded-full border border-white/15 px-4 py-3 text-sm text-stone-200">
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={saving || !selectedVersionId} className="flex-1 rounded-full bg-white px-4 py-3 text-sm font-semibold text-stone-950 disabled:bg-stone-700 disabled:text-stone-300">
            {saving ? 'Adding...' : 'Add selected version'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { logout, token, user } = useAuth();
  const audioRef = useRef(null);
  const videoRef = useRef(null);

  const [view, setView] = useState('home');
  const [homeSearchMode, setHomeSearchMode] = useState('song');
  const [homeSource, setHomeSource] = useState('youtube');
  const [manualMode, setManualMode] = useState('provider');
  const [selectedSource, setSelectedSource] = useState('youtube');
  const [homeCommand, setHomeCommand] = useState('');
  const [homeSecondaryCommand, setHomeSecondaryCommand] = useState('');
  const [manualCommand, setManualCommand] = useState('');
  const [manualSecondaryCommand, setManualSecondaryCommand] = useState('');
  const [mode, setMode] = useState('audio');
  const [audioBitrate, setAudioBitrate] = useState('192');
  const [videoQuality, setVideoQuality] = useState('best');
  const [allowPlaylist, setAllowPlaylist] = useState(false);
  const [librarySort, setLibrarySort] = useState('recent');
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [discoveryBusyKey, setDiscoveryBusyKey] = useState('');
  const [deletingMediaId, setDeletingMediaId] = useState(null);

  const [jobs, setJobs] = useState([]);
  const [homeData, setHomeData] = useState({ recent_items: [], playlists: [], radio_channels: [] });
  const [libraryPage, setLibraryPage] = useState({ items: [], total: 0, page: 1, page_size: 18 });
  const [albumGroups, setAlbumGroups] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [radioChannels, setRadioChannels] = useState([]);
  const [catalogPage, setCatalogPage] = useState({ items: [], total: 0, page: 1, page_size: 8 });
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [versionPage, setVersionPage] = useState({ items: [], total: 0, page: 1, page_size: 8, status: 'ok' });
  const [versionLoading, setVersionLoading] = useState(false);
  const [discoveryPage, setDiscoveryPage] = useState({ items: [], total: 0, page: 1, page_size: 12 });
  const [discoveryLoading, setDiscoveryLoading] = useState(false);

  const [playlistTitle, setPlaylistTitle] = useState('');
  const [playlistDescription, setPlaylistDescription] = useState('');
  const [playlistSelections, setPlaylistSelections] = useState({});
  const [editingTrack, setEditingTrack] = useState(null);
  const [trackMetadataForm, setTrackMetadataForm] = useState({ title: '', artist: '', album: '' });
  const [editingAlbum, setEditingAlbum] = useState(null);
  const [albumMetadataForm, setAlbumMetadataForm] = useState({ album: '', artist: '' });
  const [savingMetadata, setSavingMetadata] = useState(false);
  const [overrideTitle, setOverrideTitle] = useState('');
  const [overrideArtist, setOverrideArtist] = useState('');
  const [overrideAlbum, setOverrideAlbum] = useState('');
  const [queue, setQueue] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionSeconds, setPositionSeconds] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [volume, setVolume] = useState(0.9);
  const [versionPickerGroup, setVersionPickerGroup] = useState(null);
  const [selectedVersionId, setSelectedVersionId] = useState('');

  const deferredHomeCommand = useDeferredValue(homeCommand);
  const deferredHomeSecondaryCommand = useDeferredValue(homeSecondaryCommand);
  const deferredManualCommand = useDeferredValue(manualCommand);
  const deferredManualSecondaryCommand = useDeferredValue(manualSecondaryCommand);
  const trimmedHomeCommand = deferredHomeCommand.trim();
  const trimmedHomeSecondaryCommand = deferredHomeSecondaryCommand.trim();
  const trimmedManualCommand = deferredManualCommand.trim();
  const trimmedManualSecondaryCommand = deferredManualSecondaryCommand.trim();
  const urlMode = manualMode === 'url';
  const validUrlInput = URL_RE.test(trimmedManualCommand);
  const catalogQuery = view === 'home' ? trimmedHomeCommand : '';
  const discoveryQuery = view === 'yb' && manualMode === 'provider' ? trimmedManualCommand : '';
  const activeTrack = queue[currentIndex] || null;
  const totalPages = Math.max(1, Math.ceil((libraryPage.total || 0) / (libraryPage.page_size || 18)));

  const refresh = async () => {
    try {
      const params = { page, page_size: 18, sort: librarySort };
      const [jobsData, homeResponse, libraryResponse, albumsResponse, playlistsResponse, radioResponse] = await Promise.all([
        getJobs(),
        getLibraryHome(),
        getLibrary(params),
        getLibraryAlbums(),
        getPlaylists(),
        getRadioChannels(),
      ]);
      startTransition(() => {
        setJobs(jobsData);
        setHomeData(homeResponse);
        setLibraryPage(libraryResponse);
        setAlbumGroups(albumsResponse);
        setPlaylists(playlistsResponse);
        setRadioChannels(radioResponse);
      });
    } catch (error) {
      console.error(error);
      setMessage(error?.response?.data?.detail || 'Failed to refresh your library.');
    }
  };

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 6000);
    return () => window.clearInterval(timer);
  }, [page, librarySort]);

  useEffect(() => {
    let cancelled = false;
    if (!catalogQuery) {
      setCatalogPage({ items: [], total: 0, page: 1, page_size: 8 });
      setCatalogLoading(false);
      setVersionPage({ items: [], total: 0, page: 1, page_size: 8, status: 'ok' });
      setVersionLoading(false);
      return undefined;
    }
    if (homeSearchMode === 'song') {
      setVersionLoading(true);
      searchVersionGroups({
        q: catalogQuery,
        artist_hint: trimmedHomeSecondaryCommand || undefined,
        source: homeSource,
        page: 1,
        page_size: 8,
      }).then((response) => {
        if (!cancelled) {
          setVersionPage(response);
        }
      }).catch((error) => {
        console.error(error);
        if (!cancelled) {
          setMessage(error?.response?.data?.detail || 'Version search failed.');
        }
      }).finally(() => {
        if (!cancelled) {
          setVersionLoading(false);
        }
      });
      return () => {
        cancelled = true;
      };
    }
    setCatalogLoading(true);
    searchMusicCatalog({
      q: catalogQuery,
      secondary_q: trimmedHomeSecondaryCommand || undefined,
      search_type: homeSearchMode,
      page: 1,
      page_size: 8,
    }).then((response) => {
      if (!cancelled) {
        setCatalogPage(response);
      }
    }).catch((error) => {
      console.error(error);
      if (!cancelled) {
        setMessage(error?.response?.data?.detail || 'Music search failed.');
      }
    }).finally(() => {
      if (!cancelled) {
        setCatalogLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [catalogQuery, trimmedHomeSecondaryCommand, homeSearchMode, homeSource]);

  useEffect(() => {
    let cancelled = false;
    if (!discoveryQuery) {
      setDiscoveryPage({ items: [], total: 0, page: 1, page_size: 12 });
      setDiscoveryLoading(false);
      return undefined;
    }
    setDiscoveryLoading(true);
    searchDiscoveryCatalog({
      q: discoveryQuery,
      secondary_q: trimmedManualSecondaryCommand || undefined,
      search_type: 'song',
      sources: selectedSource,
      page: 1,
      page_size: 12,
    }).then((response) => {
      if (!cancelled) {
        setDiscoveryPage(response);
      }
    }).catch((error) => {
      console.error(error);
      if (!cancelled) {
        setMessage(error?.response?.data?.detail || 'Provider discovery search failed.');
      }
    }).finally(() => {
      if (!cancelled) {
        setDiscoveryLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [discoveryQuery, trimmedManualSecondaryCommand, selectedSource, manualMode]);

  useEffect(() => {
    setPositionSeconds(0);
    setDurationSeconds(activeTrack?.durationSeconds || 0);
    const media = activeTrack?.mediaType === 'video' ? videoRef.current : audioRef.current;
    if (!activeTrack || !media) return;
    media.volume = volume;
    media.play().catch((error) => {
      console.error(error);
      setIsPlaying(false);
      setMessage('Playback could not start. Try another source or add the track to your library.');
    });
  }, [activeTrack?.key]);

  useEffect(() => {
    setPage(1);
  }, [librarySort]);

  const handlePlaybackError = () => {
    setIsPlaying(false);
    setMessage('This stream could not be played. Try another source or add the track to your library first.');
  };

  const homePrimaryPlaceholder = (
    homeSearchMode === 'artist'
      ? 'Search by artist name'
      : homeSearchMode === 'album'
        ? 'Search by album title'
        : 'Search by song title'
  );

  const homeSecondaryPlaceholder = (
    homeSearchMode === 'artist'
      ? 'Optional album hint'
      : 'Optional artist name'
  );

  const manualPrimaryPlaceholder = (
    manualMode === 'url'
      ? 'Paste a YouTube, SoundCloud, or Bilibili URL'
      : 'Search directly on a provider'
  );

  const manualSecondaryPlaceholder = manualMode === 'provider'
    ? 'Optional artist name'
    : '';

  const queueTracks = (tracks, startIndex = 0) => {
    if (!tracks.length) return;
    setQueue(tracks);
    setCurrentIndex(startIndex);
  };

  const appendTrack = (track) => {
    setQueue((current) => [...current, track]);
  };

  const seekTo = (nextValue) => {
    const media = activeTrack?.mediaType === 'video' ? videoRef.current : audioRef.current;
    if (!media) return;
    media.currentTime = nextValue;
    setPositionSeconds(nextValue);
  };

  const togglePlayback = () => {
    const media = activeTrack?.mediaType === 'video' ? videoRef.current : audioRef.current;
    if (!media) return;
    if (media.paused) media.play().catch(console.error);
    else media.pause();
  };

  const addToPlaylist = async (mediaId) => {
    const playlistId = Number(playlistSelections[mediaId] || playlists[0]?.id);
    if (!playlistId) {
      setMessage('Create a playlist first.');
      return;
    }
    try {
      await addPlaylistItem(playlistId, mediaId);
      setMessage('Added to playlist.');
      refresh();
    } catch (error) {
      console.error(error);
      setMessage(error?.response?.data?.detail || 'Failed to add to playlist.');
    }
  };

  const playCatalogResult = async (item) => {
    if (!item.best_match) {
      setMessage('Yoinker could not find a preview source for this result yet.');
      return;
    }
    await playDiscoveryResult(item.best_match);
  };

  const addCatalogTrackToLibrary = async (item) => {
    const busyKey = `catalog-track:${item.catalog_id}`;
    setDiscoveryBusyKey(busyKey);
    try {
      const job = await importCatalogTrack({
        title: item.title,
        artist: item.artist,
        album: item.album,
        artwork_url: item.artwork_url,
        preferred_match: item.best_match
          ? {
              source: item.best_match.source,
              canonical_source_url: item.best_match.canonical_source_url,
              title: item.best_match.title,
              artist: item.best_match.artist,
              album: item.best_match.album,
              duration_seconds: item.best_match.duration_seconds,
              artwork_url: item.best_match.artwork_url,
              provider_id: item.best_match.provider_id,
              audio_bitrate_kbps: Number(audioBitrate),
              enrich_metadata: true,
              download_to_device: false,
            }
          : undefined,
        audio_bitrate_kbps: Number(audioBitrate),
        enrich_metadata: true,
      });
      setMessage(
        job.status === 'completed'
          ? `${item.title} is already in your library.`
          : `Adding ${item.title} to your server library.`,
      );
      refresh();
    } catch (error) {
      console.error(error);
      setMessage(error?.response?.data?.detail || 'Could not add this track to your library.');
    } finally {
      setDiscoveryBusyKey('');
    }
  };

  const addCatalogAlbumToLibrary = async (item) => {
    const busyKey = `catalog-album:${item.catalog_id}`;
    setDiscoveryBusyKey(busyKey);
    try {
      const result = await importCatalogAlbum({
        release_id: item.catalog_id,
        title: item.title,
        artist: item.artist,
        artwork_url: item.artwork_url,
        audio_bitrate_kbps: Number(audioBitrate),
        enrich_metadata: true,
      });
      if (result.unmatched_tracks?.length) {
        setMessage(`Queued ${result.queued_jobs + result.completed_jobs} tracks from ${item.title}. ${result.unmatched_tracks.length} tracks still need manual help.`);
      } else {
        setMessage(`Added ${item.title} to your server library queue.`);
      }
      refresh();
    } catch (error) {
      console.error(error);
      setMessage(error?.response?.data?.detail || 'Could not add this album to your library.');
    } finally {
      setDiscoveryBusyKey('');
    }
  };

  const playDiscoveryResult = async (item, queueOnly = false) => {
    const busyKey = `${item.source}:${item.provider_id}:stream`;
    setDiscoveryBusyKey(busyKey);
    try {
      const session = await createDiscoveryStreamSession({
        source: item.source,
        canonical_source_url: item.canonical_source_url,
        title: item.title,
        artist: item.artist,
        album: item.album,
        duration_seconds: item.duration_seconds,
        artwork_url: item.artwork_url,
        provider_id: item.provider_id,
      });
      const track = trackFromDiscovery(session, token);
      if (queueOnly) appendTrack(track);
      else queueTracks([track], 0);
      setMessage(queueOnly ? `Queued ${item.title}` : `Streaming ${item.title}`);
    } catch (error) {
      console.error(error);
      setMessage(error?.response?.data?.detail || 'Could not start discovery stream.');
    } finally {
      setDiscoveryBusyKey('');
    }
  };

  const addDiscoveryResultToLibrary = async (item) => {
    const busyKey = `${item.source}:${item.provider_id}:import`;
    setDiscoveryBusyKey(busyKey);
    try {
      const job = await importDiscoveryResult({
        source: item.source,
        canonical_source_url: item.canonical_source_url,
        title: item.title,
        artist: item.artist,
        album: item.album,
        duration_seconds: item.duration_seconds,
        artwork_url: item.artwork_url,
        provider_id: item.provider_id,
        enrich_metadata: true,
        audio_bitrate_kbps: Number(audioBitrate),
      });
      if (job.status === 'completed') {
        setMessage(`${item.title} is already in your library.`);
      } else {
        setMessage(`Added ${item.title} to your server queue.`);
      }
      refresh();
    } catch (error) {
      console.error(error);
      setMessage(error?.response?.data?.detail || 'Could not import this discovery result.');
    } finally {
      setDiscoveryBusyKey('');
    }
  };

  const submitManualUrl = async (event) => {
    event.preventDefault();
    if (!trimmedManualCommand) return;
    if (!validUrlInput) {
      setMessage('That does not look like a supported YouTube, SoundCloud, or Bilibili URL.');
      return;
    }

    setSubmitting(true);
    try {
      const job = await createJob({
        url: trimmedManualCommand,
        mode,
        allow_playlist: allowPlaylist,
        audio_bitrate_kbps: mode === 'audio' ? Number(audioBitrate) : undefined,
        video_quality: mode === 'video' ? videoQuality : undefined,
        metadata_overrides: (overrideTitle || overrideArtist || overrideAlbum) ? {
          title: overrideTitle || undefined,
          artist: overrideArtist || undefined,
          album: overrideAlbum || undefined,
        } : undefined,
      });
      setManualCommand('');
      setOverrideTitle('');
      setOverrideArtist('');
      setOverrideAlbum('');
      if (job.status === 'completed') {
        setMessage('That track is already in your server library.');
      } else {
        setMessage('Added to your server library. The worker will finish the job in the background.');
      }
      refresh();
    } catch (error) {
      console.error(error);
      setMessage(error?.response?.data?.detail || 'Failed to queue this URL.');
    } finally {
      setSubmitting(false);
    }
  };

  const deleteLibraryMedia = async (media) => {
    if (!window.confirm(`Delete "${media.title}" from your library?`)) return;
    setDeletingMediaId(media.id);
    try {
      await deleteMedia(media.id);
      setQueue((current) => current.filter((track) => track.key !== `media-${media.id}`));
      setCurrentIndex(0);
      setMessage(`Deleted ${media.title} from your library.`);
      refresh();
    } catch (error) {
      console.error(error);
      setMessage(error?.response?.data?.detail || 'Failed to delete this track.');
    } finally {
      setDeletingMediaId(null);
    }
  };

  const openTrackMetadataEditor = (media) => {
    setEditingTrack(media);
    setTrackMetadataForm({
      title: media.title || '',
      artist: media.uploader || '',
      album: media.album || '',
    });
  };

  const openAlbumMetadataEditor = (albumGroup) => {
    setEditingAlbum(albumGroup);
    setAlbumMetadataForm({
      album: albumGroup.title || '',
      artist: albumGroup.artist || '',
    });
  };

  const saveTrackMetadata = async () => {
    if (!editingTrack) return;
    setSavingMetadata(true);
    try {
      await updateMediaMetadata(editingTrack.id, {
        title: trackMetadataForm.title,
        artist: trackMetadataForm.artist,
        album: trackMetadataForm.album,
      });
      setEditingTrack(null);
      setMessage('Track metadata updated.');
      refresh();
    } catch (error) {
      console.error(error);
      setMessage(error?.response?.data?.detail || 'Failed to update this track.');
    } finally {
      setSavingMetadata(false);
    }
  };

  const saveAlbumMetadata = async () => {
    if (!editingAlbum) return;
    setSavingMetadata(true);
    try {
      await updateAlbumMetadata({
        media_ids: editingAlbum.items.map((item) => item.id),
        album: albumMetadataForm.album,
        artist: albumMetadataForm.artist,
      });
      setEditingAlbum(null);
      setMessage('Album metadata updated.');
      refresh();
    } catch (error) {
      console.error(error);
      setMessage(error?.response?.data?.detail || 'Failed to update this album.');
    } finally {
      setSavingMetadata(false);
    }
  };

  const filteredPlaylists = playlists;
  const filteredRadio = radioChannels;

  const catalogSection = catalogQuery ? (
    <section className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.32em] text-emerald-200/65">Music catalog</p>
          <h2 className="mt-2 text-3xl font-semibold text-white">Results for "{catalogQuery}"</h2>
          <p className="mt-2 text-sm text-stone-400">Search music like a library app, then let Yoinker pull and store the best version on your server.</p>
        </div>
        <p className="text-sm text-stone-400">{catalogPage.total || 0} result{(catalogPage.total || 0) === 1 ? '' : 's'}</p>
      </div>
      {catalogLoading ? <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] px-5 py-8 text-center text-sm text-stone-300">Searching the music catalog...</div> : null}
      {!catalogLoading && catalogPage.items.length === 0 ? <div className="rounded-[1.5rem] border border-dashed border-white/10 px-5 py-10 text-center text-sm text-stone-400">No matches yet. Try a different title, artist, or album search.</div> : null}
      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {catalogPage.items.map((item) => (
          item.result_type === 'track' ? (
            <CatalogTrackCard
              key={`catalog-track-${item.catalog_id}`}
              item={item}
              token={token}
              busy={discoveryBusyKey === `catalog-track:${item.catalog_id}`}
              onPlay={() => playCatalogResult(item)}
              onAdd={() => addCatalogTrackToLibrary(item)}
            />
          ) : (
            <CatalogAlbumCard
              key={`catalog-album-${item.catalog_id}`}
              item={item}
              token={token}
              busy={discoveryBusyKey === `catalog-album:${item.catalog_id}`}
              onAdd={() => addCatalogAlbumToLibrary(item)}
            />
          )
        ))}
      </div>
    </section>
  ) : null;

  const manualDiscoverySection = discoveryQuery ? (
    <section className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.32em] text-emerald-200/65">Provider tools</p>
          <h2 className="mt-2 text-3xl font-semibold text-white">Results for "{discoveryQuery}"</h2>
          <p className="mt-2 text-sm text-stone-400">Manual provider search is a secondary utility for YouTube, SoundCloud, and Bilibili imports.</p>
        </div>
        <p className="text-sm text-stone-400">{discoveryPage.total || 0} result{(discoveryPage.total || 0) === 1 ? '' : 's'} from {SOURCE_OPTIONS.find((source) => source.id === selectedSource)?.label || selectedSource}</p>
      </div>
      {discoveryLoading ? <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] px-5 py-8 text-center text-sm text-stone-300">Searching {SOURCE_OPTIONS.find((source) => source.id === selectedSource)?.label || selectedSource}...</div> : null}
      {!discoveryLoading && discoveryPage.items.length === 0 ? <div className="rounded-[1.5rem] border border-dashed border-white/10 px-5 py-10 text-center text-sm text-stone-400">No provider matches yet. Try a different title or artist.</div> : null}
      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {discoveryPage.items.map((item) => {
          const streamBusy = discoveryBusyKey === `${item.source}:${item.provider_id}:stream`;
          const importBusy = discoveryBusyKey === `${item.source}:${item.provider_id}:import`;
          return (
            <DiscoveryCard
              key={`${item.source}-${item.provider_id}`}
              item={item}
              token={token}
              busy={streamBusy || importBusy}
              onPlay={() => playDiscoveryResult(item)}
              onQueue={() => playDiscoveryResult(item, true)}
              onAdd={() => addDiscoveryResultToLibrary(item)}
            />
          );
        })}
      </div>
    </section>
  ) : null;

  let mainSection = (
    <div className="space-y-8">
      {catalogSection}
      <section className="rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.22),_transparent_42%),radial-gradient(circle_at_right,_rgba(59,130,246,0.18),_transparent_38%),linear-gradient(145deg,_rgba(12,10,9,0.98),_rgba(24,24,27,0.96))] p-7">
        <div className="grid gap-4 lg:grid-cols-3">
          {[
            ['Search', catalogQuery ? catalogPage.total : 0, 'Canonical song and album matches'],
            ['Recent', homeData.recent_items.length, 'Fresh additions from your server'],
            ['Playlists', playlists.length, 'Private or shared listening rooms'],
          ].map(([label, value, note]) => (
            <div key={label} className="rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-5">
              <p className="text-[11px] uppercase tracking-[0.28em] text-stone-400">{label}</p>
              <p className="mt-3 text-3xl font-semibold text-white">{value}</p>
              <p className="mt-2 text-sm text-stone-400">{note}</p>
            </div>
          ))}
        </div>
      </section>
      <section>
        <p className="text-[11px] uppercase tracking-[0.32em] text-emerald-200/65">Recently added</p>
        <h2 className="mt-2 text-3xl font-semibold text-white">Fresh in your library</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {homeData.recent_items.slice(0, 8).map((media) => (
            <article key={media.id} className="rounded-[1.75rem] border border-white/10 bg-white/[0.04] p-4">
              <Artwork src={artUrl(media, token)} title={media.title} className="h-48 w-full" />
              <p className="mt-4 text-[11px] uppercase tracking-[0.24em] text-stone-400">{media.source_site}</p>
              <h3 className="mt-2 truncate text-lg font-medium text-white">{media.title}</h3>
              <p className="mt-1 truncate text-sm text-stone-400">{media.uploader || 'Unknown uploader'}</p>
              <div className="mt-4 flex gap-2">
                <button type="button" onClick={() => queueTracks([trackFromMedia(media, token)], 0)} className="flex-1 rounded-full bg-emerald-300 px-4 py-2 text-sm font-semibold text-stone-950">Play</button>
                <button type="button" onClick={() => appendTrack(trackFromMedia(media, token))} className="rounded-full border border-white/15 px-4 py-2 text-sm text-stone-100">Queue</button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );

  if (view === 'yb') {
    mainSection = (
      <section className="space-y-6">
        <section className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-6">
          <p className="text-[11px] uppercase tracking-[0.32em] text-emerald-200/65">Y/B utility</p>
          <h2 className="mt-2 text-3xl font-semibold text-white">Manual provider imports</h2>
          <p className="mt-2 text-sm text-stone-400">Use this secondary area for provider-first searching or direct YouTube, SoundCloud, and Bilibili URLs.</p>
        </section>
        {manualDiscoverySection}
      </section>
    );
  } else if (view === 'library') {
    mainSection = (
      <section className="space-y-6">
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.32em] text-emerald-200/65">Albums</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">Album groups from your library</h2>
            </div>
            <p className="text-sm text-stone-400">{albumGroups.length} album{albumGroups.length === 1 ? '' : 's'}</p>
          </div>
          {albumGroups.length === 0 ? <div className="rounded-[1.5rem] border border-dashed border-white/10 px-5 py-8 text-center text-sm text-stone-400">Import an album or playlist URL and the grouped album view will appear here.</div> : null}
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {albumGroups.map((albumGroup) => (
              <article key={`${albumGroup.title}-${albumGroup.artist || 'unknown'}`} className="rounded-[1.75rem] border border-white/10 bg-white/[0.04] p-4">
                <Artwork src={albumGroup.artwork_media_id ? getMediaArtworkUrl(albumGroup.artwork_media_id, token) : null} title={albumGroup.title} className="h-44 w-full" />
                <p className="mt-4 text-[11px] uppercase tracking-[0.24em] text-stone-400">{albumGroup.track_count} track{albumGroup.track_count === 1 ? '' : 's'}</p>
                <h3 className="mt-2 truncate text-lg font-medium text-white">{albumGroup.title}</h3>
                <p className="mt-1 truncate text-sm text-stone-400">{albumGroup.artist || 'Unknown artist'}</p>
                <p className="mt-1 text-sm text-stone-500">{formatDuration(albumGroup.total_duration_seconds)}</p>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <button type="button" onClick={() => queueTracks(albumGroup.items.map((item) => trackFromMedia(item, token)), 0)} className="rounded-full bg-emerald-300 px-4 py-2 text-sm font-semibold text-stone-950">Play album</button>
                  <button type="button" onClick={() => openAlbumMetadataEditor(albumGroup)} className="rounded-full border border-white/15 px-4 py-2 text-sm text-stone-100">Edit album</button>
                </div>
              </article>
            ))}
          </div>
        </section>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.32em] text-emerald-200/65">Library</p>
            <h2 className="mt-2 text-3xl font-semibold text-white">Your saved collection</h2>
          </div>
          <select value={librarySort} onChange={(event) => setLibrarySort(event.target.value)} className="rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-sm text-white">
            <option value="recent">Recently added</option>
            <option value="title">Title A-Z</option>
            <option value="duration">Longest first</option>
          </select>
        </div>
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {libraryPage.items.map((media) => (
            <article key={media.id} className="rounded-[1.75rem] border border-white/10 bg-white/[0.04] p-4">
              <Artwork src={artUrl(media, token)} title={media.title} className="h-52 w-full" />
              <div className="mt-4 flex items-center justify-between gap-3">
                <p className="text-[11px] uppercase tracking-[0.24em] text-stone-400">{media.source_site}</p>
                <p className="rounded-full bg-white/[0.06] px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-stone-300">{media.metadata_status}</p>
              </div>
              <h3 className="mt-2 truncate text-lg font-medium text-white">{media.title}</h3>
              <p className="mt-1 truncate text-sm text-stone-400">{media.uploader || 'Unknown uploader'}</p>
              <p className="mt-1 truncate text-xs uppercase tracking-[0.22em] text-stone-500">{media.album || 'No album metadata'}</p>
              <p className="mt-3 text-sm text-stone-400">{formatDuration(media.duration_seconds)}</p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <button type="button" onClick={() => queueTracks([trackFromMedia(media, token)], 0)} className="rounded-full bg-emerald-300 px-4 py-2 text-sm font-semibold text-stone-950">Play</button>
                <button type="button" onClick={() => appendTrack(trackFromMedia(media, token))} className="rounded-full border border-white/15 px-4 py-2 text-sm text-stone-100">Queue</button>
              </div>
              <div className="mt-4 flex gap-2">
                <select value={playlistSelections[media.id] || playlists[0]?.id || ''} onChange={(event) => setPlaylistSelections((current) => ({ ...current, [media.id]: event.target.value }))} className="min-w-0 flex-1 rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-sm text-white">
                  {playlists.length === 0 ? <option value="">Create a playlist first</option> : playlists.map((playlist) => <option key={playlist.id} value={playlist.id}>{playlist.title}</option>)}
                </select>
                <button type="button" onClick={() => addToPlaylist(media.id)} className="rounded-full border border-white/15 px-4 py-2 text-sm text-stone-100">Add</button>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <button type="button" onClick={() => openTrackMetadataEditor(media)} className="rounded-full border border-white/15 px-4 py-2 text-sm text-stone-100">Edit metadata</button>
                <button type="button" onClick={() => deleteLibraryMedia(media)} disabled={deletingMediaId === media.id} className="rounded-full border border-red-400/25 px-4 py-2 text-sm text-red-100 disabled:opacity-60">
                  {deletingMediaId === media.id ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </article>
          ))}
        </div>
        <div className="flex items-center justify-between rounded-[1.5rem] border border-white/10 bg-white/[0.04] px-5 py-4 text-sm text-stone-300">
          <p>Page {page} of {totalPages}</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1} className="rounded-full border border-white/10 px-4 py-2 disabled:opacity-40">Prev</button>
            <button type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page >= totalPages} className="rounded-full border border-white/10 px-4 py-2 disabled:opacity-40">Next</button>
          </div>
        </div>
      </section>
    );
  }
  else if (view === 'playlists') {
    mainSection = (
      <section className="space-y-6">
        <form onSubmit={async (event) => {
          event.preventDefault();
          if (!playlistTitle.trim()) return;
          await createPlaylist({ title: playlistTitle.trim(), description: playlistDescription.trim() || undefined });
          setPlaylistTitle('');
          setPlaylistDescription('');
          setMessage('Playlist created.');
          refresh();
        }} className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-6">
          <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr_auto] lg:items-end">
            <input value={playlistTitle} onChange={(event) => setPlaylistTitle(event.target.value)} placeholder="Playlist title" className="rounded-[1.2rem] border border-white/10 bg-black/20 px-4 py-3 text-white outline-none" />
            <input value={playlistDescription} onChange={(event) => setPlaylistDescription(event.target.value)} placeholder="Description" className="rounded-[1.2rem] border border-white/10 bg-black/20 px-4 py-3 text-white outline-none" />
            <button type="submit" className="rounded-full bg-white px-5 py-3 text-sm font-semibold text-stone-950">Create</button>
          </div>
        </form>
        <div className="grid gap-5 xl:grid-cols-2">
          {filteredPlaylists.map((playlist) => (
            <article key={playlist.id} className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-5">
              <h3 className="text-2xl font-semibold text-white">{playlist.title}</h3>
              <p className="mt-2 text-sm text-stone-400">{playlist.description || 'No description yet.'}</p>
              <p className="mt-2 text-xs uppercase tracking-[0.24em] text-stone-400">{playlist.items.length} tracks</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={() => queueTracks((playlist.items || []).map((item) => trackFromMedia(item.media_file, token)), 0)} className="rounded-full bg-emerald-300 px-4 py-2 text-sm font-semibold text-stone-950">Play</button>
                <button type="button" onClick={() => sharePlaylist(playlist.id, { enabled: playlist.visibility !== 'shared_link' }).then(refresh)} className="rounded-full border border-white/15 px-4 py-2 text-sm text-stone-100">{playlist.visibility === 'shared_link' ? 'Disable share' : 'Share link'}</button>
                <button type="button" onClick={() => createRadioChannel({ playlist_id: playlist.id, title: `${playlist.title} Radio` }).then(refresh)} className="rounded-full border border-white/15 px-4 py-2 text-sm text-stone-100">Create radio</button>
              </div>
            </article>
          ))}
        </div>
      </section>
    );
  } else if (view === 'radio') {
    mainSection = (
      <section className="grid gap-5 xl:grid-cols-2">
        {filteredRadio.map((radioChannel) => (
          <article key={radioChannel.id} className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-5">
            <p className="text-[11px] uppercase tracking-[0.28em] text-stone-400">{radioChannel.slug}</p>
            <h3 className="mt-2 text-2xl font-semibold text-white">{radioChannel.title}</h3>
            <p className="mt-2 text-sm text-stone-400">{radioChannel.playlist?.title || 'Linked playlist'}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => shareRadioChannel(radioChannel.id, { enabled: !radioChannel.is_active }).then(refresh)} className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-stone-950">{radioChannel.is_active ? 'Disable' : 'Enable'}</button>
              {radioChannel.share_token ? <button type="button" onClick={() => navigator.clipboard.writeText(getRadioStreamUrl(radioChannel.slug, radioChannel.share_token))} className="rounded-full border border-white/15 px-4 py-2 text-sm text-stone-100">Copy HLS URL</button> : null}
            </div>
          </article>
        ))}
      </section>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.14),_transparent_28%),radial-gradient(circle_at_right,_rgba(59,130,246,0.16),_transparent_24%),linear-gradient(180deg,_#09090b_0%,_#050507_100%)] pb-36 text-stone-100">
      <audio
        ref={audioRef}
        key={activeTrack?.mediaType === 'audio' ? activeTrack.key : 'audio-idle'}
        src={activeTrack?.mediaType === 'audio' ? activeTrack.streamUrl : undefined}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={(event) => setPositionSeconds(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => setDurationSeconds(event.currentTarget.duration || activeTrack?.durationSeconds || 0)}
        onEnded={() => queue.length && setCurrentIndex((value) => (value + 1) % queue.length)}
        onError={handlePlaybackError}
        className="hidden"
      />
      <div className="mx-auto max-w-[1700px] px-4 py-4 md:px-6">
        <div className="grid gap-4 xl:grid-cols-[250px_minmax(0,1fr)_340px]">
          <aside className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-5">
            <div className="flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[linear-gradient(145deg,_rgba(16,185,129,0.95),_rgba(59,130,246,0.88))] text-stone-950"><Disc3 className="h-6 w-6" /></div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.3em] text-stone-400">Yoinker</p>
                <h1 className="mt-1 text-2xl font-semibold text-white">Cloud Library</h1>
              </div>
            </div>
            <div className="mt-8 hidden flex-col gap-2 xl:flex">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                return <button key={item.id} type="button" onClick={() => setView(item.id)} className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-sm ${view === item.id ? 'bg-white text-stone-950' : 'text-stone-300 hover:bg-white/5 hover:text-white'}`}><Icon className="h-4 w-4" />{item.label}</button>;
              })}
            </div>
            <div className="mt-6 flex gap-2 overflow-x-auto xl:hidden">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                return <button key={item.id} type="button" onClick={() => setView(item.id)} className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm ${view === item.id ? 'bg-white text-stone-950' : 'border border-white/10 bg-white/[0.04] text-stone-200'}`}><Icon className="h-4 w-4" />{item.label}</button>;
              })}
            </div>
            <div className="mt-8 rounded-[1.5rem] border border-white/10 bg-black/20 p-4">
              <p className="text-[11px] uppercase tracking-[0.3em] text-stone-400">Signed in</p>
              <p className="mt-3 text-xl font-medium text-white">{user?.username || 'Account'}</p>
              <button type="button" onClick={logout} className="mt-5 inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm text-stone-200"><LogOut className="h-4 w-4" />Sign out</button>
            </div>
          </aside>

          <main className="space-y-6">
            {view === 'home' ? (
              <section className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-5">
                <form onSubmit={(event) => event.preventDefault()} className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    {HOME_SEARCH_MODE_OPTIONS.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => setHomeSearchMode(option.id)}
                        className={`rounded-full px-4 py-2 text-sm ${homeSearchMode === option.id ? 'bg-white text-stone-950' : 'border border-white/10 bg-white/[0.03] text-stone-300'}`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
                    <div className="relative flex-1">
                      <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-stone-500" />
                      <input value={homeCommand} onChange={(event) => setHomeCommand(event.target.value)} placeholder={homePrimaryPlaceholder} className="w-full rounded-[1.4rem] border border-white/10 bg-black/25 py-4 pl-12 pr-4 text-base text-white outline-none" />
                    </div>
                    <div className="relative flex-1">
                      <input value={homeSecondaryCommand} onChange={(event) => setHomeSecondaryCommand(event.target.value)} placeholder={homeSecondaryPlaceholder} className="w-full rounded-[1.4rem] border border-white/10 bg-black/25 px-4 py-4 text-base text-white outline-none" />
                    </div>
                    <div className="inline-flex items-center justify-center gap-2 rounded-[1.2rem] bg-white px-5 py-4 text-sm font-semibold text-stone-950">
                      <Search className="h-4 w-4" />
                      Search
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="rounded-full bg-white/5 px-3 py-1.5 text-stone-300">Music-first search: find songs, albums, and artists, then store them on your server</span>
                    <select value={audioBitrate} onChange={(event) => setAudioBitrate(event.target.value)} className="rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-sm text-white">
                      {['96', '128', '160', '192', '256', '320'].map((value) => <option key={value} value={value}>{value} kbps</option>)}
                    </select>
                  </div>
                </form>
              </section>
            ) : null}
            {view === 'yb' ? (
              <section className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-5">
                <form onSubmit={manualMode === 'url' ? submitManualUrl : (event) => event.preventDefault()} className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    {MANUAL_MODE_OPTIONS.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => setManualMode(option.id)}
                        className={`rounded-full px-4 py-2 text-sm ${manualMode === option.id ? 'bg-white text-stone-950' : 'border border-white/10 bg-white/[0.03] text-stone-300'}`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
                    <div className="relative flex-1">
                      <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-stone-500" />
                      <input value={manualCommand} onChange={(event) => setManualCommand(event.target.value)} placeholder={manualPrimaryPlaceholder} className="w-full rounded-[1.4rem] border border-white/10 bg-black/25 py-4 pl-12 pr-4 text-base text-white outline-none" />
                    </div>
                    {manualMode === 'provider' ? (
                      <div className="relative flex-1">
                        <input value={manualSecondaryCommand} onChange={(event) => setManualSecondaryCommand(event.target.value)} placeholder={manualSecondaryPlaceholder} className="w-full rounded-[1.4rem] border border-white/10 bg-black/25 px-4 py-4 text-base text-white outline-none" />
                      </div>
                    ) : null}
                    {manualMode === 'provider' ? (
                      <div className="flex flex-wrap gap-2">
                        {SOURCE_OPTIONS.map((source) => (
                          <button
                            key={source.id}
                            type="button"
                            onClick={() => setSelectedSource(source.id)}
                            className={`rounded-full px-4 py-3 text-sm ${selectedSource === source.id ? 'bg-emerald-300 text-stone-950' : 'border border-white/10 bg-white/[0.03] text-stone-300'}`}
                          >
                            {source.label}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <button type="submit" disabled={!trimmedManualCommand || submitting} className="inline-flex items-center justify-center gap-2 rounded-[1.2rem] bg-white px-5 py-4 text-sm font-semibold text-stone-950 disabled:bg-stone-700 disabled:text-stone-300">
                        <UploadCloud className="h-4 w-4" />
                        {submitting ? 'Working...' : 'Add to library'}
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className={`rounded-full px-3 py-1.5 ${urlMode ? 'bg-emerald-300/15 text-emerald-100' : 'bg-white/5 text-stone-300'}`}>{urlMode ? 'Direct URL import: advanced/manual server download' : `Provider search on ${SOURCE_OPTIONS.find((source) => source.id === selectedSource)?.label || selectedSource}`}</span>
                    {urlMode ? (
                      <>
                        <select value={mode} onChange={(event) => setMode(event.target.value)} className="rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-sm text-white">
                          <option value="audio">Audio</option>
                          <option value="video">Video</option>
                        </select>
                        {mode === 'audio' ? (
                          <select value={audioBitrate} onChange={(event) => setAudioBitrate(event.target.value)} className="rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-sm text-white">
                            {['96', '128', '160', '192', '256', '320'].map((value) => <option key={value} value={value}>{value} kbps</option>)}
                          </select>
                        ) : (
                          <select value={videoQuality} onChange={(event) => setVideoQuality(event.target.value)} className="rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-sm text-white">
                            {['best', '480p', '720p', '1080p', '1440p', '2160p'].map((value) => <option key={value} value={value}>{value}</option>)}
                          </select>
                        )}
                        <label className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-sm text-stone-200">
                          <input type="checkbox" checked={allowPlaylist} onChange={(event) => setAllowPlaylist(event.target.checked)} className="h-4 w-4" />
                          Import entire album/playlist
                        </label>
                      </>
                    ) : null}
                  </div>
                  {urlMode ? (
                    <div className="grid gap-3 md:grid-cols-3">
                      {!allowPlaylist ? (
                        <input value={overrideTitle} onChange={(event) => setOverrideTitle(event.target.value)} placeholder="Optional title override" className="rounded-[1.1rem] border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none" />
                      ) : <div className="hidden md:block" />}
                      <input value={overrideArtist} onChange={(event) => setOverrideArtist(event.target.value)} placeholder={allowPlaylist ? 'Optional album artist override' : 'Optional artist override'} className="rounded-[1.1rem] border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none" />
                      <input value={overrideAlbum} onChange={(event) => setOverrideAlbum(event.target.value)} placeholder={allowPlaylist ? 'Optional album title override' : 'Optional album override'} className="rounded-[1.1rem] border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none" />
                    </div>
                  ) : null}
                </form>
              </section>
            ) : null}
            {message ? <div className="rounded-[1.5rem] border border-emerald-300/20 bg-emerald-300/10 px-5 py-4 text-sm text-emerald-100">{message}</div> : null}
            {mainSection}
          </main>
          <aside className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-5">
            <p className="text-[11px] uppercase tracking-[0.32em] text-stone-400">Now playing</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">{activeTrack?.title || 'Choose a track'}</h2>
            <p className="mt-2 text-sm text-stone-400">{activeTrack?.uploader || 'Stream from discovery or your server library'}</p>
            <div className="mt-5 rounded-[1.75rem] border border-white/10 bg-black/20 p-4">
              <Artwork src={activeTrack?.artworkUrl} title={activeTrack?.title || 'Current track'} className="h-64 w-full" />
            </div>
            {activeTrack?.mediaType === 'video' ? <video ref={videoRef} key={activeTrack.key} src={activeTrack.streamUrl} controls autoPlay onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} onTimeUpdate={(event) => setPositionSeconds(event.currentTarget.currentTime)} onLoadedMetadata={(event) => setDurationSeconds(event.currentTarget.duration || activeTrack.durationSeconds || 0)} onEnded={() => queue.length && setCurrentIndex((value) => (value + 1) % queue.length)} onError={handlePlaybackError} className="mt-5 w-full rounded-[1.5rem] bg-black" /> : null}
            <div className="mt-6 space-y-3">
              {queue.map((track, index) => (
                <button key={track.key} type="button" onClick={() => setCurrentIndex(index)} className={`flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left ${index === currentIndex ? 'border-emerald-300/50 bg-emerald-300/10 text-emerald-50' : 'border-white/10 bg-white/[0.03] text-stone-200'}`}>
                  <Artwork src={track.artworkUrl} title={track.title} className="h-12 w-12 flex-none" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{track.title}</p>
                    <p className="truncate text-xs text-stone-400">{track.uploader || 'Unknown artist'}</p>
                  </div>
                  <p className="text-[11px] uppercase tracking-[0.24em] text-stone-400">{formatDuration(track.durationSeconds)}</p>
                </button>
              ))}
              {queue.length === 0 ? <p className="rounded-[1.5rem] border border-dashed border-white/10 px-4 py-8 text-center text-sm text-stone-400">Stream a discovery result or play something from your library to start a queue.</p> : null}
            </div>
            <div className="mt-6 rounded-[1.5rem] border border-white/10 bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.24em] text-stone-400">Worker queue</p>
              <div className="mt-4 space-y-3">
                {jobs.slice(0, 4).map((job) => (
                  <div key={job.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm text-white">{job.media_files?.[0]?.title || job.source_url}</p>
                      <span className="text-xs text-stone-400">{job.progress_percent || 0}%</span>
                    </div>
                    <p className="mt-1 text-xs text-stone-400">{job.progress_message || job.status}</p>
                    {(job.status === 'queued' || job.status === 'running') ? <button type="button" onClick={() => cancelJob(job.id).then(refresh)} className="mt-3 rounded-full border border-red-400/30 px-3 py-1 text-xs text-red-200">Cancel</button> : null}
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </div>
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-[linear-gradient(180deg,_rgba(9,9,11,0.75),_rgba(5,5,7,0.95))] px-4 py-4 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1700px] flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <Artwork src={activeTrack?.artworkUrl} title={activeTrack?.title || 'No selection'} className="h-14 w-14 flex-none rounded-[1.1rem]" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">{activeTrack?.title || 'Nothing playing'}</p>
              <p className="truncate text-xs uppercase tracking-[0.22em] text-stone-400">{activeTrack ? `${activeTrack.uploader || 'Unknown artist'} | ${activeTrack.mediaType}` : 'Search, stream, and save your favorites'}</p>
            </div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-3 lg:max-w-2xl">
            <div className="flex items-center justify-center gap-3">
              <button type="button" onClick={() => queue.length && setCurrentIndex((value) => (value - 1 + queue.length) % queue.length)} disabled={!queue.length} className="rounded-full border border-white/10 p-3 text-stone-100 disabled:opacity-40"><SkipBack className="h-4 w-4" /></button>
              <button type="button" onClick={togglePlayback} disabled={!activeTrack} className="rounded-full bg-white p-4 text-stone-950 disabled:opacity-40">{isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}</button>
              <button type="button" onClick={() => queue.length && setCurrentIndex((value) => (value + 1) % queue.length)} disabled={!queue.length} className="rounded-full border border-white/10 p-3 text-stone-100 disabled:opacity-40"><SkipForward className="h-4 w-4" /></button>
            </div>
            <div className="flex items-center gap-3 text-xs text-stone-400">
              <span>{formatDuration(positionSeconds)}</span>
              <input type="range" min={0} max={Math.max(durationSeconds || activeTrack?.durationSeconds || 0, 1)} step={1} value={Math.min(positionSeconds, Math.max(durationSeconds || activeTrack?.durationSeconds || 0, 1))} onChange={(event) => seekTo(Number(event.target.value))} disabled={!activeTrack} className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-white/10 accent-emerald-300" />
              <span>{formatDuration(durationSeconds || activeTrack?.durationSeconds || 0)}</span>
            </div>
          </div>
          <div className="w-full lg:w-44">
            <input type="range" min={0} max={1} step={0.01} value={volume} onChange={(event) => { const next = Number(event.target.value); setVolume(next); const media = activeTrack?.mediaType === 'video' ? videoRef.current : audioRef.current; if (media) media.volume = next; }} className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-emerald-300" />
          </div>
        </div>
      </div>
      {editingTrack ? (
        <MetadataModal
          title={editingTrack.title}
          subtitle="Update this song's title, artist, and album metadata."
          fields={[
            { id: 'title', label: 'Song title', placeholder: 'Song title' },
            { id: 'artist', label: 'Artist', placeholder: 'Artist' },
            { id: 'album', label: 'Album', placeholder: 'Album' },
          ]}
          values={trackMetadataForm}
          onChange={(field, value) => setTrackMetadataForm((current) => ({ ...current, [field]: value }))}
          onCancel={() => setEditingTrack(null)}
          onSave={saveTrackMetadata}
          saving={savingMetadata}
        />
      ) : null}
      {editingAlbum ? (
        <MetadataModal
          title={editingAlbum.title}
          subtitle="Apply album-level metadata to every track in this album group."
          fields={[
            { id: 'album', label: 'Album title', placeholder: 'Album title' },
            { id: 'artist', label: 'Album artist', placeholder: 'Album artist' },
          ]}
          values={albumMetadataForm}
          onChange={(field, value) => setAlbumMetadataForm((current) => ({ ...current, [field]: value }))}
          onCancel={() => setEditingAlbum(null)}
          onSave={saveAlbumMetadata}
          saving={savingMetadata}
        />
      ) : null}
    </div>
  );
}

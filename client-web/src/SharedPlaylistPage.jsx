import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Disc3 } from 'lucide-react';
import { getSharedPlaylist, getSharedPlaylistItemArtworkUrl, getSharedPlaylistItemStreamUrl } from './api';

function formatDuration(seconds) {
  if (!seconds) return '--:--';
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function toQueueItem(shareToken, item) {
  return {
    key: `shared-${item.id}`,
    itemId: item.id,
    mediaType: item.media_file.media_type,
    title: item.media_file.title,
    uploader: item.media_file.uploader,
    durationSeconds: item.media_file.duration_seconds,
    artworkUrl: item.media_file.artwork_relative_path ? getSharedPlaylistItemArtworkUrl(shareToken, item.id) : null,
    streamUrl: getSharedPlaylistItemStreamUrl(shareToken, item.id),
  };
}

function Artwork({ src, title, className = '' }) {
  if (!src) {
    return (
      <div className={`grid place-items-center rounded-[1.6rem] bg-[linear-gradient(135deg,_rgba(251,191,36,0.16),_rgba(15,23,42,0.82))] ${className}`}>
        <Disc3 className="h-10 w-10 text-white/80" />
      </div>
    );
  }
  return <img src={src} alt={title} className={`rounded-[1.6rem] object-cover ${className}`} />;
}

export default function SharedPlaylistPage() {
  const { shareToken } = useParams();
  const [playlist, setPlaylist] = useState(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [queue, setQueue] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    let active = true;

    const loadPlaylist = async () => {
      try {
        setLoading(true);
        setMessage('');
        const data = await getSharedPlaylist(shareToken);
        if (!active) return;
        setPlaylist(data);
      } catch (error) {
        console.error(error);
        if (!active) return;
        setMessage(error?.response?.data?.detail || 'Shared playlist unavailable.');
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    loadPlaylist();
    return () => {
      active = false;
    };
  }, [shareToken]);

  const queueItems = useMemo(
    () => (playlist?.items || []).map((item) => toQueueItem(shareToken, item)),
    [playlist, shareToken],
  );

  const activeItem = queue[currentIndex] || null;
  const heroArtwork = playlist?.items?.[0]?.media_file?.artwork_relative_path
    ? getSharedPlaylistItemArtworkUrl(shareToken, playlist.items[0].id)
    : null;

  const playQueue = (items, startIndex = 0) => {
    setQueue(items);
    setCurrentIndex(startIndex);
  };

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-[linear-gradient(180deg,_#120f0b_0%,_#09090b_100%)] text-stone-100">
        <p className="text-sm uppercase tracking-[0.3em] text-amber-200/70">Loading shared playlist</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.18),_transparent_30%),linear-gradient(180deg,_#120f0b_0%,_#09090b_100%)] text-stone-100">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <header className="rounded-[2rem] border border-stone-800 bg-stone-950/75 p-6 shadow-[0_28px_80px_rgba(0,0,0,0.45)] backdrop-blur">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="flex items-start gap-5">
              <Artwork src={heroArtwork} title={playlist?.title || 'Yoinker Share'} className="h-28 w-28 flex-none" />
              <div>
              <p className="text-xs uppercase tracking-[0.35em] text-amber-200/70">Shared playlist</p>
              <h1 className="mt-3 text-4xl font-black text-stone-50">{playlist?.title || 'Yoinker Share'}</h1>
              <p className="mt-3 max-w-3xl text-stone-300">
                {playlist?.description || 'Listen in the browser without installing the desktop app.'}
              </p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => playQueue(queueItems, 0)}
                className="rounded-full bg-amber-300 px-4 py-2 text-sm font-semibold text-stone-950 transition hover:bg-amber-200"
              >
                Play all
              </button>
              <Link
                to="/login"
                className="rounded-full border border-stone-700 px-4 py-2 text-sm text-stone-200 transition hover:border-amber-200 hover:text-amber-100"
              >
                Open Yoinker
              </Link>
            </div>
          </div>
        </header>

        {message ? (
          <div className="mt-6 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {message}
          </div>
        ) : null}

        <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-[2rem] border border-stone-800 bg-stone-950/70 p-6">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-amber-200/70">Tracks</p>
                <h2 className="mt-2 text-2xl font-bold text-stone-50">{playlist?.items?.length || 0} items</h2>
              </div>
              <button
                type="button"
                onClick={() => playQueue([...queueItems].sort(() => Math.random() - 0.5), 0)}
                className="rounded-full border border-stone-700 px-4 py-2 text-sm text-stone-200 transition hover:border-amber-200 hover:text-amber-100"
              >
                Shuffle
              </button>
            </div>

            <div className="mt-6 space-y-3">
              {(playlist?.items || []).map((item, index) => (
                <article key={item.id} className="rounded-3xl border border-stone-800 bg-stone-900/80 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex gap-4">
                      <Artwork
                        src={item.media_file.artwork_relative_path ? getSharedPlaylistItemArtworkUrl(shareToken, item.id) : null}
                        title={item.media_file.title}
                        className="h-16 w-16 flex-none"
                      />
                      <div>
                      <p className="text-xs uppercase tracking-[0.25em] text-amber-200/70">
                        {item.media_file.media_type}
                      </p>
                      <h3 className="mt-2 text-lg font-semibold text-stone-50">{item.media_file.title}</h3>
                      <p className="mt-1 text-sm text-stone-400">{item.media_file.uploader || 'Unknown uploader'}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => playQueue(queueItems, index)}
                      className="rounded-full border border-amber-300/40 px-4 py-2 text-sm text-amber-100 transition hover:border-amber-200 hover:bg-amber-300/10"
                    >
                      Play
                    </button>
                  </div>
                  <p className="mt-3 text-sm text-stone-500">{formatDuration(item.media_file.duration_seconds)}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="rounded-[2rem] border border-stone-800 bg-stone-950/70 p-6">
            <p className="text-xs uppercase tracking-[0.3em] text-amber-200/70">Now playing</p>
            <h2 className="mt-2 text-2xl font-bold text-stone-50">
              {activeItem ? activeItem.title : 'Choose a track'}
            </h2>
            <p className="mt-2 text-stone-400">{activeItem?.uploader || 'Browser streaming from your shared link'}</p>

            <div className="mt-6 rounded-[1.75rem] border border-stone-800 bg-[linear-gradient(135deg,_rgba(251,191,36,0.12),_rgba(17,24,39,0.12))] p-5">
              {activeItem ? (
                <Artwork src={activeItem.artworkUrl} title={activeItem.title} className="mb-4 h-52 w-full" />
              ) : null}
              {activeItem ? (
                activeItem.mediaType === 'video' ? (
                  <video
                    key={activeItem.key}
                    src={activeItem.streamUrl}
                    controls
                    autoPlay
                    className="w-full rounded-3xl bg-black"
                    onEnded={() => setCurrentIndex((value) => (queue.length > 1 ? (value + 1) % queue.length : value))}
                  />
                ) : (
                  <audio
                    key={activeItem.key}
                    src={activeItem.streamUrl}
                    controls
                    autoPlay
                    className="w-full"
                    onEnded={() => setCurrentIndex((value) => (queue.length > 1 ? (value + 1) % queue.length : value))}
                  />
                )
              ) : (
                <p className="text-sm text-stone-400">Start a track to stream directly from the server.</p>
              )}
            </div>

            {queue.length > 0 ? (
              <div className="mt-6 space-y-3">
                {queue.map((item, index) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setCurrentIndex(index)}
                    className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition ${
                      index === currentIndex
                        ? 'border-amber-300/60 bg-amber-300/10 text-amber-100'
                        : 'border-stone-800 bg-stone-900/70 text-stone-300 hover:border-stone-700'
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <Artwork src={item.artworkUrl} title={item.title} className="h-12 w-12 flex-none rounded-2xl" />
                      <span className="truncate font-medium">{item.title}</span>
                    </span>
                    <span className="text-xs uppercase tracking-[0.2em]">{formatDuration(item.durationSeconds)}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}

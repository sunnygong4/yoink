import { useCallback, useEffect, useRef, useState } from 'react'
import { api, fmtTime, type Song } from './api'
import { t } from './i18n'
import * as I from './icons'
import { useLyrics } from './Lyrics'
import { ModeButtons, type Transport } from './Modes'
import NowPlaying from './NowPlaying'
import type { Page } from './Pages'
import QueueDrawer from './QueueDrawer'
import type { Queue } from './queue'
import { leadArtist } from './text'

const VOLUME = 'yoinker.volume'
const SMART_AHEAD = 40   // seconds before the end of the last song: ask for a recommendation (it downloads meanwhile)

/** The audio element, the bar at the bottom, the queue drawer and the full-screen view. */
export default function Player({ q, byId, onSong, open }: {
  q: Queue
  byId: Map<string, Song>
  onSong: (s: Song) => void   // a song the library list doesn't have yet (a recommendation)
  open: (p: Page) => void     // an artist / album page
}) {
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(() => Number(localStorage.getItem(VOLUME) ?? 1))
  const [drawer, setDrawer] = useState(false)
  const [full, setFull] = useState(false)
  const [smartBusy, setSmartBusy] = useState(false)
  const asked = useRef(new Set<string>())   // songs we already asked a recommendation for

  const song = q.current ? byId.get(q.current) ?? null : null
  const ready = song?.status === 'ready'
  const lyrics = useLyrics(song)
  const isLast = q.pos >= q.ids.length - 1

  // a new song (or the current one finished downloading): load it
  useEffect(() => {
    const a = audio.current
    if (!a) return
    if (!song || !ready) { a.removeAttribute('src'); a.load(); setTime(0); setDuration(song?.duration || 0); return }
    a.src = api.audioUrl(song.id)
    setTime(0)
    if (q.autoplay) a.play().catch(() => setPlaying(false))
  }, [song?.id, ready])

  useEffect(() => {
    if (audio.current) audio.current.volume = volume
    try { localStorage.setItem(VOLUME, String(volume)) } catch { /* private mode */ }
  }, [volume])

  // smart play: near the end of the last song, fetch a similar one so it's downloaded by the time it's needed
  const recommend = useCallback(async () => {
    if (!song || asked.current.has(song.id)) return
    asked.current.add(song.id)
    setSmartBusy(true)
    try {
      const s = await api.radio(song.id, [...q.played, ...q.ids])
      onSong(s)
      q.appendRecommended(s.id)
    } catch { /* nothing to recommend: the queue just ends */ }
    setSmartBusy(false)
  }, [song, q, onSong])

  useEffect(() => {
    if (!q.smart || q.repeat !== 'off' || !isLast || !ready || !duration) return
    if (duration - time < SMART_AHEAD || time / duration > 0.6) recommend()
  }, [q.smart, q.repeat, isLast, ready, duration, time, recommend])

  const toggle = useCallback(() => {
    const a = audio.current
    if (!a || !ready) return
    if (a.paused) a.play()
    else a.pause()
  }, [ready])
  const seek = useCallback((s: number) => { if (audio.current) audio.current.currentTime = s }, [])
  const next = useCallback(() => q.next(), [q])
  const prev = useCallback(() => {
    if (audio.current && audio.current.currentTime > 3) audio.current.currentTime = 0   // like every music player
    else q.prev()
  }, [q])

  async function ended() {
    if (q.repeat === 'one') { seek(0); audio.current?.play(); return }
    if (isLast && q.repeat === 'off' && q.smart) await recommend()   // short song: it may not have asked yet
    q.next()
  }

  // lock screen / headphone controls
  useEffect(() => {
    if (!('mediaSession' in navigator) || !song) return
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.title, artist: song.artist, album: song.album || '',
      artwork: song.thumbnail ? [{ src: song.thumbnail, sizes: '512x512' }] : [],
    })
    const ms = navigator.mediaSession
    ms.setActionHandler('play', () => audio.current?.play())
    ms.setActionHandler('pause', () => audio.current?.pause())
    ms.setActionHandler('previoustrack', prev)
    ms.setActionHandler('nexttrack', next)
    ms.setActionHandler('seekto', d => { if (d.seekTime != null) seek(d.seekTime) })
  }, [song, prev, next, seek])

  // space bar: play / pause (unless typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (e.code === 'Space' && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'BUTTON') { e.preventDefault(); toggle() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])

  const tr: Transport = { playing, time, duration, toggle, seek, next, prev }
  const preparing = song && !ready && song.status !== 'error'

  return (
    <>
      <audio ref={audio} preload="auto"
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onTimeUpdate={e => setTime(e.currentTarget.currentTime)}
        onDurationChange={e => setDuration(e.currentTarget.duration)}
        onEnded={ended} />

      <header className="toolbar">
        <div className="transport">
          <button className="round" onClick={prev} disabled={!song} title={t('prev')}><I.Prev size={16} /></button>
          <button className="round big" onClick={toggle} disabled={!ready} title={playing ? t('pause') : t('play')}>
            {playing ? <I.Pause size={20} /> : <I.Play size={20} />}
          </button>
          <button className="round" onClick={next} disabled={!song || (isLast && q.repeat !== 'all')} title={t('next')}><I.Next size={16} /></button>
        </div>
        <div className="volume">
          <button className="flat" onClick={() => setVolume(volume ? 0 : 1)} title={t('volume')}>
            {volume ? <I.Volume size={14} /> : <I.Mute size={14} />}
          </button>
          <input type="range" min={0} max={1} step={0.01} value={volume} onChange={e => setVolume(Number(e.target.value))}
            style={{ '--p': `${volume * 100}%` } as React.CSSProperties} aria-label={t('volume')} />
        </div>

        {/* the iTunes "LCD": what's playing, and where in the song; the cover opens the full-screen view */}
        <div className="lcd">
          <button className="lcd-art" onClick={() => song && setFull(true)} disabled={!song} title={t('fullScreen')}>
            {song?.thumbnail ? <img src={song.thumbnail} alt="" onError={e => { e.currentTarget.style.visibility = 'hidden' }} /> : <span className="apple-note">♫</span>}
          </button>
          <div className="lcd-body">
            {song ? <>
              <div className="lcd-title">
                {song.title}
                {song.radio && (
                  <button className="lcd-keep" title={t('keep')} onClick={() => api.keep(song.id).then(onSong)}>
                    <I.Heart size={11} />
                  </button>
                )}
              </div>
              <div className="lcd-sub">
                {preparing ? t('preparing') : <>
                  <a onClick={() => open({ kind: 'artist', name: leadArtist(song.artist) })}>{song.artist}</a>
                  {song.album && <> — <a onClick={() => open({ kind: 'album', artist: song.artist, title: song.album! })}>{song.album}</a></>}
                </>}
              </div>
              <div className="lcd-seek">
                <span>{fmtTime(time)}</span>
                <input type="range" min={0} max={duration || 0} step={0.1} value={Math.min(time, duration || 0)}
                  disabled={!ready} onChange={e => seek(Number(e.target.value))}
                  style={{ '--p': `${duration ? (100 * time) / duration : 0}%` } as React.CSSProperties} />
                <span>-{fmtTime(Math.max(0, duration - time))}</span>
              </div>
            </> : <div className="lcd-idle"><span className="apple-note">♫</span> Yoinker</div>}
          </div>
        </div>

        <div className="modes">
          <ModeButtons q={q} busy={smartBusy} />
          <button className={'square' + (drawer ? ' pressed' : '')} onClick={() => setDrawer(!drawer)} title={t('queue')}>
            <I.QueueIcon size={15} />
          </button>
        </div>
      </header>

      <QueueDrawer open={drawer} onClose={() => setDrawer(false)} q={q} byId={byId} onSong={onSong} smartBusy={smartBusy} />
      {full && song && (
        <NowPlaying song={song} tr={tr} lyrics={lyrics} q={q} smartBusy={smartBusy} preparing={!!preparing}
          onClose={() => setFull(false)} onQueue={() => setDrawer(true)} onSong={onSong}
          open={p => { setFull(false); open(p) }} />
      )}
    </>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, fmtTime, type Song } from './api'
import { t } from './i18n'
import * as I from './icons'
import { useLyrics } from './Lyrics'
import { ModeButtons, type Transport } from './Modes'
import NowPlaying from './NowPlaying'
import QueueDrawer from './QueueDrawer'
import type { Queue } from './queue'

const VOLUME = 'yoinker.volume'
const SMART_AHEAD = 40   // seconds before the end of the last song: ask for a recommendation (it downloads meanwhile)

/** The audio element, the bar at the bottom, the queue drawer and the full-screen view. */
export default function Player({ q, byId, onSong }: {
  q: Queue
  byId: Map<string, Song>
  onSong: (s: Song) => void   // a song the library list doesn't have yet (a recommendation)
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

      <footer className="player">
        <div className="progress-thin" style={{ width: `${duration ? (100 * time) / duration : 0}%` }} />
        <div className="np" onClick={() => song && setFull(true)} role="button" title={t('fullScreen')}>
          {song?.thumbnail ? <img className="cover" src={song.thumbnail} alt="" /> : <div className="cover blank"><I.Library /></div>}
          <div className="np-text">
            <div className="title">{song ? song.title : t('notPlaying')}</div>
            <div className="sub">{preparing ? t('preparing') : song?.artist}</div>
          </div>
          {song?.radio && (
            <button className="ib keep" title={t('keep')}
              onClick={e => { e.stopPropagation(); api.keep(song.id).then(onSong) }}><I.Heart size={18} /></button>
          )}
        </div>

        <div className="transport">
          <div className="buttons">
            <ModeButtons q={q} only="shuffle" />
            <button className="ib" onClick={prev} disabled={!song} title={t('prev')}><I.Prev /></button>
            <button className="ib play" onClick={toggle} disabled={!ready} title={playing ? t('pause') : t('play')}>
              {playing ? <I.Pause size={22} /> : <I.Play size={22} />}
            </button>
            <button className="ib" onClick={next} disabled={!song || (isLast && q.repeat !== 'all')} title={t('next')}><I.Next /></button>
            <ModeButtons q={q} only="repeat" />
          </div>
          <div className="seek">
            <span>{fmtTime(time)}</span>
            <input type="range" min={0} max={duration || 0} step={0.1} value={Math.min(time, duration || 0)}
              disabled={!ready} onChange={e => seek(Number(e.target.value))}
              style={{ '--p': `${duration ? (100 * time) / duration : 0}%` } as React.CSSProperties} />
            <span>{fmtTime(duration)}</span>
          </div>
        </div>

        <div className="extras">
          <ModeButtons q={q} only="smart" busy={smartBusy} />
          <button className="ib" onClick={() => song && setFull(true)} disabled={!song} title={t('fullScreen')}><I.Mic /></button>
          <button className={'ib' + (drawer ? ' on' : '')} onClick={() => setDrawer(!drawer)} title={t('queue')}><I.QueueIcon /></button>
          <div className="volume">
            <button className="ib" onClick={() => setVolume(volume ? 0 : 1)} title={t('volume')}>
              {volume ? <I.Volume /> : <I.Mute />}
            </button>
            <input type="range" min={0} max={1} step={0.01} value={volume} onChange={e => setVolume(Number(e.target.value))}
              style={{ '--p': `${volume * 100}%` } as React.CSSProperties} aria-label={t('volume')} />
          </div>
        </div>
        <button className="ib play mobile-only" onClick={e => { e.stopPropagation(); toggle() }} disabled={!ready}>
          {playing ? <I.Pause size={22} /> : <I.Play size={22} />}
        </button>
        <button className="ib mobile-only" onClick={() => setDrawer(true)}><I.QueueIcon /></button>
      </footer>

      <QueueDrawer open={drawer} onClose={() => setDrawer(false)} q={q} byId={byId} onSong={onSong} smartBusy={smartBusy} />
      {full && song && (
        <NowPlaying song={song} tr={tr} lyrics={lyrics} q={q} smartBusy={smartBusy} preparing={!!preparing}
          onClose={() => setFull(false)} onQueue={() => setDrawer(true)} onSong={onSong} />
      )}
    </>
  )
}

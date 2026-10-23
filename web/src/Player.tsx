import { useCallback, useEffect, useRef, useState } from 'react'
import { api, fmtTime, report, type Song } from './api'
import { t } from './i18n'
import * as I from './icons'
import { useLyrics } from './Lyrics'
import { LuckyButton, ModeButtons, type Transport } from './Modes'
import NowPlaying from './NowPlaying'
import { albumPage, artistPage, type Page } from './Pages'
import QueueDrawer from './QueueDrawer'
import type { Queue } from './queue'
import IPodMode, { type PodProps } from './IPodMode'
import { savedAudio } from './offline'
import { leadArtist } from './text'

const VOLUME = 'yoinker.volume'
// a moment of silence (a tenth of a second of 8 kHz WAV) to unlock audio on iPhones
const SILENCE = (() => {
  const n = 800, b = new Uint8Array(44 + n), v = new DataView(b.buffer)
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) b[o + i] = s.charCodeAt(i) }
  str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVE'); str(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true)
  str(36, 'data'); v.setUint32(40, n, true); b.fill(128, 44)
  return `data:audio/wav;base64,${btoa(String.fromCharCode(...b))}`
})()
const isPhone = /iPhone|iPad|iPod|Android/.test(navigator.userAgent)
/** play(), and on phones what came of it into the server's log. */
function start(a: HTMLAudioElement, why: string) {
  const src = a.src.startsWith('blob:') ? 'saved' : a.src.startsWith('data:') ? 'silence' : 'server'
  return a.play().then(() => { if (isPhone && why !== 'unlock') report('play ok', { why, src }) },
    (e: Error) => { if (isPhone) report('play failed', { why, src, name: e.name, msg: e.message }); throw e })
}
const SMART_AHEAD = 40   // seconds before the end of the last song: ask for a recommendation (it downloads meanwhile)

/** The audio element, the bar at the bottom, the queue drawer and the full-screen view. */
export default function Player({ q, byId, onSong, open, saved, online, pod, rerender }: {
  q: Queue
  byId: Map<string, Song>
  onSong: (s: Song) => void   // a song the library list doesn't have yet (a recommendation)
  open: (p: Page) => void     // an artist / album page
  saved: Set<string>          // songs saved on this phone: they play from it, with or without a connection
  online: boolean
  pod?: Omit<PodProps, 'saved' | 'online' | 'onSong'>   // iPod mode: the iPod instead of the iTunes bar
  rerender: () => void
}) {
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(() => Number(localStorage.getItem(VOLUME) ?? 1))
  const [drawer, setDrawer] = useState(false)
  const [full, setFull] = useState(false)
  const [smartBusy, setSmartBusy] = useState(false)
  const [luckyBusy, setLuckyBusy] = useState(false)
  const asked = useRef(new Set<string>())   // songs we already asked a recommendation for
  const reported = useRef<string | null>(null)   // the song whose play went into the history

  const song = q.current ? byId.get(q.current) ?? null : null
  const ready = song?.status === 'ready'
  const lyrics = useLyrics(song)
  const isLast = q.pos >= q.ids.length - 1

  // a new song (or the current one finished downloading): load it, from the phone when it's saved there
  const blob = useRef<string | null>(null)
  const savedNow = useRef(saved)
  savedNow.current = saved
  useEffect(() => {
    const a = audio.current
    if (!a) return
    if (!song || !ready) { a.removeAttribute('src'); a.load(); setTime(0); setDuration(song?.duration || 0); return }
    let live = true
    // (only when the song changes: saving the song that's playing doesn't restart it)
    ;(savedNow.current.has(song.id) ? savedAudio(song.id) : Promise.resolve(null)).then(local => {
      if (!live) return
      if (blob.current) URL.revokeObjectURL(blob.current)
      blob.current = local
      a.src = local ?? api.audioUrl(song.id)
      setTime(0)
      reported.current = null
      if (q.autoplay) start(a, 'song').catch(() => setPlaying(false))
    })
    return () => { live = false }
  }, [song?.id, ready])

  // offline and this song isn't on the phone: on to the next one that is
  const failed = useCallback(() => {
    if (!online && song && !saved.has(song.id)) q.next()
  }, [online, song, saved, q])

  // iPhones only let audio start inside a tap. Songs start a moment after one (the list re-renders, a saved song
  // is read from the phone), so the first tap anywhere plays a silent sound on the element: from then on it may play.
  useEffect(() => {
    const unlock = () => {
      const a = audio.current
      if (!a) return
      const nav = navigator as { audioSession?: { type: string } }
      if (nav.audioSession) nav.audioSession.type = 'playback'   // play with the silent switch on (iOS 17+)
      const done = () => { for (const ev of EVENTS) removeEventListener(ev, unlock, true) }
      if (!a.src) {
        a.src = SILENCE
        start(a, 'unlock').then(() => { if (a.src === SILENCE) a.pause(); done() }, () => {})   // failed: the next tap tries again
      } else done()   // a song is loaded: playing it from a tap does the same
    }
    const EVENTS = ['touchend', 'click', 'keydown'] as const
    for (const ev of EVENTS) addEventListener(ev, unlock, true)
    return () => { for (const ev of EVENTS) removeEventListener(ev, unlock, true) }
  }, [])

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

  // into the play history once it's really been listened to: 30 s, or the end of a shorter song
  useEffect(() => {
    if (!song || !ready || reported.current === song.id) return
    if (time >= 30 || (duration > 0 && time >= duration - 1)) {
      reported.current = song.id
      api.played(song.id).catch(() => {})
    }
  }, [song, ready, time, duration])

  // ✨: a new song right now, like the current one (or like something in the library)
  const lucky = useCallback(async () => {
    setLuckyBusy(true)
    try {
      const s = await api.radio(song?.id ?? null, [...q.played, ...q.ids])
      onSong(s)
      q.playNow(s.id)
    } catch (e) { alert((e as Error).message) }
    setLuckyBusy(false)
  }, [song, q, onSong])

  useEffect(() => {
    if (!q.smart || q.repeat !== 'off' || !isLast || !ready || !duration) return
    if (duration - time < SMART_AHEAD || time / duration > 0.6) recommend()
  }, [q.smart, q.repeat, isLast, ready, duration, time, recommend])

  const toggle = useCallback(() => {
    const a = audio.current
    if (!a || !ready) return
    if (a.paused) start(a, 'toggle').catch(() => {})
    else a.pause()
  }, [ready])
  const seek = useCallback((s: number) => { if (audio.current) audio.current.currentTime = s }, [])
  const next = useCallback(() => q.next(), [q])
  const prev = useCallback(() => {
    if (audio.current && audio.current.currentTime > 3) audio.current.currentTime = 0   // like every music player
    else q.prev()
  }, [q])

  async function ended() {
    if (audio.current?.src === SILENCE) return   // the iPhone unlock sound, not a song
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
    ms.setActionHandler('seekbackward', d => seek(Math.max(0, (audio.current?.currentTime ?? 0) - (d.seekOffset || 10))))
    ms.setActionHandler('seekforward', d => seek((audio.current?.currentTime ?? 0) + (d.seekOffset || 10)))
  }, [song, prev, next, seek])

  // the lock screen's progress bar and play / pause button
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.playbackState = song ? (playing ? 'playing' : 'paused') : 'none'
  }, [song, playing])
  const lastPos = useRef(0)
  useEffect(() => {
    if (!('mediaSession' in navigator) || !duration || !isFinite(duration)) return
    if (Math.abs(time - lastPos.current) < 5 && time > 1) return   // every few seconds is enough: it keeps counting
    lastPos.current = time
    try { navigator.mediaSession.setPositionState({ duration, position: Math.min(time, duration), playbackRate: 1 }) } catch { /* old Safari */ }
  }, [time, duration])

  // space bar: play / pause (unless typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (e.code === 'Space' && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'BUTTON') { e.preventDefault(); toggle() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])

  const tr: Transport = { playing, time, duration, toggle, seek, next, prev, lucky, luckyBusy }
  const preparing = song && !ready && song.status !== 'error'

  const el = (
    <audio ref={audio} preload="auto"
      onPlay={e => setPlaying(e.currentTarget.src !== SILENCE)} onPause={() => setPlaying(false)}
      onTimeUpdate={e => setTime(e.currentTarget.currentTime)}
      onDurationChange={e => setDuration(e.currentTarget.duration)}
      onEnded={ended} onError={e => {
        const err = e.currentTarget.error
        if (isPhone) report('audio error', { code: err?.code, msg: err?.message, src: e.currentTarget.src.slice(0, 40) })
        failed()
      }} />
  )
  if (pod) {
    return <>{el}<IPodMode {...pod} saved={saved} online={online} onSong={onSong} q={q} tr={tr} song={song} lyrics={lyrics}
      volume={volume} setVolume={setVolume} rerender={rerender} /></>
  }
  return (
    <>
      {el}

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
                  <a onClick={() => open(artistPage(leadArtist(song.artist)))}>{song.artist}</a>
                  {song.album && <> — <a onClick={() => open(albumPage(song.artist, song.album!))}>{song.album}</a></>}
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
          <ModeButtons q={q} />
          <LuckyButton tr={tr} />
          <button className={'square' + (drawer ? ' pressed' : '')} onClick={() => setDrawer(!drawer)} title={t('queue')}>
            <I.QueueIcon size={15} />
          </button>
        </div>
      </header>

      <QueueDrawer open={drawer} onClose={() => setDrawer(false)} q={q} byId={byId} onSong={onSong} smartBusy={smartBusy} />
      {full && song && (
        <NowPlaying song={song} tr={tr} lyrics={lyrics} q={q} preparing={!!preparing}
          onClose={() => setFull(false)} onQueue={() => setDrawer(true)} onSong={onSong}
          open={p => { setFull(false); open(p) }} />
      )}
    </>
  )
}

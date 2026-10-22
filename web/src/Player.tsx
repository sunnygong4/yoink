import { useEffect, useRef, useState } from 'react'
import { api, fmtTime, type Lyrics, type Song } from './api'

type Props = {
  song: Song | null
  autoplay: boolean          // false right after a page load: don't start blasting music on reload
  hasPrev: boolean
  hasNext: boolean
  onPrev: () => void
  onNext: () => void
  queue: Song[]
  pos: number
  onJump: (i: number) => void
  onRemove: (i: number) => void
}

export default function Player({ song, autoplay, hasPrev, hasNext, onPrev, onNext, queue, pos, onJump, onRemove }: Props) {
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [panel, setPanel] = useState<'none' | 'lyrics' | 'queue'>('none')
  const [lyrics, setLyrics] = useState<Lyrics | null>(null)

  useEffect(() => {
    const a = audio.current
    if (!a || !song) return
    a.src = api.audioUrl(song.id)
    setTime(0)
    if (autoplay) a.play().catch(() => setPlaying(false))
    setLyrics(null)
    if (song.lyrics) api.lyrics(song.id).then(setLyrics).catch(() => {})
  }, [song?.id])

  // lock screen / headphone controls
  useEffect(() => {
    if (!('mediaSession' in navigator) || !song) return
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.title, artist: song.artist, artwork: song.thumbnail ? [{ src: song.thumbnail }] : [],
    })
    const ms = navigator.mediaSession
    ms.setActionHandler('play', () => audio.current?.play())
    ms.setActionHandler('pause', () => audio.current?.pause())
    ms.setActionHandler('previoustrack', hasPrev ? onPrev : null)
    ms.setActionHandler('nexttrack', hasNext ? onNext : null)
    ms.setActionHandler('seekto', d => { if (audio.current && d.seekTime != null) audio.current.currentTime = d.seekTime })
  }, [song, hasPrev, hasNext, onPrev, onNext])

  function toggle() {
    const a = audio.current
    if (!a || !song) return
    if (a.paused) a.play()
    else a.pause()
  }

  const lt = time - (lyrics?.offset || 0)
  const lines = lyrics?.lines || []
  let current = -1
  for (let i = 0; i < lines.length && lines[i].t <= lt; i++) current = i

  const lineRef = useRef<HTMLParagraphElement>(null)
  useEffect(() => { lineRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }) }, [current, panel])

  return (
    <>
      {panel === 'lyrics' && (
        <div className="panel lyrics">
          {lines.length === 0 && <p className="muted">这首歌还没有歌词</p>}
          {lines.map((l, i) => (
            <p key={i} ref={i === current ? lineRef : undefined} className={i === current ? 'on' : ''}>
              {l.text}{l.tr && <span className="tr">{l.tr}</span>}
            </p>
          ))}
        </div>
      )}
      {panel === 'queue' && (
        <div className="panel">
          {queue.length === 0 && <p className="muted">队列是空的</p>}
          {queue.map((s, i) => (
            <div key={i} className={'row' + (i === pos ? ' now' : '')}>
              <button className="grow" onClick={() => onJump(i)}>
                <b>{s.title}</b> <span className="muted">{s.artist}</span>
              </button>
              <button className="icon" onClick={() => onRemove(i)} title="移出队列">✕</button>
            </div>
          ))}
        </div>
      )}
      <footer className="player">
        <audio ref={audio}
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
          onTimeUpdate={e => setTime(e.currentTarget.currentTime)}
          onDurationChange={e => setDuration(e.currentTarget.duration)}
          onEnded={() => hasNext && onNext()} />
        {song?.thumbnail ? <img className="cover" src={song.thumbnail} alt="" /> : <div className="cover" />}
        <div className="info">
          <div className="title">{song ? song.title : '还没有在播放'}</div>
          <div className="muted">{song?.artist}</div>
          <input type="range" min={0} max={duration || 0} step={0.1} value={time} disabled={!song}
            onChange={e => { if (audio.current) audio.current.currentTime = Number(e.target.value) }} />
          <div className="times muted"><span>{fmtTime(time)}</span><span>{fmtTime(duration)}</span></div>
        </div>
        <div className="controls">
          <button className="icon" onClick={onPrev} disabled={!hasPrev}>⏮</button>
          <button className="icon big" onClick={toggle} disabled={!song}>{playing ? '⏸' : '▶'}</button>
          <button className="icon" onClick={onNext} disabled={!hasNext}>⏭</button>
          <button className={'icon' + (panel === 'lyrics' ? ' active' : '')}
            onClick={() => setPanel(panel === 'lyrics' ? 'none' : 'lyrics')} title="歌词">词</button>
          <button className={'icon' + (panel === 'queue' ? ' active' : '')}
            onClick={() => setPanel(panel === 'queue' ? 'none' : 'queue')} title="播放队列">☰</button>
        </div>
      </footer>
    </>
  )
}

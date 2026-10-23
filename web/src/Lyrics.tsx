import { useEffect, useRef, useState } from 'react'
import { api, type Lyrics as LyricsData, type Song } from './api'
import { t } from './i18n'

/** The song's synced lyrics (null while loading or when it has none). */
export function useLyrics(song: Song | null): LyricsData | null {
  const [lyrics, setLyrics] = useState<LyricsData | null>(null)
  useEffect(() => {
    setLyrics(null)
    if (!song?.lyrics) return
    let live = true
    api.lyrics(song.id).then(l => { if (live) setLyrics(l) }).catch(() => {})
    return () => { live = false }
  }, [song?.id, song?.lyrics])
  return lyrics
}

/** Scrolling lyrics with the current line centred. Clicking a line seeks there; ± nudges the timing. */
export default function LyricsView({ lyrics, time, onSeek, songId }: {
  lyrics: LyricsData | null; time: number; onSeek: (t: number) => void; songId?: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const held = useRef(0)   // until when the reader's own scrolling wins over following the song
  const [offset, setOffset] = useState(0)
  useEffect(() => { setOffset(lyrics?.offset ?? 0) }, [lyrics])
  const lines = lyrics?.lines ?? []
  const lt = time - offset   // same convention as the karaoke site: a line shows at t + offset
  let current = -1
  for (let i = 0; i < lines.length && lines[i].t <= lt; i++) current = i

  useEffect(() => {
    const b = box.current
    const el = b?.querySelector<HTMLElement>('.on') ?? b?.querySelector<HTMLElement>('p')
    if (!el || !b || Date.now() < held.current) return
    // where the line sits inside the scrolling box (offsetTop is relative to some other ancestor)
    const top = el.getBoundingClientRect().top - b.getBoundingClientRect().top + b.scrollTop
    b.scrollTo({ top: top - b.clientHeight / 2 + el.offsetHeight / 2, behavior: 'smooth' })
  }, [current, lines.length])

  function nudge(by: number) {
    const next = Math.round((offset + by) * 10) / 10
    setOffset(next)
    if (songId) api.lyricsOffset(songId, next).catch(() => {})
  }

  if (!lines.length) return <div className="lyrics empty"><p>{t('noLyrics')}</p></div>
  return (
    <div className="lyrics-wrap">
      <div className="lyrics" ref={box} onWheel={() => { held.current = Date.now() + 4000 }} onTouchMove={() => { held.current = Date.now() + 4000 }}>
        {lines.map((l, i) => (
          <p key={i} className={i === current ? 'on' : i < current ? 'past' : ''} onClick={() => { held.current = 0; onSeek(l.t + offset) }}>
            {l.text}{l.tr && <span className="tr">{l.tr}</span>}
          </p>
        ))}
      </div>
      {songId && (
        <div className="lyrics-nudge">
          <button onClick={() => nudge(-0.5)} title={t('lyricsEarlier')}>−</button>
          <span>{offset === 0 ? t('lyricsTiming') : `${offset > 0 ? '+' : ''}${offset.toFixed(1)}s`}</span>
          <button onClick={() => nudge(0.5)} title={t('lyricsLater')}>+</button>
        </div>
      )}
    </div>
  )
}

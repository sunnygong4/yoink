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

/** Scrolling lyrics with the current line centred. Clicking a line seeks there. */
export default function LyricsView({ lyrics, time, onSeek }: {
  lyrics: LyricsData | null; time: number; onSeek: (t: number) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const lines = lyrics?.lines ?? []
  const offset = lyrics?.offset ?? 0
  const lt = time - offset   // same convention as the karaoke site: a line shows at t + offset
  let current = -1
  for (let i = 0; i < lines.length && lines[i].t <= lt; i++) current = i

  useEffect(() => {
    const el = box.current?.querySelector<HTMLElement>('.on')
    const b = box.current
    if (!el || !b) return
    b.scrollTo({ top: el.offsetTop - b.clientHeight / 2 + el.clientHeight / 2, behavior: 'smooth' })
  }, [current])

  if (!lines.length) return <div className="lyrics empty"><p>{t('noLyrics')}</p></div>
  return (
    <div className="lyrics" ref={box}>
      {lines.map((l, i) => (
        <p key={i} className={i === current ? 'on' : i < current ? 'past' : ''} onClick={() => onSeek(l.t + offset)}>
          {l.text}{l.tr && <span className="tr">{l.tr}</span>}
        </p>
      ))}
    </div>
  )
}

import { useEffect } from 'react'
import { api, fmtTime, type Lyrics, type Song } from './api'
import { t } from './i18n'
import * as I from './icons'
import LyricsView from './Lyrics'
import { AutoplaySwitch, LuckyButton, ModeButtons, type Transport } from './Modes'
import { albumPage, artistPage, type Page } from './Pages'
import type { Queue } from './queue'
import { leadArtist } from './text'

/** Full screen: the album cover as a spinning record, and the lyrics. */
export default function NowPlaying({ song, tr, lyrics, q, preparing, onClose, onQueue, onSong, open }: {
  song: Song; tr: Transport; lyrics: Lyrics | null; q: Queue; preparing: boolean
  onClose: () => void; onQueue: () => void; onSong: (s: Song) => void; open: (p: Page) => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    document.body.classList.add('no-scroll')
    return () => { window.removeEventListener('keydown', onKey); document.body.classList.remove('no-scroll') }
  }, [onClose])

  const pct = tr.duration ? (100 * tr.time) / tr.duration : 0
  const isLast = q.pos >= q.ids.length - 1

  return (
    <div className="full" role="dialog" aria-modal="true" aria-label={t('fullScreen')}>
      {song.thumbnail && <div className="full-bg" style={{ backgroundImage: `url("${song.thumbnail}")` }} />}
      <div className="full-top">
        <button className="ib" onClick={onClose} title={t('close')}><I.Down size={26} /></button>
        <span className="full-label">{t('nowPlaying')}</span>
        <button className="ib" onClick={onQueue} title={t('queue')}><I.QueueIcon /></button>
      </div>

      <div className="full-main">
        <div className="turntable">
          <div className={'vinyl' + (tr.playing ? ' spinning' : '')}>
            <div className="grooves" />
            {song.thumbnail ? <img className="label" src={song.thumbnail} alt="" onError={e => { e.currentTarget.style.visibility = 'hidden' }} /> : <div className="label blank" />}
            <div className="spindle" />
          </div>
          <svg className={'tonearm' + (tr.playing ? ' down' : '')} viewBox="0 0 100 300" aria-hidden="true">
            <circle cx="70" cy="30" r="18" className="arm-base" />
            <circle cx="70" cy="30" r="7" className="arm-pivot" />
            <path d="M70 30 L70 200 Q70 235 45 255" className="arm-rod" />
            <rect x="28" y="248" width="26" height="34" rx="4" transform="rotate(30 41 265)" className="arm-head" />
          </svg>
        </div>
        <LyricsView lyrics={lyrics} time={tr.time} onSeek={tr.seek} />
      </div>

      <div className="full-bottom">
        <div className="full-title">
          <div>
            <h1>{song.title}</h1>
            <p>{preparing ? t('preparing') : <>
              <a onClick={() => open(artistPage(leadArtist(song.artist)))}>{song.artist}</a>
              {song.album && <> · <a onClick={() => open(albumPage(song.artist, song.album!))}>{song.album}</a></>}
            </>}</p>
          </div>
          {song.radio && (
            <button className="chip" onClick={() => api.keep(song.id).then(onSong)}><I.Heart size={16} /> {t('keep')}</button>
          )}
        </div>
        <div className="seek big">
          <span>{fmtTime(tr.time)}</span>
          <input type="range" min={0} max={tr.duration || 0} step={0.1} value={Math.min(tr.time, tr.duration || 0)}
            onChange={e => tr.seek(Number(e.target.value))} style={{ '--p': `${pct}%` } as React.CSSProperties} />
          <span>{fmtTime(tr.duration)}</span>
        </div>
        <div className="buttons big">
          <ModeButtons q={q} only="shuffle" />
          <button className="ib" onClick={tr.prev} title={t('prev')}><I.Prev size={28} /></button>
          <button className="ib play" onClick={tr.toggle} disabled={preparing} title={tr.playing ? t('pause') : t('play')}>
            {tr.playing ? <I.Pause size={30} /> : <I.Play size={30} />}
          </button>
          <button className="ib" onClick={tr.next} disabled={isLast && q.repeat !== 'all'} title={t('next')}><I.Next size={28} /></button>
          <ModeButtons q={q} only="repeat" />
        </div>
        <div className="full-modes">
          <LuckyButton tr={tr} />
          <AutoplaySwitch q={q} />
        </div>
      </div>
    </div>
  )
}

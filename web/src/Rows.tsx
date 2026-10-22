import { useEffect, useState } from 'react'
import { api, fmtTime, type CatalogSong, type Song, type Source } from './api'
import { errorText, t } from './i18n'
import * as I from './icons'

// Rows shared by the search page and the artist / album pages: a catalog song (in the library or not, with
// 快速下载 / 单独选取), the source picker, and a library song's download state.

export type Actions = {
  play: (ids: string[], start?: number) => void
  playNext: (id: string) => void
  enqueue: (id: string) => void
}

export function SongStatus({ song }: { song: Song }) {
  if (song.status === 'error') {
    return <span className="status error">{t('failed', { error: errorText(song.error_code, song.error) })}{' '}
      <a onClick={e => { e.stopPropagation(); api.retry(song.id) }}>{t('retry')}</a></span>
  }
  return <span className="status">{song.status === 'working' ? t('downloading', { p: song.progress || 0 }) : t('queued')}</span>
}

export function CatalogRow({ song, odd, lib, currentId, open, onToggle, onAdded, play, enqueue, compact }: {
  song: CatalogSong; odd: boolean; lib?: Song; currentId?: string; open: boolean
  compact?: boolean   // on an album page: the cover and album are the page's, not repeated per track
  onToggle: () => void; onAdded: (s: Song) => void
} & Pick<Actions, 'play' | 'enqueue'>) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function quick() {
    setBusy(true)
    setError('')
    try { onAdded(await api.quick(song)) } catch (err) { setError((err as Error).message) }
    setBusy(false)
  }

  return (
    <>
      <div className={'result' + (odd ? ' odd' : '') + (lib && lib.id === currentId ? ' now' : '') + (compact ? ' compact' : '')}>
        {!compact && song.artwork ? <img className="art" src={song.artwork} alt="" loading="lazy" onError={e => { e.currentTarget.style.visibility = 'hidden' }} /> : !compact && <div className="art" />}
        <div className="result-text">
          <span className="name">{song.title}</span>
          <span className="sub">{compact ? `${song.artist} · ${fmtTime(song.duration)}`
            : <>{song.artist} — {song.album}{song.year && ` (${song.year})`} · {fmtTime(song.duration)}</>}</span>
          {lib && lib.status !== 'ready' && <SongStatus song={lib} />}
          {error && <span className="status error">{error}</span>}
        </div>
        {lib?.status === 'ready' ? <>
          <button className="pill" onClick={() => play([lib.id])}><I.Play size={11} /> {t('play')}</button>
          <button className="pill" onClick={() => enqueue(lib.id)}><I.Plus size={11} /></button>
        </> : !lib && <>
          <button className="pill blue" onClick={quick} disabled={busy} title={song.instant ? t('instantHint') : t('quickHint')}>
            {busy ? t('findingSource') : song.instant ? t('instant') : t('quickDownload')}
          </button>
          <button className={'pill' + (open ? ' pressed' : '')} onClick={onToggle}>{t('pickSource')}</button>
        </>}
      </div>
      {open && <SourcePicker song={song} onAdded={onAdded} />}
    </>
  )
}

export function SourcePicker({ song, onAdded }: { song: CatalogSong; onAdded: (s: Song) => void }) {
  const [where, setWhere] = useState('youtube')
  const [list, setList] = useState<Source[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setList(null)
    setError('')
    api.sources(song, where).then(setList).catch(e => setError((e as Error).message))
  }, [song, where])

  return (
    <div className="picker">
      <nav className="seg">
        <button className={where === 'youtube' ? 'on' : ''} onClick={() => setWhere('youtube')}>YouTube</button>
        <button className={where === 'bili' ? 'on' : ''} onClick={() => setWhere('bili')}>{t('bilibili')}</button>
      </nav>
      {error && <p className="error">{error}</p>}
      {!list && !error && <p className="muted small">{t('findingSources')}</p>}
      {list?.map(r => (
        <div key={r.source + r.id} className="source">
          <img src={r.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" />
          <div className="result-text">
            <span className="name">{r.title}</span>
            <span className="sub">{r.channel}{r.album && ` · ${r.album}`} · {fmtTime(r.duration)}
              {r.tags.map(tag => <span key={tag} className={'tag' + (tag === 'ytmusic' ? ' good' : '')}>
                {tag === 'ytmusic' ? t('official') : tag}</span>)}
              {Math.abs((r.duration || 0) - (song.duration || 0)) <= 2 && <span className="tag good">{t('sameLength')}</span>}
            </span>
          </div>
          <a className="mini" href={r.url} target="_blank" rel="noreferrer" title={t('openSource')}>↗</a>
          <button className="pill" onClick={() => api.add(r, song).then(onAdded).catch(e => setError((e as Error).message))}>{t('useThis')}</button>
        </div>
      ))}
    </div>
  )
}

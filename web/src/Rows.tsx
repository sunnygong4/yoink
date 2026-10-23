import { useEffect, useState } from 'react'
import { api, fmtTime, type CatalogSong, type Song, type Source } from './api'
import { errorText, t } from './i18n'
import * as I from './icons'
import { albumPage, artistPage, type Page } from './Pages'
import { leadArtist } from './text'

// Rows shared by the search page and the artist / album pages: a catalog song (in the library or not, with
// ▶ 播放 / 加入歌库 / ⋯ 单独选取), the source picker, and a library song's download state.

export type Actions = {
  play: (ids: string[], start?: number) => void
  playNext: (id: string) => void
  enqueue: (id: string) => void
  preview: (s: CatalogSong) => Promise<void>   // ▶ on a song that isn't in the library: just listen
}

export function SongStatus({ song }: { song: Song }) {
  if (song.status === 'error') {
    return <span className="status error">{t('failed', { error: errorText(song.error_code, song.error) })}{' '}
      <a onClick={e => { e.stopPropagation(); api.retry(song.id) }}>{t('retry')}</a></span>
  }
  return <span className="status">{song.status === 'working' ? t('downloading', { p: song.progress || 0 }) : t('queued')}</span>
}

export function CatalogRow({ song, odd, lib, currentId, open, onToggle, onAdded, play, preview, openPage, compact }: {
  song: CatalogSong; odd: boolean; lib?: Song; currentId?: string; open: boolean
  compact?: boolean   // on an album page: the cover and album are the page's, not repeated per track
  onToggle: () => void; onAdded: (s: Song) => void
  preview: (s: CatalogSong) => Promise<void>      // ▶ without adding it to the library
  openPage: (p: Page) => void
} & Pick<Actions, 'play'>) {
  const [busy, setBusy] = useState<'play' | 'add' | null>(null)
  const [error, setError] = useState('')
  const ready = lib?.status === 'ready'
  const downloaded = ready || song.instant   // white ▶: it's on the server; blue: it gets fetched first

  async function run(what: 'play' | 'add', f: () => Promise<unknown>) {
    setBusy(what)
    setError('')
    try { await f() } catch (err) { setError((err as Error).message) }
    setBusy(null)
  }

  return (
    <>
      <div className={'result' + (odd ? ' odd' : '') + (lib && lib.id === currentId ? ' now' : '') + (compact ? ' compact' : '')}>
        {!compact && song.artwork ? <img className="art" src={song.artwork} alt="" loading="lazy" onError={e => { e.currentTarget.style.visibility = 'hidden' }} /> : !compact && <div className="art" />}
        <div className="result-text">
          <span className="name">{song.title}</span>
          <span className="sub">
            <a onClick={() => openPage(artistPage(leadArtist(song.artist)))}>{song.artist}</a>
            {!compact && song.album && <> — <a onClick={() => openPage(albumPage(song.artist, song.album))}>{song.album}</a>{song.year && ` (${song.year})`}</>}
            {' · '}{fmtTime(song.duration)}
          </span>
          {lib && !ready && <SongStatus song={lib} />}
          {error && <span className="status error">{error}</span>}
        </div>
        <button className={'pill' + (downloaded ? '' : ' blue')} disabled={busy === 'play'}
          title={downloaded ? t('playHint') : t('previewHint')}
          onClick={() => ready ? play([lib!.id]) : run('play', () => preview(song))}>
          <I.Play size={10} /> {busy === 'play' ? t('findingSource') : t('play')}
        </button>
        {lib && lib.status !== 'error'
          ? <button className="pill" disabled title={t('inLibraryHint')}>✓ {t('inLibraryShort')}</button>
          : <button className="pill" disabled={busy === 'add'} onClick={() => run('add', async () => onAdded(await api.quick(song)))}>
            <I.Plus size={10} /> {busy === 'add' ? '…' : t('addToLibrary')}
          </button>}
        <button className={'pill' + (open ? ' pressed' : '')} onClick={onToggle} title={t('pickSource')}>⋯</button>
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

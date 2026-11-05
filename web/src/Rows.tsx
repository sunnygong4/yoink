import { useEffect, useRef, useState } from 'react'
import { api, fmtTime, type CatalogSong, type Song, type Source, type Upload, type UploadSong } from './api'
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
  // ▶ on a song that isn't in the library: just listen (how: now, next, or at the end of the queue)
  preview: (s: CatalogSong, how?: How) => Promise<void>
  listen: (r: Source, how?: How) => Promise<void>         // the same, for an upload found on YouTube
  // an album, in order from a track: the ones not in the library fetched one at a time, each while the one before plays
  playAlbum?: (tracks: AlbumTrack[], from?: number) => void
}
export type AlbumTrack = { track: CatalogSong; id?: string }   // id: the library's copy, ready to play

export type How = 'now' | 'next' | 'end'

// ---------- the button beside ▶: play next (▾: or add to the end of the queue; the choice is remembered) ----------

const QMODE = 'yoinker.queueMode'
const readMode = (): 'next' | 'end' => { try { return localStorage.getItem(QMODE) === 'end' ? 'end' : 'next' } catch { return 'next' } }

export function QueueButton({ run, cls = 'pill' }: { run: (how: 'next' | 'end') => Promise<unknown> | void; cls?: string }) {
  const [mode, setMode] = useState(readMode)
  const [menu, setMenu] = useState(false)
  const [state, setState] = useState<'' | 'busy' | 'done'>('')
  const box = useRef<HTMLSpanElement>(null)
  // every such button shows the same choice
  useEffect(() => {
    const on = () => setMode(readMode())
    window.addEventListener('yoinker-qmode', on)
    return () => window.removeEventListener('yoinker-qmode', on)
  }, [])
  useEffect(() => {
    if (!menu) return
    const off = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setMenu(false) }
    document.addEventListener('mousedown', off)
    return () => document.removeEventListener('mousedown', off)
  }, [menu])

  async function go(how: 'next' | 'end') {
    setMenu(false)
    setState('busy')
    try {
      await run(how)
      setState('done')
      setTimeout(() => setState(''), 1400)
    } catch (e) {
      setState('')
      alert((e as Error).message)
    }
  }
  function pick(how: 'next' | 'end') {
    try { localStorage.setItem(QMODE, how) } catch { /* private mode */ }
    window.dispatchEvent(new Event('yoinker-qmode'))
    go(how)
  }
  const label = (how: 'next' | 'end') => (how === 'next' ? t('playNext') : t('addToQueue'))
  const icon = (how: 'next' | 'end') => (how === 'next' ? <I.PlayNext size={11} /> : <I.Plus size={10} />)
  return (
    <span className="qbtn" ref={box} onDoubleClick={e => e.stopPropagation()}>
      <button className={cls + ' q-main'} disabled={state === 'busy'} onClick={e => { e.stopPropagation(); go(mode) }} title={label(mode)}>
        {state === 'done' ? '✓' : state === 'busy' ? '…' : icon(mode)} {label(mode)}
      </button>
      <button className={cls + ' q-more' + (menu ? ' pressed' : '')} onClick={e => { e.stopPropagation(); setMenu(!menu) }}
        aria-label={t('queueMenu')} title={t('queueMenu')}>▾</button>
      {menu && (
        <span className="q-menu" role="menu">
          {(['next', 'end'] as const).map(how => (
            <button key={how} role="menuitemradio" aria-checked={how === mode} className={how === mode ? 'on' : ''}
              onClick={e => { e.stopPropagation(); pick(how) }}>
              <span className="q-tick">{how === mode ? '✓' : ''}</span>{icon(how)} {label(how)}
            </button>
          ))}
        </span>
      )}
    </span>
  )
}

/** What an upload is called once added: a YouTube Music track has real details; a plain video is named from
 *  its title by the server (as an imported link is). */
export function uploadSong(r: Source | Upload): UploadSong | undefined {
  const art = `https://i.ytimg.com/vi/${r.id}/hqdefault.jpg`
  if (r.tags?.includes('ytmusic')) return { title: r.title, artist: r.channel, album: r.album ?? null, duration: r.duration, artwork: art }
  // a video: the name worked out from its title (the artist left blank when unclear: not the uploader's channel)
  const name = (r as Upload).name
  return name ? { title: name.title, artist: name.artist ?? '', duration: r.duration, artwork: art } : undefined
}

/** A song already on the server that the store catalog doesn't know: plays at once, + adds it. */
export function LocalRow({ song, inLibrary, odd, currentId, onPlay, onQueue, onAdded }: {
  song: Song; inLibrary: boolean; odd: boolean; currentId?: string; onPlay: () => void; onAdded: (s: Song) => void
  onQueue: (how: 'next' | 'end') => void
}) {
  const [busy, setBusy] = useState(false)
  const [mine, setMine] = useState(inLibrary)
  return (
    <div className={'result' + (odd ? ' odd' : '') + (song.id === currentId ? ' now' : '')} onDoubleClick={onPlay}>
      {song.thumbnail ? <img className="art" src={song.thumbnail} alt="" loading="lazy" /> : <div className="art" />}
      <div className="result-text">
        <span className="name">{song.title}</span>
        <span className="sub">{song.artist || t('artistUnknown')}{song.album && ` — ${song.album}`} · {fmtTime(song.duration)}
          {song.added_by && <> · <a onClick={e => { e.stopPropagation(); location.assign(`/usr/${encodeURIComponent(song.added_by!)}`) }}>{t('addedBy', { name: song.added_by })}</a></>}
          <span className="tag good">{t('onServer')}</span></span>
      </div>
      <button className="pill" onClick={onPlay} title={t('playHint')}><I.Play size={10} /> {t('play')}</button>
      <QueueButton run={onQueue} />
      {mine
        ? <button className="pill" disabled title={t('inLibraryHint')}>✓ {t('inLibraryShort')}</button>
        : <button className="pill" disabled={busy} onClick={async () => {
          setBusy(true)
          try { const s = await api.keep(song.id); setMine(true); onAdded(s) } catch (e) { alert((e as Error).message) }
          setBusy(false)
        }}><I.Plus size={10} /> {busy ? '…' : t('addToLibrary')}</button>}
    </div>
  )
}

/** A YouTube Music song / YouTube video found for the search: ▶ to listen, + to add. */
export function UploadRow({ r, odd, lib, currentId, listen, play, playNext, enqueue, onAdded }: {
  r: Upload; odd: boolean; lib?: Song; currentId?: string; onAdded: (s: Song) => void
} & Pick<Actions, 'listen' | 'play' | 'playNext' | 'enqueue'>) {
  const [busy, setBusy] = useState<'play' | 'add' | null>(null)
  const [error, setError] = useState('')
  const ready = lib?.status === 'ready'
  async function run(what: 'play' | 'add', f: () => Promise<unknown>) {
    setBusy(what)
    setError('')
    try { await f() } catch (err) { setError((err as Error).message) }
    setBusy(null)
  }
  return (
    <div className={'result' + (odd ? ' odd' : '') + (lib && lib.id === currentId ? ' now' : '')}>
      <img className="art wide" src={r.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" />
      <div className="result-text">
        <span className="name">{r.name?.title || r.title}{r.name?.artist && <span className="by"> — {r.name.artist}</span>}</span>
        <span className="sub" title={r.title}>
          {r.tags.includes('ytmusic') ? r.channel : t('uploadedBy', { name: r.channel })}{r.album && ` · ${r.album}`} · {fmtTime(r.duration)}
          {r.tags.includes('ytmusic') ? <span className="tag good">{t('official')}</span> : <span className="tag">YouTube</span>}
        </span>
        {lib && !ready && <SongStatus song={lib} />}
        {error && <span className="status error">{error}</span>}
      </div>
      <a className="mini" href={r.url} target="_blank" rel="noreferrer" title={t('openSource')}>↗</a>
      <button className={'pill' + (ready ? '' : ' blue')} disabled={busy === 'play'} title={ready ? t('playHint') : t('previewHint')}
        onClick={() => ready ? play([lib!.id]) : run('play', () => listen(r))}>
        <I.Play size={10} /> {busy === 'play' ? '…' : t('play')}
      </button>
      <QueueButton run={how => (ready ? (how === 'next' ? playNext : enqueue)(lib!.id) : listen(r, how))} />
      {lib && lib.status !== 'error' && !lib.radio
        ? <button className="pill" disabled title={t('inLibraryHint')}>✓ {t('inLibraryShort')}</button>
        : <button className="pill" disabled={busy === 'add'} onClick={() => run('add', async () => onAdded(await api.add(r, uploadSong(r))))}>
          <I.Plus size={10} /> {busy === 'add' ? '…' : t('addToLibrary')}
        </button>}
    </div>
  )
}

export function SongStatus({ song }: { song: Song }) {
  if (song.status === 'error') {
    return <span className="status error">{t('failed', { error: errorText(song.error_code, song.error) })}{' '}
      <a onClick={e => { e.stopPropagation(); api.retry(song.id) }}>{t('retry')}</a></span>
  }
  return <span className="status">{song.status === 'working' ? t('downloading', { p: song.progress || 0 }) : t('queued')}</span>
}

export function CatalogRow({ song, odd, lib, currentId, open, onToggle, onAdded, play, playNext, enqueue, preview, openPage, compact }: {
  song: CatalogSong; odd: boolean; lib?: Song; currentId?: string; open: boolean
  compact?: boolean   // on an album page: the cover and album are the page's, not repeated per track
  onToggle: () => void; onAdded: (s: Song) => void
  preview: (s: CatalogSong, how?: How) => Promise<void>      // ▶ without adding it to the library
  openPage: (p: Page) => void
} & Pick<Actions, 'play' | 'playNext' | 'enqueue'>) {
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
            {!compact && song.album && <> — <a onClick={() => openPage(albumPage(song.artist, song.album, song.album_id))}>{song.album}</a>{song.year && ` (${song.year})`}</>}
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
        <QueueButton run={how => (ready ? (how === 'next' ? playNext : enqueue)(lib!.id) : preview(song, how))} />
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

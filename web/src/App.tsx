import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, fmtTime, type CatalogSong, type Song, type Source, type User } from './api'
import { errorText, getLang, setLang, t } from './i18n'
import * as I from './icons'
import Import from './Import'
import Login from './Login'
import Player from './Player'
import { useQueue } from './queue'

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined)

  useEffect(() => {
    api.me().then(setUser).catch(() => setUser(null))
  }, [])

  if (user === undefined) return null
  if (!user) return <Login onDone={setUser} />
  return <Main user={user} onLogout={() => api.logout().finally(() => setUser(null))} />
}

function Main({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [, rerender] = useState(getLang())
  const [tab, setTab] = useState<'library' | 'search'>('library')
  const [songs, setSongs] = useState<Song[]>([])
  const [inviteLink, setInviteLink] = useState('')
  const [menu, setMenu] = useState(false)
  const q = useQueue()

  const refresh = useCallback(() => { api.songs().then(setSongs).catch(() => {}) }, [])

  // live updates: download progress, songs other people added
  useEffect(() => {
    refresh()
    const es = new EventSource('/api/events')
    let timer = 0
    es.onmessage = () => { clearTimeout(timer); timer = window.setTimeout(refresh, 300) }
    return () => { es.close(); clearTimeout(timer) }
  }, [refresh])

  // a song we just got from the server (a recommendation, a kept song): show it before the next refresh
  const onSong = useCallback((s: Song) => {
    setSongs(xs => xs.some(x => x.id === s.id) ? xs.map(x => (x.id === s.id ? s : x)) : [s, ...xs])
  }, [])

  const byId = useMemo(() => new Map(songs.map(s => [s.id, s])), [songs])
  const library = useMemo(() => songs.filter(s => !s.radio), [songs])

  async function invite() {
    const { code } = await api.invite()
    setInviteLink(`${location.origin}/?invite=${code}`)
  }

  const actions = { play: q.play, playNext: q.playNext, enqueue: q.enqueue }

  return (
    <div className="app">
      <header className="top">
        <div className="brand"><img src="/icon.svg" alt="" /><span>Yoinker</span></div>
        <nav className="tabs">
          <button className={tab === 'library' ? 'on' : ''} onClick={() => setTab('library')}>
            <I.Library size={18} /> {t('library')}
          </button>
          <button className={tab === 'search' ? 'on' : ''} onClick={() => setTab('search')}>
            <I.Search size={18} /> {t('find')}
          </button>
        </nav>
        <div className="me">
          <button className="avatar" onClick={() => setMenu(!menu)} title={user.name} aria-expanded={menu}>
            {user.name.slice(0, 1).toUpperCase()}
          </button>
          {menu && <>
            <div className="menu-catch" onClick={() => setMenu(false)} />
            <div className="menu" onClick={() => setMenu(false)}>
              <div className="menu-name">{user.name}</div>
              <button onClick={invite}>{t('invite')}</button>
              <button onClick={() => { const l = getLang() === 'zh' ? 'en' : 'zh'; setLang(l); rerender(l) }}>{t('language')}</button>
              <button onClick={onLogout}>{t('logout')}</button>
            </div>
          </>}
        </div>
      </header>
      {inviteLink && (
        <div className="notice">
          {t('inviteLink')}<input readOnly value={inviteLink} onFocus={e => e.target.select()} />
          <button className="link" onClick={() => setInviteLink('')}>{t('close')}</button>
        </div>
      )}
      <main>
        {tab === 'library'
          ? <Library songs={library} currentId={q.current} {...actions} />
          : <Search byId={byId} currentId={q.current} {...actions} />}
      </main>
      <Player q={q} byId={byId} onSong={onSong} />
    </div>
  )
}

type Actions = {
  play: (ids: string[], start?: number) => void
  playNext: (id: string) => void
  enqueue: (id: string) => void
}

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function Library({ songs, currentId, play, playNext, enqueue }: Actions & { songs: Song[]; currentId?: string }) {
  const [filter, setFilter] = useState('')
  const [importing, setImporting] = useState(false)
  const f = filter.trim().toLowerCase()
  const shown = f ? songs.filter(s => `${s.title} ${s.artist} ${s.album} ${s.added_by}`.toLowerCase().includes(f)) : songs
  const shownReady = shown.filter(s => s.status === 'ready').map(s => s.id)
  const readyCount = songs.filter(s => s.status === 'ready').length

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('library')}</h1>
          <p className="muted small">{songs.length ? t('songCount', { n: readyCount }) : t('emptyLibrary')}</p>
        </div>
        <div className="actions">
          <button className="primary" onClick={() => play(shownReady)} disabled={!shownReady.length}>
            <I.Play size={16} /> {t('playAll')}
          </button>
          <button onClick={() => play(shuffle(shownReady))} disabled={!shownReady.length}>
            <I.Shuffle size={16} /> {t('shuffle')}
          </button>
          <button onClick={() => setImporting(true)}><I.Upload size={16} /> {t('importBtn')}</button>
        </div>
      </div>
      {importing && <Import onClose={() => setImporting(false)} />}
      {songs.length > 0 && (
        <label className="filter">
          <I.Search size={16} />
          <input placeholder={t('filterLibrary')} value={filter} onChange={e => setFilter(e.target.value)} />
        </label>
      )}
      <div className="songs">
        {shown.map((s, i) => (
          <div key={s.id} className={'song' + (s.id === currentId ? ' now' : '') + (s.status !== 'ready' ? ' pending' : '')}
            onDoubleClick={() => s.status === 'ready' && play(shownReady, Math.max(0, shownReady.indexOf(s.id)))}>
            <button className="cover-btn" disabled={s.status !== 'ready'} title={t('play')}
              onClick={() => play(shownReady, Math.max(0, shownReady.indexOf(s.id)))}>
              {s.thumbnail ? <img src={s.thumbnail} alt="" loading="lazy" /> : <span className="blank">{i + 1}</span>}
              <span className="hover-play"><I.Play size={18} /></span>
            </button>
            <div className="song-text">
              <b>{s.title}</b>
              <span>{s.artist}</span>
              {s.status !== 'ready' && <SongStatus song={s} />}
            </div>
            <span className="song-album">{s.album}</span>
            <span className="song-by">{s.added_by}</span>
            <span className="song-time">{fmtTime(s.duration)}</span>
            <div className="song-actions">
              {s.status === 'ready' && <>
                <button className="ib" onClick={() => playNext(s.id)} title={t('playNext')}><I.PlayNext size={18} /></button>
                <button className="ib" onClick={() => enqueue(s.id)} title={t('addToQueue')}><I.Plus size={18} /></button>
                <a className="ib" href={api.downloadUrl(s.id)} download title={t('download')}><I.Download size={18} /></a>
              </>}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

function SongStatus({ song }: { song: Song }) {
  if (song.status === 'error') {
    return <span className="error">{t('failed', { error: errorText(song.error_code, song.error) })}{' '}
      <a onClick={e => { e.stopPropagation(); api.retry(song.id) }}>{t('retry')}</a></span>
  }
  return <span className="muted">{song.status === 'working' ? t('downloading', { p: song.progress || 0 }) : t('queued')}</span>
}

function Search({ byId, currentId, play, enqueue }: Actions & { byId: Map<string, Song>; currentId?: string }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<CatalogSong[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [added, setAdded] = useState<Record<string, string>>({})   // catalog key -> library song id
  const [open, setOpen] = useState<string | null>(null)            // catalog key whose sources are shown

  async function run(e: React.FormEvent) {
    e.preventDefault()
    if (!q.trim()) return
    setBusy(true)
    setError('')
    setOpen(null)
    try { setResults(await api.catalog(q)) } catch (err) { setError((err as Error).message) }
    setBusy(false)
  }

  const onAdded = (key: string, s: Song) => { setAdded(a => ({ ...a, [key]: s.id })); setOpen(null) }

  return (
    <>
      <div className="page-head"><h1>{t('find')}</h1></div>
      <form className="searchbar" onSubmit={run}>
        <I.Search size={18} />
        <input placeholder={t('searchPlaceholder')} value={q} onChange={e => setQ(e.target.value)} autoFocus />
        <button type="submit" className="primary" disabled={busy}>{busy ? t('searching') : t('search')}</button>
      </form>
      {error && <p className="error">{error}</p>}
      {results.map(r => (
        <CatalogRow key={r.key} song={r} lib={byId.get(added[r.key] || r.song_id || '')} currentId={currentId}
          open={open === r.key} onToggle={() => setOpen(open === r.key ? null : r.key)}
          onAdded={s => onAdded(r.key, s)} play={play} enqueue={enqueue} />
      ))}
    </>
  )
}

function CatalogRow({ song, lib, currentId, open, onToggle, onAdded, play, enqueue }: {
  song: CatalogSong; lib?: Song; currentId?: string; open: boolean
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
      <div className={'row' + (lib && lib.id === currentId ? ' now' : '')}>
        {song.artwork ? <img className="thumb square" src={song.artwork} alt="" loading="lazy" /> : <div className="thumb square" />}
        <div className="grow">
          <b>{song.title}</b>
          <span className="muted">{song.artist} · {song.album}{song.year && ` · ${song.year}`} · {fmtTime(song.duration)}</span>
          {lib && lib.status !== 'ready' && <SongStatus song={lib} />}
          {error && <span className="error">{error}</span>}
        </div>
        {lib?.status === 'ready' ? <>
          <button className="ib" onClick={() => play([lib.id])} title={t('play')}><I.Play size={18} /></button>
          <button className="ib" onClick={() => enqueue(lib.id)} title={t('addToQueue')}><I.Plus size={18} /></button>
        </> : !lib && <>
          <button className="primary" onClick={quick} disabled={busy} title={song.instant ? t('instantHint') : t('quickHint')}>
            {busy ? t('findingSource') : song.instant ? t('instant') : t('quickDownload')}
          </button>
          <button className={open ? 'active' : ''} onClick={onToggle}>{t('pickSource')}</button>
        </>}
      </div>
      {open && <SourcePicker song={song} onAdded={onAdded} />}
    </>
  )
}

function SourcePicker({ song, onAdded }: { song: CatalogSong; onAdded: (s: Song) => void }) {
  const [where, setWhere] = useState('youtube')
  const [list, setList] = useState<Source[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setList(null)
    setError('')
    api.sources(song, where).then(setList).catch(e => setError((e as Error).message))
  }, [song, where])

  return (
    <div className="sources">
      <div className="toolbar">
        <button className={where === 'youtube' ? 'active' : ''} onClick={() => setWhere('youtube')}>YouTube</button>
        <button className={where === 'bili' ? 'active' : ''} onClick={() => setWhere('bili')}>{t('bilibili')}</button>
      </div>
      {error && <p className="error">{error}</p>}
      {!list && !error && <p className="muted small">{t('findingSources')}</p>}
      {list?.map(r => (
        <div key={r.source + r.id} className="row">
          <img className="thumb" src={r.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" />
          <div className="grow">
            <b>{r.title}</b>
            <span className="muted">{r.channel}{r.album && ` · ${r.album}`} · {fmtTime(r.duration)}
              {r.tags.map(tag => <span key={tag} className={'tag' + (tag === 'ytmusic' ? ' good' : '')}>
                {tag === 'ytmusic' ? t('official') : tag}</span>)}
              {Math.abs((r.duration || 0) - (song.duration || 0)) <= 2 && <span className="tag good">{t('sameLength')}</span>}
            </span>
          </div>
          <a href={r.url} target="_blank" rel="noreferrer" title={t('openSource')}>↗</a>
          <button onClick={() => api.add(r, song).then(onAdded).catch(e => setError((e as Error).message))}>{t('useThis')}</button>
        </div>
      ))}
    </div>
  )
}

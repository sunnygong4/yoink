import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, fmtTime, type CatalogSong, type Song, type Source, type User } from './api'
import { errorText, getLang, setLang, t } from './i18n'
import Login from './Login'
import Player from './Player'

const SAVED = 'yoinker.queue'

function loadQueue(): { ids: string[]; pos: number } {
  try {
    const q = JSON.parse(localStorage.getItem(SAVED) || '')
    if (Array.isArray(q.ids)) return q
  } catch { /* nothing saved */ }
  return { ids: [], pos: 0 }
}

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
  const [queue, setQueue] = useState(loadQueue)
  const [autoplay, setAutoplay] = useState(false)
  const [inviteLink, setInviteLink] = useState('')

  const refresh = useCallback(() => { api.songs().then(setSongs).catch(() => {}) }, [])

  // live updates: download progress, songs other people added
  useEffect(() => {
    refresh()
    const es = new EventSource('/api/events')
    let t = 0
    es.onmessage = () => { clearTimeout(t); t = window.setTimeout(refresh, 300) }
    return () => { es.close(); clearTimeout(t) }
  }, [refresh])

  useEffect(() => {
    try { localStorage.setItem(SAVED, JSON.stringify(queue)) } catch { /* private mode */ }
  }, [queue])

  const byId = useMemo(() => new Map(songs.map(s => [s.id, s])), [songs])
  const queueSongs = queue.ids.map(id => byId.get(id)).filter((s): s is Song => !!s)
  const current = byId.get(queue.ids[queue.pos]) || null
  const ready = songs.filter(s => s.status === 'ready')

  function play(ids: string[], start = 0) {
    setAutoplay(true)
    setQueue({ ids, pos: start })
  }
  function playNext(id: string) {
    if (!current) return play([id])
    setQueue(q => ({ ids: [...q.ids.slice(0, q.pos + 1), id, ...q.ids.slice(q.pos + 1)], pos: q.pos }))
  }
  function enqueue(id: string) {
    if (!current) return play([id])
    setQueue(q => ({ ...q, ids: [...q.ids, id] }))
  }
  const go = (pos: number) => { setAutoplay(true); setQueue(q => ({ ...q, pos })) }
  function remove(i: number) {
    setQueue(q => ({ ids: q.ids.filter((_, j) => j !== i), pos: i < q.pos ? q.pos - 1 : q.pos }))
  }

  async function invite() {
    const { code } = await api.invite()
    setInviteLink(`${location.origin}/?invite=${code}`)
  }

  const actions = { play, playNext, enqueue }

  return (
    <div className="app">
      <header>
        <nav>
          <button className={tab === 'library' ? 'active' : ''} onClick={() => setTab('library')}>{t('library')}</button>
          <button className={tab === 'search' ? 'active' : ''} onClick={() => setTab('search')}>{t('find')}</button>
        </nav>
        <div className="me">
          <button className="link" onClick={() => { const l = getLang() === 'zh' ? 'en' : 'zh'; setLang(l); rerender(l) }}>
            {getLang() === 'zh' ? 'EN' : '中文'}
          </button>
          <button className="link" onClick={invite}>{t('invite')}</button>
          <span className="muted">{user.name}</span>
          <button className="link" onClick={onLogout}>{t('logout')}</button>
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
          ? <Library songs={songs} ready={ready} currentId={current?.id} {...actions} />
          : <Search byId={byId} currentId={current?.id} {...actions} />}
      </main>
      <Player song={current} autoplay={autoplay} queue={queueSongs} pos={queue.pos}
        hasPrev={queue.pos > 0} hasNext={queue.pos < queue.ids.length - 1}
        onPrev={() => go(queue.pos - 1)} onNext={() => go(queue.pos + 1)} onJump={go} onRemove={remove} />
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

function Library({ songs, ready, currentId, play, playNext, enqueue }: Actions & { songs: Song[]; ready: Song[]; currentId?: string }) {
  const [filter, setFilter] = useState('')
  const f = filter.trim().toLowerCase()
  const shown = f ? songs.filter(s => `${s.title} ${s.artist} ${s.added_by}`.toLowerCase().includes(f)) : songs
  const shownReady = shown.filter(s => s.status === 'ready').map(s => s.id)

  return (
    <>
      <div className="toolbar">
        <input placeholder={t('filterLibrary')} value={filter} onChange={e => setFilter(e.target.value)} />
        <button onClick={() => play(shownReady)} disabled={!shownReady.length}>{t('playAll')}</button>
        <button onClick={() => play(shuffle(shownReady))} disabled={!shownReady.length}>{t('shuffle')}</button>
      </div>
      <p className="muted small">{songs.length ? t('songCount', { n: ready.length }) : t('emptyLibrary')}</p>
      {shown.map(s => (
        <div key={s.id} className={'row' + (s.id === currentId ? ' now' : '')}>
          {s.thumbnail ? <img className="thumb square" src={s.thumbnail} alt="" loading="lazy" /> : <div className="thumb square" />}
          <button className="grow" disabled={s.status !== 'ready'}
            onClick={() => play(shownReady, Math.max(0, shownReady.indexOf(s.id)))}>
            <b>{s.title}</b>
            <span className="muted">{s.artist}{s.album && ` · ${s.album}`} · {fmtTime(s.duration)}{s.added_by && ` · ${t('addedBy', { name: s.added_by })}`}</span>
            {s.status !== 'ready' && <SongStatus song={s} />}
          </button>
          {s.status === 'ready' && <>
            <button className="icon" onClick={() => playNext(s.id)} title={t('playNext')}>⤵</button>
            <button className="icon" onClick={() => enqueue(s.id)} title={t('addToQueue')}>＋</button>
            <a className="icon" href={api.downloadUrl(s.id)} download title={t('download')}>⬇</a>
          </>}
        </div>
      ))}
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
      <form className="toolbar" onSubmit={run}>
        <input placeholder={t('searchPlaceholder')} value={q} onChange={e => setQ(e.target.value)} autoFocus />
        <button type="submit" disabled={busy}>{busy ? t('searching') : t('search')}</button>
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
          <button className="icon" onClick={() => play([lib.id])} title={t('play')}>▶</button>
          <button className="icon" onClick={() => enqueue(lib.id)} title={t('addToQueue')}>＋</button>
        </> : !lib && <>
          <button onClick={quick} disabled={busy} title={song.instant ? t('instantHint') : t('quickHint')}>
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

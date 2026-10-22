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

// Laid out like iTunes: the player across the top, a source list on the left, the songs in a striped list.
function Main({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [, rerender] = useState(getLang())
  const [tab, setTab] = useState<'library' | 'search'>('library')
  const [songs, setSongs] = useState<Song[]>([])
  const [inviteLink, setInviteLink] = useState('')
  const [importing, setImporting] = useState(false)
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
  const ready = library.filter(s => s.status === 'ready')
  const minutes = Math.round(ready.reduce((n, s) => n + (s.duration || 0), 0) / 60)

  async function invite() {
    const { code } = await api.invite()
    setInviteLink(`${location.origin}/?invite=${code}`)
  }

  const actions = { play: q.play, playNext: q.playNext, enqueue: q.enqueue }

  return (
    <div className="itunes">
      <Player q={q} byId={byId} onSong={onSong} />
      <div className="frame">
        <aside className="sourcelist">
          <h4>{t('libraryHeading')}</h4>
          <button className={tab === 'library' ? 'on' : ''} onClick={() => setTab('library')}>
            <I.Library size={15} /> <span>{t('library')}</span> <em>{library.length || ''}</em>
          </button>
          <h4>{t('storeHeading')}</h4>
          <button className={tab === 'search' ? 'on' : ''} onClick={() => setTab('search')}>
            <I.Search size={15} /> <span>{t('find')}</span>
          </button>
          <button onClick={() => setImporting(true)}><I.Upload size={15} /> <span>{t('importBtn')}</span></button>
          <h4>{user.name}</h4>
          <button onClick={invite}><I.Plus size={15} /> <span>{t('invite')}</span></button>
          <button onClick={() => { const l = getLang() === 'zh' ? 'en' : 'zh'; setLang(l); rerender(l) }}>
            <span className="glyph">文</span> <span>{t('language')}</span>
          </button>
          <button onClick={onLogout}><I.Close size={15} /> <span>{t('logout')}</span></button>
        </aside>

        <main className="content">
          {inviteLink && (
            <div className="notice">
              {t('inviteLink')}<input readOnly value={inviteLink} onFocus={e => e.target.select()} />
              <button onClick={() => setInviteLink('')}>{t('close')}</button>
            </div>
          )}
          {tab === 'library'
            ? <Library songs={library} currentId={q.current} onImport={() => setImporting(true)} {...actions} />
            : <Search byId={byId} currentId={q.current} {...actions} />}
        </main>
      </div>
      <footer className="statusbar">
        <nav className="seg mobile-tabs">
          <button className={tab === 'library' ? 'on' : ''} onClick={() => setTab('library')}>{t('library')}</button>
          <button className={tab === 'search' ? 'on' : ''} onClick={() => setTab('search')}>{t('find')}</button>
        </nav>
        <span className="status-text">{t('status', { n: ready.length, m: minutes })}</span>
      </footer>
      {importing && <Import onClose={() => setImporting(false)} />}
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

function Library({ songs, currentId, play, playNext, enqueue, onImport }: Actions & {
  songs: Song[]; currentId?: string; onImport: () => void
}) {
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const f = filter.trim().toLowerCase()
  const shown = f ? songs.filter(s => `${s.title} ${s.artist} ${s.album} ${s.added_by}`.toLowerCase().includes(f)) : songs
  const shownReady = shown.filter(s => s.status === 'ready').map(s => s.id)
  const playFrom = (id: string) => play(shownReady, Math.max(0, shownReady.indexOf(id)))
  // phones have no double click: a tap plays
  const touch = typeof matchMedia !== 'undefined' && matchMedia('(hover: none)').matches

  return (
    <>
      <div className="listbar">
        <button onClick={() => play(shownReady)} disabled={!shownReady.length}><I.Play size={12} /> {t('playAll')}</button>
        <button onClick={() => play(shuffle(shownReady))} disabled={!shownReady.length}><I.Shuffle size={12} /> {t('shuffle')}</button>
        <span className="grow" />
        <label className="searchfield">
          <I.Search size={12} />
          <input placeholder={t('filterLibrary')} value={filter} onChange={e => setFilter(e.target.value)} />
        </label>
      </div>
      {songs.length === 0 ? (
        <div className="empty">
          <p>{t('emptyLibrary')}</p>
          <button onClick={onImport}>{t('importBtn')}</button>
        </div>
      ) : (
        <table className="songlist">
          <thead>
            <tr>
              <th className="c-now" />
              <th>{t('colName')}</th>
              <th className="c-time">{t('colTime')}</th>
              <th>{t('colArtist')}</th>
              <th className="c-album">{t('colAlbum')}</th>
              <th className="c-by">{t('colAddedBy')}</th>
              <th className="c-act" />
            </tr>
          </thead>
          <tbody>
            {shown.map(s => {
              const ok = s.status === 'ready'
              return (
                <tr key={s.id} className={(s.id === selected ? 'sel' : '') + (ok ? '' : ' pending')}
                  onClick={() => { setSelected(s.id); if (touch && ok) playFrom(s.id) }}
                  onDoubleClick={() => ok && playFrom(s.id)}>
                  <td className="c-now">{s.id === currentId && <I.Volume size={13} />}</td>
                  <td className="c-name">
                    <span className="name">{s.title}</span>
                    <span className="sub">{s.artist}</span>
                    {!ok && <SongStatus song={s} />}
                  </td>
                  <td className="c-time">{fmtTime(s.duration)}</td>
                  <td className="c-artist">{s.artist}</td>
                  <td className="c-album">{s.album}</td>
                  <td className="c-by">{s.added_by}</td>
                  <td className="c-act">
                    {ok && <>
                      <button className="mini" onClick={e => { e.stopPropagation(); playNext(s.id) }} title={t('playNext')}><I.PlayNext size={13} /></button>
                      <button className="mini" onClick={e => { e.stopPropagation(); enqueue(s.id) }} title={t('addToQueue')}><I.Plus size={13} /></button>
                      <a className="mini" href={api.downloadUrl(s.id)} download title={t('download')} onClick={e => e.stopPropagation()}><I.Download size={13} /></a>
                    </>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </>
  )
}

function SongStatus({ song }: { song: Song }) {
  if (song.status === 'error') {
    return <span className="status error">{t('failed', { error: errorText(song.error_code, song.error) })}{' '}
      <a onClick={e => { e.stopPropagation(); api.retry(song.id) }}>{t('retry')}</a></span>
  }
  return <span className="status">{song.status === 'working' ? t('downloading', { p: song.progress || 0 }) : t('queued')}</span>
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
      <form className="listbar" onSubmit={run}>
        <label className="searchfield wide">
          <I.Search size={12} />
          <input placeholder={t('searchPlaceholder')} value={q} onChange={e => setQ(e.target.value)} autoFocus />
        </label>
        <button type="submit" className="blue" disabled={busy}>{busy ? t('searching') : t('search')}</button>
      </form>
      {error && <p className="error pad">{error}</p>}
      {results.length > 0 && (
        <div className="results">
          {results.map((r, i) => (
            <CatalogRow key={r.key} song={r} odd={i % 2 === 1} lib={byId.get(added[r.key] || r.song_id || '')}
              currentId={currentId} open={open === r.key} onToggle={() => setOpen(open === r.key ? null : r.key)}
              onAdded={s => onAdded(r.key, s)} play={play} enqueue={enqueue} />
          ))}
        </div>
      )}
    </>
  )
}

function CatalogRow({ song, odd, lib, currentId, open, onToggle, onAdded, play, enqueue }: {
  song: CatalogSong; odd: boolean; lib?: Song; currentId?: string; open: boolean
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
      <div className={'result' + (odd ? ' odd' : '') + (lib && lib.id === currentId ? ' now' : '')}>
        {song.artwork ? <img className="art" src={song.artwork} alt="" loading="lazy" onError={e => { e.currentTarget.style.visibility = 'hidden' }} /> : <div className="art" />}
        <div className="result-text">
          <span className="name">{song.title}</span>
          <span className="sub">{song.artist} — {song.album}{song.year && ` (${song.year})`} · {fmtTime(song.duration)}</span>
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

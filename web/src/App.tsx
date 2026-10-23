import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, fmtTime, type CatalogResults, type CatalogSong, type Song, type User } from './api'
import { getLang, setLang, t } from './i18n'
import * as I from './icons'
import CoverFlow, { type FlowAlbum } from './CoverFlow'
import DevicePage, { IPodPicture } from './Device'
import Import from './Import'
import Login from './Login'
import { albumPage, AlbumPage, artistPage, ArtistPage, HistoryPage, type Page, pageFromUrl, urlFor } from './Pages'
import Player from './Player'
import { useIPod } from './ipod'
import { useQueue } from './queue'
import { type Actions, CatalogRow, SongStatus } from './Rows'
import { flat, leadArtist } from './text'
import { getTheme, setTheme } from './theme'

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined)

  useEffect(() => {
    api.me().then(setUser).catch(() => setUser(null))
  }, [])

  if (user === undefined) return null
  if (!user) return <Login onDone={setUser} />
  return <Main user={user} onLogout={() => api.logout().finally(() => setUser(null))} />
}

// Laid out like iTunes: the player across the top, a source list on the left, the page on the right.
function Main({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [, rerender] = useState(0)
  // the page follows the address bar: links can be shared, and the browser's back button works
  const [page, setPage] = useState<Page>(pageFromUrl)
  const [depth, setDepth] = useState(0)   // in-app steps we can go back
  useEffect(() => {
    history.replaceState({ page, depth: 0 }, '', location.href)
    const onPop = (e: PopStateEvent) => { setPage(e.state?.page ?? pageFromUrl()); setDepth(e.state?.depth ?? 0) }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const [extra, setExtra] = useState<Map<string, Song>>(new Map())   // songs met outside the library (smart play)
  const [songs, setSongs] = useState<Song[]>([])
  const [inviteLink, setInviteLink] = useState('')
  const [importing, setImporting] = useState(false)
  const q = useQueue()
  const ipod = useIPod()
  const content = useRef<HTMLElement>(null)
  useEffect(() => { content.current?.scrollTo(0, 0) }, [page])

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
    setExtra(m => new Map(m).set(s.id, s))
    setSongs(xs => xs.some(x => x.id === s.id) ? xs.map(x => (x.id === s.id ? s : x)) : s.radio ? xs : [s, ...xs])
  }, [])

  const open = useCallback((p: Page) => {
    setDepth(d => {
      history.pushState({ page: p, depth: d + 1 }, '', urlFor(p))
      return d + 1
    })
    setPage(p)
  }, [])
  const go = (p: Page) => {   // the source list: a fresh start
    history.pushState({ page: p, depth: 0 }, '', urlFor(p))
    setPage(p)
    setDepth(0)
  }
  const back = () => history.back()

  const byId = useMemo(() => new Map([...extra, ...songs.map(s => [s.id, s] as const)]), [songs, extra])
  const library = useMemo(() => songs.filter(s => !s.radio), [songs])
  const ready = library.filter(s => s.status === 'ready')
  const minutes = Math.round(ready.reduce((n, s) => n + (s.duration || 0), 0) / 60)

  async function invite() {
    const { code } = await api.invite()
    setInviteLink(`${location.origin}/?invite=${code}`)
  }

  // ▶ on a song that isn't in the library: fetch it just to listen, and play it right away
  const preview = useCallback(async (song: CatalogSong) => {
    const s = await api.preview(song)
    onSong(s)
    q.playNow(s.id)
  }, [onSong, q])
  const actions = { play: q.play, playNext: q.playNext, enqueue: q.enqueue, preview }
  const common = { ...actions, byId, library, currentId: q.current, open }

  return (
    <div className="itunes">
      <Player q={q} byId={byId} onSong={onSong} open={open} />
      <div className="frame">
        <aside className="sourcelist">
          <h4>{t('libraryHeading')}</h4>
          <button className={page.kind === 'library' ? 'on' : ''} onClick={() => go({ kind: 'library' })}>
            <I.Library size={15} /> <span>{t('library')}</span> <em>{library.length || ''}</em>
          </button>
          <h4>{t('storeHeading')}</h4>
          <button className={page.kind === 'search' ? 'on' : ''} onClick={() => go({ kind: 'search' })}>
            <I.Search size={15} /> <span>{t('find')}</span>
          </button>
          <button onClick={() => setImporting(true)}><I.Upload size={15} /> <span>{t('importBtn')}</span></button>
          <h4>{t('devicesHeading')}</h4>
          <button className={page.kind === 'device' ? 'on' : ''} onClick={() => go({ kind: 'device' })}>
            <IPodPicture small /> <span>{ipod.status?.paired ? ipod.status.name : 'iPod'}</span>
            {ipod.status?.paired && <em>{ipod.status.songs.length}</em>}
          </button>
          <h4>{user.name}</h4>
          <button className={page.kind === 'history' ? 'on' : ''} onClick={() => go({ kind: 'history' })}>
            <span className="glyph">◷</span> <span>{t('history')}</span>
          </button>
          <button onClick={invite}><I.Plus size={15} /> <span>{t('invite')}</span></button>
          <button onClick={() => { setLang(getLang() === 'zh' ? 'en' : 'zh'); rerender(n => n + 1) }}>
            <span className="glyph">文</span> <span>{t('language')}</span>
          </button>
          <button onClick={() => { setTheme(getTheme() === 'classic' ? 'yoinker' : 'classic'); rerender(n => n + 1) }}
            title={t('themeHint')}>
            <span className="glyph">◐</span> <span>{t('theme', { name: getTheme() === 'classic' ? 'Classic' : 'Yoinker' })}</span>
          </button>
          <button onClick={onLogout}><I.Close size={15} /> <span>{t('logout')}</span></button>
        </aside>

        <main className="content" ref={content}>
          {inviteLink && (
            <div className="notice">
              {t('inviteLink')}<input readOnly value={inviteLink} onFocus={e => e.target.select()} />
              <button onClick={() => setInviteLink('')}>{t('close')}</button>
            </div>
          )}
          {depth > 0 && (
            <div className="crumbs">
              <button className="back" onClick={back}><I.Prev size={10} /> {t('back')}</button>
            </div>
          )}
          {page.kind === 'library' && <Library songs={library} onImport={() => setImporting(true)} onRemove={id => { api.remove(id).then(refresh) }} {...common} />}
          {page.kind === 'search' && <Search byId={byId} currentId={q.current} open={open} {...actions} />}
          {page.kind === 'history' && <HistoryPage {...common} onSong={onSong} />}
          {page.kind === 'device' && <DevicePage ipod={ipod} user={user} library={library} />}
          {page.kind === 'artist' && <ArtistPage key={page.key} pageKey={page.key} {...common} />}
          {page.kind === 'album' && <AlbumPage key={page.key} pageKey={page.key} {...common} />}
        </main>
      </div>
      <footer className="statusbar">
        <nav className="seg mobile-tabs">
          <button className={page.kind === 'library' ? 'on' : ''} onClick={() => go({ kind: 'library' })}>{t('library')}</button>
          <button className={page.kind === 'search' ? 'on' : ''} onClick={() => go({ kind: 'search' })}>{t('find')}</button>
          <button onClick={() => { setTheme(getTheme() === 'classic' ? 'yoinker' : 'classic'); rerender(n => n + 1) }}>◐</button>
        </nav>
        <span className="status-text">{t('status', { n: ready.length, m: minutes })}</span>
      </footer>
      {importing && <Import onClose={() => setImporting(false)} />}
    </div>
  )
}

function fmtDate(t: number | null) {
  return t ? new Date(t * 1000).toLocaleDateString(getLang() === 'zh' ? 'zh-CN' : undefined) : ''
}

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ---------- the library: songs or albums, sortable columns ----------

type SortKey = 'added' | 'title' | 'time' | 'artist' | 'album'
type Sort = { key: SortKey; dir: 1 | -1 }
const PREFS = 'yoinker.library'

function loadPrefs(): { view: 'songs' | 'albums'; sort: Sort } {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS) || '')
    if (p.view && p.sort) return p
  } catch { /* nothing saved */ }
  return { view: 'songs', sort: { key: 'added', dir: -1 } }
}

type Group = { key: string; album: string; artist: string; cover: string | null; songs: Song[] }
type Item = { kind: 'song'; song: Song } | { kind: 'album'; group: Group }

/** Songs from the same album (two or more of them) become one album entry. */
function groupAlbums(songs: Song[]): Item[] {
  const groups = new Map<string, Song[]>()
  for (const s of songs) {
    if (!s.album) continue
    const k = `${flat(s.album)}|${flat(leadArtist(s.artist))}`
    groups.set(k, [...(groups.get(k) ?? []), s])
  }
  const done = new Set<string>()
  const items: Item[] = []
  for (const s of songs) {
    const k = s.album ? `${flat(s.album)}|${flat(leadArtist(s.artist))}` : ''
    const g = k ? groups.get(k)! : []
    if (g.length < 2) { items.push({ kind: 'song', song: s }); continue }
    if (done.has(k)) continue
    done.add(k)
    items.push({ kind: 'album', group: { key: k, album: s.album!, artist: leadArtist(s.artist), cover: s.thumbnail, songs: g } })
  }
  return items
}

function Library({ songs, currentId, open, onImport, onRemove, play, playNext, enqueue }: Actions & {
  songs: Song[]; currentId?: string; open: (p: Page) => void; onImport: () => void; onRemove: (id: string) => void
}) {
  const [prefs, setPrefs] = useState(loadPrefs)
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [picked, setPicked] = useState<string | null>(null)   // the album Cover Flow is showing
  useEffect(() => { try { localStorage.setItem(PREFS, JSON.stringify(prefs)) } catch { /* private mode */ } }, [prefs])

  const f = filter.trim().toLowerCase()
  const shown = f ? songs.filter(s => `${s.title} ${s.artist} ${s.album} ${s.added_by}`.toLowerCase().includes(f)) : songs
  const collator = useMemo(() => new Intl.Collator(getLang() === 'zh' ? 'zh' : 'en', { numeric: true, sensitivity: 'base' }), [])
  const { key, dir } = prefs.sort

  const value = (it: Item): string | number => {
    const ss = it.kind === 'song' ? [it.song] : it.group.songs
    const s = ss[0]
    switch (key) {
      case 'added': return Math.max(...ss.map(x => x.added_at || 0))
      case 'title': return it.kind === 'album' ? it.group.album : s.title
      case 'time': return ss.reduce((n, x) => n + (x.duration || 0), 0)
      case 'artist': return s.artist
      case 'album': return s.album || '￿'   // songs without an album last
    }
  }
  // every album in the library (one song is enough for Cover Flow), in the list's order
  const albumKey = (s: Song) => (s.album ? `${flat(s.album)}|${flat(leadArtist(s.artist))}` : '')
  const flow: FlowAlbum[] = []
  const flowSongs = new Map<string, Song[]>()
  if (prefs.view === 'albums') {
    for (const s of shown) {
      const k = albumKey(s)
      if (!k) continue
      if (!flowSongs.has(k)) {
        flowSongs.set(k, [])
        flow.push({ key: k, album: s.album!, artist: leadArtist(s.artist), cover: s.thumbnail, count: 0 })
      }
      flowSongs.get(k)!.push(s)
    }
    for (const a of flow) a.count = flowSongs.get(a.key)!.length
  }
  const pickedSongs = picked ? flowSongs.get(picked) : undefined
  const items = (prefs.view === 'albums'
    ? (pickedSongs ? pickedSongs.map(song => ({ kind: 'song', song }) as Item) : groupAlbums(shown))
    : shown.map(song => ({ kind: 'song', song }) as Item))
    .sort((a, b) => {
      const va = value(a), vb = value(b)
      const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : collator.compare(String(va), String(vb))
      return c * dir
    })
  // the play order follows what's on screen
  const order = items.flatMap(it => it.kind === 'song' ? [it.song] : it.group.songs).filter(s => s.status === 'ready').map(s => s.id)
  const playFrom = (id: string) => play(order, Math.max(0, order.indexOf(id)))
  const touch = typeof matchMedia !== 'undefined' && matchMedia('(hover: none)').matches   // phones: a tap plays

  const sortBy = (k: SortKey) => setPrefs(p => ({ ...p, sort: { key: k, dir: p.sort.key === k ? (-p.sort.dir as 1 | -1) : (k === 'added' ? -1 : 1) } }))
  const th = (k: SortKey, label: string, className?: string) => (
    <th className={(className ?? '') + (key === k ? ' sorted' : '')} onClick={() => sortBy(k)}>
      {label}{key === k && <span className="arrow">{dir === 1 ? '▲' : '▼'}</span>}
    </th>
  )
  const toggle = (k: string) => setExpanded(e => { const n = new Set(e); if (n.has(k)) n.delete(k); else n.add(k); return n })

  const songRow = (s: Song, inAlbum = false) => {
    const ok = s.status === 'ready'
    return (
      <tr key={s.id} className={(s.id === selected ? 'sel' : '') + (ok ? '' : ' pending') + (inAlbum ? ' in-album' : '')}
        onClick={() => { setSelected(s.id); if (touch && ok) playFrom(s.id) }}
        onDoubleClick={() => ok && playFrom(s.id)}>
        <td className="c-now">{s.id === currentId && <I.Volume size={13} />}</td>
        <td className="c-name">
          <span className="name">{s.title}</span>
          <span className="sub">{s.artist}</span>
          {!ok && <SongStatus song={s} />}
        </td>
        <td className="c-time">{fmtTime(s.duration)}</td>
        <td className="c-artist">
          <a onClick={e => { e.stopPropagation(); open(artistPage(leadArtist(s.artist))) }}>{s.artist}</a>
        </td>
        <td className="c-album">
          {s.album && <a onClick={e => { e.stopPropagation(); open(albumPage(s.artist, s.album!)) }}>{s.album}</a>}
        </td>
        <td className="c-by">{fmtDate(s.added_at)}</td>
        <td className="c-act">
          {ok && <>
            <button className="mini" onClick={e => { e.stopPropagation(); playNext(s.id) }} title={t('playNext')}><I.PlayNext size={13} /></button>
            <button className="mini" onClick={e => { e.stopPropagation(); enqueue(s.id) }} title={t('addToQueue')}><I.Plus size={13} /></button>
            <a className="mini" href={api.downloadUrl(s.id)} download title={t('download')} onClick={e => e.stopPropagation()}><I.Download size={13} /></a>
          </>}
          <button className="mini" onClick={e => { e.stopPropagation(); onRemove(s.id) }} title={t('removeFromLibrary')}><I.Close size={12} /></button>
        </td>
      </tr>
    )
  }

  const albumRow = (g: Group) => {
    const ids = g.songs.filter(s => s.status === 'ready').map(s => s.id)
    const isOpen = expanded.has(g.key)
    const playing = g.songs.some(s => s.id === currentId)
    return [
      <tr key={g.key} className={'album-row' + (selected === g.key ? ' sel' : '')}
        onClick={() => { setSelected(g.key); toggle(g.key) }} onDoubleClick={() => ids.length && play(ids)}>
        <td className="c-now">{playing ? <I.Volume size={13} /> : <span className="caret">{isOpen ? '▾' : '▸'}</span>}</td>
        <td className="c-name">
          <span className="album-cell">
            {g.cover ? <img src={g.cover} alt="" loading="lazy" /> : <span className="blank" />}
            <span>
              <a className="name" onClick={e => { e.stopPropagation(); open(albumPage(g.artist, g.album)) }}>{g.album}</a>
              <span className="count">{t('nSongs', { n: g.songs.length })}</span>
            </span>
          </span>
        </td>
        <td className="c-time">{fmtTime(g.songs.reduce((n, s) => n + (s.duration || 0), 0))}</td>
        <td className="c-artist">
          <a onClick={e => { e.stopPropagation(); open(artistPage(g.artist)) }}>{g.artist}</a>
        </td>
        <td className="c-album" />
        <td className="c-by" />
        <td className="c-act">
          <button className="mini" disabled={!ids.length} onClick={e => { e.stopPropagation(); play(ids) }} title={t('play')}><I.Play size={11} /></button>
        </td>
      </tr>,
      ...(isOpen ? g.songs.map(s => songRow(s, true)) : []),
    ]
  }

  return (
    <>
      <div className="listbar">
        <button onClick={() => play(order)} disabled={!order.length}><I.Play size={12} /> {t('playAll')}</button>
        <button onClick={() => play(shuffle(order))} disabled={!order.length}><I.Shuffle size={12} /> {t('shuffle')}</button>
        <nav className="seg view-seg">
          <button className={prefs.view === 'songs' ? 'on' : ''} onClick={() => setPrefs(p => ({ ...p, view: 'songs' }))}>{t('viewSongs')}</button>
          <button className={prefs.view === 'albums' ? 'on' : ''} onClick={() => setPrefs(p => ({ ...p, view: 'albums' }))}>{t('viewAlbums')}</button>
        </nav>
        <span className="grow" />
        <label className="searchfield">
          <I.Search size={12} />
          <input placeholder={t('filterLibrary')} value={filter} onChange={e => setFilter(e.target.value)} />
        </label>
      </div>
      {prefs.view === 'albums' && flow.length > 0 && (
        <CoverFlow albums={[...flow].sort((a, b) => {
          // the row follows the list's sort; albums are compared by their first song
          const ia = items.findIndex(it => (it.kind === 'album' ? it.group.key : albumKey(it.song)) === a.key)
          const ib = items.findIndex(it => (it.kind === 'album' ? it.group.key : albumKey(it.song)) === b.key)
          return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib)
        })} picked={pickedSongs ? picked : null} onPick={setPicked}
          onPlay={k => play((flowSongs.get(k) ?? []).filter(s => s.status === 'ready').map(s => s.id))}
          onOpen={a => open(albumPage(a.artist, a.album))} />
      )}
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
              {th('title', t('colName'))}
              {th('time', t('colTime'), 'c-time')}
              {th('artist', t('colArtist'), 'c-artist')}
              {th('album', t('colAlbum'), 'c-album')}
              {th('added', t('colAdded'), 'c-by')}
              <th className="c-act" />
            </tr>
          </thead>
          <tbody>
            {items.flatMap(it => it.kind === 'song' ? [songRow(it.song)] : albumRow(it.group))}
          </tbody>
        </table>
      )}
    </>
  )
}

function Search({ byId, currentId, open, ...actions }: Actions & { byId: Map<string, Song>; currentId?: string; open: (p: Page) => void }) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState<CatalogResults | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [added, setAdded] = useState<Record<string, string>>({})   // catalog key -> library song id
  const [picker, setPicker] = useState<string | null>(null)        // catalog key whose sources are shown

  async function run(term = q) {
    if (!term.trim()) return
    setBusy(true)
    setError('')
    setPicker(null)
    try { setRes(await api.catalog(term)) } catch (err) { setError((err as Error).message) }
    setBusy(false)
  }

  const top = res?.top
  const topCover = top?.kind === 'album' ? top.artwork
    : top && res?.albums.find(a => flat(leadArtist(a.artist)) === flat(top.name))?.artwork   // an artist's face: their album cover
  return (
    <>
      <div className="listbar">
        <SearchBox value={q} onChange={setQ} busy={busy} onSearch={term => { setQ(term); run(term) }}
          onArtist={name => open(artistPage(name))} />
      </div>
      {error && <p className="error pad">{error}</p>}
      {res && (
        <div className="search-results">
          {top && (
            <section className="top-result">
              <h2 className="section-title">{t('topResult')}</h2>
              <button className="top-card" onClick={() => open(top.kind === 'artist' ? artistPage(top.name) : albumPage(top.artist, top.title))}>
                {topCover ? <img className={top.kind === 'artist' ? 'round' : ''} src={topCover} alt="" /> : <span className="blank">♫</span>}
                <span className="top-text">
                  <b>{top.kind === 'artist' ? top.name : top.title}</b>
                  <span>{top.kind === 'artist' ? [t('artistKind'), top.genre].filter(Boolean).join(' · ') : `${t('albumKind')} · ${top.artist}${top.year ? ` · ${top.year}` : ''}`}</span>
                </span>
                <span className="top-open">{t('openPage')} ›</span>
              </button>
            </section>
          )}
          {res.artists.length > (top?.kind === 'artist' ? 1 : 0) && (
            <section>
              <h2 className="section-title">{t('artistsTitle')}</h2>
              <div className="chips">
                {res.artists.filter(a => !(top?.kind === 'artist' && a.name === top.name)).map(a => (
                  <button key={a.name} className="pill" onClick={() => open(artistPage(a.name))}>{a.name}</button>
                ))}
              </div>
            </section>
          )}
          {res.albums.length > 0 && (
            <section>
              <h2 className="section-title">{t('albumsTitle')}</h2>
              <div className="covers one-row">
                {res.albums.map(a => (
                  <button key={a.title + a.artist} className="cover-tile" onClick={() => open(albumPage(a.artist, a.title))}>
                    {a.artwork ? <img src={a.artwork} alt="" loading="lazy" /> : <span className="art" />}
                    <span className="name">{a.title}</span>
                    <span className="sub">{a.artist}{a.year && ` · ${a.year}`}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
          {res.songs.length > 0 && (
            <section>
              <h2 className="section-title">{t('songsTitle')}</h2>
              <div className="results">
                {res.songs.map((r, i) => (
                  <CatalogRow key={r.key} song={r} odd={i % 2 === 1} lib={byId.get(added[r.key] || r.song_id || '')}
                    currentId={currentId} open={picker === r.key} onToggle={() => setPicker(picker === r.key ? null : r.key)}
                    onAdded={s => { setAdded(a => ({ ...a, [r.key]: s.id })); setPicker(null) }}
                    play={actions.play} preview={actions.preview} openPage={open} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </>
  )
}

/** The search field with Google-style suggestions: artists whose name starts like this, then the plain query. */
function SearchBox({ value, onChange, onSearch, onArtist, busy }: {
  value: string; onChange: (v: string) => void; onSearch: (q: string) => void; onArtist: (name: string) => void; busy: boolean
}) {
  const [items, setItems] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(-1)

  useEffect(() => {
    const term = value.trim()
    if (!term || term.length < (/[\u3400-\u9fff]/.test(term) ? 1 : 2)) { setItems([]); return }
    let live = true
    const timer = window.setTimeout(() => {
      api.suggest(term).then(r => { if (live) { setItems(r); setHi(-1) } }).catch(() => {})
    }, 250)
    return () => { live = false; clearTimeout(timer) }
  }, [value])

  const options = [...items.map(name => ({ kind: 'artist' as const, name })), ...(value.trim() ? [{ kind: 'query' as const, name: value.trim() }] : [])]
  const choose = (o: typeof options[number]) => {
    setOpen(false)
    if (o.kind === 'artist') onArtist(o.name)
    else onSearch(o.name)
  }

  return (
    <form className="searchbox" onSubmit={e => { e.preventDefault(); if (hi >= 0 && options[hi]) choose(options[hi]); else { setOpen(false); onSearch(value) } }}>
      <label className="searchfield wide">
        <I.Search size={12} />
        <input placeholder={t('searchPlaceholder')} value={value} autoFocus
          onChange={e => { onChange(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi(h => Math.min(options.length - 1, h + 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(-1, h - 1)) }
            else if (e.key === 'Escape') setOpen(false)
          }} />
      </label>
      <button type="submit" className="blue" disabled={busy}>{busy ? t('searching') : t('search')}</button>
      {open && options.length > 0 && (
        <ul className="suggest">
          {options.map((o, i) => (
            <li key={o.kind + o.name} className={i === hi ? 'hi' : ''} onMouseDown={e => { e.preventDefault(); choose(o) }}
              onMouseEnter={() => setHi(i)}>
              {o.kind === 'artist'
                ? <><b>{o.name}</b><span className="kind">{t('artistKind')}</span></>
                : <><I.Search size={11} /> {t('searchFor', { q: o.name })}</>}
            </li>
          ))}
        </ul>
      )}
    </form>
  )
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, fmtTime, type SearchResult, type Song, type User } from './api'
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
          <button className={tab === 'library' ? 'active' : ''} onClick={() => setTab('library')}>歌库</button>
          <button className={tab === 'search' ? 'active' : ''} onClick={() => setTab('search')}>搜歌</button>
        </nav>
        <div className="me">
          <button className="link" onClick={invite}>邀请</button>
          <span className="muted">{user.name}</span>
          <button className="link" onClick={onLogout}>退出</button>
        </div>
      </header>
      {inviteLink && (
        <div className="notice">
          邀请链接（只能用一次）：<input readOnly value={inviteLink} onFocus={e => e.target.select()} />
          <button className="link" onClick={() => setInviteLink('')}>关闭</button>
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
        <input placeholder="在歌库里找…" value={filter} onChange={e => setFilter(e.target.value)} />
        <button onClick={() => play(shownReady)} disabled={!shownReady.length}>▶ 全部</button>
        <button onClick={() => play(shuffle(shownReady))} disabled={!shownReady.length}>🔀 随机</button>
      </div>
      <p className="muted small">{ready.length} 首歌</p>
      {shown.map(s => (
        <div key={s.id} className={'row' + (s.id === currentId ? ' now' : '')}>
          {s.thumbnail ? <img className="thumb" src={s.thumbnail} alt="" loading="lazy" /> : <div className="thumb" />}
          <button className="grow" disabled={s.status !== 'ready'}
            onClick={() => play(shownReady, Math.max(0, shownReady.indexOf(s.id)))}>
            <b>{s.title}</b>
            <span className="muted">{s.artist} · {fmtTime(s.duration)}{s.added_by && ` · ${s.added_by} 加的`}</span>
            {s.status !== 'ready' && <SongStatus song={s} />}
          </button>
          {s.status === 'ready' && <>
            <button className="icon" onClick={() => playNext(s.id)} title="下一首播放">⤵</button>
            <button className="icon" onClick={() => enqueue(s.id)} title="加入队列">＋</button>
          </>}
        </div>
      ))}
    </>
  )
}

function SongStatus({ song }: { song: Song }) {
  if (song.status === 'error') {
    return <span className="error">下载失败：{song.error} <a onClick={e => { e.stopPropagation(); api.retry(song.id) }}>重试</a></span>
  }
  return <span className="muted">{song.status === 'working' ? `下载中 ${song.progress || 0}%` : '排队中…'}</span>
}

function Search({ byId, currentId, play, enqueue }: Actions & { byId: Map<string, Song>; currentId?: string }) {
  const [q, setQ] = useState('')
  const [where, setWhere] = useState('youtube')
  const [results, setResults] = useState<SearchResult[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [added, setAdded] = useState<Record<string, string>>({})   // search result id -> library song id

  async function run(e?: React.FormEvent) {
    e?.preventDefault()
    if (!q.trim()) return
    setBusy(true)
    setError('')
    try { setResults(await api.search(q, where)) } catch (err) { setError((err as Error).message) }
    setBusy(false)
  }

  useEffect(() => { if (q.trim()) run() }, [where])   // re-run when switching YouTube / B站

  async function add(r: SearchResult) {
    const s = await api.add(r)
    setAdded(a => ({ ...a, [r.id]: s.id }))
  }

  return (
    <>
      <form className="toolbar" onSubmit={run}>
        <input placeholder="歌名 / 歌手" value={q} onChange={e => setQ(e.target.value)} autoFocus />
        <select value={where} onChange={e => setWhere(e.target.value)}>
          <option value="youtube">YouTube</option>
          <option value="bili">B站</option>
        </select>
        <button type="submit" disabled={busy}>{busy ? '搜索中…' : '搜索'}</button>
      </form>
      {error && <p className="error">{error}</p>}
      {results.map(r => {
        const song = byId.get(added[r.id] || r.song_id || '')
        return (
          <div key={r.source + r.id} className={'row' + (song && song.id === currentId ? ' now' : '')}>
            <img className="thumb" src={r.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" />
            <div className="grow">
              <b>{r.title}</b>
              <span className="muted">{r.channel} · {fmtTime(r.duration)}
                {r.tags.map(t => <span key={t} className="tag">{t}</span>)}</span>
              {song && song.status !== 'ready' && <SongStatus song={song} />}
            </div>
            {!song && <button onClick={() => add(r)}>加入歌库</button>}
            {song?.status === 'ready' && <>
              <button className="icon" onClick={() => play([song.id])} title="播放">▶</button>
              <button className="icon" onClick={() => enqueue(song.id)} title="加入队列">＋</button>
            </>}
          </div>
        )
      })}
    </>
  )
}

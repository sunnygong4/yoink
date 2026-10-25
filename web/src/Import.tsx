import { useEffect, useState } from 'react'
import { api, type MigrateJob, type MigrateSong } from './api'
import { t } from './i18n'

type Item = {
  file: File
  title: string
  artist: string
  album: string
  state: 'ready' | 'uploading' | 'done' | 'error'
  progress: number
  error: string
}

const ACCEPT = 'audio/*,video/*,.mp3,.m4a,.aac,.flac,.wav,.ogg,.opus,.wma,.aif,.aiff,.alac,.ape,.wv,.mkv,.webm'

/** "Artist - Title.mp3" -> what the server will probably call it if the fields stay blank (shown as placeholders). */
function guess(name: string): { artist: string; title: string } {
  const stem = name.replace(/\.[^.]+$/, '')
  const parts = stem.split(/\s+[-–—]\s+/)
  return parts.length >= 2 ? { artist: parts[0], title: parts.slice(1).join(' - ') } : { artist: '', title: stem }
}

/** The Import window: add songs from your own files or from a YouTube / Bilibili link, naming them yourself. */
export default function Import({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'file' | 'link' | 'apps'>('file')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal window" role="dialog" aria-modal="true" aria-label={t('importTitle')}>
        <div className="titlebar">
          <span className="lights">
            {/* (a span, not a <button> titled "Close": some browser extensions put their own icon on those) */}
            <span className="light close" role="button" tabIndex={0} aria-label={t('closeWindow')} onClick={onClose}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClose() } }} />
            <i className="light" /><i className="light" />
          </span>
          <h2>{t('importTitle')}</h2>
        </div>
        <nav className="seg">
          <button className={tab === 'file' ? 'on' : ''} onClick={() => setTab('file')}>{t('fromFile')}</button>
          <button className={tab === 'link' ? 'on' : ''} onClick={() => setTab('link')}>{t('fromLink')}</button>
          <button className={tab === 'apps' ? 'on' : ''} onClick={() => setTab('apps')}>{t('fromApps')}</button>
        </nav>
        {tab === 'file' ? <FileImport /> : tab === 'link' ? <LinkImport /> : <AppImport />}
      </div>
    </div>
  )
}

/** Your own music files, with the song's details typed in (blank = the file's own tags, then its name). */
function FileImport() {
  const [items, setItems] = useState<Item[]>([])
  const [cover, setCover] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)

  const update = (i: number, patch: Partial<Item>) => setItems(xs => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)))

  function pick(files: FileList | null) {
    const added = [...(files || [])].map(file => ({
      file, title: '', artist: '', album: '', state: 'ready' as const, progress: 0, error: '',
    }))
    setItems(xs => [...xs.filter(x => x.state !== 'done'), ...added])
  }

  async function run() {
    setBusy(true)
    for (let i = 0; i < items.length; i++) {   // one at a time: big files over a home connection
      const it = items[i]
      if (it.state === 'done') continue
      update(i, { state: 'uploading', progress: 0, error: '' })
      try {
        await api.upload(it.file, { title: it.title, artist: it.artist, album: it.album }, cover,
          p => update(i, { progress: p }))
        update(i, { state: 'done' })
      } catch (e) {
        update(i, { state: 'error', error: (e as Error).message })
      }
    }
    setBusy(false)
  }

  const todo = items.filter(x => x.state !== 'done').length

  return (
    <div className="import">
      <div className="toolbar">
        <label className="filepick">
          {t('chooseFiles')}
          <input type="file" multiple accept={ACCEPT} onChange={e => { pick(e.target.files); e.target.value = '' }} />
        </label>
        <label className="filepick">
          {cover ? `🖼 ${cover.name}` : t('coverField')}
          <input type="file" accept="image/*" onChange={e => setCover(e.target.files?.[0] || null)} />
        </label>
      </div>
      {items.length > 0 && <p className="muted small">{t('importHint')}</p>}
      {items.map((it, i) => {
        const g = guess(it.file.name)
        const locked = it.state === 'uploading' || it.state === 'done'
        return (
          <div key={i} className="import-row">
            <div className="muted small">
              {it.file.name} · {(it.file.size / 1048576).toFixed(1)} MB
              {it.state === 'uploading' && ` · ${t('uploading', { p: it.progress })}`}
              {it.state === 'done' && <span className="good"> · {t('imported')}</span>}
              {it.state === 'error' && <span className="error"> · {it.error}</span>}
            </div>
            <div className="fields">
              <input placeholder={g.title || t('titleField')} value={it.title} disabled={locked}
                onChange={e => update(i, { title: e.target.value })} aria-label={t('titleField')} />
              <input placeholder={g.artist || t('artistField')} value={it.artist} disabled={locked}
                onChange={e => update(i, { artist: e.target.value })} aria-label={t('artistField')} />
              <input placeholder={t('albumField')} value={it.album} disabled={locked}
                onChange={e => update(i, { album: e.target.value })} aria-label={t('albumField')} />
              <button className="icon" disabled={locked} title={t('removeFromQueue')}
                onClick={() => setItems(xs => xs.filter((_, j) => j !== i))}>✕</button>
            </div>
          </div>
        )
      })}
      {todo > 0 && <button onClick={run} disabled={busy}>{t('importN', { n: todo })}</button>}
    </div>
  )
}

/** A YouTube / Bilibili link. Typed details name the song; left blank, it's worked out from the video. */
function LinkImport() {
  const [url, setUrl] = useState('')
  const [info, setInfo] = useState({ title: '', artist: '', album: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [added, setAdded] = useState<string[]>([])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (!url.trim()) return
    setBusy(true)
    setError('')
    try {
      const s = await api.importLink(url, info)
      setAdded(a => [`${s.title}${s.artist ? ` — ${s.artist}` : ''}`, ...a])
      setUrl('')
      setInfo({ title: '', artist: '', album: '' })
    } catch (err) {
      setError((err as Error).message)
    }
    setBusy(false)
  }

  return (
    <form className="import" onSubmit={add}>
      <input className="wide" placeholder={t('linkPlaceholder')} value={url} onChange={e => setUrl(e.target.value)} autoFocus />
      <div className="fields">
        {(['title', 'artist', 'album'] as const).map(k => (
          <input key={k} placeholder={t(`${k}Field`)} value={info[k]} aria-label={t(`${k}Field`)}
            onChange={e => setInfo({ ...info, [k]: e.target.value })} />
        ))}
      </div>
      <p className="muted small">{t('linkHint')}</p>
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={busy || !url.trim()}>{busy ? t('adding') : t('add')}</button>
      {added.map((a, i) => <p key={i} className="good small">{t('addedSong', { title: a })}</p>)}
    </form>
  )
}

/** Moving in from Spotify / Apple Music: their data export read here, the songs picked, then added on the server. */
function AppImport() {
  const [songs, setSongs] = useState<MigrateSong[] | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [history, setHistory] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [job, setJob] = useState<MigrateJob | null>(null)

  // an import already running (started before this window was closed): its progress, until it's finished
  useEffect(() => {
    let stop = false
    const poll = async () => {
      const j = await api.migrateStatus().catch(() => null)
      if (stop) return
      setJob(j)
      if (j && !j.finished) setTimeout(poll, 1500)
    }
    poll()
    return () => { stop = true }
  }, [job?.total])

  async function read(files: FileList | null) {
    if (!files?.length) return
    setBusy(true); setError('')
    try {
      const r = await api.migrateParse([...files])
      setSongs(r.songs)
      // ticked to begin with: saved songs and playlists (not songs only in the play history), not already in the library
      setPicked(new Set(r.songs.flatMap((s, i) => (!s.have && s.lists.length ? [i] : []))))
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(false)
  }

  async function add() {
    if (!songs) return
    setBusy(true); setError('')
    try {
      setJob(await api.migrateAdd(songs.filter((_, i) => picked.has(i))))
      setSongs(null)
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(false)
  }

  const shown = songs?.map((s, i) => ({ s, i })).filter(({ s }) => history || s.lists.length) ?? []
  const toggle = (i: number) => setPicked(p => { const n = new Set(p); n.has(i) ? n.delete(i) : n.add(i); return n })
  const listName = (l: string) => (l === 'library' ? t('migListLibrary') : l)
  const running = job && !job.finished

  return (
    <div className="import migrate">
      {!songs && !running && <>
        <p>{t('migIntro')}</p>
        <div className="mig-how">
          <div><b>{t('migSpotify')}</b><p className="muted small">{t('migSpotifySteps')}</p></div>
          <div><b>{t('migApple')}</b><p className="muted small">{t('migAppleSteps')}</p></div>
        </div>
        <p className="muted small">{t('migOther')}</p>
        <div className="toolbar">
          <label className="filepick">
            {busy ? t('migReading') : t('migChoose')}
            <input type="file" multiple accept=".zip,.json,.csv,.xml,.txt,.tsv" disabled={busy}
              onChange={e => { read(e.target.files); e.target.value = '' }} />
          </label>
        </div>
      </>}
      {error && <p className="error">{error}</p>}
      {songs && <>
        <p>{t('migFound', { n: songs.length, have: songs.filter(s => s.have).length })}</p>
        <div className="toolbar">
          <button className="link" onClick={() => setPicked(new Set(shown.filter(x => !x.s.have).map(x => x.i)))}>{t('migAll')}</button>
          <button className="link" onClick={() => setPicked(new Set())}>{t('migNone')}</button>
          {songs.some(s => !s.lists.length) && (
            <label className="small mig-check"><input type="checkbox" checked={history} onChange={e => setHistory(e.target.checked)} /> {t('migShowHistory')}</label>
          )}
        </div>
        <div className="mig-list">
          {shown.map(({ s, i }) => (
            <label key={i} className={'mig-row' + (s.have ? ' have' : '')}>
              <input type="checkbox" checked={picked.has(i)} disabled={s.have} onChange={() => toggle(i)} />
              <span className="mig-title">{s.title}</span>
              <span className="muted">{s.artist}</span>
              <span className="muted small mig-from">
                {s.have ? t('migHave') : s.lists.length ? s.lists.map(listName).join(', ') : t('migHistoryOnly', { n: s.plays })}
              </span>
            </label>
          ))}
        </div>
        <button className="blue" onClick={add} disabled={busy || !picked.size}>{t('migAdd', { n: picked.size })}</button>
      </>}
      {job && !songs && <div className="mig-job">
        {running
          ? <>
            <p>{t('migAdding', { done: job.done, total: job.total, current: job.current || '' })}</p>
            <progress max={job.total} value={job.done} />
            <p className="muted small">{t('migBackground')}</p>
          </>
          : <p className="good">{t('migDone', { added: job.added, failed: job.failed.length })}</p>}
        {job.finished && job.failed.length > 0 && <>
          <p className="muted small">{t('migNotFound')}</p>
          <ul className="mig-failed small">{job.failed.map((f, i) => <li key={i}>{f}</li>)}</ul>
        </>}
      </div>}
    </div>
  )
}

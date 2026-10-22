import { useEffect, useState } from 'react'
import { api } from './api'
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
  const [tab, setTab] = useState<'file' | 'link'>('file')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={t('importTitle')}>
        <div className="modal-head">
          <h2>{t('importTitle')}</h2>
          <button className="icon" onClick={onClose} title={t('close')}>✕</button>
        </div>
        <div className="toolbar">
          <button className={tab === 'file' ? 'active' : ''} onClick={() => setTab('file')}>{t('fromFile')}</button>
          <button className={tab === 'link' ? 'active' : ''} onClick={() => setTab('link')}>{t('fromLink')}</button>
        </div>
        {tab === 'file' ? <FileImport /> : <LinkImport />}
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

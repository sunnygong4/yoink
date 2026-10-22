import { useEffect, useState } from 'react'
import { api, fmtTime, type Album, type Artist, type Song } from './api'
import { t } from './i18n'
import * as I from './icons'
import { type Actions, CatalogRow } from './Rows'
import { flat } from './text'

// Pages have their own links: / (library), /find, /artist/<slug>, /album/<artist slug>/<album slug>.
// In the app an artist / album is opened by name; the server answers with its slug (pinyin for Chinese
// names) and the address bar switches to that.
export type Page =
  | { kind: 'library' }
  | { kind: 'search' }
  | { kind: 'artist'; key: string }   // slug or name
  | { kind: 'album'; key: string }    // "<artist>/<album>": slugs, or names (each part URL-encoded)

export const artistPage = (name: string): Page => ({ kind: 'artist', key: name })
export const albumPage = (artist: string, title: string): Page =>
  ({ kind: 'album', key: `${encodeURIComponent(artist)}/${encodeURIComponent(title)}` })

export function urlFor(p: Page): string {
  switch (p.kind) {
    case 'library': return '/'
    case 'search': return '/find'
    case 'artist': return `/artist/${encodeURIComponent(p.key)}`
    case 'album': return `/album/${p.key}`
  }
}

export function pageFromUrl(): Page {
  const [kind, a, b] = location.pathname.split('/').filter(Boolean)
  if (kind === 'find') return { kind: 'search' }
  if (kind === 'artist' && a) return { kind: 'artist', key: decodeURIComponent(a) }
  if (kind === 'album' && a && b) return { kind: 'album', key: `${a}/${b}` }
  return { kind: 'library' }
}

/** Swap the address bar to the canonical slug once the server told us (no new history entry). */
function canonical(p: Page) {
  const url = urlFor(p)
  if (location.pathname !== url) history.replaceState({ ...history.state, page: p }, '', url)
}

type Common = Actions & {
  byId: Map<string, Song>
  library: Song[]
  currentId?: string
  open: (p: Page) => void
}

function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    setData(null)
    setError('')
    load().then(d => { if (live) setData(d) }).catch(e => { if (live) setError((e as Error).message) })
    return () => { live = false }
  }, deps)
  return { data, error }
}

/** Library songs by this artist (any of a song's credited artists). */
const byArtist = (songs: Song[], name: string) => songs.filter(s => flat(s.artist).includes(flat(name)) && flat(name).length > 0)

export function ArtistPage({ pageKey, byId, library, currentId, open, ...actions }: Common & { pageKey: string }) {
  const [version, setVersion] = useState(0)   // bumps after someone uploads a picture
  const { data: a, error } = useLoad<Artist>(() => api.artist(pageKey), [pageKey, version])
  const [editing, setEditing] = useState(false)
  const [added, setAdded] = useState<Record<string, string>>({})
  const [more, setMore] = useState(false)
  const [picker, setPicker] = useState<string | null>(null)

  useEffect(() => { if (a?.slug) canonical({ kind: 'artist', key: a.slug }) }, [a?.slug])

  if (error) return <p className="error pad">{error}</p>
  if (!a) return <p className="muted pad">{t('loading')}</p>
  const mine = byArtist(library, a.name).filter(s => s.status === 'ready')
  const albums = a.albums.filter(x => !x.single)
  const singles = a.albums.filter(x => x.single)

  return (
    <div className="page artist-page">
      <header className="hero" style={a.background ? { backgroundImage: `url("${a.background}")` } : undefined}>
        <div className="hero-shade" />
        {a.photo ? <img className="avatar-big" src={a.photo} alt="" /> : <div className="avatar-big blank"><I.Library size={40} /></div>}
        <div className="hero-text">
          {a.logo ? <img className="logo" src={a.logo} alt={a.name} />
            : <h1 className="wordmark">{a.name}</h1>}   {/* no logo anywhere: the name set as one */}
          <p>{[a.genre, a.formed && t('formed', { y: a.formed })].filter(Boolean).join(' · ')}</p>
          {mine.length > 0 && (
            <button className="blue" onClick={() => actions.play(mine.map(s => s.id))}><I.Play size={12} /> {t('playArtist', { n: mine.length })}</button>
          )}
        </div>
        <button className="edit-pics" onClick={() => setEditing(!editing)} title={t('editPictures')}>✎</button>
        {editing && (
          <div className="pics-menu">
            {(['logo', 'photo', 'background'] as const).map(kind => (
              <label key={kind} className="filepick">
                {t(`pic_${kind}`)}
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" onChange={async e => {
                  const f = e.target.files?.[0]
                  if (!f) return
                  try { await api.artistMedia(a.name, kind, f); setVersion(v => v + 1); setEditing(false) }
                  catch (err) { alert((err as Error).message) }
                }} />
              </label>
            ))}
          </div>
        )}
      </header>

      {a.bio && (
        <section className="bio">
          <p className={more ? '' : 'clamp'}>{a.bio}</p>
          <button className="link" onClick={() => setMore(!more)}>{more ? t('less') : t('more')}</button>
        </section>
      )}

      {mine.length > 0 && (
        <section>
          <h2 className="section-title">{t('inLibrary')}</h2>
          <div className="results">
            {mine.map((s, i) => (
              <div key={s.id} className={'result' + (i % 2 ? ' odd' : '') + (s.id === currentId ? ' now' : '')}
                onDoubleClick={() => actions.play(mine.map(x => x.id), i)}>
                {s.thumbnail ? <img className="art" src={s.thumbnail} alt="" loading="lazy" /> : <div className="art" />}
                <div className="result-text">
                  <span className="name">{s.title}</span>
                  <span className="sub">
                    {s.album && <a onClick={() => open(albumPage(s.artist, s.album!))}>{s.album}</a>} · {fmtTime(s.duration)}
                  </span>
                </div>
                <button className="pill" onClick={() => actions.play(mine.map(x => x.id), i)}><I.Play size={11} /> {t('play')}</button>
              </div>
            ))}
          </div>
        </section>
      )}

      {a.top.length > 0 && (
        <section>
          <h2 className="section-title">{t('topSongs')}</h2>
          <div className="results">
            {a.top.map((r, i) => (
              <CatalogRow key={r.key} song={r} odd={i % 2 === 1} lib={byId.get(added[r.key] || r.song_id || '')}
                currentId={currentId} open={picker === r.key} onToggle={() => setPicker(picker === r.key ? null : r.key)}
                onAdded={s => { setAdded(x => ({ ...x, [r.key]: s.id })); setPicker(null) }} {...actions} />
            ))}
          </div>
        </section>
      )}

      {[[t('albums'), albums], [t('singlesEps'), singles]].map(([title, list]) => (list as typeof albums).length > 0 && (
        <section key={title as string}>
          <h2 className="section-title">{title as string}</h2>
          <div className="covers">
            {(list as typeof albums).map(x => (
              <button key={x.title} className="cover-tile" onClick={() => open(albumPage(x.artist, x.title))}>
                {x.artwork ? <img src={x.artwork} alt="" loading="lazy" /> : <span className="art" />}
                <span className="name">{x.title}</span>
                <span className="sub">{x.year}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

export function AlbumPage({ pageKey, byId, currentId, open, ...actions }: Common & { pageKey: string }) {
  const { data: al, error } = useLoad<Album>(() => api.album(pageKey), [pageKey])
  const [added, setAdded] = useState<Record<string, string>>({})
  const [picker, setPicker] = useState<string | null>(null)
  const [more, setMore] = useState(false)

  useEffect(() => { if (al?.slug) canonical({ kind: 'album', key: al.slug }) }, [al?.slug])

  if (error) return <p className="error pad">{error}</p>
  if (!al) return <p className="muted pad">{t('loading')}</p>
  const playable = al.tracks.map(r => byId.get(added[r.key] || r.song_id || '')).filter((s): s is Song => !!s && s.status === 'ready')
  const minutes = Math.round(al.tracks.reduce((n, x) => n + (x.duration || 0), 0) / 60)

  return (
    <div className="page album-page">
      <header className="album-head">
        {al.artwork ? <img className="album-art" src={al.artwork} alt="" /> : <div className="album-art blank" />}
        <div className="album-info">
          <h1>{al.title}</h1>
          <a className="album-artist" onClick={() => open(artistPage(al.artist))}>{al.artist}</a>
          <p className="muted">{[al.genre, al.year, t('albumStats', { n: al.tracks.length, m: minutes })].filter(Boolean).join(' · ')}</p>
          <div className="album-actions">
            <button className="blue" disabled={!playable.length} onClick={() => actions.play(playable.map(s => s.id))}>
              <I.Play size={12} /> {t('playAlbum', { n: playable.length })}
            </button>
          </div>
          {al.description && (
            <div className="bio small-bio">
              <p className={more ? '' : 'clamp'}>{al.description}</p>
              <button className="link" onClick={() => setMore(!more)}>{more ? t('less') : t('more')}</button>
            </div>
          )}
        </div>
      </header>
      <div className="results tracks">
        {al.tracks.map((r, i) => (
          <div key={r.key + i} className="track-row">
            <span className="track-no">{r.track}</span>
            <CatalogRow compact song={r} odd={i % 2 === 1} lib={byId.get(added[r.key] || r.song_id || '')} currentId={currentId}
              open={picker === r.key} onToggle={() => setPicker(picker === r.key ? null : r.key)}
              onAdded={s => { setAdded(x => ({ ...x, [r.key]: s.id })); setPicker(null) }} {...actions} />
          </div>
        ))}
      </div>
      {al.copyright && <p className="muted small pad">{al.copyright}</p>}
    </div>
  )
}

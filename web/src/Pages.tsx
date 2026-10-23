import { useEffect, useState } from 'react'
import { api, fmtTime, type Album, type Artist, type Play, type Song } from './api'
import { t } from './i18n'
import * as I from './icons'
import { useCoverPalette } from './coverColor'
import { type Actions, CatalogRow, SongStatus, SourcePicker } from './Rows'
import { flat, leadArtist } from './text'

// Pages have their own links: / (library), /find, /artist/<slug>, /album/<artist slug>/<album slug>.
// In the app an artist / album is opened by name; the server answers with its slug (pinyin for Chinese
// names) and the address bar switches to that.
export type Page =
  | { kind: 'library' }
  | { kind: 'search' }
  | { kind: 'history' }
  | { kind: 'device' }
  | { kind: 'phone' }   // songs saved on this phone / computer
  | { kind: 'iphone' }  // the whole app as an iPod classic (what iPhones open)
  | { kind: 'artist'; key: string }   // slug or name
  | { kind: 'album'; key: string }    // "<artist>/<album>": slugs, or names (each part URL-encoded)

export const artistPage = (name: string): Page => ({ kind: 'artist', key: name })
export const albumPage = (artist: string, title: string): Page =>
  ({ kind: 'album', key: `${encodeURIComponent(artist)}/${encodeURIComponent(title)}` })

export function urlFor(p: Page): string {
  switch (p.kind) {
    case 'library': return '/'
    case 'search': return '/find'
    case 'history': return '/history'
    case 'device': return '/ipod'
    case 'phone': return '/phone'
    case 'iphone': return '/iphone'
    case 'artist': return `/artist/${encodeURIComponent(p.key)}`
    case 'album': return `/album/${p.key}`
  }
}

const FULL = 'yoinker.full'   // "1": this phone chose the full site over iPod mode
const isIPhone = () => /iPhone|iPod/.test(navigator.userAgent)
function wantsPod() {
  try { return isIPhone() && localStorage.getItem(FULL) !== '1' } catch { return isIPhone() }
}
/** iPod mode or the full site, remembered on this phone. */
export function preferPod(on: boolean) {
  try { if (on) localStorage.removeItem(FULL); else localStorage.setItem(FULL, '1') } catch { /* private mode */ }
}

export function pageFromUrl(): Page {
  const [kind, a, b] = location.pathname.split('/').filter(Boolean)
  if (kind === 'find') return { kind: 'search' }
  if (kind === 'history') return { kind: 'history' }
  if (kind === 'ipod') return { kind: 'device' }
  if (kind === 'phone') return { kind: 'phone' }
  if (kind === 'iphone') return { kind: 'iphone' }
  if (!kind && wantsPod()) return { kind: 'iphone' }
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
              <CatalogRow key={r.key} song={r} odd={i % 2 === 1} lib={byId.get(added[r.key] || r.song_id || '')} openPage={open}
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

/** iTunes 11's album view: the page takes the cover's colour; the tracks are a plain numbered list beside it. */
export function AlbumPage({ pageKey, byId, currentId, open, ...actions }: Common & { pageKey: string }) {
  const { data: al, error } = useLoad<Album>(() => api.album(pageKey), [pageKey])
  const [added, setAdded] = useState<Record<string, string>>({})
  const [picker, setPicker] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [more, setMore] = useState(false)
  const [note, setNote] = useState('')
  const pal = useCoverPalette(al?.artwork)

  useEffect(() => { if (al?.slug) canonical({ kind: 'album', key: al.slug }) }, [al?.slug])

  if (error) return <p className="error pad">{error}</p>
  if (!al) return <p className="muted pad">{t('loading')}</p>
  const lib = (r: Album['tracks'][number]) => byId.get(added[r.key] || r.song_id || '')
  const playable = al.tracks.map(lib).filter((s): s is Song => !!s && s.status === 'ready')
  const minutes = Math.round(al.tracks.reduce((n, x) => n + (x.duration || 0), 0) / 60)
  const playFrom = (id: string) => actions.play(playable.map(s => s.id), Math.max(0, playable.findIndex(s => s.id === id)))
  const discs = new Set(al.tracks.map(r => r.disc || 1)).size > 1

  async function quick(r: Album['tracks'][number]) {
    setBusy(r.key)
    try { const song = await api.quick(r); setAdded(x => ({ ...x, [r.key]: song.id })) } catch (e) { alert((e as Error).message) }
    setBusy(null)
  }
  async function listen(r: Album['tracks'][number]) {
    setBusy(`p${r.key}`)
    try { await actions.preview(r) } catch (e) { alert((e as Error).message) }
    setBusy(null)
  }
  async function addAll() {
    try { const { queued } = await api.addAlbum(al!.slug); setNote(t('albumAdding', { n: queued })) } catch (e) { alert((e as Error).message) }
  }

  return (
    <div className={'page ialbum' + (pal.dark ? ' on-dark' : ' on-light')}
      style={{ '--ia-bg': pal.bg, '--ia-fg': pal.fg, '--ia-fg2': pal.fg2 } as React.CSSProperties}>
      <div className="ia-cover">
        {al.artwork ? <img src={al.artwork} alt="" /> : <div className="ia-blank">♫</div>}
      </div>
      <div className="ia-main">
        <h1>{al.title}</h1>
        <p className="ia-meta">
          <a onClick={() => open(artistPage(al.artist))}>{al.artist}</a>
          {' · '}{[al.genre, al.year].filter(Boolean).join(' · ')}
        </p>
        <p className="ia-meta">{t('albumStats', { n: al.tracks.length, m: minutes })}</p>
        <div className="ia-buttons">
          <button disabled={!playable.length} onClick={() => actions.play(playable.map(s => s.id))}>
            <I.Play size={11} /> {t('playAlbum', { n: playable.length })}
          </button>
          {playable.length < al.tracks.length && (
            <button onClick={addAll}><I.Plus size={11} /> {t('addAlbum')}</button>
          )}
        </div>
        {note && <p className="ia-meta">{note}</p>}

        <ol className="ia-tracks">
          {al.tracks.map((r, i) => {
            const song = lib(r)
            const ok = song?.status === 'ready'
            const showDisc = discs && (i === 0 || (al.tracks[i - 1].disc || 1) !== (r.disc || 1))
            return [
              showDisc && <li key={`d${r.disc}`} className="ia-disc">{t('disc', { n: r.disc || 1 })}</li>,
              <li key={r.key + i} className={'ia-track' + (song && song.id === currentId ? ' now' : '') + (song ? ' have' : '')}
                onDoubleClick={() => ok && playFrom(song!.id)}>
                <span className="ia-no">{song && song.id === currentId ? <I.Volume size={12} /> : r.track}</span>
                <span className="ia-name">
                  {r.title}
                  {flat(leadArtist(r.artist)) !== flat(leadArtist(al.artist)) && <em> — {r.artist}</em>}
                  {song && !ok && <span className="ia-status"><SongStatus song={song} /></span>}
                </span>
                <span className="ia-time">{fmtTime(r.duration)}</span>
                <span className="ia-act">
                  {/* white ▶: on the server already; blue: fetched first (just to listen) */}
                  <button className={'ia-link' + (ok || r.instant ? '' : ' fetch')} disabled={busy === `p${r.key}`}
                    onClick={() => (ok ? playFrom(song!.id) : listen(r))} title={ok || r.instant ? t('playHint') : t('previewHint')}>
                    {busy === `p${r.key}` ? '…' : <><I.Play size={9} /> {t('play')}</>}
                  </button>
                  {song ? <span className="ia-have" title={t('inLibraryHint')}>✓</span>
                    : <button className="ia-link" onClick={() => quick(r)} disabled={busy === r.key} title={t('addToLibrary')}>
                      {busy === r.key ? '…' : <><I.Plus size={9} /> {t('addToLibrary')}</>}
                    </button>}
                  <button className="ia-link" onClick={() => setPicker(picker === r.key ? null : r.key)} title={t('pickSource')}>⋯</button>
                </span>
              </li>,
              picker === r.key && (
                <li key={`p${r.key}`} className="ia-picker">
                  <SourcePicker song={r} onAdded={x => { setAdded(a => ({ ...a, [r.key]: x.id })); setPicker(null) }} />
                </li>
              ),
            ]
          })}
        </ol>

        {al.description && (
          <div className="ia-notes">
            <p className={more ? '' : 'clamp'}>{al.description}</p>
            <button className="ia-link" onClick={() => setMore(!more)}>{more ? t('less') : t('more')}</button>
          </div>
        )}
        {al.copyright && <p className="ia-copy">{al.copyright}</p>}
      </div>
    </div>
  )
}

/** What this person played, newest first; songs smart play brought are marked (and may be gone by now). */
export function HistoryPage({ currentId, open, play, onSong }: Common & { onSong: (s: Song) => void }) {
  const [version, setVersion] = useState(0)
  const { data: rows, error } = useLoad<Play[]>(() => api.history(), [version])
  const [busy, setBusy] = useState<string | null>(null)

  if (error) return <p className="error pad">{error}</p>
  if (!rows) return <p className="muted pad">{t('loading')}</p>
  if (!rows.length) return <div className="empty"><p>{t('historyEmpty')}</p></div>

  const start = (r: Play) => { if (r.song) { onSong(r.song); play([r.song.id]) } }
  async function getBack(r: Play) {   // a deleted smart-play song: download it again, into the library
    if (!r.url || (r.source !== 'youtube' && r.source !== 'bilibili')) return
    setBusy(r.song_id)
    try {
      await api.add({ source: r.source, id: r.song_id.replace(/^(yt|bili)-/, ''), url: r.url, title: r.title, channel: r.artist,
        album: r.album, duration: 0, views: null, thumbnail: r.thumbnail || '', tags: [], fit: 0 },
        { key: '', title: r.title, artist: r.artist, album: r.album || '', duration: null, artwork: r.thumbnail || '',
          year: '', versions: 1, song_id: null, instant: false })
      setVersion(v => v + 1)
    } catch (e) { alert((e as Error).message) }
    setBusy(null)
  }

  return (
    <div className="page">
      <div className="listbar"><b className="listbar-title">{t('history')}</b></div>
      <table className="songlist history">
        <thead>
          <tr>
            <th className="c-now" />
            <th className="c-played">{t('colPlayed')}</th>
            <th>{t('colName')}</th>
            <th className="c-artist">{t('colArtist')}</th>
            <th className="c-album">{t('colAlbum')}</th>
            <th className="c-act" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={(r.available ? '' : 'pending') + (r.radio ? ' radio-row' : '')} onDoubleClick={() => r.available && start(r)}>
              <td className="c-now">{r.song_id === currentId && <I.Volume size={13} />}</td>
              <td className="c-played">{new Date(r.played_at * 1000).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
              <td className="c-name">
                <span className="name">{r.title}</span>
                {r.radio && <span className="tag smart">{t('smartPick')}</span>}
                {!r.available && <span className="tag">{t('gone')}</span>}
                <span className="sub">{r.artist}</span>
              </td>
              <td className="c-artist"><a onClick={() => open(artistPage(leadArtist(r.artist)))}>{r.artist}</a></td>
              <td className="c-album">{r.album && <a onClick={() => open(albumPage(r.artist, r.album!))}>{r.album}</a>}</td>
              <td className="c-act">
                {r.available
                  ? <button className="mini" onClick={() => start(r)} title={t('play')}><I.Play size={11} /></button>
                  : r.url && <button className="pill" disabled={busy === r.song_id} onClick={() => getBack(r)}>{t('getBack')}</button>}
                {r.available && r.radio && !r.in_library && r.song && (
                  <button className="mini" title={t('keep')} onClick={() => api.keep(r.song_id).then(s => { onSong(s); setVersion(v => v + 1) })}>
                    <I.Heart size={12} />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

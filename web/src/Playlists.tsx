import { useEffect, useRef, useState } from 'react'
import { api, fmtTime, type PlaylistSummary, type Song } from './api'
import { t } from './i18n'
import * as I from './icons'
import { albumPage, artistPage, type Page } from './Pages'
import { leadArtist } from './text'

// Playlists: each person's own lists of library songs. Songs go on one from the library (the ≡+ button on a row, or
// dragged onto the list in the sidebar); the list's page plays them in its order, which a drag changes.

export const SONG_DRAG = 'application/x-yoinker-songs'   // what a dragged library row carries: song ids, as JSON

/** The name a new playlist gets ("Playlist 2" when there's a "Playlist" already). */
export function freshName(lists: PlaylistSummary[]) {
  const base = t('newPlaylistName')
  const taken = new Set(lists.map(l => l.name))
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base} ${n}`)) n++
  return `${base} ${n}`
}

/** ≡+ on a library row: a menu of the playlists (and a new one) to put the songs on. */
export function AddToPlaylist({ ids, lists, onChanged }: { ids: string[]; lists: PlaylistSummary[]; onChanged: () => void }) {
  // where the menu goes: against the window (a table cell would cut it off), below the button or above near the bottom
  const [menu, setMenu] = useState<React.CSSProperties | null>(null)
  const [done, setDone] = useState('')
  const box = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!menu) return
    const off = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setMenu(null) }
    const gone = () => setMenu(null)
    document.addEventListener('mousedown', off)
    window.addEventListener('resize', gone)
    document.addEventListener('scroll', gone, true)
    return () => {
      document.removeEventListener('mousedown', off)
      window.removeEventListener('resize', gone)
      document.removeEventListener('scroll', gone, true)
    }
  }, [menu])
  function toggle(e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation()
    if (menu) { setMenu(null); return }
    const r = e.currentTarget.getBoundingClientRect()
    const below = innerHeight - r.bottom > 220
    setMenu({ position: 'fixed', right: Math.max(8, innerWidth - r.right),
      ...(below ? { top: r.bottom + 3 } : { bottom: innerHeight - r.top + 3 }) })
  }

  async function add(pid: number, name: string) {
    setMenu(null)
    try {
      await api.addToPlaylist(pid, ids)
      setDone(name)
      setTimeout(() => setDone(''), 1600)
      onChanged()
    } catch (e) { alert((e as Error).message) }
  }
  async function addNew() {
    const name = prompt(t('newPlaylistAsk'), freshName(lists))?.trim()
    if (!name) return
    try { const p = await api.createPlaylist(name); await add(p.id, p.name) } catch (e) { alert((e as Error).message) }
  }
  return (
    <span className="qbtn pl-add" ref={box}>
      <button className={'mini pl' + (menu ? ' pressed' : '')} title={done ? t('addedToPlaylist', { name: done }) : t('addToPlaylist')}
        onClick={toggle}>{done ? '✓' : <I.ListAdd size={13} />}</button>
      {menu && (
        <span className="q-menu" role="menu" style={menu} onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
          <span className="q-head">{t('addToPlaylist')}</span>
          {lists.map(l => (
            <button key={l.id} role="menuitem" onClick={() => add(l.id, l.name)}><span className="q-tick" /><I.List size={11} /> {l.name}</button>
          ))}
          <button role="menuitem" onClick={addNew}><span className="q-tick" /><I.Plus size={10} /> {t('newPlaylist')}</button>
        </span>
      )}
    </span>
  )
}

/** A playlist's page: its songs in order (drag to reorder), play / shuffle, rename, delete. */
export function PlaylistPage({ id, currentId, open, play, playNext, enqueue, onSong, onChanged, onDeleted }: {
  id: number; currentId?: string; open: (p: Page) => void
  play: (ids: string[], start?: number) => void; playNext: (id: string) => void; enqueue: (id: string) => void
  onSong: (s: Song) => void; onChanged: () => void; onDeleted: () => void
}) {
  const [data, setData] = useState<{ id: number; name: string; songs: (Song & { row_id: number })[] } | null>(null)
  const [error, setError] = useState('')
  const [name, setName] = useState<string | null>(null)   // being renamed
  const [selected, setSelected] = useState<number | null>(null)
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null)

  const load = () => api.playlist(id).then(d => { d.songs.forEach(onSong); setData(d) }).catch(e => setError((e as Error).message))
  useEffect(() => { setData(null); load() }, [id])

  if (error) return <p className="error pad">{error}</p>
  if (!data) return <p className="muted pad">{t('loading')}</p>
  const ready = data.songs.filter(s => s.status === 'ready')
  const ids = ready.map(s => s.id)
  const minutes = Math.round(data.songs.reduce((n, s) => n + (s.duration || 0), 0) / 60)
  const playFrom = (sid: string) => play(ids, Math.max(0, ids.indexOf(sid)))
  const touch = typeof matchMedia !== 'undefined' && matchMedia('(hover: none)').matches

  async function rename() {
    const n = name?.trim()
    setName(null)
    if (!n || n === data!.name) return
    await api.renamePlaylist(id, n).catch(e => alert((e as Error).message))
    setData(d => d && { ...d, name: n })
    onChanged()
  }
  async function remove() {
    if (!confirm(t('deletePlaylistAsk', { name: data!.name }))) return
    await api.deletePlaylist(id)
    onChanged()
    onDeleted()
  }
  async function drop(rowId: number, to: number) {
    // at once on screen, then on the server
    setData(d => {
      if (!d) return d
      const list = [...d.songs]
      const from = list.findIndex(s => s.row_id === rowId)
      const [it] = list.splice(from, 1)
      list.splice(to, 0, it)
      return { ...d, songs: list }
    })
    await api.movePlaylistSong(id, rowId, to).catch(() => load())
  }
  async function take(rowId: number) {
    setData(d => d && { ...d, songs: d.songs.filter(s => s.row_id !== rowId) })
    await api.removeFromPlaylist(id, rowId).catch(() => load())
    onChanged()
  }

  return (
    <>
      <div className="pl-head">
        <div className="pl-art">
          {data.songs.slice(0, 4).map(s => s.thumbnail ? <img key={s.row_id} src={s.thumbnail} alt="" /> : <span key={s.row_id} />)}
          {!data.songs.length && <I.List size={40} />}
        </div>
        <div className="pl-text">
          {name !== null
            ? <input className="pl-name" autoFocus value={name} onChange={e => setName(e.target.value)} onBlur={rename}
              onKeyDown={e => { if (e.key === 'Enter') rename(); if (e.key === 'Escape') setName(null) }} />
            : <h1 className="pl-name" title={t('renameHint')} onClick={() => setName(data.name)}>{data.name}</h1>}
          <p className="muted">{t('nSongs', { n: data.songs.length })}{minutes > 0 && ` · ${t('nMinutes', { n: minutes })}`}</p>
          <div className="pl-buttons">
            <button onClick={() => play(ids)} disabled={!ids.length}><I.Play size={12} /> {t('playAll')}</button>
            <button onClick={() => play([...ids].sort(() => Math.random() - 0.5))} disabled={!ids.length}><I.Shuffle size={12} /> {t('shuffle')}</button>
            <button onClick={() => setName(data.name)}>{t('rename')}</button>
            <button onClick={remove}>{t('deletePlaylist')}</button>
          </div>
        </div>
      </div>
      {data.songs.length === 0
        ? <div className="empty"><p>{t('playlistEmpty')}</p><button onClick={() => open({ kind: 'library' })}>{t('library')}</button></div>
        : (
          <table className="songlist playlist">
            <thead>
              <tr>
                <th className="c-now" />
                <th className="c-no">#</th>
                <th>{t('colName')}</th>
                <th className="c-time">{t('colTime')}</th>
                <th className="c-artist">{t('colArtist')}</th>
                <th className="c-album">{t('colAlbum')}</th>
                <th className="c-act" />
              </tr>
            </thead>
            <tbody>
              {data.songs.map((s, i) => {
                const ok = s.status === 'ready'
                return (
                  <tr key={s.row_id} draggable
                    className={(selected === s.row_id ? 'sel' : '') + (ok ? '' : ' pending')
                      + (drag && drag.over === i && drag.from !== i ? (drag.from < i ? ' drop-below' : ' drop-above') : '')}
                    onClick={() => { setSelected(s.row_id); if (touch && ok) playFrom(s.id) }}
                    onDoubleClick={() => ok && playFrom(s.id)}
                    onDragStart={e => { setDrag({ from: i, over: i }); e.dataTransfer.effectAllowed = 'move' }}
                    onDragOver={e => { if (drag) { e.preventDefault(); if (drag.over !== i) setDrag({ ...drag, over: i }) } }}
                    onDragEnd={() => setDrag(null)}
                    onDrop={e => { e.preventDefault(); if (drag && drag.from !== i) drop(data.songs[drag.from].row_id, i); setDrag(null) }}>
                    <td className="c-now">{s.id === currentId && <I.Volume size={13} />}</td>
                    <td className="c-no">{i + 1}</td>
                    <td className="c-name"><span className="name">{s.title}</span><span className="sub">{s.artist}</span></td>
                    <td className="c-time">{fmtTime(s.duration)}</td>
                    <td className="c-artist"><a onClick={e => { e.stopPropagation(); open(artistPage(leadArtist(s.artist))) }}>{s.artist}</a></td>
                    <td className="c-album">{s.album && <a onClick={e => { e.stopPropagation(); open(albumPage(s.artist, s.album!, s.album_id)) }}>{s.album}</a>}</td>
                    <td className="c-act">
                      {ok && <>
                        <button className="mini" onClick={e => { e.stopPropagation(); playNext(s.id) }} title={t('playNext')}><I.PlayNext size={13} /></button>
                        <button className="mini" onClick={e => { e.stopPropagation(); enqueue(s.id) }} title={t('addToQueue')}><I.Plus size={13} /></button>
                      </>}
                      <button className="mini rm" onClick={e => { e.stopPropagation(); take(s.row_id) }} title={t('removeFromPlaylist')}><I.Close size={12} /></button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      <p className="muted small pad pl-hint">{t('playlistHint')}</p>
    </>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { api, fmtTime, type Group, type GroupSummary, type Song } from './api'
import { t } from './i18n'
import * as I from './icons'
import { Avatar, userPage } from './People'
import type { Page } from './Pages'

// 听友群: groups of friends with a shared playlist; "一起听" plays it for everyone in the group at once.

export type Together = { id: number; name: string } | null

export const groupPage = (id: number): Page => ({ kind: 'group', id })

export function GroupsPage({ open }: { open: (p: Page) => void }) {
  const [list, setList] = useState<GroupSummary[] | null>(null)
  const [name, setName] = useState('')
  const load = () => api.groups().then(setList).catch(() => setList([]))
  useEffect(() => { load() }, [])
  async function create() {
    if (!name.trim()) return
    try { const { id } = await api.newGroup(name); open(groupPage(id)) } catch (e) { alert((e as Error).message) }
  }
  return (
    <div className="groups-page">
      <section>
        <h2 className="section-title">{t('groupsTitle')}</h2>
        <form className="new-group" onSubmit={e => { e.preventDefault(); create() }}>
          <input placeholder={t('groupNamePlaceholder')} value={name} maxLength={60} onChange={e => setName(e.target.value)} />
          <button className="blue" disabled={!name.trim()}><I.Plus size={11} /> {t('newGroup')}</button>
        </form>
        <p className="pad hint small">{t('groupsHint')}</p>
        {!list ? <p className="pad hint">…</p> : !list.length ? <p className="pad hint">{t('noGroups')}</p> : (
          <div className="friend-grid">
            {list.map(g => (
              <button key={g.id} className="friend-card group-card" onClick={() => open(groupPage(g.id))}>
                <span className="group-faces">{g.members.slice(0, 4).map(m => <Avatar key={m} name={m} size={30} />)}</span>
                <b>{g.name}</b>
                <span className="muted small">{t('groupLine', { n: g.members.length, s: g.songs })}</span>
                {g.listening > 0 && <span className="now-line live"><span className="eq"><i /><i /><i /></span>{t('listeningNow', { n: g.listening })}</span>}
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

export function GroupPage({ id, me, library, open, onSong, together, setTogether }: {
  id: number; me: string; library: Song[]; open: (p: Page) => void; onSong: (s: Song) => void
  together: Together; setTogether: (t: Together) => void
}) {
  const [g, setG] = useState<Group | null>(null)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [filter, setFilter] = useState('')
  const load = () => api.group(id).then(x => { setG(x); x.playlist.forEach(onSong) }).catch(e => setError((e as Error).message))
  useEffect(() => { load(); const timer = setInterval(load, 5000); return () => clearInterval(timer) }, [id])
  const inPlaylist = useMemo(() => new Set(g?.playlist.map(s => s.id) ?? []), [g])

  if (error) return <p className="pad error">{error}</p>
  if (!g) return <p className="pad hint">…</p>
  const joined = together?.id === id
  const act = (f: () => Promise<unknown>) => f().then(load).catch(e => alert((e as Error).message))
  const cur = g.session?.song_id

  async function listen(index?: number) {
    setTogether({ id, name: g!.name })
    // starting a song (or joining a group already playing): the player follows from here
    if (index !== undefined) await api.groupControl(id, { action: 'jump', index })
    else if (!g!.session?.playing) await api.groupControl(id, { action: 'play' })   // joining a group that's paused starts it
    load()
  }
  const f = filter.trim().toLowerCase()
  const candidates = library.filter(s => s.status === 'ready' && !inPlaylist.has(s.id) && (!f || `${s.title} ${s.artist}`.toLowerCase().includes(f)))

  return (
    <div className="group-page">
      <header className="profile-head">
        <span className="group-faces big">{g.members.slice(0, 4).map(m => <Avatar key={m.name} name={m.name} size={48} />)}</span>
        <div className="ph-text">
          <h1>{g.name}</h1>
          <p className="muted">{t('groupLine', { n: g.members.length, s: g.playlist.length })} · {t('groupOwner', { name: g.owner ?? '—' })}</p>
          <div className="ph-buttons">
            {joined
              ? <button onClick={() => setTogether(null)}>{t('stopListening')}</button>
              : <button className="blue" disabled={!g.playlist.length} onClick={() => listen()}><I.Play size={11} /> {g.session?.playing ? t('joinListening') : t('listenTogether')}</button>}
            <button onClick={() => { if (confirm(t('leaveGroupConfirm', { name: g.name }))) act(() => api.removeGroupMember(id, me)).then(() => open({ kind: 'groups' })) }}>{t('leaveGroup')}</button>
          </div>
          {g.listeners.length > 0 && (
            <p className="listeners">🎧 {g.listeners.join('、')} {g.session?.playing && g.song ? t('listeningTo', { song: g.song.title }) : t('pausedTogether')}</p>
          )}
        </div>
      </header>

      <section>
        <h2 className="section-title">{t('members')}</h2>
        <div className="member-row">
          {g.members.map(m => (
            <span key={m.name} className="member">
              <button className="who" onClick={() => open(userPage(m.name))}><Avatar name={m.name} size={28} /> {m.name}</button>
              {g.owner === me && m.name !== me && (
                <button className="mini" title={t('removeMember')} onClick={() => confirm(t('removeMemberConfirm', { name: m.name })) && act(() => api.removeGroupMember(id, m.name))}>✕</button>
              )}
            </span>
          ))}
          {g.can_add.length > 0 && (
            <select value="" onChange={e => e.target.value && act(() => api.addGroupMember(id, e.target.value))}>
              <option value="">{t('addFriendToGroup')}</option>
              {g.can_add.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          )}
        </div>
      </section>

      <section>
        <h2 className="section-title">{t('groupPlaylist')}
          <button className="pill" onClick={() => setAdding(a => !a)}><I.Plus size={10} /> {adding ? t('close') : t('addSongs')}</button></h2>
        {adding && (
          <div className="add-songs">
            <div className="listbar"><label className="searchfield"><I.Search size={12} />
              <input placeholder={t('filterLibrary')} value={filter} onChange={e => setFilter(e.target.value)} autoFocus /></label></div>
            {candidates.slice(0, 40).map(s => (
              <div key={s.id} className="result compact-row">
                {s.thumbnail ? <img className="art" src={s.thumbnail} alt="" loading="lazy" /> : <div className="art" />}
                <div className="result-text"><span className="name">{s.title}</span><span className="sub">{s.artist}</span></div>
                <button className="pill" onClick={() => act(() => api.addGroupSong(id, s.id))}><I.Plus size={10} /> {t('addToGroup')}</button>
              </div>
            ))}
            {!candidates.length && <p className="pad hint small">{t('nothingToAdd')}</p>}
          </div>
        )}
        {!g.playlist.length ? <p className="pad hint">{t('emptyGroupPlaylist')}</p> : (
          <div className="results">
            {g.playlist.map((s, i) => (
              <div key={s.row_id} className={'result compact-row' + (i % 2 ? ' odd' : '') + (s.id === cur ? ' now' : '')} onDoubleClick={() => listen(i)}>
                {s.thumbnail ? <img className="art" src={s.thumbnail} alt="" loading="lazy" /> : <div className="art" />}
                <div className="result-text"><span className="name">{s.id === cur && g.session?.playing && <span className="eq"><i /><i /><i /></span>}{s.title}</span>
                  <span className="sub">{s.artist} · {fmtTime(s.duration)} · {t('addedBy', { name: s.added_by_name })}</span></div>
                <button className="pill" onClick={() => listen(i)} title={t('playForGroup')}><I.Play size={10} /> {t('play')}</button>
                <button className="mini" onClick={() => act(() => api.removeGroupSong(id, s.row_id))} title={t('removeFromGroup')}>✕</button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

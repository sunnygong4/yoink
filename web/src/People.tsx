import { useEffect, useState } from 'react'
import { api, fmtTime, type Friends, type Person, type Profile, type Relation, type Song } from './api'
import { getLang, t } from './i18n'
import * as I from './icons'
import { artistPage, type Page } from './Pages'

// People's pages (/usr/<name>) and the friends page (/friends).

type Common = {
  me: string
  open: (p: Page) => void
  play: (ids: string[], start?: number) => void
  onSong: (s: Song) => void
  onFriends: () => void   // friends changed (the sidebar's count)
}

const ago = (ts: number | null | undefined) => {
  if (!ts) return ''
  const s = Date.now() / 1000 - ts
  const zh = getLang() === 'zh'
  if (s < 90) return zh ? '刚刚' : 'just now'
  if (s < 3600) return zh ? `${Math.round(s / 60)} 分钟前` : `${Math.round(s / 60)} min ago`
  if (s < 86400) return zh ? `${Math.round(s / 3600)} 小时前` : `${Math.round(s / 3600)} h ago`
  if (s < 30 * 86400) return zh ? `${Math.round(s / 86400)} 天前` : `${Math.round(s / 86400)} days ago`
  return new Date(ts * 1000).toLocaleDateString(zh ? 'zh-CN' : undefined)
}

/** A round picture with the person's initial, in a colour of their own. */
export function Avatar({ name, size = 72 }: { name: string; size?: number }) {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) % 360
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.42,
      background: `linear-gradient(160deg, hsl(${h} 55% 62%), hsl(${(h + 30) % 360} 50% 42%))` }}>
      {[...name][0]?.toUpperCase()}
    </span>
  )
}

export const userPage = (name: string): Page => ({ kind: 'user', name })

/** Add / accept / take back / unfriend, depending on how things stand. */
function FriendButton({ name, relation, onChange }: { name: string; relation: Relation; onChange: (r: Relation) => void }) {
  const [busy, setBusy] = useState(false)
  const act = async (f: () => Promise<{ relation: Relation }>) => {
    setBusy(true)
    try { onChange((await f()).relation) } catch (e) { alert((e as Error).message) }
    setBusy(false)
  }
  const add = () => act(() => api.addFriend(name))
  const remove = () => act(() => api.removeFriend(name))
  switch (relation) {
    case 'self': return null
    case 'none': return <button className="blue" disabled={busy} onClick={add}><I.Plus size={11} /> {t('addFriend')}</button>
    case 'sent': return <button disabled={busy} onClick={remove} title={t('cancelRequestHint')}>{t('requestSent')}</button>
    case 'received': return <><button className="blue" disabled={busy} onClick={add}>{t('accept')}</button>
      <button disabled={busy} onClick={remove}>{t('decline')}</button></>
    case 'friends': return <button disabled={busy} onClick={() => confirm(t('unfriendConfirm', { name })) && remove()}
      title={t('unfriend')}>✓ {t('friendsLabel')}</button>
  }
}

const AUDIENCE = ['everyone', 'friends', 'nobody'] as const
const SECTIONS = ['now', 'recent', 'top', 'library', 'radio'] as const

export function ProfilePage({ name, me, open, play, onSong, onFriends }: Common & { name: string }) {
  const [p, setP] = useState<Profile | null>(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const load = () => api.profile(name).then(setP).catch(e => setError((e as Error).message))
  useEffect(() => { setP(null); setError(''); setEditing(false); load() }, [name])

  if (error) return <p className="pad error">{error}</p>
  if (!p) return <p className="pad hint">…</p>
  const self = p.relation === 'self'
  const playSongs = (songs: Song[], start = 0) => { songs.forEach(onSong); play(songs.map(s => s.id), start) }
  const nothing = !self && !p.now && !p.recent?.length && !p.top?.length && !p.library?.length && !p.radio?.length

  return (
    <div className="profile">
      <header className="profile-head">
        <Avatar name={p.name} size={96} />
        <div className="ph-text">
          <h1>{p.name}</h1>
          {p.bio && <p className="bio">{p.bio}</p>}
          <p className="muted">{t('joined', { when: ago(p.joined) })} · {t('songCount', { n: p.counts.songs })} · {t('friendCount', { n: p.counts.friends })}</p>
          <div className="ph-buttons">
            {self ? <button onClick={() => setEditing(e => !e)}>{editing ? t('close') : t('editProfile')}</button>
              : <FriendButton name={p.name} relation={p.relation} onChange={r => { setP({ ...p, relation: r }); onFriends(); load() }} />}
            {p.radio && p.radio.length > 0 && (
              <button className="blue" onClick={() => playSongs(p.radio!)}><I.Play size={11} /> {t('playRadio', { name: p.name })}</button>
            )}
          </div>
        </div>
      </header>

      {self && editing && p.show && <ProfileEditor bio={p.bio} show={p.show} onSaved={() => { setEditing(false); load() }} />}

      {p.now && (
        <section className="profile-now">
          <h2 className="section-title">{p.now.playing ? t('playingNow') : t('pausedOn')}</h2>
          <button className="now-card" onClick={() => playSongs([p.now!.song])}>
            {p.now.song.thumbnail ? <img src={p.now.song.thumbnail} alt="" /> : <span className="blank">♫</span>}
            <span><b>{p.now.song.title}</b><span>{p.now.song.artist}</span></span>
            {p.now.playing && <span className="eq"><i /><i /><i /></span>}
          </button>
        </section>
      )}

      {p.top && p.top.length > 0 && (
        <section>
          <h2 className="section-title">{t('topArtists')}</h2>
          <div className="chips">
            {p.top.map(a => <button key={a.artist} className="pill" onClick={() => open(artistPage(a.artist))}>{a.artist} <span className="muted">{a.n}</span></button>)}
          </div>
        </section>
      )}

      {p.recent && p.recent.length > 0 && (
        <section>
          <h2 className="section-title">{t('recentPlays')}</h2>
          <div className="results">
            {p.recent.map((r, i) => (
              <div key={i} className={'result compact-row' + (i % 2 ? ' odd' : '')}>
                {r.thumbnail ? <img className="art" src={r.thumbnail} alt="" loading="lazy" /> : <div className="art" />}
                <div className="result-text"><span className="name">{r.title}{r.radio ? ' ✨' : ''}</span>
                  <span className="sub">{r.artist}{r.album && ` — ${r.album}`}</span></div>
                <span className="muted small">{ago(r.played_at)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {p.library && p.library.length > 0 && (
        <section>
          <h2 className="section-title">{self ? t('myLibrary') : t('theirLibrary', { name: p.name })}
            <button className="pill" onClick={() => playSongs(p.library!)}><I.Play size={10} /> {t('playAll')}</button></h2>
          <div className="results">
            {p.library.map((s, i) => (
              <div key={s.id} className={'result compact-row' + (i % 2 ? ' odd' : '')} onDoubleClick={() => playSongs(p.library!, i)}>
                {s.thumbnail ? <img className="art" src={s.thumbnail} alt="" loading="lazy" /> : <div className="art" />}
                <div className="result-text"><span className="name">{s.title}</span><span className="sub">{s.artist} · {fmtTime(s.duration)}</span></div>
                {!self && !s.radio && <span className="tag good">{t('inLibraryShort')}</span>}
                <button className="pill" onClick={() => playSongs(p.library!, i)}><I.Play size={10} /> {t('play')}</button>
              </div>
            ))}
          </div>
        </section>
      )}

      {nothing && <p className="pad hint">{t('nothingShared', { name: p.name })}</p>}
      {self && !editing && <p className="pad hint small">{t('profileHint', { me })}</p>}
    </div>
  )
}

function ProfileEditor({ bio, show, onSaved }: { bio: string; show: Record<string, string>; onSaved: () => void }) {
  const [text, setText] = useState(bio)
  const [vis, setVis] = useState(show)
  const [busy, setBusy] = useState(false)
  async function save() {
    setBusy(true)
    try { await api.saveProfile(text, vis); onSaved() } catch (e) { alert((e as Error).message) }
    setBusy(false)
  }
  return (
    <div className="profile-edit">
      <label>{t('bio')}<textarea value={text} maxLength={300} rows={2} onChange={e => setText(e.target.value)} placeholder={t('bioPlaceholder')} /></label>
      <table>
        <tbody>
          {SECTIONS.map(k => (
            <tr key={k}>
              <td>{t(`show_${k}`)}</td>
              <td>
                <nav className="seg">
                  {AUDIENCE.map(a => <button key={a} className={vis[k] === a ? 'on' : ''} onClick={() => setVis(v => ({ ...v, [k]: a }))}>{t(`aud_${a}`)}</button>)}
                </nav>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="blue" disabled={busy} onClick={save}>{t('save')}</button>
    </div>
  )
}

export function FriendsPage({ open, onFriends }: Common) {
  const [f, setF] = useState<Friends | null>(null)
  const [q, setQ] = useState('')
  const [found, setFound] = useState<Person[] | null>(null)
  const load = () => api.friends().then(setF).catch(() => {})
  useEffect(() => { load(); const timer = setInterval(load, 20000); return () => clearInterval(timer) }, [])
  useEffect(() => {
    let live = true
    const timer = setTimeout(() => api.people(q).then(r => { if (live) setFound(r) }).catch(() => {}), 200)
    return () => { live = false; clearTimeout(timer) }
  }, [q])
  const changed = () => { load(); onFriends(); api.people(q).then(setFound).catch(() => {}) }

  return (
    <div className="friends-page">
      {f && f.incoming.length > 0 && (
        <section>
          <h2 className="section-title">{t('friendRequests')}</h2>
          {f.incoming.map(r => (
            <div key={r.name} className="person-row">
              <button className="who" onClick={() => open(userPage(r.name))}><Avatar name={r.name} size={36} /> <b>{r.name}</b></button>
              <span className="muted small">{ago(r.at)}</span>
              <FriendButton name={r.name} relation="received" onChange={changed} />
            </div>
          ))}
        </section>
      )}

      <section>
        <h2 className="section-title">{t('friendsTitle')}</h2>
        {!f ? <p className="pad hint">…</p> : !f.friends.length ? <p className="pad hint">{t('noFriends')}</p> : (
          <div className="friend-grid">
            {f.friends.map(x => (
              <button key={x.name} className="friend-card" onClick={() => open(userPage(x.name))}>
                <Avatar name={x.name} size={56} />
                <b>{x.name}</b>
                {x.now ? <span className={'now-line' + (x.now.playing ? ' live' : '')}>
                  {x.now.playing && <span className="eq"><i /><i /><i /></span>}{x.now.song.title} · {x.now.song.artist}</span>
                  : <span className="muted small">{x.last_played ? t('lastListened', { when: ago(x.last_played) }) : ''}</span>}
              </button>
            ))}
          </div>
        )}
      </section>

      {f && f.outgoing.length > 0 && (
        <section>
          <h2 className="section-title">{t('requestsSent')}</h2>
          {f.outgoing.map(r => (
            <div key={r.name} className="person-row">
              <button className="who" onClick={() => open(userPage(r.name))}><Avatar name={r.name} size={36} /> <b>{r.name}</b></button>
              <span className="muted small">{ago(r.at)}</span>
              <FriendButton name={r.name} relation="sent" onChange={changed} />
            </div>
          ))}
        </section>
      )}

      <section>
        <h2 className="section-title">{t('findPeople')}</h2>
        <div className="listbar"><label className="searchfield"><I.Search size={12} />
          <input placeholder={t('findPeopleHint')} value={q} onChange={e => setQ(e.target.value)} /></label></div>
        {found?.map(x => (
          <div key={x.name} className="person-row">
            <button className="who" onClick={() => open(userPage(x.name))}><Avatar name={x.name} size={36} /> <b>{x.name}</b></button>
            <FriendButton name={x.name} relation={x.relation} onChange={changed} />
          </div>
        ))}
      </section>
    </div>
  )
}

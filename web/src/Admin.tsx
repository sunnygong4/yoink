import { useEffect, useState } from 'react'
import { api, type AdminData } from './api'
import { getLang } from './i18n'

// /admin: everyone at a glance, for an admin. Not linked from anywhere; the server answers 404 to anyone else.

const when = (ts: number | null) => {
  if (!ts) return '—'
  const s = Date.now() / 1000 - ts
  const zh = getLang() === 'zh'
  if (s < 3600) return zh ? `${Math.max(1, Math.round(s / 60))} 分钟前` : `${Math.max(1, Math.round(s / 60))} min ago`
  if (s < 86400) return zh ? `${Math.round(s / 3600)} 小时前` : `${Math.round(s / 3600)} h ago`
  if (s < 30 * 86400) return zh ? `${Math.round(s / 86400)} 天前` : `${Math.round(s / 86400)} days ago`
  return new Date(ts * 1000).toLocaleDateString(zh ? 'zh-CN' : undefined)
}

const link = (code: string) => `${location.origin}/?invite=${code}`
const until = (ts: number, zh: boolean) => {
  const d = (ts * 1000 - Date.now()) / 86400000
  if (d <= 0) return new Date(ts * 1000).toLocaleDateString(zh ? 'zh-CN' : undefined)
  if (d < 1) return zh ? `${Math.max(1, Math.round(d * 24))} 小时后` : `in ${Math.max(1, Math.round(d * 24))} h`
  return zh ? `${Math.round(d)} 天后` : `in ${Math.round(d)} days`
}

export default function AdminPage() {
  const [data, setData] = useState<AdminData | null>(null)
  const [error, setError] = useState('')
  const [made, setMade] = useState('')   // the link of the invite just made
  const load = () => api.admin().then(setData).catch(e => setError((e as Error).message))
  useEffect(() => { load() }, [])
  async function newInvite(reusable = false) {
    try { const { code } = await api.adminInvite(reusable); setMade(link(code)); load() } catch (e) { alert((e as Error).message) }
  }
  async function toggle(code: string, reusable: boolean) {
    try { await api.setReusable(code, reusable); load() } catch (e) { alert((e as Error).message) }
  }
  async function drop(code: string) {
    try { await api.deleteInvite(code); load() } catch (e) { alert((e as Error).message) }
  }
  const zh = getLang() === 'zh'
  if (error) return <p className="pad error">{error}</p>
  if (!data) return <p className="pad hint">…</p>
  const { people, recent, stats } = data

  return (
    <div className="admin">
      <h1>Admin</h1>
      <div className="stats">
        <div className="stat"><b>{people.length}</b><span>{zh ? '用户' : 'people'}</span></div>
        <div className="stat"><b>{stats.ready}</b><span>{zh ? '已下载的歌' : 'songs on the server'}</span></div>
        <div className="stat"><b>{stats.smart_songs}</b><span>{zh ? '智能推荐的临时歌' : 'smart-play songs (temporary)'}</span></div>
        <div className="stat"><b>{people.reduce((n, p) => n + p.plays_week, 0)}</b><span>{zh ? '这周播放' : 'plays this week'}</span></div>
        <div className="stat"><b>{stats.invites_open}</b><span>{zh ? '未用的邀请' : 'unused invites'}</span></div>
      </div>

      <table>
        <thead><tr>
          <th>{zh ? '用户' : 'Person'}</th><th>{zh ? '加入' : 'Joined'}</th><th>{zh ? '邀请人' : 'Invited by'}</th>
          <th className="num">{zh ? '歌库' : 'Library'}</th><th className="num">{zh ? '播放' : 'Plays'}</th>
          <th className="num">{zh ? '本周' : 'This week'}</th><th className="num">{zh ? '智能' : 'Smart'}</th>
          <th>{zh ? '最近播放' : 'Last played'}</th><th>{zh ? '常听' : 'Listens to'}</th><th>{zh ? '设备' : 'Devices'}</th>
        </tr></thead>
        <tbody>
          {people.map(p => (
            <tr key={p.id}>
              <td><b>{p.name}</b>{p.is_admin && <span className="badge">admin</span>}</td>
              <td className="muted">{when(p.created)}</td>
              <td className="muted">{p.invited_by ?? '—'}</td>
              <td className="num">{p.songs}</td>
              <td className="num">{p.plays}</td>
              <td className="num">{p.plays_week}</td>
              <td className="num">{p.smart_plays}</td>
              <td className="muted">{when(p.last_played)}</td>
              <td>{p.top_artists.map(a => `${a.artist} (${a.n})`).join(' · ') || '—'}</td>
              <td className="muted">{p.devices.map(d => `${d.name}${d.last_seen ? ` · ${when(d.last_seen)}` : ''}`).join(', ') || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="section-title invites-title">
        {zh ? '邀请码' : 'Invites'}
        <button onClick={() => newInvite(true)} title={zh ? '7 天内谁都能用，次数不限' : 'Anyone may use it, any number of times, for 7 days'}>
          {zh ? '+ 可重复的邀请码（7 天）' : '+ Reusable invite (7 days)'}</button>
        <button className="blue" onClick={() => newInvite()}>{zh ? '+ 新建邀请码（7 天）' : '+ New invite (7 days)'}</button>
      </h2>
      {made && (
        <div className="notice">{zh ? '新邀请链接：' : 'New invite link:'}
          <input readOnly value={made} onFocus={e => e.target.select()} />
          <button onClick={() => navigator.clipboard?.writeText(made)}>{zh ? '复制' : 'Copy'}</button>
          <button onClick={() => setMade('')}>{zh ? '关闭' : 'Close'}</button>
        </div>
      )}
      <table>
        <thead><tr>
          <th>{zh ? '邀请码' : 'Code'}</th><th>{zh ? '创建人' : 'Made by'}</th><th>{zh ? '创建' : 'Made'}</th>
          <th>{zh ? '到期' : 'Expires'}</th><th>{zh ? '状态' : 'Status'}</th><th />
        </tr></thead>
        <tbody>
          {data.invites.map(v => {
            const timeUp = v.expires !== null && v.expires * 1000 < Date.now()
            const open = !timeUp && (v.reusable || !v.used_by)   // can still be used
            const expired = timeUp && (v.reusable || !v.used_by)
            return (
              <tr key={v.code} className={open ? '' : 'done'}>
                <td><code>{v.code}</code></td>
                <td>{v.created_by}</td>
                <td className="muted">{when(v.created)}</td>
                <td className="muted">{v.reusable || !v.used_by ? (v.expires ? until(v.expires, zh) : (zh ? '不过期' : 'never')) : '—'}</td>
                <td>
                  {v.reusable && <span className="badge">{zh ? '可重复' : 'reusable'}</span>}{' '}
                  {v.used_by_all.length
                    ? (zh ? `已用 ${v.used_by_all.length} 次：${v.used_by_all.join('、')}` : `used ${v.used_by_all.length}×: ${v.used_by_all.join(', ')}`)
                    : expired ? (zh ? '已过期' : 'expired') : (zh ? '未用' : 'unused')}
                  {expired && v.used_by_all.length > 0 && <span className="muted">{zh ? '（已过期）' : ' (expired)'}</span>}
                </td>
                <td className="num">
                  {open && <button className="mini" onClick={() => navigator.clipboard?.writeText(link(v.code))} title={zh ? '复制链接' : 'Copy link'}>⧉</button>}
                  {!timeUp && (
                    <button className="mini" onClick={() => toggle(v.code, !v.reusable)}
                      title={v.reusable ? (zh ? '改成只能用一次' : 'Make it one-time') : (zh ? '改成可重复用（到期前谁都能用）' : 'Make it reusable until it expires')}>
                      {v.reusable ? '1×' : '∞'}</button>
                  )}
                  {open && <button className="mini" onClick={() => drop(v.code)} title={v.reusable && v.used_by ? (zh ? '停用' : 'Stop it') : (zh ? '删除' : 'Delete')}>✕</button>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <h2 className="section-title">{zh ? '最近谁在听什么' : 'What everyone played lately'}</h2>
      <table>
        <thead><tr><th>{zh ? '时间' : 'When'}</th><th>{zh ? '用户' : 'Person'}</th><th>{zh ? '歌曲' : 'Song'}</th><th>{zh ? '表演者' : 'Artist'}</th></tr></thead>
        <tbody>
          {recent.map((r, i) => (
            <tr key={i}>
              <td className="muted">{when(r.played_at)}</td>
              <td>{r.user}</td>
              <td>{r.title}{r.radio ? ' ✨' : ''}</td>
              <td className="muted">{r.artist}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

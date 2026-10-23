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

export default function AdminPage() {
  const [data, setData] = useState<AdminData | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { api.admin().then(setData).catch(e => setError((e as Error).message)) }, [])
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

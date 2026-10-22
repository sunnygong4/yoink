import { useEffect, useMemo, useState } from 'react'
import { api, fmtTime, type Song, type User } from './api'
import { t } from './i18n'
import type { IPod } from './ipod'

const mb = (n: number) => (n >= 1e9 ? `${(n / 1073741824).toFixed(1)} GB` : `${(n / 1048576).toFixed(1)} MB`)

/** A little iPod classic, drawn in CSS (the device page's picture). */
export const IPodPicture = ({ small }: { small?: boolean }) => (
  <div className={'ipod-pic' + (small ? ' small' : '')} aria-hidden="true"><div className="ip-screen" /><div className="ip-wheel"><i /></div></div>
)

/** iTunes' device page: the iPod's summary, and which songs go on it. */
export default function DevicePage({ ipod, user, library }: { ipod: IPod; user: User; library: Song[] }) {
  const { present, status, progress } = ipod
  const [name, setName] = useState(t('defaultIpodName', { name: user.name }))
  const [checked, setChecked] = useState<Set<string> | null>(null)   // null: as on the device
  const [filter, setFilter] = useState('')
  const [error, setError] = useState('')

  const onDevice = useMemo(() => new Set(status?.songs.map(s => s.id) ?? []), [status])
  useEffect(() => { setChecked(null) }, [status])
  const want = checked ?? onDevice
  const ready = library.filter(s => s.status === 'ready')
  // songs on the iPod that aren't in the library (any more) still show, so they can come off
  const extra = (status?.songs ?? []).filter(s => !ready.some(r => r.id === s.id))
  const f = filter.trim().toLowerCase()
  const rows = [...ready.map(s => ({ id: s.id, title: s.title, artist: s.artist, album: s.album, duration: s.duration, gone: false })),
    ...extra.map(s => ({ ...s, gone: true }))].filter(r => !f || `${r.title} ${r.artist} ${r.album}`.toLowerCase().includes(f))
  const toAdd = ready.filter(s => want.has(s.id) && !onDevice.has(s.id))
  const toRemove = [...onDevice].filter(id => !want.has(id))
  const busy = !!progress && !progress.finished

  const toggle = (id: string) => setChecked(c => { const n = new Set(c ?? onDevice); if (n.has(id)) n.delete(id); else n.add(id); return n })

  async function connect() {
    setError('')
    try {
      const d = await api.addDevice(name)
      await ipod.pair({ token: d.token, deviceId: d.id, name, user: user.name })
    } catch (e) { setError((e as Error).message) }
  }
  async function disconnect() {
    if (!status?.paired || !confirm(t('disconnectConfirm'))) return
    if (status.deviceId) await api.removeDevice(status.deviceId).catch(() => {})
    await ipod.unpair()
  }
  async function sync() {
    setError('')
    try {
      await ipod.sync(toAdd.map(s => ({ id: s.id, title: s.title, artist: s.artist, album: s.album, duration: s.duration, thumbnail: s.thumbnail })), toRemove)
    } catch (e) { setError((e as Error).message) }
  }

  if (!present) {
    return (
      <div className="page device-page">
        <div className="device-hero"><IPodPicture /><div>
          <h1>{t('ipodTitle')}</h1>
          <p>{t('installIntro')}</p>
          <ol className="steps">
            <li><a href="/yoinker-ipod.zip" download>{t('installStep1')}</a></li>
            <li>{t('installStep2')}</li>
            <li>{t('installStep3')}</li>
            <li>{t('installStep4')}</li>
          </ol>
        </div></div>
      </div>
    )
  }
  if (status && !status.sameSite) {
    return <div className="page device-page"><p className="pad">{t('pairedElsewhere', { origin: status.origin || '' })}</p></div>
  }
  if (!status?.paired) {
    return (
      <div className="page device-page">
        <div className="device-hero"><IPodPicture /><div>
          <h1>{t('newIpod')}</h1>
          <p>{t('newIpodHint')}</p>
          <label className="name-field">{t('ipodName')} <input value={name} onChange={e => setName(e.target.value)} /></label>
          <button className="blue" onClick={connect}>{t('connectIpod')}</button>
          {error && <p className="error">{error}</p>}
        </div></div>
      </div>
    )
  }

  const usedPct = status.quota ? Math.max(1, (100 * status.usage) / status.quota) : 0
  return (
    <div className="page device-page">
      <div className="device-summary">
        <IPodPicture />
        <div className="ds-text">
          <h1>{status.name}</h1>
          <p>{t('ipodSongs', { n: status.songs.length })} · {t('used', { s: mb(status.usage) })}</p>
          <p className="muted">{t('worksOffline')}</p>
          <button onClick={disconnect}>{t('disconnect')}</button>
        </div>
      </div>
      <div className="capacity">
        <div className="cap-bar"><i className="cap-audio" style={{ width: `${usedPct}%` }} /></div>
        <div className="cap-legend">
          <span><i className="cap-audio" /> {t('audio')} {mb(status.usage)}</span>
          <span><i className="cap-free" /> {t('free')} {status.quota ? mb(status.quota - status.usage) : '—'}</span>
        </div>
      </div>

      <div className="listbar">
        <b className="listbar-title">{t('syncMusic')}</b>
        <button onClick={() => setChecked(new Set(ready.map(s => s.id)))}>{t('selectAll')}</button>
        <button onClick={() => setChecked(new Set())}>{t('selectNone')}</button>
        <span className="grow" />
        <label className="searchfield"><input placeholder={t('filterLibrary')} value={filter} onChange={e => setFilter(e.target.value)} /></label>
        <button className="blue" disabled={busy || (!toAdd.length && !toRemove.length)} onClick={sync}>
          {t('syncNow', { a: toAdd.length, r: toRemove.length })}
        </button>
      </div>
      {progress && (
        <div className={'sync-status' + (progress.finished ? ' done' : '')}>
          {progress.finished ? t('syncDone', { n: progress.done }) : t('syncing', { d: progress.done, n: progress.total, s: progress.current || '' })}
          {!progress.finished && <div className="cap-bar thin"><i className="cap-audio" style={{ width: `${progress.total ? (100 * progress.done) / progress.total : 0}%` }} /></div>}
          {progress.errors.length > 0 && <p className="error small">{progress.errors.join(' · ')}</p>}
        </div>
      )}
      {error && <p className="error pad">{error}</p>}
      <table className="songlist">
        <thead><tr><th className="c-check" /><th>{t('colName')}</th><th className="c-time">{t('colTime')}</th><th className="c-artist">{t('colArtist')}</th><th className="c-album">{t('colAlbum')}</th><th className="c-by">{t('onIpod')}</th></tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} onClick={() => !busy && toggle(r.id)} className={r.gone ? 'pending' : ''}>
              <td className="c-check"><input type="checkbox" checked={want.has(r.id)} readOnly disabled={busy} /></td>
              <td className="c-name"><span className="name">{r.title}</span>{r.gone && <span className="tag">{t('notInLibrary')}</span>}<span className="sub">{r.artist}</span></td>
              <td className="c-time">{fmtTime(r.duration)}</td>
              <td className="c-artist">{r.artist}</td>
              <td className="c-album">{r.album}</td>
              <td className="c-by">{onDevice.has(r.id) ? '✓' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

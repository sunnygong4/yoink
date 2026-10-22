import { useEffect } from 'react'
import { api, fmtTime, type Song } from './api'
import { t } from './i18n'
import * as I from './icons'
import type { Queue } from './queue'

/** The play queue, sliding in from the right: what's playing, what's next, and smart play's picks. */
export default function QueueDrawer({ open, onClose, q, byId, onSong, smartBusy }: {
  open: boolean; onClose: () => void; q: Queue; byId: Map<string, Song>; onSong: (s: Song) => void; smartBusy: boolean
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const now = q.current ? byId.get(q.current) : undefined
  const upcoming = q.ids.map((id, i) => ({ i, s: byId.get(id) })).slice(q.pos + 1)

  return (
    <>
      <div className={'drawer-backdrop' + (open ? ' open' : '')} onClick={onClose} />
      <aside className={'drawer' + (open ? ' open' : '')} aria-hidden={!open} aria-label={t('queue')}>
        <div className="drawer-head">
          <h2>{t('queue')}</h2>
          <button className="ib" onClick={onClose} title={t('close')}><I.Close /></button>
        </div>

        <div className="drawer-body">
          <h3>{t('nowPlaying')}</h3>
          {now ? <QueueRow s={now} now /> : <p className="muted small">{t('notPlaying')}</p>}

          <div className="drawer-sub">
            <h3>{t('upNext')}</h3>
            {upcoming.length > 0 && <button className="link small" onClick={q.clearUpcoming}>{t('clearUpcoming')}</button>}
          </div>
          {upcoming.length === 0 && !smartBusy && (
            <p className="muted small">{q.smart && q.repeat === 'off' ? t('smartWillPick') : t('emptyQueue')}</p>
          )}
          {upcoming.map(({ i, s }) => s && (
            <QueueRow key={`${i}-${s.id}`} s={s} onPlay={() => q.jump(i)} onRemove={() => q.remove(i)}
              onKeep={s.radio ? () => api.keep(s.id).then(onSong) : undefined} />
          ))}
          {smartBusy && <p className="muted small"><I.Sparkle size={14} /> {t('smartPicking')}</p>}
        </div>

        <div className="drawer-foot">
          <button className={'chip' + (q.smart ? ' on' : '')} onClick={q.toggleSmart}>
            <I.Sparkle size={16} /> {t(q.smart ? 'smartOn' : 'smartOff')}
          </button>
          <span className="muted small">{t('smartHint')}</span>
        </div>
      </aside>
    </>
  )
}

function QueueRow({ s, now, onPlay, onRemove, onKeep }: {
  s: Song; now?: boolean; onPlay?: () => void; onRemove?: () => void; onKeep?: () => void
}) {
  return (
    <div className={'qrow' + (now ? ' now' : '')}>
      <button className="qmain" onClick={onPlay} disabled={!onPlay}>
        {s.thumbnail ? <img src={s.thumbnail} alt="" loading="lazy" /> : <div className="blank" />}
        <span className="qtext">
          <b>{s.title}</b>
          <span>
            {s.radio && <span className="tag good">{t('recommended')}</span>}
            {s.artist}{s.status !== 'ready' ? ` · ${s.status === 'error' ? t('failedShort') : t('preparing')}` : ` · ${fmtTime(s.duration)}`}
          </span>
        </span>
      </button>
      {onKeep && <button className="ib" onClick={onKeep} title={t('keep')}><I.Heart size={18} /></button>}
      {onRemove && <button className="ib" onClick={onRemove} title={t('removeFromQueue')}><I.Close size={18} /></button>}
    </div>
  )
}

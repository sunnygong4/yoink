import { t } from './i18n'
import * as I from './icons'
import type { Queue } from './queue'

/** Playback controls the player hands to the full-screen view. */
export type Transport = {
  playing: boolean
  time: number
  duration: number
  toggle: () => void
  seek: (t: number) => void
  next: () => void
  prev: () => void
  lucky: () => void      // ✨: play a new song (like this one) right now
  luckyBusy: boolean
}

/** Shuffle / repeat toggles (the bar and the full-screen view). */
export function ModeButtons({ q, only }: { q: Queue; only?: 'shuffle' | 'repeat' }) {
  const show = (k: string) => !only || only === k
  return (
    <>
      {show('shuffle') && (
        <button className={'square mode' + (q.shuffle ? ' pressed' : '')} onClick={q.toggleShuffle} title={t('shuffleMode')}
          aria-pressed={q.shuffle}><I.Shuffle size={15} /></button>
      )}
      {show('repeat') && (
        <button className={'square mode' + (q.repeat !== 'off' ? ' pressed' : '')} onClick={q.cycleRepeat}
          title={t(q.repeat === 'one' ? 'repeatOne' : q.repeat === 'all' ? 'repeatAll' : 'repeatOff')}>
          {q.repeat === 'one' ? <I.RepeatOne size={15} /> : <I.Repeat size={15} />}
        </button>
      )}
    </>
  )
}

/** ✨: one press plays a song smart play picks (like the current one, or like your library), right away. */
export function LuckyButton({ tr }: { tr: Pick<Transport, 'lucky' | 'luckyBusy'> }) {
  return (
    <button data-tour="lucky" className={'square mode lucky' + (tr.luckyBusy ? ' busy' : '')} onClick={tr.lucky} disabled={tr.luckyBusy}
      title={t('luckyHint')}><I.Sparkle size={15} /></button>
  )
}

/** Autoplay: when the queue runs out, keep going with similar songs. */
export function AutoplaySwitch({ q }: { q: Queue }) {
  return (
    <label className="switch" title={t('smartHint')}>
      <input type="checkbox" checked={q.smart} onChange={q.toggleSmart} />
      <span className="track"><span className="knob" /></span>
      <span className="switch-label">{t('autoplay')}</span>
    </label>
  )
}

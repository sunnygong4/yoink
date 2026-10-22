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
}

/** Shuffle / repeat / smart-play toggles (used in the bar and the full-screen view). */
export function ModeButtons({ q, only, busy }: { q: Queue; only?: 'shuffle' | 'repeat' | 'smart'; busy?: boolean }) {
  const show = (k: string) => !only || only === k
  return (
    <>
      {show('shuffle') && (
        <button className={'ib mode' + (q.shuffle ? ' on' : '')} onClick={q.toggleShuffle} title={t('shuffleMode')}
          aria-pressed={q.shuffle}><I.Shuffle size={18} /></button>
      )}
      {show('repeat') && (
        <button className={'ib mode' + (q.repeat !== 'off' ? ' on' : '')} onClick={q.cycleRepeat}
          title={t(q.repeat === 'one' ? 'repeatOne' : q.repeat === 'all' ? 'repeatAll' : 'repeatOff')}>
          {q.repeat === 'one' ? <I.RepeatOne size={18} /> : <I.Repeat size={18} />}
        </button>
      )}
      {show('smart') && (
        <button className={'ib mode' + (q.smart ? ' on' : '') + (busy ? ' busy' : '')} onClick={q.toggleSmart}
          title={`${t(q.smart ? 'smartOn' : 'smartOff')} — ${t('smartHint')}`} aria-pressed={q.smart}>
          <I.Sparkle size={18} />
        </button>
      )}
    </>
  )
}

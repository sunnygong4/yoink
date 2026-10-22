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
        <button className={'square mode' + (q.shuffle ? ' pressed' : '')} onClick={q.toggleShuffle} title={t('shuffleMode')}
          aria-pressed={q.shuffle}><I.Shuffle size={15} /></button>
      )}
      {show('repeat') && (
        <button className={'square mode' + (q.repeat !== 'off' ? ' pressed' : '')} onClick={q.cycleRepeat}
          title={t(q.repeat === 'one' ? 'repeatOne' : q.repeat === 'all' ? 'repeatAll' : 'repeatOff')}>
          {q.repeat === 'one' ? <I.RepeatOne size={15} /> : <I.Repeat size={15} />}
        </button>
      )}
      {show('smart') && (
        <button className={'square mode' + (q.smart ? ' pressed' : '') + (busy ? ' busy' : '')} onClick={q.toggleSmart}
          title={`${t(q.smart ? 'smartOn' : 'smartOff')} — ${t('smartHint')}`} aria-pressed={q.smart}>
          <I.Sparkle size={15} />
        </button>
      )}
    </>
  )
}

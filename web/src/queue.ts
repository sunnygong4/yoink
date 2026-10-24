import { useCallback, useEffect, useState } from 'react'

// The play queue and how it moves on: repeat (off / all / one), shuffle and smart play (recommendations).
// Saved per device, so a reload picks up where you were.

export type Repeat = 'off' | 'all' | 'one'

type State = {
  ids: string[]
  pos: number
  original: string[] | null   // the order before shuffling, to go back to
  repeat: Repeat
  shuffle: boolean
  smart: boolean
  played: string[]            // recently finished songs: smart play doesn't recommend them again
}

const SAVED = 'yoinker.queue'
const EMPTY: State = { ids: [], pos: 0, original: null, repeat: 'off', shuffle: false, smart: true, played: [] }

function load(): State {
  try {
    const q = JSON.parse(localStorage.getItem(SAVED) || '')
    if (Array.isArray(q.ids)) return { ...EMPTY, ...q }
  } catch { /* nothing saved */ }
  return EMPTY
}

function shuffled<T>(xs: T[]): T[] {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** The current song stays where it is; everything after it is shuffled. */
function shuffleRest(ids: string[], pos: number): string[] {
  return [...ids.slice(0, pos + 1), ...shuffled(ids.slice(pos + 1))]
}

export function useQueue() {
  const [q, setQ] = useState<State>(load)
  // false right after a page load: don't start blasting music on reload
  const [autoplay, setAutoplay] = useState(false)
  // ticks on every "play this": the player starts it even when it's the song already loaded (paused)
  const [starts, setStarts] = useState(0)

  useEffect(() => {
    try { localStorage.setItem(SAVED, JSON.stringify(q)) } catch { /* private mode */ }
  }, [q])

  const play = useCallback((ids: string[], start = 0) => {
    setAutoplay(true); setStarts(x => x + 1)
    setQ(s => {
      if (!s.shuffle) return { ...s, ids, pos: start, original: null }
      // shuffle on: the chosen song first, the rest in random order
      const first = ids[start]
      return { ...s, ids: [first, ...shuffled(ids.filter((_, i) => i !== start))], pos: 0, original: ids }
    })
  }, [])

  const playNext = useCallback((id: string) => {
    setQ(s => s.ids.length
      ? { ...s, ids: [...s.ids.slice(0, s.pos + 1), id, ...s.ids.slice(s.pos + 1)] }
      : { ...s, ids: [id], pos: 0 })
    setAutoplay(true); setStarts(x => x + 1)
  }, [])

  /** Straight to this song: it goes right after the current one, and plays. */
  const playNow = useCallback((id: string) => {
    setAutoplay(true); setStarts(x => x + 1)
    setQ(s => s.ids.length
      ? { ...s, ids: [...s.ids.slice(0, s.pos + 1), id, ...s.ids.slice(s.pos + 1)], pos: s.pos + 1 }
      : { ...s, ids: [id], pos: 0 })
  }, [])

  const enqueue = useCallback((id: string) => {
    setQ(s => s.ids.length ? { ...s, ids: [...s.ids, id] } : { ...s, ids: [id], pos: 0 })
    setAutoplay(true); setStarts(x => x + 1)
  }, [])

  const jump = useCallback((pos: number) => { setAutoplay(true); setStarts(x => x + 1); setQ(s => ({ ...s, pos })) }, [])

  const remove = useCallback((i: number) => {
    setQ(s => ({ ...s, ids: s.ids.filter((_, j) => j !== i), pos: i < s.pos ? s.pos - 1 : Math.min(s.pos, s.ids.length - 2) }))
  }, [])

  const clearUpcoming = useCallback(() => setQ(s => ({ ...s, ids: s.ids.slice(0, s.pos + 1) })), [])

  /** Move on to the next song (repeat-all wraps around; at the very end nothing changes). Repeat-one is the
   * player's business: it only applies when a song ends by itself. */
  const next = useCallback(() => {
    setAutoplay(true)
    setQ(s => {
      const played = [...s.played.filter(id => id !== s.ids[s.pos]), s.ids[s.pos]].filter(Boolean).slice(-100)
      if (s.pos < s.ids.length - 1) return { ...s, pos: s.pos + 1, played }
      if (s.repeat === 'all' && s.ids.length) return { ...s, pos: 0, played, ids: s.shuffle ? shuffled(s.ids) : s.ids }
      return { ...s, played }
    })
  }, [])

  const prev = useCallback(() => {
    setAutoplay(true)
    setQ(s => s.pos > 0 ? { ...s, pos: s.pos - 1 } : s.repeat === 'all' && s.ids.length ? { ...s, pos: s.ids.length - 1 } : s)
  }, [])

  const toggleShuffle = useCallback(() => setQ(s => {
    if (!s.shuffle) return { ...s, shuffle: true, original: s.ids, ids: shuffleRest(s.ids, s.pos) }
    // back to the order the songs were queued in, keeping the current one playing
    const current = s.ids[s.pos]
    const extra = s.ids.filter(id => !(s.original ?? []).includes(id))   // added while shuffled
    const ids = [...(s.original ?? s.ids).filter(id => s.ids.includes(id)), ...extra]
    return { ...s, shuffle: false, original: null, ids, pos: Math.max(0, ids.indexOf(current)) }
  }), [])

  const cycleRepeat = useCallback(() => setQ(s => ({ ...s, repeat: s.repeat === 'off' ? 'all' : s.repeat === 'all' ? 'one' : 'off' })), [])
  const toggleSmart = useCallback(() => setQ(s => ({ ...s, smart: !s.smart })), [])

  /** Smart play found the next song: it goes at the end of the queue. */
  const appendRecommended = useCallback((id: string) => setQ(s => s.ids.includes(id) ? s : { ...s, ids: [...s.ids, id] }), [])

  return {
    ...q, autoplay, starts, current: q.ids[q.pos] as string | undefined,
    play, playNext, enqueue, jump, remove, clearUpcoming, next, prev, toggleShuffle, cycleRepeat, toggleSmart,
    appendRecommended, playNow,
  }
}

export type Queue = ReturnType<typeof useQueue>

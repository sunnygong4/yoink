import { useCallback, useEffect, useRef, useState } from 'react'

// Talking to the Yoinker iPod browser extension: its content script relays window messages
// ({ source: 'yoinker-page' } out, { source: 'yoinker-ipod' } back) to the extension.

export type IPodSong = { id: string; title: string; artist: string; album: string | null; duration: number | null; size: number }
export type IPodStatus = {
  paired: boolean; name?: string; user?: string; deviceId?: number; origin?: string
  songs: IPodSong[]; usage: number; quota: number; sameSite: boolean
}
export type SyncProgress = { done: number; total: number; current: string | null; errors: string[]; finished?: boolean }

export function useIPod() {
  const [present, setPresent] = useState(false)
  const [status, setStatus] = useState<IPodStatus | null>(null)
  const [progress, setProgress] = useState<SyncProgress | null>(null)
  const pending = useRef(new Map<number, (r: unknown) => void>())
  const seq = useRef(0)

  const request = useCallback(<T,>(type: string, extra: object = {}) => new Promise<T>((resolve, reject) => {
    const reqId = ++seq.current
    pending.current.set(reqId, r => {
      const reply = r as { error?: string }
      if (reply?.error) reject(new Error(reply.error)); else resolve(r as T)
    })
    window.postMessage({ source: 'yoinker-page', type, reqId, ...extra }, location.origin)
    setTimeout(() => { if (pending.current.delete(reqId)) reject(new Error('the iPod did not answer')) }, 8000)
  }), [])

  const refresh = useCallback(() => request<IPodStatus>('status').then(s => { setPresent(true); setStatus(s) }).catch(() => {}), [request])

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== window || e.data?.source !== 'yoinker-ipod') return
      const m = e.data
      if (m.type === 'present') { setPresent(true); refresh() }
      else if (m.type === 'reply') { pending.current.get(m.reqId)?.(m.reply); pending.current.delete(m.reqId) }
      else if (m.type === 'sync-progress') setProgress({ done: m.done, total: m.total, current: m.current, errors: m.errors })
      else if (m.type === 'sync-done') { setProgress({ done: m.done, total: m.total, current: null, errors: m.errors, finished: true }); refresh() }
    }
    window.addEventListener('message', onMsg)
    refresh()   // the content script may have said hello before we were listening
    return () => window.removeEventListener('message', onMsg)
  }, [refresh])

  const pair = (p: { token: string; deviceId: number; name: string; user: string }) => request<IPodStatus>('pair', p).then(setStatus)
  const unpair = () => request<IPodStatus>('unpair').then(setStatus)
  const sync = (add: object[], remove: string[]) => {
    setProgress({ done: 0, total: add.length, current: null, errors: [] })
    return request('sync', { add, remove }).then(() => refresh())
  }
  return { present, status, progress, refresh, pair, unpair, sync }
}

export type IPod = ReturnType<typeof useIPod>

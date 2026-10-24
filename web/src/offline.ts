import { useCallback, useEffect, useState } from 'react'
import { api, type Song } from './api'
import type { IPod, IPodSong, IPodStatus, SyncProgress } from './ipod'
import { getQuality } from './quality'

// Songs saved on this phone / computer: the audio, cover and lyrics go into the "yoinker-music" cache (the service
// worker serves covers and lyrics from it when offline), and the list of what's saved into localStorage.

const MUSIC = 'yoinker-music-v1'
const INDEX = 'yoinker.offline'
const key = (id: string) => `/offline/${id}`
export const canSave = typeof caches !== 'undefined'

function readIndex(): IPodSong[] {
  try { return JSON.parse(localStorage.getItem(INDEX) || '[]') } catch { return [] }
}
function writeIndex(songs: IPodSong[]) {
  try { localStorage.setItem(INDEX, JSON.stringify(songs)) } catch { /* private mode */ }
}

/** A saved song's audio as a blob: URL (null when it isn't saved here). Playing from it needs no connection. */
export async function savedAudio(id: string): Promise<string | null> {
  if (!canSave) return null
  try {
    const r = await (await caches.open(MUSIC)).match(key(id))
    return r ? URL.createObjectURL(await r.blob()) : null
  } catch { return null }
}

const coverUrl = (thumb: string) => (thumb.startsWith('/') ? thumb : `/api/cover?${new URLSearchParams({ url: thumb })}`)

async function save(cache: Cache, s: Song): Promise<number> {
  const r = await fetch(api.audioUrl(s.id, getQuality()))   // at this device's quality
  if (!r.ok) throw new Error(`${s.title}: ${r.status}`)
  const blob = await r.blob()
  await cache.put(key(s.id), new Response(blob, { headers: { 'content-type': 'audio/mp4', 'content-length': String(blob.size) } }))
  // the cover under its own address (that's what the page asks for), and the lyrics: nice to have, not needed
  if (s.thumbnail) {
    await fetch(coverUrl(s.thumbnail)).then(c => (c.ok ? cache.put(s.thumbnail!, c) : undefined)).catch(() => {})
  }
  if (s.lyrics) {
    const url = `/api/songs/${s.id}/lyrics`
    await fetch(url).then(l => (l.ok ? cache.put(url, l) : undefined)).catch(() => {})
  }
  return blob.size
}

async function drop(cache: Cache, s: IPodSong & { thumbnail?: string | null }) {
  await cache.delete(key(s.id))
  await cache.delete(`/api/songs/${s.id}/lyrics`)
  if (s.thumbnail) await cache.delete(s.thumbnail)
}

/** "This phone" as a device, shaped like the iPod extension so the same sync page drives both. */
export function useLocalDevice(name: string): IPod {
  const [status, setStatus] = useState<IPodStatus | null>(null)
  const [progress, setProgress] = useState<SyncProgress | null>(null)

  const refresh = useCallback(async () => {
    let songs = readIndex()
    if (canSave) {
      // the browser may have cleared the cache (low storage): only list what's really there
      const there = new Set((await (await caches.open(MUSIC)).keys()).map(r => new URL(r.url).pathname))
      const kept = songs.filter(s => there.has(key(s.id)))
      if (kept.length !== songs.length) writeIndex(songs = kept)
    }
    const est = await navigator.storage?.estimate?.().catch(() => null)
    setStatus({ paired: true, name, songs, usage: songs.reduce((n, s) => n + (s.size || 0), 0),
      quota: est?.quota ?? 0, sameSite: true })
  }, [name])
  useEffect(() => { refresh() }, [refresh])

  const sync = useCallback(async (add: object[], remove: string[]) => {
    const cache = await caches.open(MUSIC)
    // ask once not to be cleared when space runs low (Safari / Chrome grant it to installed apps)
    navigator.storage?.persist?.().catch(() => {})
    const songs = readIndex()
    for (const id of remove) {
      const s = songs.find(x => x.id === id)
      if (s) await drop(cache, s)
    }
    let list = songs.filter(s => !remove.includes(s.id))
    writeIndex(list)
    const todo = add as Song[]
    const errors: string[] = []
    for (let i = 0; i < todo.length; i++) {
      const s = todo[i]
      setProgress({ done: i, total: todo.length, current: s.title, errors: [...errors] })
      try {
        const size = await save(cache, s)
        list = [...list.filter(x => x.id !== s.id),
          { id: s.id, title: s.title, artist: s.artist, album: s.album, duration: s.duration, size, thumbnail: s.thumbnail } as IPodSong]
        writeIndex(list)
      } catch (e) {
        errors.push((e as Error).message.includes('QuotaExceeded') ? `${s.title}: storage full` : (e as Error).message)
        if ((e as Error).name === 'QuotaExceededError') break
      }
    }
    setProgress({ done: todo.length - errors.length, total: todo.length, current: null, errors, finished: true })
    await refresh()
  }, [refresh])

  const noop = useCallback(async () => {}, [])
  return { present: true, status, progress, refresh, pair: noop, unpair: noop, sync } as unknown as IPod
}

/** Whether there's a connection (songs not saved here can't play without one). */
export function useOnline() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  return online
}

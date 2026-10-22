import { getLang } from './i18n'

export type User = { id: number; name: string; is_admin: boolean }

export type Song = {
  id: string
  title: string
  artist: string
  album: string | null
  duration: number | null
  thumbnail: string | null
  url: string | null
  status: 'queued' | 'working' | 'ready' | 'error' | null
  progress: number | null
  error: string | null
  error_code: string | null   // known download errors, translated by the client
  added_by: string | null
  added_at: number | null
  lyrics: boolean
}

// a real song from the catalog (iTunes): one per song per artist
export type CatalogSong = {
  key: string
  title: string
  artist: string
  album: string
  duration: number | null
  artwork: string
  year: string
  versions: number
  song_id: string | null   // already in the library
  instant: boolean         // the karaoke site already has it: adding takes a second
}

// an upload of a song on YouTube / Bilibili
export type Source = {
  source: 'youtube' | 'bilibili'
  id: string
  url: string
  title: string
  channel: string
  album?: string | null
  duration: number
  views: number | null
  thumbnail: string
  tags: string[]
  fit: number
}

export type Lyrics = { lines: { t: number; text: string; tr?: string }[]; offset: number }

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'x-lang': getLang() }   // server messages in the UI's language
  const r = await fetch(path, body === undefined ? { headers } : {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    let msg = r.statusText
    try { msg = (await r.json()).detail || msg } catch { /* not json */ }
    throw new ApiError(r.status, typeof msg === 'string' ? msg : JSON.stringify(msg))
  }
  return r.json()
}

export const api = {
  me: () => call<User>('/api/me'),
  setup: () => call<{ first_user: boolean }>('/api/setup'),
  login: (name: string, password: string) => call<User>('/api/login', { name, password }),
  register: (name: string, password: string, invite: string) => call<User>('/api/register', { name, password, invite }),
  logout: () => call('/api/logout', {}),
  invite: () => call<{ code: string }>('/api/invites', {}),
  songs: () => call<Song[]>('/api/songs'),
  catalog: (q: string) => call<CatalogSong[]>(`/api/catalog?${new URLSearchParams({ q })}`),
  quick: (song: CatalogSong) => call<Song>('/api/songs/quick', song),
  sources: (song: CatalogSong, where: string) => call<Source[]>(`/api/sources?where=${where}`, song),
  add: (r: Source, song: CatalogSong) => call<Song>('/api/songs', { ...r, song }),
  retry: (id: string) => call(`/api/songs/${id}/retry`, {}),
  lyrics: (id: string) => call<Lyrics>(`/api/songs/${id}/lyrics`),
  audioUrl: (id: string) => `/api/songs/${id}/audio`,
  downloadUrl: (id: string) => `/api/songs/${id}/download`,
}

export function fmtTime(s: number | null | undefined) {
  if (!s || !isFinite(s)) return '0:00'
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

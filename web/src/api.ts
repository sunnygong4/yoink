export type User = { id: number; name: string; is_admin: boolean }

export type Song = {
  id: string
  title: string
  artist: string
  duration: number | null
  thumbnail: string | null
  url: string | null
  status: 'queued' | 'working' | 'ready' | 'error' | null
  progress: number | null
  error: string | null
  added_by: string | null
  added_at: number | null
  lyrics: boolean
}

export type SearchResult = {
  source: 'youtube' | 'bilibili'
  id: string
  url: string
  title: string
  channel: string
  duration: number
  views: number | null
  thumbnail: string
  tags: string[]
  song_id: string | null   // already in the library (this upload, or another one of the same song)
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
  const r = await fetch(path, body === undefined ? {} : {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
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
  search: (q: string, where: string) => call<SearchResult[]>(`/api/search?${new URLSearchParams({ q, where })}`),
  add: (r: SearchResult) => call<Song>('/api/songs', r),
  retry: (id: string) => call(`/api/songs/${id}/retry`, {}),
  lyrics: (id: string) => call<Lyrics>(`/api/songs/${id}/lyrics`),
  audioUrl: (id: string) => `/api/songs/${id}/audio`,
}

export function fmtTime(s: number | null | undefined) {
  if (!s || !isFinite(s)) return '0:00'
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

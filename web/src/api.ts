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
  radio: boolean   // recommended by smart play, not (yet) in the library
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

export type SearchAlbum = { title: string; artist: string; year: string; artwork: string | null }
export type CatalogResults = {
  songs: CatalogSong[]
  artists: { name: string; genre: string | null }[]
  albums: SearchAlbum[]
  top: ({ kind: 'artist'; name: string; genre: string | null } | ({ kind: 'album' } & SearchAlbum)) | null
}

export type ArtistAlbum = { title: string; artist: string; year: string; artwork: string | null; tracks: number | null; single: boolean }

export type Artist = {
  name: string
  photo: string | null
  logo: string | null
  background: string | null
  bio: string | null
  genre: string | null
  formed: string | null
  albums: ArtistAlbum[]
  top: CatalogSong[]
  slug: string
}

export type Album = {
  title: string
  artist: string
  year: string
  artwork: string | null
  genre: string | null
  copyright: string | null
  description: string | null
  tracks: (CatalogSong & { track: number | null; disc: number | null })[]
  slug: string
}

export type Play = {
  song_id: string
  played_at: number
  radio: boolean       // smart play brought it
  title: string
  artist: string
  album: string | null
  thumbnail: string | null
  source: 'youtube' | 'bilibili' | 'local' | null
  url: string | null
  in_library: boolean
  available: boolean   // still downloaded (smart-play songs nobody kept are deleted after a while)
  song: Song | null
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
  addDevice: (name: string) => call<{ id: number; name: string; token: string }>('/api/devices', { name }),
  removeDevice: (id: number) => fetch(`/api/devices/${id}`, { method: 'DELETE' }),
  songs: () => call<Song[]>('/api/songs'),
  catalog: (q: string) => call<CatalogResults>(`/api/catalog?${new URLSearchParams({ q })}`),
  suggest: (q: string) => call<string[]>(`/api/suggest?${new URLSearchParams({ q })}`),
  preview: (song: CatalogSong) => call<Song>('/api/songs/preview', song),
  addAlbum: (key: string) => call<{ queued: number }>('/api/album/add', { key }),
  artist: (key: string) => call<Artist>(`/api/artist?${new URLSearchParams({ key })}`),
  artistMedia: async (name: string, kind: 'logo' | 'photo' | 'background', file: File) => {
    const form = new FormData()
    form.append('name', name)
    form.append('kind', kind)
    form.append('file', file)
    const r = await fetch('/api/artist/media', { method: 'POST', body: form, headers: { 'x-lang': getLang() } })
    if (!r.ok) throw new ApiError(r.status, (await r.json().catch(() => ({}))).detail || r.statusText)
  },
  album: (key: string) => call<Album>(`/api/album?${new URLSearchParams({ key })}`),
  quick: (song: CatalogSong) => call<Song>('/api/songs/quick', song),
  sources: (song: CatalogSong, where: string) => call<Source[]>(`/api/sources?where=${where}`, song),
  add: (r: Source, song: CatalogSong) => call<Song>('/api/songs', { ...r, song }),
  retry: (id: string) => call(`/api/songs/${id}/retry`, {}),
  remove: (id: string) => fetch(`/api/songs/${id}`, { method: 'DELETE' }),
  forYou: (fresh = false) => call<CatalogSong[]>(`/api/foryou${fresh ? '?fresh=1' : ''}`),
  radio: (seed: string | null, exclude: string[]) => call<Song>('/api/radio', { seed, exclude }),
  played: (id: string) => call('/api/plays', { song_id: id }),
  history: () => call<Play[]>('/api/plays'),
  keep: (id: string) => call<Song>(`/api/songs/${id}/keep`, {}),
  lyrics: (id: string) => call<Lyrics>(`/api/songs/${id}/lyrics`),
  lyricsOffset: (id: string, offset: number) => call<{ offset: number }>(`/api/songs/${id}/lyrics-offset`, { method: 'POST', body: JSON.stringify({ offset }) }),
  audioUrl: (id: string) => `/api/songs/${id}/audio`,
  downloadUrl: (id: string) => `/api/songs/${id}/download`,
  importLink: (url: string, info: { title: string; artist: string; album: string }) =>
    call<Song>('/api/songs/link', { url, ...info }),
  // XHR rather than fetch: it reports upload progress
  upload: (file: File, info: { title: string; artist: string; album: string }, cover: File | null,
    onProgress: (percent: number) => void) => new Promise<Song>((resolve, reject) => {
    const form = new FormData()
    form.append('file', file)
    Object.entries(info).forEach(([k, v]) => form.append(k, v))
    if (cover) form.append('cover', cover)
    const x = new XMLHttpRequest()
    x.open('POST', '/api/songs/upload')
    x.setRequestHeader('x-lang', getLang())
    x.upload.onprogress = e => { if (e.lengthComputable) onProgress(Math.round(100 * e.loaded / e.total)) }
    x.onload = () => {
      let body: { detail?: string } & Song
      try { body = JSON.parse(x.responseText) } catch { body = {} as Song }
      if (x.status < 300) resolve(body)
      else reject(new ApiError(x.status, body.detail || (x.status === 413 ? 'File too large' : x.statusText)))
    }
    x.onerror = () => reject(new ApiError(0, 'Network error'))
    x.send(form)
  }),
}

/** What the audio is doing on a phone, into the server's log (iPhone home-screen problems can't be seen otherwise). */
export function report(event: string, detail: Record<string, unknown> = {}) {
  try {
    const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
    navigator.sendBeacon?.('/api/clientlog', new Blob([JSON.stringify({ event, standalone, ua: navigator.userAgent, ...detail })],
      { type: 'application/json' }))
  } catch { /* nothing to report with */ }
}

export function fmtTime(s: number | null | undefined) {
  if (!s || !isFinite(s)) return '0:00'
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

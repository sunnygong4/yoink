import { getLang } from './i18n'

export type User = { id: number; name: string; is_admin: boolean }

export type Song = {
  id: string
  title: string
  artist: string
  artist_main?: string   // the artist's one name (邓丽君 / Teresa Teng -> 鄧麗君)
  album: string | null
  album_id?: number | null   // the store's album id: its page opens by it
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
  source_title?: string | null   // the video's own title
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
  album_id?: number | null   // the store's album id
}

// the name to give an upload when it's added (a catalog song, or a YouTube Music track's own details)
export type UploadSong = { title: string; artist: string; album?: string | null; duration?: number | null; artwork?: string | null }
// 找不到的歌: a YouTube Music song or YouTube video found for the search itself
export type Upload = Source & { song_id: string | null; name: { title: string; artist: string | null } }

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

export type SearchAlbum = { title: string; artist: string; year: string; artwork: string | null; id?: number | null }
export type CatalogResults = {
  songs: CatalogSong[]
  artists: { name: string; genre: string | null }[]
  albums: SearchAlbum[]
  top: ({ kind: 'artist'; name: string; genre: string | null } | ({ kind: 'album' } & SearchAlbum)) | null
  matched: number   // songs that really are what was searched (all its words in the name / artist / album)
  local: LocalSong[]   // songs on the server the store catalog doesn't have (named by whoever added them)
}
export type LocalSong = { song: Song; in_library: boolean }

export type ArtistAlbum = { title: string; artist: string; year: string; artwork: string | null; tracks: number | null; single: boolean; id?: number | null }

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
  local: Song[]   // their songs on the server
  slug: string
}

// an artist's songs, by the language they're sung in
export type Lang = 'zh' | 'yue' | 'ja' | 'en' | 'ko' | 'nan' | 'other'
export type ArtistSongs = { langs: Partial<Record<Lang, number>>; total: number; songs: (CatalogSong & { lang: Lang })[] }

export type Album = {
  id?: number | null
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

async function call<T>(path: string, body?: unknown, method?: 'DELETE' | 'PUT' | 'PATCH'): Promise<T> {
  const headers: Record<string, string> = { 'x-lang': getLang() }   // server messages in the UI's language
  const r = await fetch(path, method === 'DELETE' ? { method, headers } : body === undefined ? { headers } : {
    method: method ?? 'POST',
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
  admin: () => call<AdminData>('/api/admin'),
  profile: (name: string) => call<Profile>(`/api/users/${encodeURIComponent(name)}`),
  saveProfile: (bio: string, show: Record<string, string>) => call<Profile>('/api/profile', { bio, show }, 'PUT'),
  friends: () => call<Friends>('/api/friends'),
  people: (q: string) => call<Person[]>(`/api/people?${new URLSearchParams({ q })}`),
  addFriend: (name: string) => call<{ relation: Relation }>(`/api/friends/${encodeURIComponent(name)}`, {}),
  removeFriend: (name: string) => call<{ relation: Relation }>(`/api/friends/${encodeURIComponent(name)}`, undefined, 'DELETE'),
  now: (song_id: string | null, playing: boolean) => call('/api/now', { song_id, playing }),
  editSong: (id: string, info: { title: string; artist: string; album: string }) => call<Song>(`/api/songs/${id}/info`, info, 'PUT'),
  songCover: async (id: string, file: File) => {
    const form = new FormData()
    form.append('file', file)
    const r = await fetch(`/api/songs/${id}/cover`, { method: 'POST', body: form, headers: { 'x-lang': getLang() } })
    if (!r.ok) throw new ApiError(r.status, (await r.json().catch(() => ({}))).detail || r.statusText)
    return r.json() as Promise<Song>
  },
  groups: () => call<GroupSummary[]>('/api/groups'),
  newGroup: (name: string) => call<{ id: number }>('/api/groups', { name }),
  group: (id: number) => call<Group>(`/api/groups/${id}`),
  addGroupMember: (id: number, name: string) => call(`/api/groups/${id}/members/${encodeURIComponent(name)}`, {}),
  removeGroupMember: (id: number, name: string) => call(`/api/groups/${id}/members/${encodeURIComponent(name)}`, undefined, 'DELETE'),
  addGroupSong: (id: number, song_id: string) => call(`/api/groups/${id}/songs`, { song_id }),
  removeGroupSong: (id: number, row: number) => call(`/api/groups/${id}/songs/${row}`, undefined, 'DELETE'),
  groupSession: (id: number, listen: boolean) => call<GroupState>(`/api/groups/${id}/session${listen ? '?listen=1' : ''}`),
  groupControl: (id: number, c: { action: string; index?: number; pos?: number; from_index?: number }) =>
    call<GroupState>(`/api/groups/${id}/session`, c),
  stopGroupSession: (id: number) => call(`/api/groups/${id}/session`, undefined, 'DELETE'),
  setup: () => call<{ first_user: boolean }>('/api/setup'),
  login: (name: string, password: string) => call<User>('/api/login', { name, password }),
  register: (name: string, password: string, invite: string) => call<User>('/api/register', { name, password, invite }),
  logout: () => call('/api/logout', {}),
  invite: () => call<{ code: string; expires: number }>('/api/invites', {}),
  adminInvite: (reusable = false) => call<{ code: string; expires: number }>('/api/admin/invites', { reusable }),
  setReusable: (code: string, reusable: boolean) => call(`/api/admin/invites/${encodeURIComponent(code)}`, { reusable }, 'PATCH'),
  deleteInvite: (code: string) => call<{ ok: boolean }>(`/api/admin/invites/${encodeURIComponent(code)}`, undefined, 'DELETE'),
  addDevice: (name: string) => call<{ id: number; name: string; token: string }>('/api/devices', { name }),
  removeDevice: (id: number) => fetch(`/api/devices/${id}`, { method: 'DELETE' }),
  songs: () => call<Song[]>('/api/songs'),
  catalog: (q: string) => call<CatalogResults>(`/api/catalog?${new URLSearchParams({ q })}`),
  suggest: (q: string) => call<string[]>(`/api/suggest?${new URLSearchParams({ q })}`),
  preview: (song: CatalogSong) => call<Song>('/api/songs/preview', song),
  addAlbum: (key: string, id?: number | null) => call<{ queued: number }>('/api/album/add', { key, id: id ?? null }),
  artist: (key: string) => call<Artist>(`/api/artist?${new URLSearchParams({ key })}`),
  artistMedia: async (name: string, kind: 'logo' | 'photo' | 'background', file: File) => {
    const form = new FormData()
    form.append('name', name)
    form.append('kind', kind)
    form.append('file', file)
    const r = await fetch('/api/artist/media', { method: 'POST', body: form, headers: { 'x-lang': getLang() } })
    if (!r.ok) throw new ApiError(r.status, (await r.json().catch(() => ({}))).detail || r.statusText)
  },
  album: (key: string, id?: number) => call<Album>(`/api/album?${new URLSearchParams({ key, ...(id ? { id: String(id) } : {}) })}`),
  artistSongs: (key: string, langs: string[], offset: number) =>
    call<ArtistSongs>(`/api/artist/songs?${new URLSearchParams({ key, langs: langs.join(','), offset: String(offset) })}`),
  quick: (song: CatalogSong) => call<Song>('/api/songs/quick', song),
  sources: (song: CatalogSong, where: string) => call<Source[]>(`/api/sources?where=${where}`, song),
  add: (r: Source, song?: UploadSong, preview = false) => call<Song>('/api/songs', { ...r, song, preview }),
  uploads: (q: string) => call<Upload[]>(`/api/uploads?${new URLSearchParams({ q })}`),
  retry: (id: string) => call(`/api/songs/${id}/retry`, {}),
  remove: (id: string) => fetch(`/api/songs/${id}`, { method: 'DELETE' }),
  forYou: (fresh = false) => call<CatalogSong[]>(`/api/foryou${fresh ? '?fresh=1' : ''}`),
  radio: (seed: string | null, exclude: string[]) => call<Song>('/api/radio', { seed, exclude }),
  played: (id: string) => call('/api/plays', { song_id: id }),
  history: () => call<Play[]>('/api/plays'),
  keep: (id: string) => call<Song>(`/api/songs/${id}/keep`, {}),
  lyrics: (id: string) => call<Lyrics>(`/api/songs/${id}/lyrics`),
  lyricsOffset: (id: string, offset: number) => call<{ offset: number }>(`/api/songs/${id}/lyrics-offset`, { offset }),
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

// people
export type Relation = 'self' | 'friends' | 'sent' | 'received' | 'none'
export type NowPlaying = { song: Song; playing: boolean; at: number }
export type Profile = {
  name: string; joined: number; bio: string; relation: Relation
  counts: { songs: number; friends: number | null } | null   // for friends (songs too when the library is on the page)
  show: Record<string, string> | null   // only on your own page: who sees what
  now?: NowPlaying | null
  recent?: { song_id: string; played_at: number; radio: number; title: string; artist: string; album: string | null; thumbnail: string | null }[]
  top?: { artist: string; n: number; thumbnail: string | null }[]
  library?: Song[]
  radio?: Song[]
}
export type Friends = {
  friends: { name: string; since: number; now: NowPlaying | null; last_played: number | null }[]
  incoming: { name: string; at: number }[]
  outgoing: { name: string; at: number }[]
}
export type Person = { name: string; relation: Relation }

// 听友群
export type GroupSummary = { id: number; name: string; members: string[]; songs: number; listening: number }
export type GroupSession = { index: number; song_id: string; playing: boolean; pos: number; at: number; by: string; rev: number }
export type GroupState = { session: GroupSession | null; song: Song | null; listeners: string[]; listening: boolean; now: number }
export type Group = GroupState & {
  id: number; name: string; owner: string | null; members: { name: string; joined: number }[]; can_add: string[]
  playlist: (Song & { row_id: number; added_by_name: string; added_to_group: number })[]
}

// /admin
export type AdminData = {
  people: { id: number; name: string; is_admin: boolean; created: number; invited_by: string | null; songs: number
    plays: number; last_played: number | null; smart_plays: number; plays_week: number
    devices: { name: string; created: number; last_seen: number | null }[]; top_artists: { artist: string; n: number }[] }[]
  recent: { played_at: number; title: string; artist: string; radio: number; user: string }[]
  stats: { store_songs: number; ready: number; smart_songs: number; invites_open: number }
  invites: { code: string; created: number; expires: number | null; created_by: string; used_by: string | null
    reusable: boolean; used_by_all: string[] }[]
}

export function fmtTime(s: number | null | undefined) {
  if (!s || !isFinite(s)) return '0:00'
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

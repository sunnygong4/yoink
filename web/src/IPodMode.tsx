import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api, type Album, type Artist, type CatalogResults, type CatalogSong, type Lyrics, type Song, type Source, type Upload, type User } from './api'
import { albumPage } from './Pages'
import { uploadSong } from './Rows'
import { getQuality, type Quality, setQuality } from './quality'
import { getLang, setLang, t } from './i18n'
import type { IPod } from './ipod'
import type { Transport } from './Modes'
import type { Queue } from './queue'
import { flat, leadArtist, mainArtist } from './text'

// The phone app as an iPod classic: menus on the screen, the click wheel below (go round it to scroll, tap
// MENU / ⏮ / ⏭ / ⏯, the centre button selects). Everything is here: the library, search, picks, what's saved on
// the phone, settings. It plays through the same player as the full site.

export type PodProps = {
  user: User
  library: Song[]
  saved: Set<string>
  online: boolean
  phone: IPod                                  // songs saved on this phone
  preview: (s: CatalogSong) => Promise<void>   // a catalog song that isn't in the library: fetch it and play it
  listen: (r: Source) => Promise<void>         // the same for a YouTube find
  onSong: (s: Song) => void
  onLogout: () => void
  exit: () => void                             // to the full site
  audioTest: () => void                        // the audio test page
}

type Item = { label: string; right?: string; more?: boolean; dim?: boolean; head?: boolean; go?: () => void }   // head: a section's title
type Screen =
  | { kind: 'list'; id: string; title: string; arg?: string; sel: number; top: number }
  | { kind: 'now'; mode: 'volume' | 'scrub' | 'lyrics' }
  | { kind: 'search'; sel: number; top: number }
  | { kind: 'message'; title: string; text: string }

const COLOUR = 'yoinker.pod.colour'
const RECENT = 'yoinker.pod.searches'
const readRecent = (): string[] => { try { return JSON.parse(localStorage.getItem(RECENT) || '[]') } catch { return [] } }

/** Library songs that have every word of the search in their name, artist or album. */
function libraryMatch(songs: Song[], term: string) {
  const words = term.split(/\s+/).map(flat).filter(Boolean)
  const hay = (s: Song) => flat(`${s.title} ${s.artist} ${s.artist_main ?? ''} ${s.album ?? ''}`)
  const has = (text: string) => words.every(w => text.includes(w))
  const songs_ = songs.filter(s => has(hay(s)))
  const artists = [...new Set(songs.map(s => mainArtist(s)).filter(a => a && has(flat(a))))]
  const albums = new Map<string, Song>()
  for (const s of songs) if (s.album && has(flat(`${s.album} ${mainArtist(s)}`)) && !albums.has(`${flat(s.album)}|${flat(mainArtist(s))}`)) albums.set(`${flat(s.album)}|${flat(mainArtist(s))}`, s)
  // the closest first: the name starting with the search, then containing it
  const first = flat(term)
  const rank = (name: string) => (flat(name) === first ? 0 : flat(name).startsWith(first) ? 1 : 2)
  return {
    songs: songs_.sort((a, b) => rank(a.title) - rank(b.title)),
    artists: artists.sort((a, b) => rank(a) - rank(b)),
    albums: [...albums.values()].sort((a, b) => rank(a.album!) - rank(b.album!)),
  }
}
const iOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const BASE_W = 268, BASE_H = 440, ROWS = 8, SCREEN = 168, WHEEL = 186

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const mb = (n: number) => (n >= 1e9 ? `${(n / 1073741824).toFixed(1)} GB` : `${(n / 1048576).toFixed(0)} MB`)

// a little buzz with each click, like the iPod's. Android: the vibration API. iPhone (iOS 18+): Safari has no
// vibration API, but toggling a switch control gives a haptic tap, so a hidden one is toggled.
// (only from a tap: iOS doesn't buzz for a finger sliding round the wheel)
function buzz() {
  if (navigator.vibrate) { navigator.vibrate(6); return }
  if (!iOS) return
  const label = document.createElement('label')
  label.ariaHidden = 'true'
  label.style.display = 'none'
  const box = document.createElement('input')
  box.type = 'checkbox'
  box.setAttribute('switch', '')
  label.appendChild(box)
  document.head.appendChild(label)
  label.click()
  label.remove()
}

let audioCtx: AudioContext | null = null
/** The click sound needs its audio started inside a tap (iPhone): the first tap does that. */
function primeClick() {
  try {
    audioCtx ??= new AudioContext()
    if (audioCtx.state !== 'running') audioCtx.resume().catch(() => {})
  } catch { /* no audio */ }
}
function tick() {   // the click wheel's click
  buzz()
  try {
    if (!audioCtx || audioCtx.state !== 'running') return
    const o = audioCtx.createOscillator(), g = audioCtx.createGain()
    o.frequency.value = 2400
    g.gain.setValueAtTime(0.05, audioCtx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.012)
    o.connect(g).connect(audioCtx.destination)
    o.start(); o.stop(audioCtx.currentTime + 0.015)
  } catch { /* no audio */ }
}

export default function IPodMode({ q, tr, song, lyrics, volume, setVolume, rerender, ...p }: PodProps & {
  q: Queue; tr: Transport; song: Song | null; lyrics: Lyrics | null
  volume: number; setVolume: (v: number) => void; rerender: () => void
}) {
  const [stack, setStack] = useState<Screen[]>(() => [{ kind: 'list', id: 'root', title: 'iPod', sel: 0, top: 0 }])
  const [quality, setQ] = useState<Quality>(getQuality)
  const [black, setBlack] = useState(() => { try { return localStorage.getItem(COLOUR) === 'black' } catch { return false } })
  const [fit, setFit] = useState({ s: 1, w: 256, h: BASE_H - 16, full: false })
  const [query, setQuery] = useState('')
  const [suggest, setSuggest] = useState<string[]>([])
  const [results, setResults] = useState<CatalogResults | null>(null)
  const [finds, setFinds] = useState<Upload[]>([])   // YouTube finds, when the catalog hardly knows the song
  const [searching, setSearching] = useState(false)
  const [recent, setRecent] = useState<string[]>(readRecent)
  const [remote, setRemote] = useState<Record<string, Artist | Album | 'error'>>({})   // catalog artist / album pages
  const asked = useRef(new Set<string>())
  // which catalog page a screen shows (and how to load it)
  const remoteFor = (s: Screen): [string, () => Promise<Artist | Album>] | null => {
    if (s.kind !== 'list' || !s.arg) return null
    if (s.id === 'catArtist') return [`artist:${s.arg}`, () => api.artist(s.arg!)]
    if (s.id === 'catAlbum') {
      const ref = JSON.parse(s.arg) as { artist: string; title: string; id?: number | null }
      const page = albumPage(ref.artist, ref.title, ref.id) as { key: string; id?: number }
      return [`album:${page.key}|${page.id ?? ''}`, () => api.album(page.key, page.id)]
    }
    return null
  }
  const [picks, setPicks] = useState<CatalogSong[] | null>(null)
  const [added, setAdded] = useState<Record<string, string>>({})   // catalog key -> library id
  const [busy, setBusy] = useState('')                             // what's being fetched (shown on screen)
  const [overlay, setOverlay] = useState(0)                        // volume shown until
  const input = useRef<HTMLInputElement>(null)
  const top = stack[stack.length - 1]
  // ---------- the first-run lesson (each person once; Settings > tutorial plays it again) ----------
  const [tour, setTour] = useState<number | null>(() => (p.user.tutorials?.pod === false ? 0 : null))
  const [, tourTick] = useState(0)
  const scrolled = useRef(0)
  const wentIn = useRef(false)
  useEffect(() => {
    if (tour === null) return
    scrolled.current = 0
    const timer = setInterval(() => tourTick(n => n + 1), 300)   // the tasks tick as they're done
    return () => clearInterval(timer)
  }, [tour])
  useEffect(() => { if (stack.length > 1) wentIn.current = true }, [stack.length])
  const endTour = () => { setTour(null); api.tutorialDone('pod').catch(() => {}) }
  const podSteps: { title: string; body: string; task?: string; done?: () => boolean }[] = [
    { title: t('pt1Title'), body: t('pt1Body') },
    { title: t('pt2Title'), body: t('pt2Body'), task: t('pt2Task'), done: () => scrolled.current >= 3 },
    { title: t('pt3Title'), body: t('pt3Body'), task: t('pt3Task'), done: () => stack.length > 1 },
    { title: t('pt4Title'), body: t('pt4Body'), task: t('pt4Task'), done: () => wentIn.current && stack.length === 1 },
    { title: t('pt5Title'), body: t('pt5Body') },
    { title: t('pt6Title'), body: t('pt6Body') },
    { title: t('pt7Title'), body: t('pt7Body') },
    { title: t('pt8Title'), body: t('pt8Body') },
    { title: t('pt9Title'), body: t('pt9Body') },
  ]
  const screenH = SCREEN
  const rows = ROWS

  // a phone becomes the iPod (its body fills the screen, the wheel centred below the 4:3 screen);
  // anything wider shows an iPod standing in the middle
  useLayoutEffect(() => {
    const onResize = () => {
      if (innerWidth <= 600 && innerHeight > innerWidth) {
        const s = innerWidth / 256
        setFit({ s, w: 256, h: innerHeight / s, full: true })
      } else {
        setFit({ s: Math.min(innerWidth / BASE_W, innerHeight / BASE_H) * 0.92, w: 256, h: BASE_H - 16, full: false })
      }
    }
    onResize()
    addEventListener('resize', onResize)
    return () => removeEventListener('resize', onResize)
  }, [])
  useEffect(() => {
    const prime = () => primeClick()
    addEventListener('touchend', prime, true)
    addEventListener('click', prime, true)
    return () => { removeEventListener('touchend', prime, true); removeEventListener('click', prime, true) }
  }, [])
  useEffect(() => {
    document.documentElement.classList.add('pod-page')
    return () => document.documentElement.classList.remove('pod-page')
  }, [])
  useEffect(() => { try { localStorage.setItem(COLOUR, black ? 'black' : 'silver') } catch { /* private mode */ } }, [black])

  const push = (s: Screen) => setStack(st => [...st, s])
  const list = (id: string, title: string, arg?: string) => push({ kind: 'list', id, title, arg, sel: 0, top: 0 })
  const message = (title: string, text: string) => push({ kind: 'message', title, text })
  const openNow = () => setStack(st => (st[st.length - 1].kind === 'now' ? st : [...st, { kind: 'now', mode: iOS ? 'scrub' : 'volume' }]))
  const pool = p.online ? p.library.filter(s => s.status === 'ready') : p.library.filter(s => p.saved.has(s.id))
  const collator = new Intl.Collator(getLang() === 'zh' ? 'zh' : 'en', { numeric: true, sensitivity: 'base' })
  const by = (f: (s: Song) => string) => (a: Song, b: Song) => collator.compare(f(a) || '', f(b) || '')
  const playList = (songs: Song[], i: number) => { q.play(songs.map(s => s.id), i); openNow() }

  // a catalog song: play it (from the library if it's there), or add it
  const libFor = (c: CatalogSong) => p.library.find(s => s.id === (added[c.key] || c.song_id))
  async function playCatalog(c: CatalogSong) {
    const mine = libFor(c)
    if (mine?.status === 'ready') { q.play([mine.id]); openNow(); return }
    setBusy(c.title)
    try { await p.preview(c); openNow() } catch (e) { message(t('podError'), (e as Error).message) }
    setBusy('')
  }
  async function addCatalog(c: CatalogSong) {
    setBusy(c.title)
    try {
      const s = await api.quick(c)
      setAdded(a => ({ ...a, [c.key]: s.id }))
      p.onSong(s)
      setStack(st => st.slice(0, -1))
    } catch (e) { message(t('podError'), (e as Error).message) }
    setBusy('')
  }
  const catalogItem = (c: CatalogSong): Item => ({
    label: c.title, right: leadArtist(c.artist), more: true,
    go: () => list('catalogSong', c.title, JSON.stringify(c)),
  })
  const save = (songs: Song[]) => p.phone.sync(songs, [])
  const syncing = p.phone.progress && !p.phone.progress.finished ? p.phone.progress : null

  function items(s: Extract<Screen, { kind: 'list' }>): Item[] {
    switch (s.id) {
      case 'root': return [
        { label: t('podMusic'), more: true, go: () => list('music', t('podMusic')) },
        { label: t('search'), more: true, dim: !p.online, go: () => p.online && push({ kind: 'search', sel: 0, top: 0 }) },
        ...(song ? [{ label: t('podNowPlaying'), more: true, go: openNow }] : []),
        ...(song?.radio ? [{ label: `♥ ${t('keep')}`, right: song.title, go: () => api.keep(song.id).then(p.onSong) }] : []),
        { label: t('thisDevice'), more: true, right: p.saved.size ? String(p.saved.size) : '', go: () => list('saved', t('thisDevice')) },
        { label: t('podSettings'), more: true, go: () => list('settings', t('podSettings')) },
      ]
      case 'music': return [
        { label: t('podRecent'), more: true, go: () => list('recent', t('podRecent')) },
        { label: t('podArtists'), more: true, go: () => list('artists', t('podArtists')) },
        { label: t('podAlbums'), more: true, go: () => list('albums', t('podAlbums')) },
        { label: t('podSongs'), more: true, go: () => list('songs', t('podSongs')) },
        { label: t('forYou'), more: true, dim: !p.online, go: () => { if (!p.online) return; list('picks', t('forYou')); if (!picks) loadPicks(false) } },
        { label: t('podShuffleSongs'), go: () => { if (!pool.length) return message(t('podMusic'), t('podNoMusic')); if (!q.shuffle) q.toggleShuffle(); playList(pool, Math.floor(Math.random() * pool.length)) } },
        ...(!p.online ? [{ label: t('podOfflineOnly'), dim: true }] : []),
      ]
      case 'recent': {   // 新加入: the library's newest songs first
        const songs = [...pool].sort((a, b) => (b.added_at || 0) - (a.added_at || 0)).slice(0, 100)
        if (!songs.length) return [{ label: t('podNoMusic'), dim: true }]
        return songs.map((x, i) => ({ label: x.title, right: mainArtist(x), go: () => playList(songs, i) }))
      }
      case 'artists': {
        const names = [...new Set(pool.map(x => mainArtist(x) || t('podUnknown')))].sort(collator.compare)
        return names.map(n => ({ label: n, more: true, go: () => list('artist', n, n) }))
      }
      case 'artist': {
        const mine = pool.filter(x => (mainArtist(x) || t('podUnknown')) === s.arg)
        const albums = [...new Set(mine.map(x => x.album || t('podUnknown')))].sort(collator.compare)
        return [
          { label: t('podAllSongs'), more: true, go: () => list('songsOf', s.arg!, `artist:${s.arg}`) },
          ...albums.map(a => ({ label: a, more: true, go: () => list('songsOf', a, `album:${s.arg}|${a}`) })),
        ]
      }
      case 'albums': {
        const seen = new Map<string, Song>()
        for (const x of pool) if (x.album && !seen.has(`${flat(x.album)}|${flat(mainArtist(x))}`)) seen.set(`${flat(x.album)}|${flat(mainArtist(x))}`, x)
        return [...seen.values()].sort(by(x => x.album!)).map(x => ({
          label: x.album!, right: mainArtist(x), more: true,
          go: () => list('songsOf', x.album!, `album:${mainArtist(x)}|${x.album}`),
        }))
      }
      case 'songs': case 'songsOf': {
        let songs = [...pool]
        if (s.arg?.startsWith('artist:')) songs = songs.filter(x => mainArtist(x) === s.arg!.slice(7))
        if (s.arg?.startsWith('album:')) {
          const [artist, album] = s.arg.slice(6).split('|')
          songs = songs.filter(x => mainArtist(x) === artist && (x.album || t('podUnknown')) === album)
        }
        songs.sort(by(x => x.title))
        if (!songs.length) return [{ label: t('podNoMusic'), dim: true }]
        return songs.map((x, i) => ({ label: x.title, right: s.id === 'songs' ? mainArtist(x) : '', go: () => playList(songs, i) }))
      }
      case 'searchLib': {   // every library song the search found
        const songs = libraryMatch(pool, s.arg!).songs
        return songs.map((x, i) => ({ label: x.title, right: mainArtist(x), go: () => playList(songs, i) }))
      }
      case 'catArtist': {   // an artist from the catalog: their best-known songs and albums
        const a = remote[remoteFor(s)![0]] as Artist | 'error' | undefined
        if (!a) return [{ label: t('forYouLoading'), dim: true }]
        if (a === 'error') return [{ label: t('podError'), dim: true }]
        const mine = pool.some(x => flat(mainArtist(x)) === flat(a.name))
        const top = a.top.slice(0, 15)
        return [
          ...(mine ? [{ label: t('podInYourLibrary'), more: true, go: () => list('artist', a.name, pool.find(x => flat(mainArtist(x)) === flat(a.name)) ? mainArtist(pool.find(x => flat(mainArtist(x)) === flat(a.name))!) : a.name) }] : []),
          ...(top.length ? [{ label: t('podTopSongs'), head: true }, ...top.map(catalogItem)] : []),
          ...(a.albums.length ? [{ label: t('podAlbums'), head: true }, ...a.albums.slice(0, 30).map(al => ({
            label: al.title, right: al.year, more: true,
            go: () => list('catAlbum', al.title, JSON.stringify({ artist: al.artist, title: al.title, id: al.id })),
          }))] : []),
        ]
      }
      case 'catAlbum': {   // an album from the catalog: its tracks
        const al = remote[remoteFor(s)![0]] as Album | 'error' | undefined
        if (!al) return [{ label: t('forYouLoading'), dim: true }]
        if (al === 'error') return [{ label: t('podError'), dim: true }]
        const ready = al.tracks.map(libFor).filter((x): x is Song => !!x && x.status === 'ready')
        return [
          ...(ready.length ? [{ label: `▶ ${t('podPlayAlbum')}`, right: String(ready.length), go: () => playList(ready, 0) }] : []),
          ...(ready.length < al.tracks.length ? [{ label: `+ ${t('addAlbum')}`, go: async () => {
            setBusy(al.title)
            try { await api.addAlbum(al.slug, al.id ?? undefined); message(al.title, t('albumAdding', { n: al.tracks.length - ready.length })) }
            catch (e) { message(t('podError'), (e as Error).message) }
            setBusy('')
          } }] : []),
          { label: `${al.artist}${al.year ? ` · ${al.year}` : ''}`, dim: true },
          ...al.tracks.map(c => ({ ...catalogItem(c), right: libFor(c) ? '✓' : fmt(c.duration || 0) })),
        ]
      }
      case 'picks': return [
        { label: `↻ ${t('forYouMore')}`, go: () => loadPicks(true) },
        ...(!picks ? [{ label: t('forYouLoading'), dim: true }] : !picks.length ? [{ label: t('forYouEmpty'), dim: true }] : picks.map(catalogItem)),
      ]
      case 'catalogSong': {
        const c = JSON.parse(s.arg!) as CatalogSong
        const mine = libFor(c)
        return [
          { label: `▶ ${t('play')}`, go: () => playCatalog(c) },
          mine ? { label: `✓ ${t('inLibraryShort')}`, dim: true } : { label: `+ ${t('addToLibrary')}`, go: () => addCatalog(c) },
          ...(mine?.status === 'ready' && !p.saved.has(mine.id) ? [{ label: t('podSaveThis'), go: () => save([mine]) }] : []),
          { label: c.artist, more: true, dim: true },
          ...(c.album ? [{ label: c.album, dim: true }] : []),
        ]
      }
      case 'saved': {
        const st = p.phone.status
        const stored = [...(st?.songs ?? [])].sort((a, b) => collator.compare(a.title, b.title))
        const playable = p.library.filter(x => p.saved.has(x.id)).sort(by(x => x.title))
        const missing = p.library.filter(x => x.status === 'ready' && !p.saved.has(x.id))
        return [
          ...(syncing ? [{ label: t('podSaving', { d: syncing.done, n: syncing.total }), dim: true }] : []),
          ...(playable.length ? [{ label: t('podPlayAll'), go: () => playList(playable, 0) }] : []),
          ...(!syncing && p.online && song?.status === 'ready' && !p.saved.has(song.id) && !song.radio
            ? [{ label: t('podSaveNow'), right: song.title, go: () => save([song]) }] : []),
          ...(!syncing && p.online && missing.length ? [{ label: t('podSaveAll', { n: missing.length }), go: () => save(missing) }] : []),
          ...(!syncing && stored.length ? [{ label: t('podRemoveAll'), more: true, go: () => list('clearSaved', t('podRemoveAll')) }] : []),
          ...(st ? [{ label: t('used', { s: mb(st.usage) }), right: st.quota ? `${t('free')} ${mb(Math.max(0, st.quota - st.usage))}` : '', dim: true }] : []),
          ...(stored.length ? stored.map(x => ({ label: x.title, right: mainArtist(x), more: true, go: () => list('savedSong', x.title, x.id) }))
            : [{ label: t('podNothingSaved'), dim: true }]),
        ]
      }
      case 'savedSong': {   // one song saved here: play it, or take it off the phone
        const x = p.phone.status?.songs.find(y => y.id === s.arg)
        const mine = p.library.find(y => y.id === s.arg)
        if (!x) return [{ label: t('podRemoved'), dim: true }]
        return [
          ...(mine ? [{ label: `▶ ${t('play')}`, go: () => { q.play([mine.id]); openNow() } }] : [{ label: t('notInLibrary'), dim: true }]),
          { label: t('podRemoveThis'), go: () => { p.phone.sync([], [x.id]); setStack(st => st.slice(0, -1)) } },
          { label: x.artist, dim: true },
          ...(x.album ? [{ label: x.album, dim: true }] : []),
          { label: mb(x.size || 0), dim: true },
        ]
      }
      case 'upload': {   // a YouTube find: listen, or add it
        const r = JSON.parse(s.arg!) as Upload
        const mine = p.library.find(x => x.id === (added[r.id] || r.song_id))
        return [
          { label: `▶ ${t('play')}`, go: async () => {
            if (mine?.status === 'ready') { q.play([mine.id]); openNow(); return }
            setBusy(r.title)
            try { await p.listen(r); openNow() } catch (e) { message(t('podError'), (e as Error).message) }
            setBusy('')
          } },
          mine && !mine.radio ? { label: `✓ ${t('inLibraryShort')}`, dim: true } : { label: `+ ${t('addToLibrary')}`, go: async () => {
            setBusy(r.title)
            try {
              const x = await api.add(r, uploadSong(r))
              setAdded(a => ({ ...a, [r.id]: x.id }))
              p.onSong(x)
              setStack(st => st.slice(0, -1))
            } catch (e) { message(t('podError'), (e as Error).message) }
            setBusy('')
          } },
          { label: r.channel, dim: true },
        ]
      }
      case 'nowMenu': {   // long press on the centre button while a song plays
        if (!song) return [{ label: t('podNothing'), dim: true }]
        const upNext = q.ids[q.ids.indexOf(song.id) + 1]
        const nextSong = upNext ? p.library.find(x => x.id === upNext) : undefined
        return [
          { label: `✨ ${t('podSmartNext')}`, dim: !p.online, go: () => p.online && smartNext() },
          { label: t('autoplay'), right: q.smart ? t('podOn') : t('podOff'), go: q.toggleSmart },
        { label: t('saveQuality'), right: t(`quality_${quality}`), go: () => {   // what songs saved on this phone take up
          const order: Quality[] = ['high', 'normal', 'low']
          const next = order[(order.indexOf(quality) + 1) % order.length]
          setQuality(next); setQ(next)
        } },
          ...(song.radio ? [{ label: `♥ ${t('keep')}`, go: () => api.keep(song.id).then(p.onSong) }] : []),
          ...(nextSong ? [{ label: t('podUpNext'), right: nextSong.title, dim: true }] : []),
          { label: t('podCancel'), go: () => setStack(st => st.slice(0, -1)) },
        ]
      }
      case 'clearSaved': {
        const n = p.phone.status?.songs.length ?? 0
        return [
          { label: t('podCancel'), go: () => setStack(st => st.slice(0, -1)) },
          { label: t('podRemoveAllYes', { n }), go: () => { p.phone.sync([], (p.phone.status?.songs ?? []).map(y => y.id)); setStack(st => st.slice(0, -1)) } },
        ]
      }
      case 'settings': return [
        { label: t('shuffleMode'), right: q.shuffle ? t('podOn') : t('podOff'), go: q.toggleShuffle },
        { label: t('podRepeat'), right: { off: t('podOff'), all: t('podAll'), one: t('podOne') }[q.repeat], go: q.cycleRepeat },
        { label: t('autoplay'), right: q.smart ? t('podOn') : t('podOff'), go: q.toggleSmart },
        { label: t('podLanguage'), right: getLang() === 'zh' ? '中文' : 'English', go: () => { setLang(getLang() === 'zh' ? 'en' : 'zh'); rerender() } },
        { label: t('podColour'), right: black ? t('podBlack') : t('podSilver'), go: () => setBlack(b => !b) },
        { label: t('podAbout'), more: true, go: () => list('about', t('podAbout')) },
      ]
      case 'about': return [
        { label: p.user.name, right: t('podAccount'), more: true, go: () => list('account', p.user.name) },
        { label: t('podSongs'), right: String(p.library.length), dim: true },
        { label: t('thisDevice'), right: String(p.saved.size), dim: true },
        { label: t('tourTitle'), go: () => { setStack(st => st.slice(0, 1)); setTour(0) } },
        { label: 'music.sunnygong.com', more: true, go: p.exit },   // the full site
      ]
      case 'account': return [
        { label: p.user.name, right: p.user.is_admin ? t('podAdmin') : '', dim: true },
        { label: t('logout'), go: p.onLogout },
      ]
    }
    return []
  }

  const loadPicks = useCallback((fresh: boolean) => {
    setPicks(null)
    api.forYou(fresh).then(setPicks).catch(() => setPicks([]))
  }, [])

  // search, like Apple Music's: as you type, your library at once and the catalog a moment later, by section
  const searched = useRef('')
  useEffect(() => {
    const term = query.trim()
    if (top.kind !== 'search' || !term) { setSearching(false); return }
    if (results && searched.current === term) return
    let live = true
    setSearching(true)
    const timer = setTimeout(async () => {
      try {
        const found = await api.catalog(term)
        if (!live) return
        searched.current = term
        setResults(found)
        setFinds(found.matched < 3 ? await api.uploads(term).catch(() => []) : [])
      } catch { /* offline, or the catalog's slow: the library's still there */ }
      if (live) setSearching(false)
    }, 350)
    return () => { live = false; clearTimeout(timer) }
  }, [query, top.kind])
  void suggest; void setSuggest
  function remember(term: string) {
    const r = [term, ...recent.filter(x => x !== term)].slice(0, 8)
    setRecent(r)
    try { localStorage.setItem(RECENT, JSON.stringify(r)) } catch { /* private mode */ }
  }
  function runSearch(term: string) {
    if (!term.trim()) return
    input.current?.blur()
    setQuery(term)
    remember(term.trim())
  }
  function searchItems(): Item[] {
    const term = query.trim()
    if (!term) {
      return recent.length ? [
        { label: t('podRecentSearches'), head: true },
        ...recent.map(r => ({ label: r, more: true, go: () => runSearch(r) })),
        { label: t('podClearSearches'), dim: true, go: () => { setRecent([]); try { localStorage.removeItem(RECENT) } catch { /* private mode */ } } },
      ] : [{ label: t('podSearchHint'), dim: true }]
    }
    // (what's tapped is remembered as a recent search)
    const keep = (f?: () => void) => () => { remember(term); f?.() }
    const mine = libraryMatch(pool, term)
    const cat = results && searched.current === term ? results : null
    const out: Item[] = []
    if (mine.artists.length || mine.albums.length || mine.songs.length) {
      out.push({ label: t('podInYourLibrary'), head: true })
      out.push(...mine.artists.slice(0, 3).map(a => ({ label: a, right: t('artistKind'), more: true, go: keep(() => list('artist', a, a)) })))
      out.push(...mine.albums.slice(0, 3).map(x => ({ label: x.album!, right: mainArtist(x), more: true,
        go: keep(() => list('songsOf', x.album!, `album:${mainArtist(x)}|${x.album}`)) })))
      const songs = mine.songs.slice(0, 6)
      out.push(...songs.map((x, i) => ({ label: x.title, right: mainArtist(x), go: keep(() => playList(mine.songs, i)) })))
      if (mine.songs.length > songs.length) out.push({ label: t('podAllLibrarySongs', { n: mine.songs.length }), more: true, go: keep(() => list('searchLib', term, term)) })
    }
    if (cat) {
      if (cat.artists.length) {
        out.push({ label: t('podArtists'), head: true })
        out.push(...cat.artists.slice(0, 4).map(a => ({ label: a.name, right: a.genre || '', more: true, go: keep(() => list('catArtist', a.name, a.name)) })))
      }
      if (cat.albums.length) {
        out.push({ label: t('podAlbums'), head: true })
        out.push(...cat.albums.slice(0, 6).map(a => ({ label: a.title, right: leadArtist(a.artist), more: true,
          go: keep(() => list('catAlbum', a.title, JSON.stringify({ artist: a.artist, title: a.title, id: a.id }))) })))
      }
      if (cat.songs.length) {
        out.push({ label: t('podSongs'), head: true })
        out.push(...cat.songs.map(c => { const it = catalogItem(c); return { ...it, go: keep(it.go) } }))
      }
      if (finds.length) {
        out.push({ label: 'YouTube', head: true })
        out.push(...finds.map(r => ({ label: r.name?.title || r.title, right: r.name?.artist || r.channel, more: true,
          go: keep(() => list('upload', r.title, JSON.stringify(r))) })))
      }
    }
    if (searching) out.push({ label: t('searching'), dim: true })
    else if (!out.length) out.push({ label: t('nothingOnYouTube'), dim: true })
    return out
  }

  const current = top.kind === 'list' ? items(top) : top.kind === 'search' ? searchItems() : []
  const visible = top.kind === 'search' ? rows - 2 : rows

  // ---------- the wheel and buttons ----------

  // where each row starts, in px (section titles are shorter)
  const off = [0]
  for (const it of current) off.push(off[off.length - 1] + (it.head ? 15 : 18.5))
  // the list's glide: how far (px) it's drawn past its first row, eased back to 0
  const [shift, setShift] = useState(0)
  const anim = useRef(0)
  const glide = (from: number, ms = 150) => {
    cancelAnimationFrame(anim.current)
    const t0 = performance.now()
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms)
      setShift(from * (1 - k) ** 3)
      if (k < 1) anim.current = requestAnimationFrame(step)
    }
    setShift(from)
    anim.current = requestAnimationFrame(step)
  }

  const setTop = (f: (s: Screen) => Screen) => setStack(st => [...st.slice(0, -1), f(st[st.length - 1])])
  function scroll(step: number) {
    scrolled.current++
    if (top.kind === 'list' || top.kind === 'search') {
      const n = current.length
      const lo = top.kind === 'search' ? -1 : 0   // (search's -1: the search bar)
      let sel = top.sel + step
      while (sel >= 0 && sel < n && current[sel].head) sel += Math.sign(step)   // (section titles aren't stops)
      if (sel >= n || sel < lo) sel = lo < 0 && sel < lo ? -1 : top.sel
      if (sel === top.sel) return
      if (top.kind === 'search') input.current?.blur()   // turning the wheel: the keyboard goes, the list scrolls
      tick()
      const topRow = Math.max(0, sel < top.top ? sel : sel >= top.top + visible ? sel - visible + 1 : top.top)
      if (topRow !== top.top) glide(Math.max(-40, Math.min(40, off[top.top] + shift - off[topRow])))
      setTop(s => (s.kind === 'list' || s.kind === 'search' ? { ...s, sel, top: topRow } : s))
    } else if (top.kind === 'now' && song) {
      tick()
      if (top.mode === 'volume') { setVolume(Math.max(0, Math.min(1, volume + step * 0.05))); setOverlay(Date.now() + 1500) }
      else tr.seek(Math.max(0, Math.min(tr.duration, tr.time + step * 5)))
    }
  }
  function select(i?: number) {
    tick()
    if (top.kind === 'list' || top.kind === 'search') {
      const at = i ?? top.sel
      if (at === -1) { input.current?.focus(); return }   // the search bar: type (in the click, so a phone's keyboard opens)
      if (current[at]?.head) return
      if (i !== undefined) setTop(s => (s.kind === 'list' || s.kind === 'search' ? { ...s, sel: at } : s))
      current[at]?.go?.()
    } else if (top.kind === 'now') {
      const modes = iOS ? ['scrub', 'lyrics'] as const : ['volume', 'scrub', 'lyrics'] as const
      setTop(s => (s.kind === 'now' ? { ...s, mode: modes[(modes.indexOf(s.mode as never) + 1) % modes.length] } : s))
    }
  }
  function menu() {
    tick()
    // in search, MENU first clears what's typed (like Cancel), then goes back
    if (top.kind === 'search' && query) { setQuery(''); setResults(null); setFinds([]); searched.current = ''; return }
    if (stack.length > 1) setStack(st => st.slice(0, -1))
  }
  const playPause = () => { tick(); tr.toggle() }

  // ✨ as the next song: a smart pick like this one, queued right after it
  async function smartNext() {
    if (!song) return
    setBusy(t('podSmartNext'))
    try {
      const s = await api.radio(song.id, [...q.played, ...q.ids])
      p.onSong(s)
      q.playNext(s.id)
      setStack(st => (st[st.length - 1].kind === 'list' ? st.slice(0, -1) : st))
    } catch (e) { message(t('podError'), (e as Error).message) }
    setBusy('')
  }

  // holding the centre button (Now Playing): the song's options, like the iPod's
  const hold = useRef<{ timer: number; fired: boolean } | null>(null)
  const centreDown = () => {
    if (hold.current) clearTimeout(hold.current.timer)
    const h = { timer: 0, fired: false }
    h.timer = window.setTimeout(() => {
      if (stack[stack.length - 1].kind !== 'now' || !song) return
      h.fired = true
      buzz()
      list('nowMenu', song.title)
    }, 550)
    hold.current = h
  }
  const centreUp = () => { if (hold.current) clearTimeout(hold.current.timer) }
  const centreClick = () => {
    const fired = hold.current?.fired
    hold.current = null
    if (!fired) select()
  }
  const next = () => { tick(); tr.next() }
  const prev = () => { tick(); tr.prev() }

  const drag = useRef<{ cx: number; cy: number; last: number; acc: number; moved: number; x: number; y: number } | null>(null)
  const wheel = useRef<HTMLDivElement>(null)
  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).classList.contains('center')) return
    const r = wheel.current!.getBoundingClientRect()
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2
    drag.current = { cx, cy, last: Math.atan2(e.clientY - cy, e.clientX - cx), acc: 0, moved: 0, x: e.clientX - cx, y: e.clientY - cy }
    wheel.current!.setPointerCapture(e.pointerId)
  }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const a = Math.atan2(e.clientY - d.cy, e.clientX - d.cx)
    let da = a - d.last
    if (da > Math.PI) da -= 2 * Math.PI
    if (da < -Math.PI) da += 2 * Math.PI
    d.last = a
    d.acc += da
    d.moved += Math.abs(da)
    const STEP = Math.PI / 9
    while (d.acc > STEP) { d.acc -= STEP; scroll(1) }
    while (d.acc < -STEP) { d.acc += STEP; scroll(-1) }
  }
  const tapped = useRef<{ x: number; y: number } | null>(null)
  const onUp = () => {
    const d = drag.current
    drag.current = null
    tapped.current = d && d.moved < 0.15 ? { x: d.x, y: d.y } : null   // a tap, not a turn: acted on in the click
  }
  // the click that follows: iPhones only let audio start (⏯) and buzz inside a click
  const onWheelClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).classList.contains('center')) return
    const tp = tapped.current
    tapped.current = null
    if (!tp) return
    if (Math.abs(tp.y) > Math.abs(tp.x)) (tp.y < 0 ? menu : playPause)()
    else (tp.x < 0 ? prev : next)()
  }
  // the scroll handlers read the latest screen through this
  const scrollRef = useRef(scroll)
  scrollRef.current = scroll
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' && !['ArrowDown', 'ArrowUp'].includes(e.key)) return
      if (e.key === 'ArrowDown') scrollRef.current(1)
      else if (e.key === 'ArrowUp') scrollRef.current(-1)
      else return
      e.preventDefault()
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => { if (top.kind === 'search' && !query) setTimeout(() => input.current?.focus(), 50) }, [top.kind])
  // a catalog artist / album screen: its page, loaded once
  useEffect(() => {
    const r = remoteFor(top)
    if (!r || asked.current.has(r[0])) return
    const [key, load] = r
    asked.current.add(key)
    load().then(v => setRemote(m => ({ ...m, [key]: v })))
      .catch(() => { asked.current.delete(key); setRemote(m => ({ ...m, [key]: 'error' })) })
  }, [top])
  // a new search's results start at their first row; nothing typed yet, at the search bar
  useEffect(() => {
    if (top.kind !== 'search') return
    const first = current.findIndex(it => !it.head && !it.dim)
    setStack(st => st.map((x, i) => (i === st.length - 1 && x.kind === 'search' ? { ...x, sel: query ? Math.max(0, first) : -1, top: 0 } : x)))
  }, [query, results, top.kind])

  // ---------- the screen by touch: drag to scroll, tap a row, swipe right for back; the progress bar seeks ----------
  const pan = useRef<{ x: number; y: number; pos0: number; pos: number; moved: '' | 'v' | 'h'; t: number; v: number } | null>(null)
  const panned = useRef(false)
  const slide = useRef({ depth: 1, dir: '' })
  const [swipe, setSwipe] = useState(0)   // the screen following a finger swiping right (back)
  const listy = top.kind === 'list' || top.kind === 'search'
  // the list scrolled to pos (px): its first row, and the rest drawn as the glide (stretching past either end)
  const placeAt = (pos: number) => {
    const maxFirst = Math.max(0, current.length - visible), maxPos = off[maxFirst]
    let first = 0, sh: number
    if (pos < 0) sh = pos * 0.35
    else if (pos > maxPos) { first = maxFirst; sh = (pos - maxPos) * 0.35 }
    else { while (first < maxFirst && off[first + 1] <= pos) first++; sh = pos - off[first] }
    setShift(sh)
    setTop(s => {
      if ((s.kind !== 'list' && s.kind !== 'search') || s.top === first) return s
      scrolled.current++
      // the highlight stays on screen as the list moves under it
      let sel = Math.max(first, Math.min(first + visible - 1, s.sel))
      if (current[sel]?.head) sel = Math.min(current.length - 1, sel + 1)
      return { ...s, top: first, sel }
    })
    return { at: off[first] + sh, out: pos < 0 || pos > maxPos }
  }
  // let go: the list settles on the nearest row
  const settle = (at: number) => {
    const maxFirst = Math.max(0, current.length - visible)
    let k = 0
    for (let i = 0; i <= maxFirst; i++) if (Math.abs(off[i] - at) < Math.abs(off[k] - at)) k = i
    setTop(s => (s.kind === 'list' || s.kind === 'search' ? { ...s, top: k, sel: Math.max(k, Math.min(k + visible - 1, s.sel)) } : s))
    glide(at - off[k], 220)
  }
  const onViewDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return
    cancelAnimationFrame(anim.current)
    const pos0 = listy ? off[top.top] + shift : 0
    pan.current = { x: e.clientX, y: e.clientY, pos0, pos: pos0, moved: '', t: performance.now(), v: 0 }
    panned.current = false
  }
  const onViewMove = (e: React.PointerEvent) => {
    const d = pan.current
    if (!d) return
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    if (!d.moved && Math.hypot(dx, dy) > 7) {
      d.moved = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v'
      panned.current = true
      input.current?.blur()
    }
    if (d.moved === 'h') { if (stack.length > 1) setSwipe(Math.max(0, dx / fit.s)); return }
    if (d.moved !== 'v' || !listy) return
    const pos = d.pos0 - dy / fit.s, now = performance.now()
    d.v = 0.8 * ((pos - d.pos) / Math.max(1, now - d.t)) + 0.2 * d.v   // px per ms, for the flick
    d.pos = pos
    d.t = now
    placeAt(pos)
  }
  const onViewUp = (e: React.PointerEvent) => {
    const d = pan.current
    pan.current = null
    if (!d) return
    if (d.moved === 'h') {
      setSwipe(0)
      if ((e.clientX - d.x) / fit.s > 60) menu()   // swiped far enough right: back
      return
    }
    if (d.moved !== 'v' || !listy) return
    // a flick keeps the list going, slowing down, then it settles
    let pos = d.pos, v = performance.now() - d.t > 80 ? 0 : d.v, last = performance.now()
    if (Math.abs(v) < 0.2) { settle(placeAt(pos).at); return }
    const fly = (now: number) => {
      const dt = now - last
      last = now
      pos += v * dt
      v *= 0.995 ** dt
      const p = placeAt(pos)
      if (p.out || Math.abs(v) < 0.03) settle(p.at)
      else anim.current = requestAnimationFrame(fly)
    }
    anim.current = requestAnimationFrame(fly)
  }
  const seekAt = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    if (tr.duration) tr.seek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * tr.duration)
  }

  // ---------- drawing ----------

  const title = top.kind === 'list' ? top.title : top.kind === 'search' ? t('search') : top.kind === 'now' ? t('podNowPlaying') : top.title
  const pos = song ? q.ids.indexOf(song.id) + 1 : 0
  const lyricLine = (() => {
    const lines = lyrics?.lines ?? []
    const lt = tr.time - (lyrics?.offset ?? 0)
    let i = -1
    for (let k = 0; k < lines.length && lines[k].t <= lt; k++) i = k
    return { now: lines[i]?.text ?? '', next: lines[i + 1]?.text ?? '' }
  })()

  const listView = (all: Item[], sel: number, first: number, n: number) => {
    // a couple of rows either side, for the glide to show
    const from = Math.max(0, first - 3)
    return <>
      <ul className="pod-list" style={{ marginRight: all.length > n ? 5 : undefined, transform: `translateY(${-(off[first] - off[from] + shift)}px)` }}>
        {all.slice(from, first + n + 3).map((it, i) => (
          <li key={from + i} className={it.head ? 'head' : (from + i === sel ? 'sel ' : '') + (it.more ? 'more ' : '') + (it.dim ? 'dim' : '')}
            onClick={() => { if (!panned.current) select(from + i) }}>
            <span className="l">{it.label}</span>{it.right && <span className="r">{it.right}</span>}
          </li>
        ))}
      </ul>
      {all.length > n && <div className="pod-scroll"><i style={{ top: `${(100 * Math.max(0, off[first] + shift)) / off[all.length]}%`, height: `${(100 * n) / all.length}%` }} /></div>}
    </>
  }

  // a screen going in slides in from the right; going back, from the left
  if (stack.length !== slide.current.depth) slide.current = { depth: stack.length, dir: stack.length > slide.current.depth ? 'push' : 'pop' }
  let view: React.ReactNode
  if (top.kind === 'list') view = listView(current, top.sel, top.top, rows)
  else if (top.kind === 'search') {
    view = <>
      <form className={'pod-search' + (top.sel === -1 ? ' sel' : '')} onSubmit={e => { e.preventDefault(); input.current?.blur(); runSearch(query) }}>
        <input ref={input} value={query} placeholder={t('searchPlaceholder')} enterKeyHint="search"
          onChange={e => setQuery(e.target.value)} />
        {query && <button type="button" className="pod-clear" aria-label={t('podClearSearches')} onClick={() => { setQuery(''); input.current?.focus() }}>✕</button>}
      </form>
      <div className="pod-under">{listView(current, top.sel, top.top, visible)}</div>
    </>
  } else if (top.kind === 'message') view = <div className="pod-message"><b>{top.title}</b>{top.text}</div>
  else if (!song) view = <div className="pod-message"><b>{t('podNowPlaying')}</b>{t('podNothing')}</div>
  else {
    const showVol = top.mode === 'volume' && Date.now() < overlay
    const pct = showVol ? 100 * volume : tr.duration ? (100 * tr.time) / tr.duration : 0
    const preparing = song.status !== 'ready'
    view = (
      <div className="pod-np">
        <div className="pos">{pos > 0 && `${pos} ${t('podOf')} ${q.ids.length}`}</div>
        <div className="modes">{q.shuffle ? '⤨ ' : ''}{q.repeat === 'one' ? '↻1' : q.repeat === 'all' ? '↻' : ''}{song.radio ? ' ✨' : ''}</div>
        <div className="row">
          {song.thumbnail ? <img className="art" src={song.thumbnail} alt="" /> : <div className="art none">♫</div>}
          <div className="meta"><b>{song.title}</b><span>{song.artist}</span><span>{song.album}</span></div>
        </div>
        {top.mode === 'lyrics'
          ? <div className="pod-lyric"><b>{lyricLine.now || (lyrics?.lines.length ? '♪' : t('noLyrics'))}</b><span>{lyricLine.next}</span></div>
          : <div className="progress">
            <div className={'track' + (showVol ? ' vol' : '')} onPointerDown={e => { e.stopPropagation(); if (!showVol) { e.currentTarget.setPointerCapture(e.pointerId); seekAt(e) } }}
              onPointerMove={e => { if (e.buttons && !showVol) seekAt(e) }}><i style={{ width: `${pct}%` }} /></div>
            <div className="times">{preparing ? <span>{t('preparing')}</span> : showVol ? <span>{t('volume')}</span>
              : <><span>{fmt(tr.time)}</span>{top.mode === 'scrub' && <span>{t('podScrub')}</span>}<span>-{fmt(Math.max(0, tr.duration - tr.time))}</span></>}</div>
          </div>}
      </div>
    )
  }

  return (
    <div className={'pod-stage' + (fit.full ? ' pod-full' : '')}>
      <div className={'pod' + (black ? ' black' : '') + (fit.full ? ' pod-full' : '')} style={{ width: fit.w, height: fit.h, transform: fit.full ? `translateX(-50%) scale(${fit.s})` : `translate(-50%, -50%) scale(${fit.s})` }}>
        <div className="pod-screen" style={{ height: screenH }}>
          <div className="pod-bar">
            <span className="state">{song ? (tr.playing ? '▶' : '❚❚') : ''}</span>
            <span className="title">{busy ? `${t('preparing')}` : title}</span>
            <span className={'net' + (p.online ? '' : ' off')}>{p.online ? '' : '✈︎'}</span>
            <span className="battery"><i /></span>
          </div>
          <div className="pod-view" onPointerDown={onViewDown} onPointerMove={onViewMove} onPointerUp={onViewUp}
            onPointerCancel={() => { pan.current = null; setSwipe(0) }}>
            <div key={stack.length} className={'pod-pane ' + slide.current.dir + (pan.current?.moved === 'h' ? ' held' : '')}
              style={swipe ? { transform: `translateX(${swipe}px)` } : undefined}>{view}</div>
          </div>
        </div>
        {tour !== null && (() => {
          // the lesson's card: in the gap between the screen and the wheel (over the screen's foot when there's none)
          const s = podSteps[tour]
          const ok = s.done?.() ?? false
          const gapTop = 16 + SCREEN + 4
          const gap = fit.full ? Math.max(20, (fit.h - 16 - SCREEN - WHEEL) / 2) - 8 : 0
          return (
            <div className="pod-tour" style={fit.full && gap > 60 ? { top: gapTop, height: gap } : { top: 16 + SCREEN - 96, height: 92 }}>
              <div className="pt-head"><b>{s.title}</b><span>{tour + 1} / {podSteps.length}</span></div>
              <p>{s.body}</p>
              {s.task && <p className={'pt-task' + (ok ? ' done' : '')}>{ok ? '✓' : '→'} {s.task}</p>}
              <div className="pt-buttons">
                <button className="pt-skip" onClick={() => endTour()}>{t('tourSkip')}</button>
                {tour > 0 && <button onClick={() => setTour(tour - 1)}>{t('tourBack')}</button>}
                <button className="pt-next" onClick={() => (tour === podSteps.length - 1 ? endTour() : setTour(tour + 1))}>
                  {tour === podSteps.length - 1 ? t('tourFinish') : t('tourNext')}</button>
              </div>
            </div>
          )
        })()}
        <div className="pod-wheel" ref={wheel}
          style={{ top: fit.full ? 16 + screenH + Math.max(20, (fit.h - 16 - screenH - WHEEL) / 2) : undefined }}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onClick={onWheelClick} onPointerCancel={() => { drag.current = null }}>
          <span className="pod-label w-menu">MENU</span>
          <span className="pod-label w-prev">⏮︎</span>
          <span className="pod-label w-next">⏭︎</span>
          <span className="pod-label w-play">⏯︎</span>
          <button className="center" onPointerDown={centreDown} onPointerUp={centreUp} onPointerLeave={centreUp}
            onContextMenu={e => e.preventDefault()} onClick={centreClick} aria-label="Select" />
        </div>
      </div>
    </div>
  )
}


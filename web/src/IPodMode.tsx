import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api, type CatalogResults, type CatalogSong, type Lyrics, type Song, type Source, type Upload, type User } from './api'
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

type Item = { label: string; right?: string; more?: boolean; dim?: boolean; go?: () => void }
type Screen =
  | { kind: 'list'; id: string; title: string; arg?: string; sel: number; top: number }
  | { kind: 'now'; mode: 'volume' | 'scrub' | 'lyrics' }
  | { kind: 'search'; sel: number; top: number }
  | { kind: 'message'; title: string; text: string }

const COLOUR = 'yoinker.pod.colour'
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
        { label: t('forYou'), more: true, dim: !p.online, go: () => { if (!p.online) return; list('picks', t('forYou')); if (!picks) loadPicks(false) } },
        { label: t('podShuffleSongs'), go: () => { if (!pool.length) return message(t('podMusic'), t('podNoMusic')); if (!q.shuffle) q.toggleShuffle(); playList(pool, Math.floor(Math.random() * pool.length)) } },
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
        { label: t('tourTitle'), go: () => { setStack(st => st.slice(0, 1)); setTour(0) } },
        { label: t('podFullSite'), go: p.exit },
        { label: 'Audio test', go: p.audioTest },
        { label: t('logout'), go: p.onLogout },
      ]
      case 'about': return [
        { label: p.user.name, dim: true },
        { label: t('podSongs'), right: String(p.library.length), dim: true },
        { label: t('thisDevice'), right: String(p.saved.size), dim: true },
        { label: p.online ? t('podOnline') : t('podOffline'), dim: true },
        { label: 'music.sunnygong.com', dim: true },
      ]
    }
    return []
  }

  const loadPicks = useCallback((fresh: boolean) => {
    setPicks(null)
    api.forYou(fresh).then(setPicks).catch(() => setPicks([]))
  }, [])

  // search: artists as you type, then the catalog
  useEffect(() => {
    const term = query.trim()
    if (top.kind !== 'search' || !term || results) { setSuggest([]); return }
    let live = true
    const timer = setTimeout(() => api.suggest(term).then(r => { if (live) setSuggest(r) }).catch(() => {}), 250)
    return () => { live = false; clearTimeout(timer) }
  }, [query, top.kind, results])
  async function runSearch(term: string) {
    if (!term.trim()) return
    input.current?.blur()
    setQuery(term)
    setSearching(true)
    setSuggest([])
    setFinds([])
    let found: CatalogResults | null = null
    try { found = await api.catalog(term); setResults(found) } catch (e) { message(t('podError'), (e as Error).message) }
    if (!found || found.matched < 3) setFinds(await api.uploads(term).catch(() => []))
    setSearching(false)
    setStack(st => st.map((x, i) => (i === st.length - 1 && x.kind === 'search' ? { ...x, sel: 0, top: 0 } : x)))
  }
  function searchItems(): Item[] {
    if (searching) return [{ label: t('searching'), dim: true }]
    if (results) {
      const artistNames = results.artists.map(a => a.name).slice(0, 3)
      return [
        ...artistNames.map(n => ({ label: n, right: t('artistKind'), more: true, go: () => { setResults(null); runSearch(n) } })),
        ...results.songs.map(catalogItem),
        ...finds.map(r => ({ label: r.title, right: 'YouTube', more: true, go: () => list('upload', r.title, JSON.stringify(r)) })),
        ...(!results.songs.length && !finds.length ? [{ label: t('nothingOnYouTube'), dim: true }] : []),
      ]
    }
    return [
      ...suggest.map(n => ({ label: n, right: t('artistKind'), more: true, go: () => runSearch(n) })),
      ...(query.trim() ? [{ label: t('searchFor', { q: query.trim() }), go: () => runSearch(query) }] : []),
    ]
  }

  const current = top.kind === 'list' ? items(top) : top.kind === 'search' ? searchItems() : []
  const visible = top.kind === 'search' ? rows - 2 : rows

  // ---------- the wheel and buttons ----------

  const setTop = (f: (s: Screen) => Screen) => setStack(st => [...st.slice(0, -1), f(st[st.length - 1])])
  function scroll(step: number) {
    scrolled.current++
    if (top.kind === 'list' || top.kind === 'search') {
      const n = current.length
      const sel = Math.max(0, Math.min(n - 1, top.sel + step))
      if (sel === top.sel) return
      tick()
      setTop(s => {
        if (s.kind !== 'list' && s.kind !== 'search') return s
        const topRow = sel < s.top ? sel : sel >= s.top + visible ? sel - visible + 1 : s.top
        return { ...s, sel, top: topRow }
      })
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
      if (i !== undefined) setTop(s => (s.kind === 'list' || s.kind === 'search' ? { ...s, sel: at } : s))
      current[at]?.go?.()
    } else if (top.kind === 'now') {
      const modes = iOS ? ['scrub', 'lyrics'] as const : ['volume', 'scrub', 'lyrics'] as const
      setTop(s => (s.kind === 'now' ? { ...s, mode: modes[(modes.indexOf(s.mode as never) + 1) % modes.length] } : s))
    }
  }
  function menu() {
    tick()
    if (top.kind === 'search' && results) { setResults(null); return }
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
  useEffect(() => { if (top.kind === 'search' && !results) setTimeout(() => input.current?.focus(), 50) }, [top.kind, results])

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

  const listView = (all: Item[], sel: number, first: number, n: number) => (
    <>
      <ul className="pod-list" style={all.length > n ? { marginRight: 5 } : undefined}>
        {all.slice(first, first + n).map((it, i) => (
          <li key={first + i} className={(first + i === sel ? 'sel ' : '') + (it.more ? 'more ' : '') + (it.dim ? 'dim' : '')}
            onClick={() => select(first + i)}>
            <span className="l">{it.label}</span>{it.right && <span className="r">{it.right}</span>}
          </li>
        ))}
      </ul>
      {all.length > n && <div className="pod-scroll"><i style={{ top: `${(100 * first) / all.length}%`, height: `${(100 * n) / all.length}%` }} /></div>}
    </>
  )

  let view: React.ReactNode
  if (top.kind === 'list') view = listView(current, top.sel, top.top, rows)
  else if (top.kind === 'search') {
    view = <>
      <form className="pod-search" onSubmit={e => { e.preventDefault(); runSearch(query) }}>
        <input ref={input} value={query} placeholder={t('searchPlaceholder')} enterKeyHint="search"
          onChange={e => { setQuery(e.target.value); setResults(null) }} />
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
            <div className={'track' + (showVol ? ' vol' : '')}><i style={{ width: `${pct}%` }} /></div>
            <div className="times">{preparing ? <span>{t('preparing')}</span> : showVol ? <span>{t('volume')}</span>
              : <><span>{fmt(tr.time)}</span>{top.mode === 'scrub' && <span>{t('podScrub')}</span>}<span>-{fmt(Math.max(0, tr.duration - tr.time))}</span></>}</div>
          </div>}
      </div>
    )
  }

  return (
    <div className={'pod-stage' + (fit.full ? ' pod-full' : '')}>
      <div className={'pod' + (black ? ' black' : '') + (fit.full ? ' pod-full' : '')} style={{ width: fit.w, height: fit.h, transform: fit.full ? `translateX(-50%) scale(${fit.s})` : `translate(-50%, -50%) scale(${fit.s})` }}>
        <div className="pod-screen" style={{ height: SCREEN }}>
          <div className="pod-bar">
            <span className="state">{song ? (tr.playing ? '▶' : '❚❚') : ''}</span>
            <span className="title">{busy ? `${t('preparing')}` : title}</span>
            <span className={'net' + (p.online ? '' : ' off')}>{p.online ? '' : '✈︎'}</span>
            <span className="battery"><i /></span>
          </div>
          <div className="pod-view">{view}</div>
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
          style={{ top: fit.full ? 16 + SCREEN + Math.max(20, (fit.h - 16 - SCREEN - WHEEL) / 2) : undefined }}
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


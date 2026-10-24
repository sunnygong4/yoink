// The iPod's player: lives in an offscreen document, so the music keeps going when the popup closes.
// Synced songs play straight from the extension's IndexedDB (no network needed); the rest of the library is fetched
// from the site as it comes up, the next song while this one plays.
import { allSongs, getArt, getAudio } from './db.js'

const audio = document.getElementById('audio')
const st = { queue: [], index: -1, shuffle: false, repeat: 'off', order: [] }   // order: the queue as played (shuffled or not)
let songs = new Map()
let url = null, artUrl = null

// offscreen documents only get chrome.runtime, so the settings live in this page's own storage
const save = () => localStorage.setItem('playerPrefs', JSON.stringify({ shuffle: st.shuffle, repeat: st.repeat, volume: audio.volume }))
try {
  const p = JSON.parse(localStorage.getItem('playerPrefs') || 'null')
  if (p) { st.shuffle = !!p.shuffle; st.repeat = p.repeat || 'off'; audio.volume = p.volume ?? 1 }
} catch { /* first run */ }

const current = () => songs.get(st.order[st.index]) || null
let pair = null   // the site and this iPod's token, to fetch songs that aren't synced

// songs fetched from the site, kept for a little while (the current one, the next one)
const fetched = new Map()
async function audioFor(id) {
  const local = await getAudio(id)
  if (local) return local
  if (fetched.has(id)) return fetched.get(id)
  if (!pair) return null
  const p = fetch(`${pair.origin}/api/songs/${encodeURIComponent(id)}/audio`, { headers: { Authorization: `Bearer ${pair.token}` } })
    .then(r => (r.ok ? r.blob() : null)).catch(() => null)
  fetched.set(id, p)
  if (fetched.size > 3) fetched.delete(fetched.keys().next().value)
  const blob = await p
  if (!blob) fetched.delete(id)
  return blob
}
async function artFor(id) {
  const local = await getArt(id)
  if (local || !pair) return local
  const thumb = songs.get(id)?.thumbnail
  if (!thumb) return null
  const url = thumb.startsWith('/') ? pair.origin + thumb : `${pair.origin}/api/cover?${new URLSearchParams({ url: thumb })}`
  return fetch(url, { headers: { Authorization: `Bearer ${pair.token}` } }).then(r => (r.ok ? r.blob() : null)).catch(() => null)
}

async function load(autoplay = true) {
  const id = st.order[st.index]
  const blob = id && await audioFor(id)
  if (!blob) {   // not synced and no connection: on to one that plays
    if (id && st.index < st.order.length - 1) { st.index++; return load(autoplay) }
    return
  }
  if (url) URL.revokeObjectURL(url)
  url = URL.createObjectURL(blob)
  audio.src = url
  if (autoplay) await audio.play().catch(() => {})
  // Chrome's media controls (the toolbar media hub, media keys)
  const s = current()
  const after = st.order[st.index + 1]
  if (after) audioFor(after)   // the next song, ready by the time it's needed
  if (artUrl) URL.revokeObjectURL(artUrl)
  const art = await artFor(id)
  artUrl = art ? URL.createObjectURL(art) : null
  if ('mediaSession' in navigator && s) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: s.title, artist: s.artist, album: s.album || '', artwork: artUrl ? [{ src: artUrl, sizes: '600x600' }] : [],
    })
  }
}

function shuffled(ids, first) {
  const rest = ids.filter(x => x !== first)
  for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]] }
  return first ? [first, ...rest] : rest
}

async function next(auto) {
  if (auto && st.repeat === 'one') { audio.currentTime = 0; return audio.play() }
  if (st.index < st.order.length - 1) st.index++
  else if (st.repeat === 'all' || !auto) st.index = 0
  else { audio.pause(); return }
  await load()
}

async function prev() {
  if (audio.currentTime > 3) { audio.currentTime = 0; return }
  st.index = st.index > 0 ? st.index - 1 : st.order.length - 1
  await load()
}

audio.addEventListener('ended', () => next(true))
navigator.mediaSession?.setActionHandler('play', () => audio.play())
navigator.mediaSession?.setActionHandler('pause', () => audio.pause())
navigator.mediaSession?.setActionHandler('nexttrack', () => next(false))
navigator.mediaSession?.setActionHandler('previoustrack', () => prev())

function state() {
  const s = current()
  return {
    song: s, playing: !audio.paused, time: audio.currentTime || 0, duration: audio.duration || s?.duration || 0,
    position: st.index + 1, count: st.order.length, shuffle: st.shuffle, repeat: st.repeat, volume: audio.volume,
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.to !== 'offscreen') return false
  ;(async () => {
    switch (msg.type) {
      case 'play': {   // a list, starting at one of its songs
        songs = new Map([...(await allSongs()), ...(msg.songs || [])].map(s => [s.id, s]))
        pair = msg.pair || pair
        st.queue = msg.ids.filter(id => songs.has(id))
        const first = st.queue[msg.start ?? 0]
        st.order = (msg.shuffle ?? st.shuffle) ? shuffled(st.queue, msg.start == null ? null : first) : st.queue
        if (msg.shuffle != null) { st.shuffle = msg.shuffle; save() }
        st.index = Math.max(0, st.order.indexOf(first))
        await load()
        break
      }
      case 'toggle': if (!audio.src) break; if (audio.paused) await audio.play().catch(() => {}); else audio.pause(); break
      case 'next': if (st.order.length) await next(false); break
      case 'prev': if (st.order.length) await prev(); break
      case 'seek': audio.currentTime = msg.time; break
      case 'volume': audio.volume = Math.max(0, Math.min(1, msg.volume)); save(); break
      case 'shuffle': {
        st.shuffle = msg.on; save()
        const id = st.order[st.index]
        st.order = st.shuffle ? shuffled(st.queue, id) : st.queue
        st.index = Math.max(0, st.order.indexOf(id))
        break
      }
      case 'repeat': st.repeat = msg.mode; save(); break
      case 'forget': {   // songs removed from the iPod
        if (msg.ids.includes(st.order[st.index])) { audio.pause(); audio.removeAttribute('src') }
        st.queue = st.queue.filter(x => !msg.ids.includes(x))
        st.order = st.order.filter(x => !msg.ids.includes(x))
        st.index = Math.min(st.index, st.order.length - 1)
        break
      }
    }
    return state()
  })().then(reply, e => reply({ error: String(e) }))
  return true
})

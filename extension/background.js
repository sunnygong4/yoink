// The iPod's brain: pairing with a Yoinker account, syncing songs onto the device (the extension's
// IndexedDB), the whole library when online, and handing playback commands to the offscreen player (which keeps
// playing when the popup closes).
import { allSongs, putSong, removeSongs } from './db.js'

const pairing = async () => (await chrome.storage.local.get('pair')).pair || null

// ---------- the offscreen player ----------

async function player() {
  const has = await chrome.offscreen.hasDocument?.()
  if (!has) {
    try {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html', reasons: ['AUDIO_PLAYBACK'], justification: 'Plays the songs on this iPod',
      })
    } catch (e) {
      if (!String(e).includes('single offscreen')) throw e   // created meanwhile by another call
    }
  }
}

async function toPlayer(msg) {
  if (msg.type === 'state' && !(await chrome.offscreen.hasDocument?.())) return { song: null }   // nothing playing
  await player()
  if (msg.type === 'play') {
    // the player gets the songs themselves (synced or not) and the way to fetch the ones that aren't
    const { songs } = await library()
    const pick = new Map(songs.map(s => [s.id, s]))
    return chrome.runtime.sendMessage({ to: 'offscreen', ...msg, songs: msg.ids.map(id => pick.get(id)).filter(Boolean),
      pair: await pairing() })
  }
  return chrome.runtime.sendMessage({ to: 'offscreen', ...msg })
}

// ---------- the library: everything in the account when online, the synced songs when not ----------

async function library() {
  const local = await allSongs()
  const saved = new Set(local.map(s => s.id))
  const pair = await pairing()
  let remote = null
  if (pair && navigator.onLine) {
    try {
      const r = await fetch(`${pair.origin}/api/songs`, { headers: { Authorization: `Bearer ${pair.token}` }, signal: AbortSignal.timeout(8000) })
      if (r.ok) {
        remote = (await r.json()).filter(s => s.status === 'ready' && !s.radio)
          .map(({ id, title, artist, artist_main, album, duration, thumbnail, added_at }) => ({ id, title, artist, artist_main, album, duration, thumbnail, added_at }))
        await chrome.storage.local.set({ library: remote })   // for the next time, in case the network's slow then
      }
    } catch { /* offline after all, or the site's away */ }
  }
  if (!remote) {
    // no connection: only what's on the iPod can play
    return { online: false, songs: local.map(s => ({ ...s, saved: true })) }
  }
  const merged = remote.map(s => ({ ...s, saved: saved.has(s.id) }))
  // synced songs no longer in the library still play from the iPod
  for (const s of local) if (!merged.some(x => x.id === s.id)) merged.push({ ...s, saved: true })
  return { online: true, songs: merged }
}

// ---------- syncing ----------

let syncing = null   // { done, total, current }

async function sync(add, remove, tabId) {
  const pair = await pairing()
  if (!pair) throw new Error('not paired')
  if (remove.length) await removeSongs(remove)
  const have = new Set((await allSongs()).map(s => s.id))
  const todo = add.filter(s => !have.has(s.id))
  syncing = { done: 0, total: todo.length, current: null, errors: [] }
  const tell = extra => tabId != null && chrome.tabs.sendMessage(tabId, { to: 'page', type: 'sync-progress', ...syncing, ...extra }).catch(() => {})
  // a long sync must not let the worker fall asleep between downloads
  const awake = setInterval(() => chrome.runtime.getPlatformInfo(), 20000)
  try {
    for (const song of todo) {
      syncing.current = song.title
      tell()
      try {
        const headers = { Authorization: `Bearer ${pair.token}` }
        const r = await fetch(`${pair.origin}/api/songs/${encodeURIComponent(song.id)}/audio`, { headers })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const audio = await r.blob()
        let art = null
        if (song.thumbnail) {
          const url = song.thumbnail.startsWith('/') ? pair.origin + song.thumbnail
            : `${pair.origin}/api/cover?${new URLSearchParams({ url: song.thumbnail })}`
          art = await fetch(url, { headers }).then(x => (x.ok ? x.blob() : null)).catch(() => null)
        }
        const { thumbnail, ...meta } = song
        await putSong(meta, audio, art)
      } catch (e) {
        syncing.errors.push(`${song.title}: ${e.message}`)
      }
      syncing.done++
    }
  } finally {
    clearInterval(awake)
    const result = { ...syncing, current: null }
    syncing = null
    tabId != null && chrome.tabs.sendMessage(tabId, { to: 'page', type: 'sync-done', ...result }).catch(() => {})
  }
}

async function status() {
  const songs = await allSongs()
  const { usage = 0, quota = 0 } = await navigator.storage.estimate()
  const pair = await pairing()
  return {
    paired: !!pair, name: pair?.name, user: pair?.user, deviceId: pair?.deviceId, origin: pair?.origin,
    songs: songs.map(({ id, title, artist, album, duration, size }) => ({ id, title, artist, album, duration, size })),
    usage, quota, syncing,
  }
}

// ---------- messages: the website (through content.js) and the popup ----------

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.to === 'offscreen') return false   // for the player, not us
  const work = (async () => {
    if (msg.from === 'page') {
      const pair = await pairing()
      // only the site this iPod is paired with (or, before pairing, the one pairing it) may manage it
      if (pair && pair.origin !== msg.origin && msg.type !== 'status') return { error: 'paired with another site' }
      switch (msg.type) {
        case 'status': return { ...(await status()), sameSite: !pair || pair.origin === msg.origin }
        case 'pair':
          await chrome.storage.local.set({ pair: { token: msg.token, deviceId: msg.deviceId, name: msg.name, user: msg.user, origin: msg.origin } })
          return { ...(await status()), sameSite: true }
        case 'unpair':
          await chrome.storage.local.remove('pair')
          return { ...(await status()), sameSite: true }
        case 'sync':
          if (syncing) return { error: 'already syncing' }
          sync(msg.add || [], msg.remove || [], sender.tab?.id)   // runs on; progress goes to the tab
          return { started: true }
      }
      return { error: 'unknown request' }
    }
    if (msg.from === 'popup') {
      if (msg.type === 'status') return status()
      if (msg.type === 'library') return library()
      if (msg.type === 'player') return toPlayer(msg.cmd)
    }
    return { error: 'unknown request' }
  })()
  work.then(reply, e => reply({ error: String(e?.message || e) }))
  return true   // answering asynchronously
})

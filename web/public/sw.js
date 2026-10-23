// Yoinker's service worker: the app opens without a connection, and songs saved on this device play offline.
// Songs themselves live in the "yoinker-music" cache (written by the page, see src/offline.ts); this only serves
// what's there: the app's own files, the last library list, and saved songs' covers and lyrics.

const SHELL = 'yoinker-shell-v1'   // index.html, the built JS / CSS, icons
const API = 'yoinker-api-v1'       // the last /api/me and /api/songs answers
const MUSIC = 'yoinker-music-v1'   // saved songs, their covers and lyrics
const KEEP = [SHELL, API, MUSIC]
const SLOW = 4000                  // ms: a bad connection counts as none

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(['/', '/manifest.webmanifest', '/icon-192.png'])).catch(() => {}))
  self.skipWaiting()
})

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => !KEEP.includes(k)).map(k => caches.delete(k))))
    .then(() => self.clients.claim()))
})

// the network if it answers in time, else the last copy (and the network's answer still refreshes the copy)
async function networkFirst(req, cacheName, cacheKey = req) {
  const cache = await caches.open(cacheName)
  const net = fetch(req).then(r => {
    if (r.ok) cache.put(cacheKey, r.clone())
    return r
  })
  const timeout = new Promise(resolve => setTimeout(resolve, SLOW))
  try {
    const r = await Promise.race([net, timeout])
    if (r) return r
  } catch { /* offline */ }
  const copy = await caches.match(cacheKey)
  if (copy) return copy
  return net
}

async function cacheFirst(req, cacheName) {
  const hit = await caches.match(req)
  if (hit) return hit
  const r = await fetch(req)
  if (r.ok) (await caches.open(cacheName)).put(req, r.clone())
  return r
}

self.addEventListener('fetch', e => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)

  if (url.origin !== location.origin) {
    // covers come from the stores' servers; a saved song's cover is in the music cache under its own address
    if (req.destination === 'image') {
      e.respondWith(caches.match(req.url, { cacheName: MUSIC }).then(hit => hit || fetch(req)))
    }
    return
  }
  const p = url.pathname
  if (p === '/api/events' || p.endsWith('/audio') || p.endsWith('/download')) return
  if (p === '/api/me' || p === '/api/songs') { e.respondWith(networkFirst(req, API)); return }
  if (/^\/api\/songs\/[^/]+\/lyrics$/.test(p)) {
    e.respondWith(fetch(req).catch(() => caches.match(req).then(hit => hit || Response.error())))
    return
  }
  if (p.startsWith('/api/')) return
  if (req.mode === 'navigate') { e.respondWith(networkFirst(req, SHELL, '/')); return }   // every page is the same app
  if (p.startsWith('/assets/')) { e.respondWith(cacheFirst(req, SHELL)); return }   // hashed names never change
  if (/\.(png|svg|webmanifest)$/.test(p)) e.respondWith(networkFirst(req, SHELL))
})

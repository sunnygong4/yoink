// The iPod's disk: songs (what they are), audio and artwork, in the extension's own IndexedDB, so they
// play without the network. Shared by the background worker (sync), the player and the popup.

const DB = 'ipod'

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      db.createObjectStore('songs', { keyPath: 'id' })   // { id, title, artist, album, duration, size, added }
      db.createObjectStore('audio')                     // id -> Blob
      db.createObjectStore('art')                       // id -> Blob
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

let dbp = null
const db = () => (dbp ??= open())

function run(store, mode, fn) {
  return db().then(d => new Promise((resolve, reject) => {
    const tx = d.transaction(store, mode)
    const result = fn(tx.objectStore(store))
    // a request's own result (undefined for a key that isn't there), else what fn returned
    tx.oncomplete = () => resolve(result instanceof IDBRequest ? result.result : result)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  }))
}

export const allSongs = () => run('songs', 'readonly', s => s.getAll())
export const getAudio = id => run('audio', 'readonly', s => s.get(id))
export const getArt = id => run('art', 'readonly', s => s.get(id))

export async function putSong(meta, audio, art) {
  const d = await db()
  await new Promise((resolve, reject) => {
    const tx = d.transaction(['songs', 'audio', 'art'], 'readwrite')
    tx.objectStore('audio').put(audio, meta.id)
    if (art) tx.objectStore('art').put(art, meta.id)
    tx.objectStore('songs').put({ ...meta, size: audio.size + (art?.size || 0), added: Date.now() })
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  })
}

export async function removeSongs(ids) {
  const d = await db()
  await new Promise((resolve, reject) => {
    const tx = d.transaction(['songs', 'audio', 'art'], 'readwrite')
    for (const id of ids) for (const s of ['songs', 'audio', 'art']) tx.objectStore(s).delete(id)
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  })
}

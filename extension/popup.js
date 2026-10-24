// The iPod's software: menus driven by the click wheel (drag around it to scroll; MENU / ⏮ / ⏭ / ⏯ and the
// centre button), Now Playing, Settings. Online the menus have the whole library (songs not synced are fetched as
// they play); offline, just what's synced onto the iPod.
import { allSongs, getArt } from './db.js'

const view = document.getElementById('view')
const titleEl = document.getElementById('title')
const stateEl = document.getElementById('state')
const ipod = document.getElementById('ipod')
const ROWS = 8

const lang = navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
const T = {
  en: { music: 'Music', artists: 'Artists', albums: 'Albums', songs: 'Songs', shuffle: 'Shuffle Songs', now: 'Now Playing',
    settings: 'Settings', about: 'About', allSongs: 'All Songs', shuffleSet: 'Shuffle', repeat: 'Repeat', theme: 'Colour',
    off: 'Off', on: 'Songs', one: 'One', all: 'All', silver: 'Silver', black: 'Black', of: 'of', capacity: 'Capacity',
    available: 'Available', version: 'Version', paired: 'Synced with', notPaired: 'Not synced yet', unknown: 'Unknown',
    noMusic: 'No music', noMusicHint: 'Open music.sunnygong.com, pick this iPod under Devices and sync some songs.',
    onIpod: 'On this iPod', offline: 'Offline: synced songs only', recent: 'Recently Added',
    volume: 'Volume', scrub: 'Scrub' },
  zh: { music: '音乐', artists: '表演者', albums: '专辑', songs: '歌曲', shuffle: '随机播放歌曲', now: '正在播放',
    settings: '设置', about: '关于本机', allSongs: '所有歌曲', shuffleSet: '随机播放', repeat: '重复', theme: '外壳颜色',
    off: '关', on: '歌曲', one: '单曲', all: '全部', silver: '银色', black: '黑色', of: '/', capacity: '容量',
    available: '可用', version: '版本', paired: '同步自', notPaired: '尚未同步', unknown: '未知',
    noMusic: '没有音乐', noMusicHint: '打开 music.sunnygong.com，在「设备」里选择这台 iPod，同步几首歌吧。',
    onIpod: '本机上的歌', offline: '没有网络：只有同步过的歌', recent: '新加入',
    volume: '音量', scrub: '进度' },
}[lang]

const collator = new Intl.Collator([lang, 'zh', 'en'], { numeric: true, sensitivity: 'base' })
const byName = f => (a, b) => collator.compare(f(a) || '', f(b) || '')
let songs = []
let online = false
const artistOf = s => s.artist_main || s.artist || T.unknown
let player = { song: null }
const stack = []

// ---------- talking to the player (through the background worker) ----------

const send = cmd => chrome.runtime.sendMessage({ from: 'popup', type: 'player', cmd })
const play = (list, start) => send({ type: 'play', ids: list.map(s => s.id), start }).then(st => { player = st; openNow() })

// ---------- the click ----------

let audioCtx = null
function tick() {
  try {
    audioCtx ??= new AudioContext()
    const o = audioCtx.createOscillator(), g = audioCtx.createGain()
    o.frequency.value = 2400
    g.gain.setValueAtTime(0.06, audioCtx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.012)
    o.connect(g).connect(audioCtx.destination)
    o.start(); o.stop(audioCtx.currentTime + 0.015)
  } catch { /* no audio */ }
}

// ---------- screens ----------

const list = (title, items) => ({ kind: 'list', title, items, sel: 0, top: 0 })
const top = () => stack[stack.length - 1]
const push = s => { stack.push(s); render() }

function root() {
  return list('iPod', () => [
    { label: T.music, more: true, go: musicMenu },
    { label: T.shuffle, go: () => songs.length ? (send({ type: 'play', ids: songs.map(s => s.id), shuffle: true }).then(st => { player = st; openNow() })) : push(empty()) },
    ...(player.song ? [{ label: T.now, more: true, go: openNow }] : []),
    { label: T.settings, more: true, go: settings },
  ])
}

const empty = () => ({ kind: 'message', title: T.music, html: `<b>${T.noMusic}</b>${T.noMusicHint}` })

function musicMenu() {
  if (!songs.length) return push(empty())
  push(list(T.music, () => [
    ...(online ? [] : [{ label: T.offline, dim: true }]),
    { label: T.recent, more: true, go: () => songList(T.recent, [...songs].sort((a, b) => (b.added_at || b.added / 1000 || 0) - (a.added_at || a.added / 1000 || 0)).slice(0, 100)) },
    { label: T.artists, more: true, go: artists },
    { label: T.albums, more: true, go: () => albums(songs, T.albums) },
    { label: T.songs, more: true, go: () => songList(T.songs, [...songs].sort(byName(s => s.title))) },
    ...(online ? [{ label: T.onIpod, more: true, go: () => songList(T.onIpod, songs.filter(s => s.saved).sort(byName(s => s.title))) }] : []),
  ]))
}

function artists() {
  const names = [...new Set(songs.map(artistOf))].sort(collator.compare)
  push(list(T.artists, () => names.map(name => ({
    label: name, more: true,
    go: () => {
      const mine = songs.filter(s => artistOf(s) === name)
      albums(mine, name, true)
    },
  }))))
}

function albums(from, title, withAll = false) {
  const names = [...new Set(from.map(s => s.album || T.unknown))].sort(collator.compare)
  push(list(title, () => [
    ...(withAll ? [{ label: T.allSongs, more: true, go: () => songList(title, [...from].sort(byName(s => s.title))) }] : []),
    ...names.map(name => ({
      label: name, more: true,
      go: () => songList(name, from.filter(s => (s.album || T.unknown) === name).sort(byName(s => s.title))),
    })),
  ]))
}

function songList(title, items) {
  push(list(title, () => items.map((s, i) => ({ label: s.title, go: () => play(items, i) }))))
}

function settings() {
  push(list(T.settings, () => [
    { label: T.shuffleSet, right: player.shuffle ? T.on : T.off, go: () => send({ type: 'shuffle', on: !player.shuffle }).then(st => { player = st; render() }) },
    { label: T.repeat, right: { off: T.off, one: T.one, all: T.all }[player.repeat || 'off'],
      go: () => send({ type: 'repeat', mode: { off: 'one', one: 'all', all: 'off' }[player.repeat || 'off'] }).then(st => { player = st; render() }) },
    { label: T.theme, right: ipod.classList.contains('black') ? T.black : T.silver, go: toggleTheme },
    { label: T.about, more: true, go: about },
  ]))
}

async function about() {
  const st = await chrome.runtime.sendMessage({ from: 'popup', type: 'status' })
  const mb = n => `${(n / 1048576).toFixed(n > 1e9 ? 0 : 1)} MB`
  push(list(T.about, () => [
    { label: st.name || 'iPod', dim: true },
    { label: T.songs, right: String(st.songs.length), dim: true },
    { label: T.capacity, right: mb(st.usage), dim: true },
    { label: T.available, right: st.quota ? mb(Math.max(0, st.quota - st.usage)) : '—', dim: true },
    { label: st.paired ? `${T.paired} ${st.user}` : T.notPaired, dim: true },
    { label: T.version, right: chrome.runtime.getManifest().version, dim: true },
  ]))
}

function toggleTheme() {
  ipod.classList.toggle('black')
  chrome.storage.local.set({ ipodColour: ipod.classList.contains('black') ? 'black' : 'silver' })
  render()
}

function openNow() {
  if (top()?.kind !== 'now') push({ kind: 'now', title: T.now, mode: 'volume', overlayUntil: 0 })
  else render()
}

// ---------- drawing ----------

let artFor = null, artUrl = null

async function render() {
  const s = top()
  titleEl.textContent = s.title
  stateEl.textContent = (player.song ? (player.playing ? '▶' : '❚❚') : '') + (online ? '' : ' ✈︎')
  if (s.kind === 'message') {
    view.innerHTML = `<div class="message">${s.html}</div>`
  } else if (s.kind === 'list') {
    const items = s.items()
    s.sel = Math.min(s.sel, Math.max(0, items.length - 1))
    if (s.sel < s.top) s.top = s.sel
    if (s.sel >= s.top + ROWS) s.top = s.sel - ROWS + 1
    const shown = items.slice(s.top, s.top + ROWS)
    const esc = x => String(x).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
    view.innerHTML = `<ul class="list" style="${items.length > ROWS ? 'margin-right:5px' : ''}">${shown.map((it, i) =>
      `<li class="${s.top + i === s.sel ? 'sel' : ''} ${it.more ? 'more' : ''} ${it.dim ? 'dim' : ''}">${esc(it.label)}${it.right ? `<span class="r">${esc(it.right)}</span>` : ''}</li>`).join('')}</ul>` +
      (items.length > ROWS ? `<div class="scroll"><i style="top:${(100 * s.top) / items.length}%;height:${(100 * ROWS) / items.length}%"></i></div>` : '')
  } else if (s.kind === 'now') {
    const p = player
    if (!p.song) { view.innerHTML = `<div class="message"><b>${T.now}</b></div>`; return }
    if (artFor !== p.song.id) {
      artFor = p.song.id
      if (artUrl?.startsWith('blob:')) URL.revokeObjectURL(artUrl)
      const blob = await getArt(p.song.id)
      // not synced: its cover straight from the stores' image servers
      artUrl = blob ? URL.createObjectURL(blob) : (p.song.thumbnail && /^https:/.test(p.song.thumbnail) ? p.song.thumbnail : null)
    }
    const fmt = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`
    const showVol = Date.now() < s.overlayUntil && s.mode === 'volume'
    const pct = showVol ? 100 * (p.volume ?? 1) : p.duration ? (100 * p.time) / p.duration : 0
    const esc = x => String(x ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
    view.innerHTML = `<div class="np">
      <div class="pos">${p.position} ${T.of} ${p.count}</div>
      <div class="modes">${p.shuffle ? '⤨ ' : ''}${p.repeat === 'one' ? '↻1' : p.repeat === 'all' ? '↻' : ''}</div>
      <div class="row">
        ${artUrl ? `<div class="art" style="background-image:url('${artUrl}')"></div>` : '<div class="art none">♫</div>'}
        <div class="meta"><b>${esc(p.song.title)}</b><span>${esc(p.song.artist)}</span><span>${esc(p.song.album)}</span></div>
      </div>
      <div class="progress">
        <div class="track ${showVol ? 'vol' : ''}"><i style="width:${pct}%"></i></div>
        <div class="times">${showVol ? `<span>${T.volume}</span><span></span>`
          : `<span>${fmt(p.time)}</span>${s.mode === 'scrub' ? `<span>${T.scrub}</span>` : ''}<span>-${fmt(Math.max(0, p.duration - p.time))}</span>`}</div>
      </div></div>`
  }
}

// ---------- controls ----------

function scroll(step) {
  const s = top()
  if (s.kind === 'list') {
    const n = s.items().length
    const sel = Math.max(0, Math.min(n - 1, s.sel + step))
    if (sel !== s.sel) { s.sel = sel; tick(); render() }
  } else if (s.kind === 'now' && player.song) {
    tick()
    if (s.mode === 'scrub') {
      player.time = Math.max(0, Math.min(player.duration, player.time + step * 5))
      send({ type: 'seek', time: player.time })
    } else {
      player.volume = Math.max(0, Math.min(1, (player.volume ?? 1) + step * 0.05))
      send({ type: 'volume', volume: player.volume })
      s.overlayUntil = Date.now() + 1500
    }
    render()
  }
}

function select() {
  const s = top()
  tick()
  if (s.kind === 'list') {
    const it = s.items()[s.sel]
    it?.go?.()
  } else if (s.kind === 'now') {
    s.mode = s.mode === 'volume' ? 'scrub' : 'volume'   // the centre button switches what the wheel does
    render()
  }
}

function menu() {
  tick()
  if (stack.length > 1) { stack.pop(); render() }
}

const playPause = () => { tick(); send({ type: 'toggle' }).then(st => { player = st; render() }) }
const next = () => { tick(); send({ type: 'next' }).then(st => { player = st; render() }) }
const prev = () => { tick(); send({ type: 'prev' }).then(st => { player = st; render() }) }

// the wheel: going round scrolls (one step every 20°); a tap on MENU / ⏮ / ⏭ / ⏯ presses that
const wheel = document.getElementById('wheel')
let drag = null
wheel.addEventListener('pointerdown', e => {
  if (e.target.id === 'center') return
  const r = wheel.getBoundingClientRect()
  const c = { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  drag = { c, last: Math.atan2(e.clientY - c.y, e.clientX - c.x), acc: 0, moved: 0, x: e.clientX - c.x, y: e.clientY - c.y }
  wheel.setPointerCapture(e.pointerId)
  wheel.classList.add('pressing')
})
wheel.addEventListener('pointermove', e => {
  if (!drag) return
  const a = Math.atan2(e.clientY - drag.c.y, e.clientX - drag.c.x)
  let d = a - drag.last
  if (d > Math.PI) d -= 2 * Math.PI
  if (d < -Math.PI) d += 2 * Math.PI
  drag.last = a
  drag.acc += d
  drag.moved += Math.abs(d)
  const STEP = Math.PI / 9
  while (drag.acc > STEP) { drag.acc -= STEP; scroll(1) }
  while (drag.acc < -STEP) { drag.acc += STEP; scroll(-1) }
})
wheel.addEventListener('pointerup', () => {
  if (!drag) return
  wheel.classList.remove('pressing')
  if (drag.moved < 0.15) {   // a tap, not a turn
    const { x, y } = drag
    if (Math.abs(y) > Math.abs(x)) (y < 0 ? menu : playPause)()
    else (x < 0 ? prev : next)()
  }
  drag = null
})
document.getElementById('center').addEventListener('click', select)
document.addEventListener('wheel', e => { e.preventDefault(); scroll(e.deltaY > 0 ? 1 : -1) }, { passive: false })
document.addEventListener('keydown', e => {
  const k = e.key
  if (k === 'ArrowDown') scroll(1)
  else if (k === 'ArrowUp') scroll(-1)
  else if (k === 'Enter' || k === 'ArrowRight') select()
  else if (k === 'Escape' || k === 'Backspace' || k === 'ArrowLeft') menu()
  else if (k === ' ') playPause()
  else return
  e.preventDefault()
})

// ---------- start ----------

;(async () => {
  const { ipodColour } = await chrome.storage.local.get('ipodColour')
  if (ipodColour === 'black') ipod.classList.add('black')
  // the whole library when online (the background asks the site), the synced songs when not
  // (asked twice: the background worker may be just waking up)
  const ask = () => chrome.runtime.sendMessage({ from: 'popup', type: 'library' }).catch(() => null)
  const lib = (await ask()) || (await new Promise(r => setTimeout(r, 400)), await ask())
  if (lib && !lib.error) { songs = lib.songs; online = lib.online } else { songs = (await allSongs()).map(s => ({ ...s, saved: true })) }
  player = await send({ type: 'state' }).catch(() => ({ song: null }))
  stack.push(root())
  if (player?.song?.id && player.playing) stack.push({ kind: 'now', title: T.now, mode: 'volume', overlayUntil: 0 })
  render()
  setInterval(async () => {   // keep Now Playing and the ▶ icon current
    const st = await send({ type: 'state' }).catch(() => null)
    if (st && !st.error) { player = st; if (top().kind === 'now' || !drag) render() }
  }, 500)
})()

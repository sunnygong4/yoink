// The bubble: closed, a turning cover (drag it anywhere; hover for ⏮ ⏯ ⏭; click to open; double-click for the main
// window); open, a mini iPod whose wheel controls the main window's player (go round it to move through the song;
// MENU opens the main window; the centre plays / pauses).
const $ = id => document.getElementById(id)
const ball = $('ball'), mini = $('mini')
let st = null
let open = false

const fmt = t => `${Math.floor((t || 0) / 60)}:${String(Math.floor((t || 0) % 60)).padStart(2, '0')}`

function render() {
  const s = st?.song
  const playing = !!st?.playing
  // the bubble
  const disc = $('disc')
  disc.style.backgroundImage = s?.cover ? `url("${s.cover}")` : ''
  disc.querySelector('.note').style.display = s?.cover ? 'none' : ''
  disc.classList.toggle('spin', playing)
  const pct = st?.duration ? Math.min(1, st.time / st.duration) : 0
  $('ring').style.strokeDashoffset = String(188.5 * (1 - pct))
  $('ballToggle').innerHTML = playing   // drawn, not ⏸ / ▶ (Windows shows those as coloured emoji)
    ? '<svg viewBox="0 0 24 24" width="15" height="15"><rect fill="currentColor" x="6" y="4.5" width="4" height="15" rx="1.2"/><rect fill="currentColor" x="14" y="4.5" width="4" height="15" rx="1.2"/></svg>'
    : '<svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>'
  ball.title = s ? `${s.title} — ${s.artist}` : 'Yoinker'
  // the mini iPod
  $('st').textContent = s ? (playing ? '▶' : '❚❚') : ''
  $('title').textContent = s?.title || 'Yoinker'
  $('artist').textContent = s?.artist || '没有在播放'
  $('album').textContent = s?.album || ''
  const art = $('art')
  art.style.backgroundImage = s?.cover ? `url("${s.cover}")` : ''
  art.classList.toggle('has', !!s?.cover)
  $('bar').style.width = `${pct * 100}%`
  $('t0').textContent = fmt(st?.time)
  $('t1').textContent = `-${fmt(Math.max(0, (st?.duration || 0) - (st?.time || 0)))}`
}

window.bubble.onState(s => { st = s; render() })
window.bubble.state().then(s => { st = s; render() })
// between the player's reports, the clock keeps going
setInterval(() => {
  if (st?.playing && st.duration) { st.time = Math.min(st.duration, (st.time || 0) + 1); render() }
}, 1000)

const send = c => window.bubble.command(c)
function setOpen(on) {
  open = on
  ball.classList.toggle('hidden', on)
  mini.classList.toggle('hidden', !on)
  window.bubble.open(on)
}

// ---------- dragging the window by the bubble or the iPod's body (a short press is a click instead) ----------
function draggable(el, onClick, onDouble) {
  let start = null, moved = false, lastClick = 0
  el.addEventListener('pointerdown', e => {
    if (e.target.closest('button') || e.target.closest('.wheel')) return
    start = { x: e.screenX, y: e.screenY }
    moved = false
    el.setPointerCapture(e.pointerId)
  })
  el.addEventListener('pointermove', e => {
    if (!start) return
    const dx = e.screenX - start.x, dy = e.screenY - start.y
    if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return
    moved = true
    window.bubble.drag(dx, dy)
    start = { x: e.screenX, y: e.screenY }
  })
  el.addEventListener('pointerup', () => {
    const was = start
    start = null
    if (!was || moved) return
    const now = Date.now()
    if (onDouble && now - lastClick < 320) { lastClick = 0; onDouble(); return }
    lastClick = now
    if (onClick) setTimeout(() => { if (lastClick === now) onClick() }, 330)   // not if a second click makes it a double
  })
}
draggable(ball, () => setOpen(true), () => send({ type: 'show' }))
draggable(mini, null, () => send({ type: 'show' }))

document.querySelectorAll('.ball-controls button').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); send({ type: b.dataset.cmd }) }))
$('shrink').addEventListener('click', () => setOpen(false))
$('center').addEventListener('click', () => send({ type: 'toggle' }))

// ---------- the click wheel: round it moves through the song; MENU / ⏮ / ⏭ / ⏯ are buttons ----------
const wheel = $('wheel')
let w = null
wheel.addEventListener('pointerdown', e => {
  if (e.target.id === 'center') return
  const r = wheel.getBoundingClientRect()
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2
  w = { cx, cy, last: Math.atan2(e.clientY - cy, e.clientX - cx), acc: 0, moved: 0, x: e.clientX - cx, y: e.clientY - cy, seek: null }
  wheel.setPointerCapture(e.pointerId)
})
wheel.addEventListener('pointermove', e => {
  if (!w) return
  const a = Math.atan2(e.clientY - w.cy, e.clientX - w.cx)
  let d = a - w.last
  if (d > Math.PI) d -= 2 * Math.PI
  if (d < -Math.PI) d += 2 * Math.PI
  w.last = a
  w.acc += d
  w.moved += Math.abs(d)
  const STEP = Math.PI / 9
  while (Math.abs(w.acc) > STEP && st?.duration) {
    const dir = Math.sign(w.acc)
    w.acc -= dir * STEP
    st.time = Math.max(0, Math.min(st.duration, (st.time || 0) + dir * 5))
    w.seek = st.time
    render()
  }
})
wheel.addEventListener('pointerup', () => {
  const g = w
  w = null
  if (!g) return
  if (g.seek != null) { send({ type: 'seek', time: g.seek }); return }
  if (g.moved > 0.15) return
  if (Math.abs(g.y) > Math.abs(g.x)) send({ type: g.y < 0 ? 'show' : 'toggle' })   // MENU: the main window
  else send({ type: g.x < 0 ? 'prev' : 'next' })
})

render()

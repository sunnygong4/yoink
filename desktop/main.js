// Yoinker for Windows: music.sunnygong.com in its own window (closing it hides it to the tray, the music keeps
// playing), and a floating bubble that stays on top: what's playing, ⏮ ⏯ ⏭, and a mini iPod when clicked. The music
// plays in the main window; the bubble and the media keys are remote controls for it.
const { app, BrowserWindow, Tray, Menu, ipcMain, globalShortcut, screen, nativeImage, shell } = require('electron')
const path = require('path')
const fs = require('fs')

const SITE = process.env.YOINKER_URL || 'https://music.sunnygong.com'
const ICON = path.join(__dirname, 'build', 'icon.png')
const BUBBLE = 64, MINI = { width: 236, height: 372 }

let main = null, bubble = null, tray = null, quitting = false
let bubbleOpen = false   // the mini iPod is showing
let state = null   // what the site's player said last

// ---------- remembered between runs: where the windows were ----------
const prefsFile = () => path.join(app.getPath('userData'), 'windows.json')
function prefs() {
  try { return JSON.parse(fs.readFileSync(prefsFile(), 'utf8')) } catch { return {} }
}
function savePrefs(p) {
  try { fs.writeFileSync(prefsFile(), JSON.stringify({ ...prefs(), ...p })) } catch { /* not worth stopping for */ }
}

if (!app.requestSingleInstanceLock()) app.quit()   // a second Yoinker.exe just brings the first one forward
app.on('second-instance', () => showMain())

function showMain() {
  if (!main) return
  if (main.isMinimized()) main.restore()
  main.show()
  main.focus()
}

function createMain() {
  const p = prefs()
  main = new BrowserWindow({
    width: p.main?.width || 1280, height: p.main?.height || 820, x: p.main?.x, y: p.main?.y,
    minWidth: 760, minHeight: 520, title: 'Yoinker', icon: ICON, backgroundColor: '#d9d9d9', show: false,
    autoHideMenuBar: true,
    // a music app: the bubble, the tray and the media keys start the music, no click in the window needed
    webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' },
  })
  main.loadURL(SITE)
  main.once('ready-to-show', () => main.show())
  // links to other sites (a video's YouTube page, Wikipedia) open in the browser
  main.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(SITE)) { shell.openExternal(url); return { action: 'deny' } }
    return { action: 'allow' }
  })
  main.on('close', e => {
    savePrefs({ main: main.getBounds() })
    if (!quitting) { e.preventDefault(); main.hide() }   // like 百度网盘: the window goes, Yoinker stays (in the tray)
  })
}

// ---------- the bubble ----------

function createBubble() {
  const p = prefs()
  const area = screen.getPrimaryDisplay().workArea
  bubble = new BrowserWindow({
    width: BUBBLE, height: BUBBLE,
    x: p.bubble?.x ?? area.x + area.width - BUBBLE - 24, y: p.bubble?.y ?? area.y + area.height - BUBBLE - 120,
    frame: false, transparent: true, resizable: false, alwaysOnTop: true, skipTaskbar: true, hasShadow: false,
    focusable: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'bubble-preload.js') },
  })
  bubble.setAlwaysOnTop(true, 'floating')
  bubble.setMinimumSize(BUBBLE, BUBBLE)
  bubble.setMaximumSize(BUBBLE, BUBBLE)
  bubble.loadFile(path.join(__dirname, 'bubble.html'))
  bubble.once('ready-to-show', () => { if (prefs().bubbleHidden !== true) bubble.showInactive() })
  bubble.on('moved', () => savePrefs({ bubble: bubble.getBounds() }))
}

// the bubble opens into the mini iPod and back, growing from the corner it sits nearest
function setBubbleSize(open) {
  if (!bubble) return
  const b = bubble.getBounds()
  const area = screen.getDisplayMatching(b).workArea
  bubbleOpen = open
  const w = open ? MINI.width : BUBBLE, h = open ? MINI.height : BUBBLE
  const right = b.x + b.width / 2 > area.x + area.width / 2
  const bottom = b.y + b.height / 2 > area.y + area.height / 2
  let x = right ? b.x + b.width - w : b.x
  let y = bottom ? b.y + b.height - h : b.y
  x = Math.max(area.x, Math.min(x, area.x + area.width - w))
  y = Math.max(area.y, Math.min(y, area.y + area.height - h))
  // locked to exactly this size: a scaled display can't round it bigger as it's dragged
  bubble.setMinimumSize(w, h)
  bubble.setMaximumSize(w, h)
  bubble.setBounds({ x, y, width: w, height: h })
}

function toggleBubble() {
  if (!bubble) return
  if (bubble.isVisible()) { bubble.hide(); savePrefs({ bubbleHidden: true }) }
  else { bubble.showInactive(); savePrefs({ bubbleHidden: false }) }
  buildTray()
}

// ---------- the tray ----------

function buildTray() {
  const menu = Menu.buildFromTemplate([
    { label: '打开 Yoinker  Open', click: showMain },
    { label: bubble?.isVisible() ? '隐藏悬浮球  Hide the bubble' : '显示悬浮球  Show the bubble', click: toggleBubble },
    { type: 'separator' },
    { label: '播放 / 暂停  Play / Pause', click: () => command({ type: 'toggle' }) },
    { label: '下一首  Next', click: () => command({ type: 'next' }) },
    { type: 'separator' },
    { label: '退出  Quit', click: () => { quitting = true; app.quit() } },
  ])
  tray.setContextMenu(menu)
}

// ---------- the site's player <-> the bubble, the tray, the media keys ----------

function command(c) {
  if (c.type === 'show') return showMain()
  main?.webContents.send('yoinker:command', c)
}

ipcMain.on('yoinker:state', (_e, s) => {
  state = s
  bubble?.webContents.send('yoinker:state', s)
  tray?.setToolTip(s?.song ? `${s.song.title} — ${s.song.artist}` : 'Yoinker')
})
ipcMain.on('yoinker:command', (_e, c) => command(c))
ipcMain.on('yoinker:bubble-open', (_e, open) => setBubbleSize(open))
ipcMain.on('yoinker:bubble-drag', (_e, { dx, dy }) => {
  if (!bubble) return
  // the size is set with every move: on a scaled display (125%, 150%) Windows rounds a frameless window's size a
  // little each time it's only moved, and dragging made it grow
  const [x, y] = bubble.getPosition()
  const w = bubbleOpen ? MINI.width : BUBBLE, h = bubbleOpen ? MINI.height : BUBBLE
  bubble.setBounds({ x: Math.round(x + dx), y: Math.round(y + dy), width: w, height: h })
})
ipcMain.handle('yoinker:state', () => state)

app.whenReady().then(() => {
  createMain()
  createBubble()
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }))
  tray.setToolTip('Yoinker')
  tray.on('click', showMain)
  buildTray()
  // the keyboard's media keys, wherever the focus is
  globalShortcut.register('MediaPlayPause', () => command({ type: 'toggle' }))
  globalShortcut.register('MediaNextTrack', () => command({ type: 'next' }))
  globalShortcut.register('MediaPreviousTrack', () => command({ type: 'prev' }))
})

app.on('before-quit', () => { quitting = true })
app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('window-all-closed', () => { /* stays in the tray */ })

// What the site sees of the desktop app: window.yoinkerDesktop. Its player reports what it's on (for the bubble and
// the tray) and takes commands (from the bubble, the tray and the media keys).
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('yoinkerDesktop', {
  state: s => ipcRenderer.send('yoinker:state', s),
  onCommand: cb => {
    const listener = (_e, c) => cb(c)
    ipcRenderer.on('yoinker:command', listener)
    return () => ipcRenderer.removeListener('yoinker:command', listener)
  },
})

// The bubble's line to the app: what's playing comes in, commands (and its own resizing and dragging) go out.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('bubble', {
  onState: cb => ipcRenderer.on('yoinker:state', (_e, s) => cb(s)),
  state: () => ipcRenderer.invoke('yoinker:state'),
  command: c => ipcRenderer.send('yoinker:command', c),
  open: on => ipcRenderer.send('yoinker:bubble-open', on),
  drag: (dx, dy) => ipcRenderer.send('yoinker:bubble-drag', { dx, dy }),
})

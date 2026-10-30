// Preload of the splash window: a tiny, read-only channel from the main process (no access to the app methods).
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('splash', {
  // Called once the page can render; the main process answers with the current state and then every change.
  onState: (callback) => {
    ipcRenderer.on('splash:state', (_, state) => callback(state));
    ipcRenderer.send('splash:ready');
  },
  onLeave: (callback) => ipcRenderer.on('splash:leave', () => callback()),
  quit: () => ipcRenderer.send('splash:quit'),
  proceed: () => ipcRenderer.send('splash:proceed'),
});

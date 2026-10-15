const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('omphalos', {
  call: (method, args) => ipcRenderer.invoke('omphalos:call', method, args),
  onEvent: (callback) => { const listener = (_, event) => callback(event); ipcRenderer.on('omphalos:event', listener); return () => ipcRenderer.removeListener('omphalos:event', listener); }
});

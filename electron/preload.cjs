const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('vesta', {
  call: (method, args) => ipcRenderer.invoke('vesta:call', method, args),
  onEvent: (callback) => {
    const listener = (_, event) => callback(event);
    ipcRenderer.on('vesta:event', listener);
    return () => ipcRenderer.removeListener('vesta:event', listener);
  },
});

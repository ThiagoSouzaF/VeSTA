const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('vesta', {
  call: (method, args) => ipcRenderer.invoke('vesta:call', method, args),
  // Tells the main process that the first state is loaded and painted (or `{ error }` if the app could not start).
  ready: (payload) => ipcRenderer.send('vesta:ready', payload),
  onEvent: (callback) => {
    const listener = (_, event) => callback(event);
    ipcRenderer.on('vesta:event', listener);
    return () => ipcRenderer.removeListener('vesta:event', listener);
  },
});

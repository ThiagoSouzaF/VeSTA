const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('vesta', {
  call: (method, args) => ipcRenderer.invoke('vesta:call', method, args),
  // Path of a file dropped on the window (empty for pasted or synthetic files, which travel as bytes instead).
  pathOf: (file) => {
    try {
      return webUtils.getPathForFile(file) || '';
    } catch {
      return '';
    }
  },
  // Tells the main process that the first state is loaded and painted (or `{ error }` if the app could not start).
  ready: (payload) => ipcRenderer.send('vesta:ready', payload),
  onEvent: (callback) => {
    const listener = (_, event) => callback(event);
    ipcRenderer.on('vesta:event', listener);
    return () => ipcRenderer.removeListener('vesta:event', listener);
  },
});

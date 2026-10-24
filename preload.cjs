const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  init: () => ipcRenderer.invoke('init'),
  act: (name, ...args) => ipcRenderer.invoke('act', name, ...args),
  onState: (fn) => ipcRenderer.on('state', (_e, state) => fn(state)),
  onStream: (fn) => ipcRenderer.on('stream', (_e, data) => fn(data)),
});

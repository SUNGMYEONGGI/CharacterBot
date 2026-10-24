import { contextBridge, ipcRenderer } from 'electron';
import type { Broadcast, DesktopApi, StreamChunk } from '../shared/types';

const api: DesktopApi = {
  init: () => ipcRenderer.invoke('init'),
  act: (name, ...args) => ipcRenderer.invoke('act', name, ...args),
  onState: (fn) => { ipcRenderer.on('state', (_e, state: Broadcast) => fn(state)); },
  onStream: (fn) => { ipcRenderer.on('stream', (_e, data: StreamChunk) => fn(data)); },
};
contextBridge.exposeInMainWorld('desktop', api);

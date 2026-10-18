'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('mori', Object.freeze({
  getState: () => ipcRenderer.invoke('state:get'),
  saveSettings: patch => ipcRenderer.invoke('settings:save', patch),
  saveUsage: update => ipcRenderer.invoke('usage:save', update),
  copyToken: () => ipcRenderer.invoke('bridge:copy'),
  action: action => ipcRenderer.invoke('pet:action', action),
  interactive: value => ipcRenderer.send('pet:interactive', value),
  drag: input => ipcRenderer.send('pet:drag', input),
  onState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('state', listener);
    return () => ipcRenderer.removeListener('state', listener);
  },
  onNotice: callback => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on('notice', listener);
    return () => ipcRenderer.removeListener('notice', listener);
  },
}));

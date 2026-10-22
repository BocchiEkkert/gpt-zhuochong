'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('mori', Object.freeze({
  getState: () => ipcRenderer.invoke('state:get'),
  scalePet: steps => ipcRenderer.invoke('pet:scale', steps),
  saveSettings: patch => ipcRenderer.invoke('settings:save', patch),
  saveUsage: update => ipcRenderer.invoke('usage:save', update),
  refreshCodex: () => ipcRenderer.invoke('codex:refresh'),
  selectCodex: () => ipcRenderer.invoke('codex:select'),
  onHidden: callback => {
    const listener = () => callback(); ipcRenderer.on('pet:hidden', listener);
    return () => ipcRenderer.removeListener('pet:hidden', listener);
  },
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

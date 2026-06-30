'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// subscribe helper: returns an unsubscribe fn
function sub(channel, cb) {
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

// Everything the renderer can reach lives under window.app — a small, explicit surface.
// No Node, no ipcRenderer in the page (contextIsolation is on). Grow this as your app grows.
contextBridge.exposeInMainWorld('app', {
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    onState: (cb) => sub('window:state', cb),
  },
  config: {
    get: (key) => ipcRenderer.invoke('config:get', key),
    set: (key, value) => ipcRenderer.invoke('config:set', key, value),
  },
  ping: () => ipcRenderer.invoke('demo:ping'),
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  setLang: (code) => ipcRenderer.invoke('app:set-lang', code),

  // auto-update (cloned from Umbra's bridge `updates`)
  updates: {
    status: () => ipcRenderer.invoke('updates:status'),
    check: () => ipcRenderer.invoke('updates:check'),
    install: () => ipcRenderer.invoke('updates:install'),
    onStatus: (cb) => sub('updates:status', cb),
  },

  // WDL trainer — drives the game's Lua VM through the main process (koffi lives there).
  trainer: {
    catalog: () => ipcRenderer.invoke('trainer:catalog'),
    status: () => ipcRenderer.invoke('trainer:status'),
    attach: () => ipcRenderer.invoke('trainer:attach'),
    exec: (id, state) => ipcRenderer.invoke('trainer:exec', { id, state }),
    lua: (code) => ipcRenderer.invoke('trainer:lua', code),
    onHotkeyFired: (cb) => sub('trainer:hotkey-fired', cb),
    onDisconnected: (cb) => sub('trainer:disconnected', cb),   // game closed → main reset toggles/loops
  },

  // global hotkeys — free assignment, persisted in main
  hotkeys: {
    get: () => ipcRenderer.invoke('hotkeys:get'),
    set: (id, accel) => ipcRenderer.invoke('hotkeys:set', id, accel),
  },
});

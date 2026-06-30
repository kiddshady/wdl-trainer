'use strict';

/**
 * Auto-update — electron-updater against the public GitHub releases repo (kiddshady/wdl-trainer).
 *
 * Polls for new releases shortly after boot, then every few hours, downloads them quietly, and
 * applies on a real quit (autoInstallOnAppQuit) or via the explicit "Reiniciar y actualizar"
 * button in Settings / the update toast.
 *
 * In dev (unpacked) there is no app-update.yml, so this reports { state: 'dev' } and every
 * operation is a no-op — the Settings section explains itself. (Cloned from Umbra's core/updater.js.)
 */

const { app } = require('electron');

const FIRST_CHECK_DELAY_MS = 15 * 1000;
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

let autoUpdater = null;
let onStatus = () => {};
let status = { state: 'idle', current: app.getVersion(), version: null, pct: 0, error: null, checkedAt: null };

function set(patch) { status = { ...status, ...patch }; onStatus(status); }

function init(opts = {}) {
  onStatus = opts.onStatus || (() => {});
  if (!app.isPackaged) { status.state = 'dev'; return; }

  ({ autoUpdater } = require('electron-updater'));
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => set({ state: 'checking', error: null }));
  autoUpdater.on('update-available', (info) => set({ state: 'downloading', version: info.version, pct: 0 }));
  autoUpdater.on('update-not-available', () => set({ state: 'idle', version: null, checkedAt: Date.now() }));
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', pct: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', (info) => set({ state: 'ready', version: info.version, pct: 100 }));
  autoUpdater.on('error', (err) => set({ state: 'error', error: (err && err.message) || String(err) }));

  setTimeout(check, FIRST_CHECK_DELAY_MS);
  const timer = setInterval(check, CHECK_EVERY_MS);
  if (timer.unref) timer.unref();
}

function check() {
  if (autoUpdater && status.state !== 'downloading' && status.state !== 'ready') {
    autoUpdater.checkForUpdates().catch(() => { /* surfaced via the 'error' event */ });
  }
  return status;
}

function getStatus() { return status; }

function quitAndInstall() {
  if (!autoUpdater || status.state !== 'ready') return false;
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
  return true;
}

module.exports = { init, check, getStatus, quitAndInstall };

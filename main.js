'use strict';

const { app, BrowserWindow, ipcMain, screen, globalShortcut } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const updater = require('./core/updater');

let mainWindow = null;

// --- WDL trainer engine (koffi). engine.mjs/cheats.mjs are ESM; load lazily from CJS main. ---
let engine = null;            // attached engine instance, or null when not connected
let trainer = null;           // { attach, byId, CHEATS }
const toggleState = {};       // id -> bool — authoritative toggle state (so hotkeys can flip it)
const hotkeys = {};           // id -> accelerator string, currently registered
async function loadTrainer() {
  if (!trainer) {
    const [eng, cat] = await Promise.all([import('./engine.mjs'), import('./cheats.mjs')]);
    trainer = { attach: eng.attach, byId: cat.byId, CHEATS: cat.CHEATS };
  }
  return trainer;
}

function notify(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

// Fire a cheat by id (used by both clicks and global hotkeys). Toggles flip their stored state.
async function fireCheat(id) {
  if (!engine) { notify('trainer:hotkey-fired', { id, ok: false, error: 'No conectado al juego.' }); return; }
  try {
    const { byId } = await loadTrainer();
    const c = byId(id);
    if (!c) return;
    if (c.kind === 'toggle') {
      const next = !toggleState[id];
      engine.exec(next ? c.on : c.off);
      toggleState[id] = next;
      notify('trainer:hotkey-fired', { id, kind: 'toggle', on: next, ok: true });
    } else {
      engine.exec(c.run);
      notify('trainer:hotkey-fired', { id, kind: 'action', ok: true });
    }
  } catch (e) { engine = null; notify('trainer:hotkey-fired', { id, ok: false, error: e.message }); }
}

// Register/replace/clear a global hotkey for a cheat. accel=null clears it.
function applyHotkey(id, accel) {
  const old = hotkeys[id];
  if (old) { try { globalShortcut.unregister(old); } catch { /* ignore */ } delete hotkeys[id]; }
  if (!accel) return { ok: true };
  // if this accelerator is already mapped to another cheat, free it first (one key, one cheat)
  for (const [oid, a] of Object.entries(hotkeys)) {
    if (a === accel) { try { globalShortcut.unregister(a); } catch { /* ignore */ } delete hotkeys[oid]; }
  }
  let ok = false;
  try { ok = globalShortcut.register(accel, () => fireCheat(id)); } catch { ok = false; }
  if (!ok) return { ok: false, error: `No se pudo registrar "${accel}" (¿ya lo usa el sistema u otra app?)` };
  hotkeys[id] = accel;
  return { ok: true };
}

function loadHotkeys() {
  const saved = readConfig().hotkeys || {};
  for (const [id, accel] of Object.entries(saved)) applyHotkey(id, accel);
}

// --- tiny JSON config store (userData/config.json) — the starter's persistence layer ---
function configPath() { return path.join(app.getPath('userData'), 'config.json'); }
function readConfig() { try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch { return {}; } }
function writeConfig(obj) {
  try { fs.mkdirSync(path.dirname(configPath()), { recursive: true }); fs.writeFileSync(configPath(), JSON.stringify(obj, null, 2)); }
  catch { /* best-effort */ }
}

function createWindow() {
  const WIN_W = 1100, WIN_H = 760;
  const { x: waX, y: waY, width: waW, height: waH } = screen.getPrimaryDisplay().workArea;
  const winX = Math.round(waX + (waW - WIN_W) / 2);
  const winY = Math.round(waY + (waH - WIN_H) / 2);

  mainWindow = new BrowserWindow({
    // Anti-flash (Umbra's validated trick): create OFF-SCREEN so the Windows DWM compositor
    // flash on the first show() happens where the user can't see it, then snap to centre.
    x: -20000, y: -20000,
    width: WIN_W, height: WIN_H,
    minWidth: 820, minHeight: 560,
    frame: false,                 // frameless — the titlebar is drawn in the renderer
    backgroundColor: '#0e0f12',   // matches --u-bg so there's no white frame before paint
    icon: path.join(__dirname, 'build', 'icon.png'),
    show: false,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();            // the DWM flash fires here — off-screen, invisible
    setTimeout(() => {            // let DWM settle before moving (200ms is the cross-app sweet spot)
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setPosition(winX, winY);
    }, 200);
  });

  mainWindow.on('maximize', () => mainWindow.webContents.send('window:state', { maximized: true }));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:state', { maximized: false }));
  mainWindow.on('closed', () => { mainWindow = null; });
}

function registerIpc() {
  // --- window controls (the frameless titlebar's buttons call these) ---
  ipcMain.handle('window:minimize', () => mainWindow && mainWindow.minimize());
  ipcMain.handle('window:toggle-maximize', () => {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize();
    return mainWindow.isMaximized();
  });
  ipcMain.handle('window:close', () => mainWindow && mainWindow.close());

  // --- config persistence ---
  ipcMain.handle('config:get', (_e, key) => { const c = readConfig(); return key == null ? c : c[key]; });
  ipcMain.handle('config:set', (_e, key, value) => { const c = readConfig(); c[key] = value; writeConfig(c); return true; });

  // --- WDL trainer: catalog + attach + exec, bridged to the renderer ---
  ipcMain.handle('trainer:catalog', async () => {
    const { CHEATS } = await loadTrainer();
    return CHEATS.map(({ id, label, kind }) => ({ id, label, kind }));
  });
  ipcMain.handle('trainer:status', () => ({ attached: !!engine, info: engine ? engine.info : null, toggles: { ...toggleState } }));
  ipcMain.handle('trainer:attach', async () => {
    try {
      const { attach } = await loadTrainer();
      if (engine) { try { engine.close(); } catch { /* ignore */ } }
      engine = attach();                       // discover + AOB-scan + resolve (blocks ~1-2s)
      return { ok: true, info: engine.info };
    } catch (e) { engine = null; return { ok: false, error: e.message }; }
  });
  ipcMain.handle('trainer:exec', async (_e, { id, state }) => {
    if (!engine) return { ok: false, error: 'No conectado al juego.' };
    try {
      const { byId } = await loadTrainer();
      const c = byId(id);
      if (!c) return { ok: false, error: `cheat desconocido: ${id}` };
      if (c.kind === 'toggle') { engine.exec(state === 'off' ? c.off : c.on); toggleState[id] = state !== 'off'; }
      else engine.exec(c.run);
      return { ok: true };
    } catch (e) { engine = null; return { ok: false, error: e.message }; }   // drop on failure → UI reflects disconnect
  });
  ipcMain.handle('trainer:lua', async (_e, code) => {
    if (!engine) return { ok: false, error: 'No conectado al juego.' };
    try { engine.exec(String(code || '')); return { ok: true }; }
    catch (e) { engine = null; return { ok: false, error: e.message }; }
  });

  // --- global hotkeys: free user assignment, persisted ---
  ipcMain.handle('hotkeys:get', () => ({ ...hotkeys }));
  ipcMain.handle('hotkeys:set', (_e, id, accel) => {
    const r = applyHotkey(id, accel || null);
    if (r.ok) { const c = readConfig(); c.hotkeys = { ...hotkeys }; writeConfig(c); return { ok: true, hotkeys: { ...hotkeys } }; }
    return r;
  });

  // --- app version + auto-update (electron-updater, cloned from Umbra) ---
  ipcMain.handle('app:getVersion', () => app.getVersion());
  ipcMain.handle('updates:status', () => updater.getStatus());
  ipcMain.handle('updates:check', () => updater.check());
  ipcMain.handle('updates:install', () => updater.quitAndInstall());

  // --- a demo round-trip so you can see the IPC bridge working end to end ---
  ipcMain.handle('demo:ping', () => `pong @ ${new Date().toLocaleTimeString()}`);
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  loadHotkeys();
  updater.init({ onStatus: (s) => notify('updates:status', s) });
});
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => { globalShortcut.unregisterAll(); });

'use strict';

const { app, BrowserWindow, ipcMain, screen, globalShortcut, Tray, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const updater = require('./core/updater');
const flight = require('./core/flightlog');   // JSONL trace to diagnose the random "se cierra limpio" on spawns

let mainWindow = null;
let tray = null;
let isQuitting = false;
let lang = 'en';              // UI language for the tray labels (mirrors config.language)

// --- WDL trainer engine (koffi). engine.mjs/cheats.mjs are ESM; load lazily from CJS main. ---
let engine = null;            // attached engine instance, or null when not connected
let trainer = null;           // { attach, byId, CHEATS }
const toggleState = {};       // id -> bool — authoritative toggle state (so hotkeys can flip it)
const hotkeys = {};           // id -> accelerator string, currently registered
const loops = {};             // id -> setInterval handle for 'loop' cheats (auto-repeat, e.g. infinite ammo)
let watchdog = null;          // setInterval handle — passively polls the game's liveness while attached
let cooldownUntil = 0;        // ms timestamp — serialize commands + a brief per-kind settle (avoids spawn crashes)
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
// One command at a time, with a brief per-kind cooldown after each — so a spawn (heavier Lua)
// can't be raced by another command (the main cause of spawn crashes). Returns { ok:false, busy:true }
// when something is already in its settle window.
const COOLDOWN_MS = { toggle: 70, lua: 120, action: 160, loop: 100 };
function gateExec(kind, run) {
  if (Date.now() < cooldownUntil) return { ok: false, busy: true };
  try {
    const r = run();                                       // engine.exec is synchronous (blocks the thread)
    cooldownUntil = Date.now() + (COOLDOWN_MS[kind] || 140);
    return r;
  } catch (e) { handleDisconnect('error'); return { ok: false, error: e.message }; } // tear down NOW, don't wait for the watchdog
}

// Heavy spawns run on the game's OWN thread via the per-frame hook (no foreign-thread race → no
// crash). Everything else, and any spawn where the hook isn't available (unknown build / in a menu),
// falls back to the normal foreign-thread exec(). Both go through gateExec so they stay serialized.
function execCheat(c) {
  // Heavy spawns run ONLY on the game thread (per-frame hook). If the hook can't fire — game paused, not
  // in-world, or momentarily not ticking — SKIP the spawn instead of falling back to engine.exec(): a heavy
  // SpawnEntityFromArchetype on a foreign thread is exactly the clean-close crash, and spawning into a
  // paused/transitioning world is pointless anyway. Returns a result so the UI can say why nothing appeared.
  if (/SpawnEntityFromArchetype/.test(c.run)) {
    if (!engine.spawnOnMainThread) { flight.log('spawn.skip', { id: c.id, reason: 'no hook support' }); return { ok: false, error: 'Spawns necesitan el hook del hilo del juego (build no soportado).' }; }
    const r = engine.spawnOnMainThread(c.run);
    flight.log('spawn', { id: c.id, ok: r.ok, reason: r.reason });
    if (r.ok) return { ok: true };                         // ran safely on the game thread
    return { ok: false, error: 'Spawn omitido — el juego tiene que estar activo y sin pausa. Usá el hotkey mientras jugás.' };
  }
  flight.log('exec', { id: c.id });
  engine.exec(c.run);                                      // light cheats + non-spawn actions (single Lua call, safe on a foreign thread)
  return { ok: true };
}

// --- 'loop' cheats: while ON, re-fire `c.run` every c.intervalMs through the same gate as manual
// commands, so a refill tick can never race a heavier spawn (the known crash cause). The Lua is
// pre-injected ONCE via engine.prepare(); each tick only relaunches the thread — no per-tick
// alloc/free and no per-tick use-after-free window. A tick dropped as "busy" is harmless. ---
function startLoop(c) {
  if (loops[c.id]) return;                                 // already running
  let cmd;
  // Prefer the game-thread hook: keep the shared per-frame hook resident and only ARM the mailbox each
  // tick — no foreign-thread CreateRemoteThread, so the refill can't race the frame (removes the
  // accumulating "closes over time" crash). Falls back to the foreign-thread loop (engine.prepare) only
  // when the build has no usable hook site, so the feature degrades gracefully instead of failing.
  try { cmd = engine.prepareMainThreadLoop(c.run); flight.log('loop.start', { id: c.id, path: 'mainthread' }); }  // game-thread loop (crash-free)
  catch (e) {
    try { cmd = engine.prepare(c.run); flight.log('loop.start', { id: c.id, path: 'foreign' }); }  // no hook site → foreign-thread loop fallback
    catch (e2) { notify('trainer:hotkey-fired', { id: c.id, ok: false, error: e2.message }); return; }
  }
  const tick = () => {
    if (!engine) return handleDisconnect('error');         // engine gone → full teardown
    const r = gateExec('loop', () => { cmd.fire(); return { ok: true }; });
    if (!r.ok && r.error) handleDisconnect('error');       // fire threw → gate tore down; finish here
  };
  loops[c.id] = { interval: setInterval(tick, c.intervalMs || 500), cmd };
  toggleState[c.id] = true;
  tick();                                                  // first refill immediately, not after a full interval
}
function stopLoop(id) {
  const l = loops[id];
  if (l) { clearInterval(l.interval); try { l.cmd.dispose(); } catch { /* ignore */ } delete loops[id]; }
  toggleState[id] = false;
}
function stopAllLoops() { for (const id of Object.keys(loops)) stopLoop(id); }

// --- liveness watchdog: while attached, passively poll the game every 1.5s (a cheap RPM, no thread
// injection). The moment the game closes — or a command already nulled the engine — tear everything
// down: stop loops, flip every toggle OFF, drop the engine, and tell the renderer to re-sync. ---
function startWatchdog() {
  if (watchdog) return;
  watchdog = setInterval(() => {
    if (!engine) return handleDisconnect('error');         // a command already failed → finish cleanup
    if (!engine.alive()) handleDisconnect('closed');       // game process is gone
  }, 1500);
}
function stopWatchdog() { if (watchdog) { clearInterval(watchdog); watchdog = null; } }

// idempotent: callable from the watchdog, a failed command, or a dying loop — runs the teardown once.
function handleDisconnect(reason) {
  if (!engine && !watchdog) return;                        // already disconnected
  flight.log('DISCONNECT', { reason: reason || 'closed' }); // the lines just above this say what killed the game
  stopWatchdog();
  stopAllLoops();
  for (const id of Object.keys(toggleState)) toggleState[id] = false;
  if (engine) { try { engine.close(); } catch { /* ignore */ } engine = null; }
  notify('trainer:disconnected', { reason: reason || 'closed', toggles: { ...toggleState } });
}

async function fireCheat(id) {
  if (!engine) { notify('trainer:hotkey-fired', { id, ok: false, error: 'No conectado al juego.' }); return; }
  const { byId } = await loadTrainer();
  const c = byId(id);
  if (!c) return;
  if (c.kind === 'loop') {                                  // hotkey flips the loop on/off (renders as a toggle)
    const next = !loops[id];
    if (next) startLoop(c); else stopLoop(id);
    notify('trainer:hotkey-fired', { id, ok: true, kind: 'toggle', on: next });
    return;
  }
  const r = gateExec(c.kind, () => {
    if (c.kind === 'toggle') { const next = !toggleState[id]; engine.exec(next ? c.on : c.off); toggleState[id] = next; return { ok: true, kind: 'toggle', on: next }; }
    return { ...execCheat(c), kind: 'action' };
  });
  notify('trainer:hotkey-fired', { id, ...r });
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
  mainWindow.on('close', (e) => { if (!isQuitting && tray) { e.preventDefault(); mainWindow.hide(); } }); // close → tray (only if the tray exists)
  mainWindow.on('closed', () => { mainWindow = null; });
}

// show / restore / focus the window (from the tray, a second launch, or dock activate)
function showWindow() {
  if (!mainWindow) { createWindow(); return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// system tray — close-to-tray keeps the app (and its global hotkeys) alive in the background
const TRAY_LABELS = {
  en: { show: 'Show wdl-trainer', quit: 'Quit' },
  es: { show: 'Mostrar wdl-trainer', quit: 'Salir' },
};
function trayMenu() {
  const L = TRAY_LABELS[lang] || TRAY_LABELS.en;
  return Menu.buildFromTemplate([
    { label: L.show, click: showWindow },
    { type: 'separator' },
    { label: L.quit, click: () => { isQuitting = true; app.quit(); } },
  ]);
}
function createTray() {
  if (tray) return;
  try {
    // build/icon.ico (multi-size) is crisper in the Windows tray than a scaled png.
    // build/ is electron-builder's buildResources dir, so it's only inside the package because
    // we list build/icon.* explicitly in `files` — otherwise the tray icon goes missing.
    tray = new Tray(path.join(__dirname, 'build', 'icon.ico'));
    tray.setToolTip('wdl-trainer');
    tray.setContextMenu(trayMenu());
    tray.on('click', showWindow);
  } catch (e) { tray = null; /* tray unavailable → close will quit instead of hiding (no zombie) */ }
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
    return CHEATS.map(({ id, label, kind, section }) => ({ id, label, kind, section }));
  });
  ipcMain.handle('trainer:status', () => ({ attached: !!engine, info: engine ? engine.info : null, toggles: { ...toggleState } }));
  ipcMain.handle('trainer:attach', async () => {
    try {
      const { attach } = await loadTrainer();
      stopWatchdog();                          // pause liveness checks across the handle swap (no false disconnect)
      stopAllLoops();                          // drop loops bound to the old handle
      for (const id of Object.keys(toggleState)) toggleState[id] = false;  // fresh session → clean toggle state (renderer re-syncs via status)
      if (engine) { try { engine.close(); } catch { /* ignore */ } }
      engine = attach({ log: flight.log });    // discover + AOB-scan + resolve (blocks ~1-2s)
      // spawnHook null here = the game-thread hook did NOT resolve → every spawn falls back to the
      // crash-prone foreign thread. The first thing to check in the log after a close.
      flight.log('attach', { pid: engine.info.pid, module: engine.info.module, spawnHook: engine.info.spawnHook, execAddr: engine.info.execAddr, singletonPtr: engine.info.singletonPtr });
      startWatchdog();                         // from here on, auto-detect the game closing
      return { ok: true, info: engine.info };
    } catch (e) { engine = null; stopWatchdog(); return { ok: false, error: e.message }; }
  });
  ipcMain.handle('trainer:exec', async (_e, { id, state }) => {
    if (!engine) return { ok: false, error: 'No conectado al juego.' };
    const { byId } = await loadTrainer();
    const c = byId(id);
    if (!c) return { ok: false, error: `cheat desconocido: ${id}` };
    if (c.kind === 'loop') {                                // start/stop the repeat timer (not a single exec)
      if (state === 'off') stopLoop(id); else startLoop(c);
      return { ok: true };
    }
    return gateExec(c.kind, () => {
      if (c.kind === 'toggle') { const on = state !== 'off'; engine.exec(on ? c.on : c.off); toggleState[id] = on; return { ok: true, on }; }
      return execCheat(c);
    });
  });
  ipcMain.handle('trainer:lua', async (_e, code) => {
    if (!engine) return { ok: false, error: 'No conectado al juego.' };
    return gateExec('lua', () => { engine.exec(String(code || '')); return { ok: true }; });
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
  ipcMain.handle('app:set-lang', (_e, code) => { lang = code === 'es' ? 'es' : 'en'; if (tray) tray.setContextMenu(trayMenu()); return true; });
  ipcMain.handle('updates:status', () => updater.getStatus());
  ipcMain.handle('updates:check', () => updater.check());
  ipcMain.handle('updates:install', () => updater.quitAndInstall());

  // --- a demo round-trip so you can see the IPC bridge working end to end ---
  ipcMain.handle('demo:ping', () => `pong @ ${new Date().toLocaleTimeString()}`);
}

// single instance — a second launch just focuses the running window instead of opening another
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  app.whenReady().then(() => {
    registerIpc();
    flight.init(path.join(app.getPath('userData'), 'logs'), { version: app.getVersion() });
    createWindow();
    lang = readConfig().language === 'es' ? 'es' : 'en';
    createTray();
    loadHotkeys();
    updater.init({ onStatus: (s) => notify('updates:status', s) });
  });

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); else showWindow(); });
  app.on('window-all-closed', () => { /* stay alive in the tray — quit only via the tray menu */ });
  app.on('before-quit', () => { isQuitting = true; });
  app.on('will-quit', () => { stopWatchdog(); stopAllLoops(); globalShortcut.unregisterAll(); });
}

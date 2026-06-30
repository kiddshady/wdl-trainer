import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Toggle, Icon } from '@penumbra/ui';
import { playOn, playOff } from './sound.js';

/**
 * The trainer island. Cheats (served by main) render as rows: icon · label · hotkey chip · control.
 * Toggles use Penumbra's Toggle; actions are "Lanzar" buttons; every cheat can take a free,
 * user-assigned GLOBAL hotkey (works inside the game). Console runs any Lua string.
 */

const ICON = {
  godmode: 'shield', nodetect: 'eye-off', nofelony: 'alert-triangle',
  endchase: 'rotate-ccw', moto: 'target', auto: 'target', sergei: 'robot', racedrone: 'zap',
};

// Browser KeyboardEvent -> Electron Accelerator string (or null to keep waiting / ignore).
function eventToAccelerator(e) {
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return null; // wait for a real key
  const mods = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');
  const code = e.code || '', k = e.key || '';
  let key = null;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);                 // KeyG -> G
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);          // Digit5 -> 5
  else if (/^Numpad[0-9]$/.test(code)) key = 'num' + code.slice(6); // Numpad5 -> num5
  else if (/^F\d{1,2}$/.test(k)) key = k;                           // F1..F24
  else {
    const map = {
      ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
      ' ': 'Space', Enter: 'Return', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete',
      Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', '+': 'Plus',
    };
    if (k in map) key = map[k];
    else if (k.length === 1) key = k.toUpperCase();
  }
  return key ? [...mods, key].join('+') : null;
}

function Trainer() {
  const [catalog, setCatalog] = useState([]);
  const [attached, setAttached] = useState(false);
  const [info, setInfo] = useState(null);
  const [toggles, setToggles] = useState({});
  const [bindings, setBindings] = useState({});
  const [capturing, setCapturing] = useState(null);   // cheat id currently capturing a key, or null
  const [busy, setBusy] = useState(false);
  const [lua, setLua] = useState('');
  const [log, setLog] = useState('Listo. Abrí el juego y conectá.');

  async function refresh() {
    const s = await window.app.trainer.status();
    setAttached(s.attached);
    setInfo(s.info);
    if (s.toggles) setToggles(s.toggles);
    return s;
  }

  async function connect() {
    setBusy(true);
    setLog('Conectando al juego…');
    const r = await window.app.trainer.attach();
    setBusy(false);
    if (r.ok) { setAttached(true); setInfo(r.info); setLog(`Conectado — pid ${r.info.pid}`); }
    else { setAttached(false); setInfo(null); setLog('✗ ' + r.error); }
  }

  useEffect(() => {
    (async () => {
      setCatalog(await window.app.trainer.catalog());
      setBindings(await window.app.hotkeys.get());
      const s = await refresh();
      if (!s.attached) connect();
    })();
    // reflect hotkey-driven changes (they can fire while the window is in the background)
    const off = window.app.trainer.onHotkeyFired((p) => {
      if (!p) return;
      if (p.ok && p.kind === 'toggle') { (p.on ? playOn : playOff)(); setToggles((t) => ({ ...t, [p.id]: p.on })); setLog(`${p.id} (atajo) → ${p.on ? 'ON' : 'OFF'}`); }
      else if (p.ok) setLog(`${p.id} (atajo) → ✓`);
      else { setLog('✗ ' + (p.error || 'atajo')); refresh(); }
    });
    return off;
  }, []);

  // key-capture mode for assigning a hotkey
  useEffect(() => {
    if (!capturing) return;
    function onKey(e) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { setCapturing(null); return; }
      const accel = eventToAccelerator(e);
      if (!accel) return;                       // modifier-only / unsupported — keep waiting
      bindHotkey(capturing, accel);
      setCapturing(null);
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturing]);

  async function bindHotkey(id, accel) {
    const r = await window.app.hotkeys.set(id, accel);
    if (r.ok) { setBindings(r.hotkeys); setLog(accel ? `atajo ${accel} → ${id}` : `atajo quitado de ${id}`); }
    else setLog('✗ ' + r.error);
  }

  async function onToggle(id, next) {
    setToggles((t) => ({ ...t, [id]: next }));
    const r = await window.app.trainer.exec(id, next ? 'on' : 'off');
    if (r.ok) { (next ? playOn : playOff)(); setLog(`${id} → ${next ? 'ON' : 'OFF'}`); }
    else { setToggles((t) => ({ ...t, [id]: !next })); setLog('✗ ' + r.error); refresh(); }
  }

  async function onAction(id) {
    const r = await window.app.trainer.exec(id);
    setLog(r.ok ? `${id} → ✓` : '✗ ' + r.error);
    if (!r.ok) refresh();
  }

  async function onRunLua() {
    if (!lua.trim()) return;
    const r = await window.app.trainer.lua(lua);
    setLog(r.ok ? `lua ✓  ${lua.replace(/\s+/g, ' ').slice(0, 80)}` : '✗ ' + r.error);
    if (!r.ok) refresh();
  }

  function renderRow(c) {
    const accel = bindings[c.id];
    const cap = capturing === c.id;
    return (
      <div className="trn-row" key={c.id}>
        <Icon name={ICON[c.id] ?? 'check'} size={16} />
        <span className="trn-label">{c.label}</span>
        <button
          className={'trn-key' + (cap ? ' capturing' : accel ? ' bound' : '')}
          onClick={() => setCapturing(cap ? null : c.id)}
          title="Asignar atajo global"
        >
          {cap ? 'presioná…' : accel || '＋ atajo'}
        </button>
        {accel && !cap && (
          <button className="trn-key-clear" title="Quitar atajo" onClick={() => bindHotkey(c.id, null)}>
            <Icon name="x" size={12} />
          </button>
        )}
        {c.kind === 'toggle' ? (
          <Toggle on={!!toggles[c.id]} onChange={(n) => onToggle(c.id, n)} disabled={!attached} />
        ) : (
          <button className="btn trn-fire" onClick={() => onAction(c.id)} disabled={!attached}>
            <Icon name="play" size={13} /> Lanzar
          </button>
        )}
      </div>
    );
  }

  const toggleCheats = catalog.filter((c) => c.kind === 'toggle');
  const actionCheats = catalog.filter((c) => c.kind === 'action');

  return (
    <div className="trainer">
      <div className="trn-status">
        <span className={'dot ' + (attached ? 'on' : 'off')} />
        <span className="trn-status-text">
          {attached ? `Conectado · ${info?.module ?? ''} · pid ${info?.pid ?? ''}` : 'Sin conexión al juego'}
        </span>
        <button className="btn" onClick={connect} disabled={busy}>
          <Icon name="plug" size={14} /> {busy ? 'Conectando…' : attached ? 'Reconectar' : 'Conectar'}
        </button>
      </div>

      <p className="trn-note">Tip: los atajos son globales y funcionan dentro del juego. Usá F1–F12 o el Numpad para no pisar tus controles.</p>

      <section className="trn-section">
        <h3>Toggles</h3>
        <div className="trn-list">{toggleCheats.map(renderRow)}</div>
      </section>

      <section className="trn-section">
        <h3>Acciones y spawns <span className="trn-sub">— apuntá con la retícula para los spawns</span></h3>
        <div className="trn-list">{actionCheats.map(renderRow)}</div>
      </section>

      <section className="trn-section">
        <h3>Consola Lua</h3>
        <textarea
          className="trn-lua"
          value={lua}
          onChange={(e) => setLua(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onRunLua(); } }}
          placeholder={'cualquier Lua del juego — ej:\nSetInvincibility(1)\nSetCanBeDetected(GetLocalPlayerEntityId(), 0)'}
          spellCheck={false}
          disabled={!attached}
        />
        <div className="trn-lua-row">
          <button className="btn primary" onClick={onRunLua} disabled={!attached}>
            <Icon name="play" size={14} /> Ejecutar <span className="trn-kbd">Ctrl·Enter</span>
          </button>
        </div>
      </section>

      <p className="trn-log">{log}</p>
      <p className="trn-credit">by Kidd Shady</p>
    </div>
  );
}

let root = null;
export function mount(el) { root = createRoot(el); root.render(<Trainer />); }
export function unmount() { if (root) { root.unmount(); root = null; } }

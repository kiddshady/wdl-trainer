import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Toggle, Icon } from '@penumbra/ui';
import { playOn, playOff } from './sound.js';
import { useT } from './lib/i18n.js';

/**
 * The trainer island. Cheats (served by main) render as rows: icon · label · hotkey chip · control.
 * Toggles use Penumbra's Toggle; actions are "Fire" buttons; every cheat can take a free, user-assigned
 * GLOBAL hotkey (works inside the game). Console runs any Lua string. All strings go through useT().
 */

const ICON = {
  godmode: 'shield', nodetect: 'eye-off', nofelony: 'alert-triangle', infammo: 'flame',
  moto: 'target', auto: 'target', sergei: 'robot', racedrone: 'zap', dedsecshop: 'database',
  bulletrefill: 'plus', distract: 'bell', disrupt: 'radio', endchase: 'rotate-ccw',
};

// Browser KeyboardEvent -> Electron Accelerator string (or null to keep waiting / ignore).
function eventToAccelerator(e) {
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return null;
  const mods = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');
  const code = e.code || '', k = e.key || '';
  let key = null;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
  else if (/^Numpad[0-9]$/.test(code)) key = 'num' + code.slice(6);
  else if (/^F\d{1,2}$/.test(k)) key = k;
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
  const t = useT();
  const [catalog, setCatalog] = useState([]);
  const [attached, setAttached] = useState(false);
  const [info, setInfo] = useState(null);
  const [toggles, setToggles] = useState({});
  const [bindings, setBindings] = useState({});
  const [capturing, setCapturing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [lua, setLua] = useState('');
  const [log, setLog] = useState('');

  const cheatName = (id) => t('cheat.' + id);

  async function refresh() {
    const s = await window.app.trainer.status();
    setAttached(s.attached);
    setInfo(s.info);
    if (s.toggles) setToggles(s.toggles);
    return s;
  }

  async function connect() {
    setBusy(true);
    setLog(t('log.connecting'));
    const r = await window.app.trainer.attach();
    setBusy(false);
    if (r.ok) { setAttached(true); setInfo(r.info); setLog(t('log.connected', { pid: r.info.pid })); }
    else { setAttached(false); setInfo(null); setLog('✗ ' + r.error); }
  }

  useEffect(() => {
    setLog(t('log.ready'));
    (async () => {
      setCatalog(await window.app.trainer.catalog());
      setBindings(await window.app.hotkeys.get());
      const s = await refresh();
      if (!s.attached) connect();
    })();
    const offHotkey = window.app.trainer.onHotkeyFired((p) => {
      if (!p) return;
      if (p.busy) { setLog(t('log.busyHotkey', { id: cheatName(p.id) })); return; }
      if (p.ok && p.kind === 'toggle') { (p.on ? playOn : playOff)(); setToggles((t2) => ({ ...t2, [p.id]: p.on })); setLog(`${cheatName(p.id)} → ${p.on ? 'ON' : 'OFF'}`); }
      else if (p.ok) { playOn(); setLog(`${cheatName(p.id)} → ✓`); }
      else { setLog('✗ ' + (p.error || 'hotkey')); refresh(); }
    });
    // game closed (or the engine dropped): main already reset everything — re-sync the UI to OFF.
    const offDisc = window.app.trainer.onDisconnected((p) => {
      playOff();
      setAttached(false);
      setInfo(null);
      setToggles(p?.toggles ?? {});
      setLog(t('log.gameClosed'));
    });
    return () => { offHotkey(); offDisc(); };
  }, []);

  useEffect(() => {
    if (!capturing) return;
    function onKey(e) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { setCapturing(null); return; }
      const accel = eventToAccelerator(e);
      if (!accel) return;
      bindHotkey(capturing, accel);
      setCapturing(null);
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturing]);

  async function bindHotkey(id, accel) {
    const r = await window.app.hotkeys.set(id, accel);
    if (r.ok) { setBindings(r.hotkeys); setLog(accel ? `${cheatName(id)} → ${accel}` : `${cheatName(id)} ✕`); }
    else setLog('✗ ' + r.error);
  }

  async function onToggle(id, next) {
    setToggles((tg) => ({ ...tg, [id]: next }));
    const r = await window.app.trainer.exec(id, next ? 'on' : 'off');
    if (r.ok) { (next ? playOn : playOff)(); setLog(`${cheatName(id)} → ${next ? 'ON' : 'OFF'}`); }
    else { setToggles((tg) => ({ ...tg, [id]: !next })); if (r.busy) setLog(t('log.busy')); else { setLog('✗ ' + r.error); refresh(); } }
  }

  async function onAction(id) {
    const r = await window.app.trainer.exec(id);
    if (r.ok) { playOn(); setLog(`${cheatName(id)} → ✓`); }
    else if (r.busy) setLog(t('log.busy'));
    else { setLog('✗ ' + r.error); refresh(); }
  }

  async function onRunLua() {
    if (!lua.trim()) return;
    const r = await window.app.trainer.lua(lua);
    if (r.ok) { playOn(); setLog(`Lua ✓  ${lua.replace(/\s+/g, ' ').slice(0, 80)}`); }
    else if (r.busy) setLog(t('log.busy'));
    else { setLog('✗ ' + r.error); refresh(); }
  }

  function renderRow(c) {
    const accel = bindings[c.id];
    const cap = capturing === c.id;
    return (
      <div className="trn-row" key={c.id}>
        <Icon name={ICON[c.id] ?? 'check'} size={16} />
        <span className="trn-label">{cheatName(c.id)}</span>
        <button
          className={'trn-key' + (cap ? ' capturing' : accel ? ' bound' : '')}
          onClick={() => setCapturing(cap ? null : c.id)}
          title={t('hotkey.assign')}
        >
          {cap ? t('hotkey.capturing') : accel || t('hotkey.add')}
        </button>
        {accel && !cap && (
          <button className="trn-key-clear" title={t('hotkey.clear')} onClick={() => bindHotkey(c.id, null)}>
            <Icon name="x" size={12} />
          </button>
        )}
        {c.kind === 'toggle' || c.kind === 'loop' ? (   // loops are on/off too — render the same Toggle
          <Toggle on={!!toggles[c.id]} onChange={(n) => onToggle(c.id, n)} disabled={!attached} />
        ) : (
          <button className="btn trn-fire" onClick={() => onAction(c.id)} disabled={!attached}>
            <Icon name="play" size={13} /> {t('btn.fire')}
          </button>
        )}
      </div>
    );
  }

  const sectionOf = (c) => c.section || (c.kind === 'toggle' ? 'toggles' : 'actions');
  const group = (s) => catalog.filter((c) => sectionOf(c) === s).sort((a, b) => cheatName(a.id).localeCompare(cheatName(b.id)));
  const toggleCheats = group('toggles');
  const spawnCheats = group('spawns');
  const actionCheats = group('actions');

  return (
    <div className="trainer">
      <div className="trn-status">
        <span className={'dot ' + (attached ? 'on' : 'off')} />
        <span className="trn-status-text">
          {attached ? t('status.connected', { module: info?.module ?? '', pid: info?.pid ?? '' }) : t('status.disconnected')}
        </span>
        <button className="btn" onClick={connect} disabled={busy}>
          <Icon name="plug" size={14} /> {busy ? t('btn.connecting') : attached ? t('btn.reconnect') : t('btn.connect')}
        </button>
      </div>

      <p className="trn-note">{t('tip.hotkeys')}</p>

      <section className="trn-section">
        <h3>{t('section.toggles')}</h3>
        <div className="trn-list">{toggleCheats.map(renderRow)}</div>
      </section>

      <section className="trn-section">
        <h3>{t('section.spawns')} <span className="trn-sub">{t('section.spawns.sub')}</span></h3>
        <div className="trn-list">{spawnCheats.map(renderRow)}</div>
      </section>

      <section className="trn-section">
        <h3>{t('section.actions')}</h3>
        <div className="trn-list">{actionCheats.map(renderRow)}</div>
      </section>

      <section className="trn-section">
        <h3>{t('section.console')}</h3>
        <textarea
          className="trn-lua"
          value={lua}
          onChange={(e) => setLua(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onRunLua(); } }}
          placeholder={t('console.placeholder')}
          spellCheck={false}
          disabled={!attached}
        />
        <div className="trn-lua-row">
          <button className="btn primary" onClick={onRunLua} disabled={!attached}>
            <Icon name="play" size={14} /> {t('btn.run')} <span className="trn-kbd">{t('console.kbd')}</span>
          </button>
        </div>
      </section>

      <p className="trn-log">{log}</p>
    </div>
  );
}

let root = null;
export function mount(el) { root = createRoot(el); root.render(<Trainer />); }
export function unmount() { if (root) { root.unmount(); root = null; } }

import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Toggle, Icon } from '@penumbra/ui';
import { playOn, playOff } from './sound.js';
import { useT } from './lib/i18n.js';

/**
 * The trainer island. Cheats (served by main) render as rows: icon · label · hotkey chip · control.
 * Toggles use Penumbra's Toggle; actions are "Fire" buttons; every cheat can take a free, user-assigned
 * GLOBAL hotkey (works inside the game). Console runs any Lua string. All strings go through useT().
 */

// Row icons by TYPE convention: cars → car, bikes → moto, drones → robot (transport OR hostile).
const ICON = {
  godmode: 'shield', nodetect: 'eye-off', nofelony: 'alert-triangle', infammo: 'flame',
  auto: 'car', moto: 'moto', racedrone: 'robot', sergei: 'robot',   // vehicles
  ctdrone: 'robot', bloodhound: 'robot', omniskull: 'skull',        // enemies (drones → robot; skull → skull)
  dedsecshop: 'database', eto: 'money', techpts: 'chip',            // others
  bulletrefill: 'plus', distract: 'bell', disrupt: 'radio', endchase: 'rotate-ccw',
};

// which UI group a cheat belongs to (falls back for anything without an explicit section)
const sectionOf = (c) => c.section || (c.kind === 'toggle' ? 'toggles' : 'actions');

// Custom inline glyphs for shapes Penumbra's Icon set lacks — used by section headings (HeadIcon)
// and by row icons (CheatIcon) for car/moto. Everything else falls back to a Penumbra Icon.
const GLYPH = {
  toggle: (<>
    <rect x="2.5" y="7.5" width="19" height="9" rx="4.5" />
    <circle cx="16.5" cy="12" r="2.7" fill="currentColor" stroke="none" />
  </>),
  rocket: (<>
    <path d="M12 3c2.6 2 4 4.9 4 8.2 0 1.6-.35 3-1 4.3h-6c-.65-1.3-1-2.7-1-4.3C8 7.9 9.4 5 12 3Z" />
    <circle cx="12" cy="9.8" r="1.6" />
    <path d="M8.6 15l-2.4 2.4 3.3.2M15.4 15l2.4 2.4-3.3.2" />
    <path d="M10.6 17.6l1.4 3 1.4-3" />
  </>),
  reticle: (<>
    <circle cx="12" cy="12" r="7" />
    <line x1="12" y1="2" x2="12" y2="5" /><line x1="12" y1="19" x2="12" y2="22" />
    <line x1="2" y1="12" x2="5" y2="12" /><line x1="19" y1="12" x2="22" y2="12" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
  </>),
  die: (<>
    <rect x="4" y="4" width="16" height="16" rx="3" />
    <circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" stroke="none" /><circle cx="15.5" cy="8.5" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="8.5" cy="15.5" r="1.2" fill="currentColor" stroke="none" /><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" stroke="none" />
  </>),
  zap: (<path d="M13 2 5 13h6l-1 9 8-12h-6l1-8Z" />),
  car: (<>
    <path d="M4.5 15v-2.5l1.7-4A2 2 0 0 1 8 7h8a2 2 0 0 1 1.8 1.5l1.7 4V15" />
    <line x1="4" y1="15" x2="20" y2="15" />
    <circle cx="8" cy="15" r="1.6" /><circle cx="16" cy="15" r="1.6" />
  </>),
  moto: (<>
    <circle cx="5.8" cy="15.5" r="3.2" /><circle cx="18.2" cy="15.5" r="3.2" />
    <path d="M5.8 15.5h5.2l2.5-4h3l2.9 4" />
    <path d="M10.5 11.5h5.5" />
    <path d="M15 8.5h2.8" /><path d="M16.6 8.5l-1.1 3" />
  </>),
  skull: (<>
    <path d="M5 10.5a7 7 0 0 1 14 0v3c0 .9-.6 1.7-1.5 1.9l-.5.15V18a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-2.45l-.5-.15A2 2 0 0 1 5 13.5Z" />
    <circle cx="9.2" cy="11" r="1.5" fill="currentColor" stroke="none" /><circle cx="14.8" cy="11" r="1.5" fill="currentColor" stroke="none" />
    <path d="M10.5 19v-2M13.5 19v-2" />
  </>),
  money: (<>
    <rect x="2" y="6.5" width="20" height="11" rx="2" />
    <circle cx="12" cy="12" r="2.6" />
    <circle cx="5.5" cy="12" r="0.7" fill="currentColor" stroke="none" /><circle cx="18.5" cy="12" r="0.7" fill="currentColor" stroke="none" />
  </>),
  chip: (<>
    <rect x="7" y="7" width="10" height="10" rx="1.5" />
    <rect x="9.5" y="9.5" width="5" height="5" rx="0.5" />
    <path d="M10 4v3M14 4v3M10 17v3M14 17v3M4 10h3M4 14h3M17 10h3M17 14h3" />
  </>),
};
function Glyph({ name, size = 16, style }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>
      {GLYPH[name]}
    </svg>
  );
}
const HEAD = { toggles: 'toggle', vehicles: 'rocket', enemies: 'reticle', others: 'die', actions: 'zap' };
function HeadIcon({ section }) {
  return <Glyph name={HEAD[section]} size={17} style={{ verticalAlign: '-3px', marginRight: '7px', opacity: 0.9 }} />;
}
// a cheat row icon: a custom glyph (car/moto) when one exists, otherwise a Penumbra Icon
function CheatIcon({ name }) {
  return GLYPH[name] ? <Glyph name={name} size={16} /> : <Icon name={name} size={16} />;
}

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
    await refresh();                       // re-sync attached/info/toggles from main's authoritative status
    setLog(r.ok ? t('log.connected', { pid: r.info.pid }) : '✗ ' + r.error);
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
      setCapturing(null);                 // drop any in-progress hotkey capture (frees its global keydown listener)
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
    if (r.ok) {
      const applied = typeof r.on === 'boolean' ? r.on : next;   // trust main's reported state over the optimistic guess
      setToggles((tg) => ({ ...tg, [id]: applied }));
      (applied ? playOn : playOff)();
      setLog(`${cheatName(id)} → ${applied ? 'ON' : 'OFF'}`);
    } else { setToggles((tg) => ({ ...tg, [id]: !next })); if (r.busy) setLog(t('log.busy')); else { setLog('✗ ' + r.error); refresh(); } }
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
        <CheatIcon name={ICON[c.id] ?? 'check'} />
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

  // catalog + language are the only inputs to the grouping/sort — memoize so the localeCompare sort
  // doesn't re-run on every toggle/hotkey/log re-render.
  const { toggleCheats, vehicleCheats, enemyCheats, otherCheats, actionCheats } = useMemo(() => {
    const group = (s) => catalog.filter((c) => sectionOf(c) === s).sort((a, b) => cheatName(a.id).localeCompare(cheatName(b.id)));
    return {
      toggleCheats: group('toggles'), vehicleCheats: group('vehicles'),
      enemyCheats: group('enemies'), otherCheats: group('others'), actionCheats: group('actions'),
    };
  }, [catalog, t]);

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
        <h3><HeadIcon section="toggles" />{t('section.toggles')}</h3>
        <div className="trn-list">{toggleCheats.map(renderRow)}</div>
      </section>

      <section className="trn-section">
        <h3><HeadIcon section="vehicles" />{t('section.vehicles')} <span className="trn-sub">{t('section.spawns.sub')}</span></h3>
        <div className="trn-list">{vehicleCheats.map(renderRow)}</div>
      </section>

      <section className="trn-section">
        <h3><HeadIcon section="enemies" />{t('section.enemies')}</h3>
        <div className="trn-list">{enemyCheats.map(renderRow)}</div>
      </section>

      <section className="trn-section">
        <h3><HeadIcon section="others" />{t('section.others')}</h3>
        <div className="trn-list">{otherCheats.map(renderRow)}</div>
      </section>

      <section className="trn-section">
        <h3><HeadIcon section="actions" />{t('section.actions')}</h3>
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

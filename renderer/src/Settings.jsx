import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * Settings island — app version + the auto-update section (cloned from Umbra's AppUpdates):
 * current version, background-check status, a check/restart button, and a live download bar.
 */
function AppUpdates() {
  const [ver, setVer] = useState('');
  const [st, setSt] = useState(null);   // mirror of core/updater.js status

  useEffect(() => {
    window.app.getVersion().then(setVer).catch(() => {});
    window.app.updates.status().then(setSt).catch(() => {});
    return window.app.updates.onStatus(setSt);
  }, []);

  const state = (st && st.state) || 'idle';
  const statusText =
    state === 'dev' ? 'Modo desarrollo — el auto-update solo corre en la app instalada.'
      : state === 'checking' ? 'Buscando actualizaciones…'
      : state === 'downloading' ? `Descargando v${st.version}…`
      : state === 'ready' ? `v${st.version} lista para instalar.`
      : state === 'error' ? `Error: ${st.error}`
      : (st && st.checkedAt) ? 'Estás al día.'
      : 'Se busca automáticamente en segundo plano.';

  return (
    <div className="set-update">
      <div className="set-update-row">
        <div className="set-update-info">
          <span className="set-update-label">Versión</span>
          <span className="set-embed-status">{ver ? `v${ver}` : '…'}</span>
        </div>
        {state === 'ready'
          ? <button className="btn primary" onClick={() => window.app.updates.install()}>Reiniciar y actualizar</button>
          : <button className="btn" disabled={state !== 'idle' && state !== 'error'} onClick={() => window.app.updates.check()}>Buscar actualizaciones</button>}
      </div>
      <div className="set-update-status">{statusText}</div>
      {state === 'downloading' && (
        <div className="set-embed-prog">
          <div className="set-embed-prog-label">Descargando v{st.version} — {st.pct}%</div>
          <div className="set-embed-bar"><div className="set-embed-bar-fill" style={{ width: (st.pct || 0) + '%' }} /></div>
        </div>
      )}
    </div>
  );
}

function Settings() {
  return (
    <div className="panel">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
        <svg viewBox="0 0 64 64" width="34" height="34" fill="none" aria-hidden="true">
          <path d="M10 8 L21 42 L32 18 L43 42 L54 8 M10 8 L32 56 L54 8" stroke="var(--u-accent)" strokeWidth="6" strokeLinejoin="miter" />
        </svg>
        <div>
          <h2>wdl-trainer</h2>
          <p>Trainer para Watch Dogs Legion · single-player.</p>
        </div>
      </div>

      <section className="trn-section">
        <h3>Actualizaciones</h3>
        <AppUpdates />
      </section>

      <p className="trn-credit">by Kidd Shady</p>
    </div>
  );
}

let root = null;
export function mount(el) { root = createRoot(el); root.render(<Settings />); }
export function unmount() { if (root) { root.unmount(); root = null; } }

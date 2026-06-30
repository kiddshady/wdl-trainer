import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Select } from '@penumbra/ui';
import { useT, languages, getLang, setLang } from './lib/i18n.js';

/** App updates — version, background-check status, check/restart button, live download bar. */
function AppUpdates() {
  const t = useT();
  const [ver, setVer] = useState('');
  const [st, setSt] = useState(null);

  useEffect(() => {
    window.app.getVersion().then(setVer).catch(() => {});
    window.app.updates.status().then(setSt).catch(() => {});
    return window.app.updates.onStatus(setSt);
  }, []);

  const state = (st && st.state) || 'idle';
  const statusText =
    state === 'dev' ? t('update.status.dev')
      : state === 'checking' ? t('update.status.checking')
      : state === 'downloading' ? t('update.status.downloading', { version: st.version })
      : state === 'ready' ? t('update.status.ready', { version: st.version })
      : state === 'error' ? t('update.status.error', { error: st.error })
      : (st && st.checkedAt) ? t('update.status.uptodate')
      : t('update.status.auto');

  return (
    <div className="set-update">
      <div className="set-update-row">
        <div className="set-update-info">
          <span className="set-update-label">{t('settings.version')}</span>
          <span className="set-embed-status">{ver ? `v${ver}` : '…'}</span>
        </div>
        {state === 'ready'
          ? <button className="btn primary" onClick={() => window.app.updates.install()}>{t('update.restart')}</button>
          : <button className="btn" disabled={state !== 'idle' && state !== 'error'} onClick={() => window.app.updates.check()}>{t('update.check')}</button>}
      </div>
      <div className="set-update-status">{statusText}</div>
      {state === 'downloading' && (
        <div className="set-embed-prog">
          <div className="set-embed-prog-label">{t('update.downloading', { version: st.version, pct: st.pct })}</div>
          <div className="set-embed-bar"><div className="set-embed-bar-fill" style={{ width: (st.pct || 0) + '%' }} /></div>
        </div>
      )}
    </div>
  );
}

function Settings() {
  const t = useT();
  const langs = languages();
  const current = langs.find((l) => l.code === getLang()) || langs[0];

  return (
    <div className="panel">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
        <svg viewBox="0 0 64 64" width="34" height="34" fill="none" aria-hidden="true">
          <path d="M10 8 L21 42 L32 18 L43 42 L54 8 M10 8 L32 56 L54 8" stroke="var(--u-accent)" strokeWidth="6" strokeLinejoin="miter" />
        </svg>
        <div>
          <h2>wdl-trainer</h2>
          <p>{t('settings.subtitle')}</p>
        </div>
      </div>

      <section className="trn-section">
        <h3>{t('settings.language')}</h3>
        <Select
          value={current.label}
          onChange={(label) => { const l = langs.find((x) => x.label === label); if (l) setLang(l.code); }}
          options={langs.map((l) => l.label)}
          minWidth={160}
        />
      </section>

      <section className="trn-section">
        <h3>{t('settings.updates')}</h3>
        <AppUpdates />
      </section>

      <p className="trn-credit">by Kidd Shady</p>
    </div>
  );
}

let root = null;
export function mount(el) { root = createRoot(el); root.render(<Settings />); }
export function unmount() { if (root) { root.unmount(); root = null; } }

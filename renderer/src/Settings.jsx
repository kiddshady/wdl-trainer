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
    <div className="settings">
      <div className="set-hero">
        <span className="set-hero-tag">ABOUT // DS-17</span>
        <svg className="set-hero-logo" viewBox="0 0 64 64" width="40" height="40" fill="none" aria-hidden="true">
          <path d="M8 8 L17 47 L32 19 L47 47 L56 8 M8 8 L32 55 L56 8" stroke="var(--u-accent)" strokeWidth="6" strokeLinejoin="miter" />
        </svg>
        <div>
          <h2>wdl<span className="brand-us">_</span>trainer</h2>
          <p>{t('settings.subtitle')}</p>
        </div>
      </div>

      <div className="set-grid">
        <section className="trn-card">
          <div className="trn-card-head">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="trn-card-ico"><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5.5 5.5 7.6 7.6M16.4 16.4 18.5 18.5M18.5 5.5 16.4 7.6M7.6 16.4 5.5 18.5" /></svg>
            <span className="trn-card-title">{t('settings.language')}</span>
          </div>
          <Select
            value={current.label}
            onChange={(label) => { const l = langs.find((x) => x.label === label); if (l) setLang(l.code); }}
            options={langs.map((l) => l.label)}
            minWidth={160}
          />
        </section>

        <section className="trn-card">
          <div className="trn-card-head">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="trn-card-ico"><path d="M4 12a8 8 0 1 0 2.5-5.8" /><path d="M3 4v5h5" /></svg>
            <span className="trn-card-title">{t('settings.updates')}</span>
          </div>
          <AppUpdates />
        </section>
      </div>

      <p className="trn-credit">by Kidd Shady</p>
    </div>
  );
}

let root = null;
export function mount(el) { root = createRoot(el); root.render(<Settings />); }
export function unmount() { if (root) { root.unmount(); root = null; } }

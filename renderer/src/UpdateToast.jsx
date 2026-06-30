import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Icon, usePresence } from '@penumbra/ui';
import { useT } from './lib/i18n.js';

/**
 * Global "update ready" toast — cloned from Umbra. Mounted ONCE, permanently (renderer/js/app.js).
 * Packaged-only (dev never reaches 'ready'). Dev preview from DevTools:
 *   window.dispatchEvent(new CustomEvent('wdl:update-preview', { detail: { state: 'ready', version: '9.9.9' } }))
 */
function UpdateToast() {
  const t = useT();
  const [st, setSt] = useState(null);
  const [dismissed, setDismissed] = useState(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    window.app.updates.status().then(setSt).catch(() => {});
    const off = window.app.updates.onStatus(setSt);
    const preview = (e) => setSt(e.detail);
    window.addEventListener('wdl:update-preview', preview);
    return () => { if (off) off(); window.removeEventListener('wdl:update-preview', preview); };
  }, []);

  const version = st && st.state === 'ready' ? st.version : null;
  const visible = version && version !== dismissed;
  const toastP = usePresence(visible ? version : null, 200);

  const restart = () => {
    setInstalling(true);
    window.app.updates.install().then((ok) => { if (!ok) setInstalling(false); }).catch(() => setInstalling(false));
  };
  const later = () => { if (version) setDismissed(version); };

  if (!toastP.item) return null;
  return (
    <div className={'u-toast' + (toastP.closing ? ' closing' : '')} role="status" aria-live="polite">
      <div className="u-toast-icon"><Icon name="download" size={18} /></div>
      <div className="u-toast-main">
        <div className="u-toast-title">{t('toast.title')}</div>
        <div className="u-toast-msg">{t('toast.msg', { version: toastP.item })}</div>
        <div className="u-toast-actions">
          <button className="btn" onClick={later} disabled={installing}>{t('toast.later')}</button>
          <button className="btn primary" onClick={restart} disabled={installing}>
            {installing ? t('toast.restarting') : t('toast.restart')}
          </button>
        </div>
      </div>
      <button className="u-toast-x" onClick={later} disabled={installing} aria-label={t('common.dismiss')}>
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}

let root = null;
export function mount(el) { root = createRoot(el); root.render(<UpdateToast />); }
export function unmount() { if (root) { root.unmount(); root = null; } }

import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Icon, usePresence } from '@penumbra/ui';

/**
 * Global "update ready" toast — cloned from Umbra's UpdateToast. Mounted ONCE, permanently, into
 * a host on <body> (see renderer/js/app.js), so it hears the updater's state:'ready' no matter
 * which view is open. Slides in bottom-right; offers Reiniciar y actualizar / Después.
 *
 * Packaged-only by nature (dev never reaches 'ready'). Preview the look in dev from DevTools:
 *   window.dispatchEvent(new CustomEvent('wdl:update-preview', { detail: { state: 'ready', version: '9.9.9' } }))
 */
function UpdateToast() {
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
        <div className="u-toast-title">Actualización lista</div>
        <div className="u-toast-msg">La versión {toastP.item} está lista para instalar.</div>
        <div className="u-toast-actions">
          <button className="btn" onClick={later} disabled={installing}>Después</button>
          <button className="btn primary" onClick={restart} disabled={installing}>
            {installing ? 'Reiniciando…' : 'Reiniciar y actualizar'}
          </button>
        </div>
      </div>
      <button className="u-toast-x" onClick={later} disabled={installing} aria-label="Descartar">
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}

let root = null;
export function mount(el) { root = createRoot(el); root.render(<UpdateToast />); }
export function unmount() { if (root) { root.unmount(); root = null; } }

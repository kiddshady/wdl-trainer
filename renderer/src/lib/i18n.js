/**
 * React binding for the global i18n engine (renderer/js/i18n.js → window.WdlI18n).
 * Islands are separate IIFE bundles, so they all proxy to the one window.WdlI18n loaded by the
 * shell. useT() subscribes a component so the UI flips language live (no reload).
 */
import { useEffect, useState } from 'react';
import { configureI18n } from '@penumbra/ui';

const I = () => (typeof window !== 'undefined' ? window.WdlI18n : null);

/** Standalone translate — safe before the engine exists (returns the key). */
export function t(key, vars) { const e = I(); return e ? e.t(key, vars) : key; }

/** Hook: returns t() and re-renders the component when the language changes. */
export function useT() {
  const [, force] = useState(0);
  useEffect(() => { const e = I(); if (!e) return undefined; return e.onChange(() => force((n) => n + 1)); }, []);
  return t;
}

export const languages = () => { const e = I(); return (e && e.available) || [{ code: 'en', label: 'English' }, { code: 'es', label: 'Español' }]; };
export const getLang = () => { const e = I(); return e ? e.lang : 'en'; };
export const setLang = (code) => { const e = I(); return e ? e.setLang(code) : code; };

// route Penumbra primitives (Select placeholder, etc.) through the same catalogs
try { configureI18n({ t }); } catch (e) { /* primitives keep their English defaults */ }

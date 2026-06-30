'use strict';

/**
 * wdl-trainer i18n — adapted from Umbra's. A window global loaded BEFORE the island bundles and
 * app.js, so the shell and every island (separate IIFE bundles) share ONE engine + ONE set of
 * catalogs. Catalogs register via js/locales/{en,es}.js. React islands consume it via
 * src/lib/i18n.js (useT). Language persists in config.language; switching is live (no reload).
 */
(function () {
  var LANGS = [
    { code: 'en', label: 'English', locale: 'en-US' },
    { code: 'es', label: 'Español', locale: 'es-419' },
  ];
  var DEFAULT = 'en';
  var catalogs = {};
  var listeners = new Set();
  var inited = false;

  if (window.__wdlLocales) { for (var k in window.__wdlLocales) catalogs[k] = window.__wdlLocales[k]; }

  function localeOf(code) { var l = LANGS.find(function (x) { return x.code === code; }); return l ? l.locale : 'en-US'; }
  function isSupported(code) { return LANGS.some(function (x) { return x.code === code; }); }
  function detect() { try { return (navigator.language || 'en').toLowerCase().indexOf('es') === 0 ? 'es' : 'en'; } catch (e) { return DEFAULT; } }

  var API = {
    lang: DEFAULT,
    get locale() { return localeOf(this.lang); },
    available: LANGS.map(function (l) { return { code: l.code, label: l.label }; }),

    register: function (code, dict) { catalogs[code] = Object.assign(catalogs[code] || {}, dict); if (inited) this._notify(); },

    t: function (key, vars) {
      var str = this._resolve(this.lang, key);
      if (str === undefined && this.lang !== 'en') str = this._resolve('en', key); // fall back to source
      if (str === undefined) str = key;                                            // last resort: the key
      return this._interp(str, vars);
    },
    _resolve: function (lang, key) { var d = catalogs[lang]; return d ? d[key] : undefined; },
    _interp: function (str, vars) {
      if (!vars || typeof str !== 'string') return str;
      return str.replace(/\{(\w+)\}/g, function (m, name) { return vars[name] !== undefined ? String(vars[name]) : m; });
    },

    onChange: function (cb) { listeners.add(cb); return function () { listeners.delete(cb); }; },
    _notify: function () { listeners.forEach(function (cb) { try { cb(API.lang); } catch (e) { /* one bad listener mustn't block */ } }); },

    _setActive: function (code) {
      if (!isSupported(code)) code = DEFAULT;
      if (code === this.lang) return false;
      this.lang = code;
      try { document.documentElement.lang = code; } catch (e) {}
      return true;
    },

    /** Change + persist + propagate (called by the Settings selector). */
    setLang: function (code) {
      var changed = this._setActive(code);
      if (changed) { this.applyStaticDom(); this._notify(); }
      try { window.app.config.set('language', this.lang); } catch (e) {}
      try { window.app.setLang(this.lang); } catch (e) {}   // nudge main (tray labels)
      return this.lang;
    },

    /** Refresh vanilla shell DOM: elements opt in with data-i18n (textContent) / data-i18n-title. */
    applyStaticDom: function () {
      try {
        var self = this;
        document.querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = self.t(el.getAttribute('data-i18n')); });
        document.querySelectorAll('[data-i18n-title]').forEach(function (el) { el.setAttribute('title', self.t(el.getAttribute('data-i18n-title'))); });
      } catch (e) { /* shell DOM not ready — re-applied on the next change */ }
    },

    /** Resolve boot language (config override → OS locale), paint the shell. Awaited by app.js. */
    init: async function () {
      if (inited) return this.lang;
      inited = true;
      var code = null;
      try { code = await window.app.config.get('language'); } catch (e) {}
      this._setActive(isSupported(code) ? code : detect());
      try { window.app.setLang(this.lang); } catch (e) {}
      this.applyStaticDom();
      return this.lang;
    },
  };

  window.WdlI18n = API;
})();

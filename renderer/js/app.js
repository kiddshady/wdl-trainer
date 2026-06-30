'use strict';

/**
 * Renderer shell. Wires the window controls and swaps islands into #content.
 * Each island bundle exposes window.App<Name> = { mount(el), unmount() } (see renderer/src/*).
 */
(function () {
  const $ = (id) => document.getElementById(id);

  // window controls → the preload bridge (window.app.window.*)
  $('win-min').addEventListener('click', () => window.app.window.minimize());
  $('win-max').addEventListener('click', () => window.app.window.toggleMaximize());
  $('win-close').addEventListener('click', () => window.app.window.close());

  // island registry: view name → the global its bundle exposes
  const ISLANDS = { home: 'AppHome', settings: 'AppSettings' };
  let currentView = null;

  function markActive(view) {
    document.querySelectorAll('.tb-nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  }

  function showView(view) {
    if (view === currentView) return;
    const content = $('content');
    if (currentView && window[ISLANDS[currentView]] && window[ISLANDS[currentView]].unmount) {
      window[ISLANDS[currentView]].unmount();
    }
    content.innerHTML = '';
    const island = window[ISLANDS[view]];
    if (island && typeof island.mount === 'function') { island.mount(content); currentView = view; }
    markActive(view);
  }

  document.querySelectorAll('.tb-nav button').forEach((b) => {
    b.addEventListener('click', () => showView(b.dataset.view));
  });

  showView('home');

  // mount the global update toast once — permanent, independent of the view registry
  const toastHost = $('update-toast-host');
  if (toastHost && window.AppUpdateToast && typeof window.AppUpdateToast.mount === 'function') {
    window.AppUpdateToast.mount(toastHost);
  }
})();

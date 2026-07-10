'use strict';
(function () {
  var dict = {
    'nav.trainer': 'Trainer',
    'nav.settings': 'Ajustes',

    'status.connected': 'Conectado · {module} · pid {pid}',
    'status.disconnected': 'Sin conexión al juego',
    'btn.connect': 'Conectar',
    'btn.reconnect': 'Reconectar',
    'btn.connecting': 'Conectando…',

    'tip.hotkeys': 'Tip: los atajos son globales y funcionan dentro del juego. Usá F1–F12 o el Numpad para no pisar tus controles.',

    'section.toggles': 'Toggles',
    'section.spawns': 'Spawns',
    'section.spawns.sub': '— apuntá con la retícula',
    'section.vehicles': 'Vehículos',
    'section.enemies': 'Enemigos',
    'section.allies': 'Aliados',
    'section.others': 'Otros',
    'section.actions': 'Acciones',
    'section.console': 'Consola Lua',

    'hotkey.add': '＋ atajo',
    'hotkey.capturing': 'presioná…',
    'hotkey.assign': 'Asignar atajo global',
    'hotkey.clear': 'Quitar atajo',

    'btn.fire': 'Lanzar',
    'btn.run': 'Ejecutar',
    'console.kbd': 'Ctrl·Enter',
    'console.placeholder': 'cualquier Lua del juego — ej:\nSetInvincibility(1)\nSetCanBeDetected(GetLocalPlayerEntityId(), 0)',

    'log.ready': 'Listo. Abrí el juego y conectá.',
    'log.connecting': 'Conectando al juego…',
    'log.connected': 'Conectado — pid {pid}',
    'log.busy': 'ocupado — esperá un toque ⏳',
    'log.busyHotkey': '{id} (atajo) ocupado ⏳',
    'log.gameClosed': 'El juego se cerró — toggles reseteados. Reconectá cuando vuelva.',

    'cheat.godmode': 'Modo Dios',
    'cheat.nodetect': 'Desactivar Detección',
    'cheat.nofelony': 'Desactivar Sistema de Delitos',
    'cheat.auto': 'Auto (Bogen Hailkal EV4 Sport)',
    'cheat.dedsecshop': 'Tienda DedSec',
    'cheat.moto': 'Moto (Kurahawa Tourer)',
    'cheat.racedrone': 'Dron de carrera',
    'cheat.ctdrone': 'Dron antiterrorista de Albion',
    'cheat.bloodhound': 'Dron Bloodhound de Albion',
    'cheat.omniskull': 'Omni Skull',
    'cheat.blackspider': 'Torreta Black Spider',
    'cheat.sergei': 'Sergei',
    'cheat.bulletrefill': 'Recarga de Munición',
    'cheat.eto': 'Agregar ETO (+1000)',
    'cheat.techpts': 'Agregar Tech Points (+10)',
    'cheat.distract': 'Distraer a todos en rango',
    'cheat.disrupt': 'Interferir a todos en rango',
    'cheat.endchase': 'Terminar Persecución',

    'settings.subtitle': 'Trainer para Watch Dogs Legion · single-player.',
    'settings.updates': 'Actualizaciones',
    'settings.version': 'Versión',
    'settings.language': 'Idioma',

    'update.status.dev': 'Modo desarrollo — el auto-update solo corre en la app instalada.',
    'update.status.checking': 'Buscando actualizaciones…',
    'update.status.downloading': 'Descargando v{version}…',
    'update.status.ready': 'v{version} lista para instalar.',
    'update.status.error': 'Error: {error}',
    'update.status.uptodate': 'Estás al día.',
    'update.status.auto': 'Se busca automáticamente en segundo plano.',
    'update.check': 'Buscar actualizaciones',
    'update.restart': 'Reiniciar y actualizar',
    'update.downloading': 'Descargando v{version} — {pct}%',

    'toast.title': 'Actualización lista',
    'toast.msg': 'La versión {version} está lista para instalar.',
    'toast.later': 'Después',
    'toast.restart': 'Reiniciar y actualizar',
    'toast.restarting': 'Reiniciando…',
    'common.dismiss': 'Descartar',

    'select.placeholder': 'Elegí…',
    'select.empty': 'Sin opciones',
  };
  if (window.WdlI18n) window.WdlI18n.register('es', dict);
  else { window.__wdlLocales = window.__wdlLocales || {}; window.__wdlLocales.es = dict; }
})();

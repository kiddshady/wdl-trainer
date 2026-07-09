'use strict';
(function () {
  var dict = {
    'nav.trainer': 'Trainer',
    'nav.settings': 'Settings',

    'status.connected': 'Connected · {module} · pid {pid}',
    'status.disconnected': 'Not connected to the game',
    'btn.connect': 'Connect',
    'btn.reconnect': 'Reconnect',
    'btn.connecting': 'Connecting…',

    'tip.hotkeys': "Tip: hotkeys are global and work inside the game. Use F1–F12 or the Numpad so you don't clash with your controls.",

    'section.toggles': 'Toggles',
    'section.spawns': 'Spawns',
    'section.spawns.sub': '— aim with your reticle',
    'section.vehicles': 'Vehicles',
    'section.enemies': 'Enemies',
    'section.allies': 'Allies',
    'section.others': 'Others',
    'section.actions': 'Actions',
    'section.console': 'Lua console',

    'hotkey.add': '＋ hotkey',
    'hotkey.capturing': 'press a key…',
    'hotkey.assign': 'Assign global hotkey',
    'hotkey.clear': 'Remove hotkey',

    'btn.fire': 'Fire',
    'btn.run': 'Run',
    'console.kbd': 'Ctrl·Enter',
    'console.placeholder': "any of the game's Lua — e.g.:\nSetInvincibility(1)\nSetCanBeDetected(GetLocalPlayerEntityId(), 0)",

    'log.ready': 'Ready. Open the game and connect.',
    'log.connecting': 'Connecting to the game…',
    'log.connected': 'Connected — pid {pid}',
    'log.busy': 'busy — wait a sec ⏳',
    'log.busyHotkey': '{id} (hotkey) busy ⏳',
    'log.gameClosed': 'Game closed — toggles reset. Reconnect when it’s back.',

    'cheat.godmode': 'God Mode',
    'cheat.nodetect': 'Disable Detection',
    'cheat.nofelony': 'Disable Felony System',
    'cheat.infammo': 'Infinite Ammo',
    'cheat.auto': 'Car (Bogen Hailkal EV4 Sport)',
    'cheat.dedsecshop': 'DedSec Shop',
    'cheat.moto': 'Bike (Kurahawa Tourer)',
    'cheat.racedrone': 'Race drone',
    'cheat.ctdrone': 'Albion Counter-Terrorism Drone',
    'cheat.bloodhound': 'Albion Bloodhound Drone',
    'cheat.omniskull': 'Omni Skull',
    'cheat.blackspider': 'Black Spider Turret',
    'cheat.sergei': 'Sergei',
    'cheat.bulletrefill': 'Bullet Refill',
    'cheat.eto': 'Add ETO (+1000)',
    'cheat.techpts': 'Add Tech Points (+10)',
    'cheat.distract': 'Distract all in range',
    'cheat.disrupt': 'Disrupt all in range',
    'cheat.endchase': 'End Felony Chase',

    'settings.subtitle': 'Trainer for Watch Dogs Legion · single-player.',
    'settings.updates': 'Updates',
    'settings.version': 'Version',
    'settings.language': 'Language',

    'update.status.dev': 'Dev mode — auto-update only runs in the installed app.',
    'update.status.checking': 'Checking for updates…',
    'update.status.downloading': 'Downloading v{version}…',
    'update.status.ready': 'v{version} ready to install.',
    'update.status.error': 'Error: {error}',
    'update.status.uptodate': "You're up to date.",
    'update.status.auto': 'Checked automatically in the background.',
    'update.check': 'Check for updates',
    'update.restart': 'Restart and update',
    'update.downloading': 'Downloading v{version} — {pct}%',

    'toast.title': 'Update ready',
    'toast.msg': 'Version {version} is ready to install.',
    'toast.later': 'Later',
    'toast.restart': 'Restart and update',
    'toast.restarting': 'Restarting…',
    'common.dismiss': 'Dismiss',

    'select.placeholder': 'Select…',
    'select.empty': 'No options',
  };
  if (window.WdlI18n) window.WdlI18n.register('en', dict);
  else { window.__wdlLocales = window.__wdlLocales || {}; window.__wdlLocales.en = dict; }
})();

// cheats.mjs — the whole catalog, as Lua strings. This is the entire "content"
// of the trainer: toggles have on/off, actions have a single run. Adding a new
// cheat later = add one entry here. (Lua extracted from reg2k's WDL-E.CT.)

// A reticle spawn: drops an archetype where the player is aiming.
const spawn = (guid) => [
  'local loc = GetReticleHitLocation()',
  'if not loc then return end',
  `SpawnEntityFromArchetype("${guid}", loc[1], loc[2], loc[3], 0, 0, 0)`,
].join('\n');

export const CHEATS = [
  // ---- toggles ----
  { id: 'godmode',  label: 'God Mode',               kind: 'toggle',
    on: 'SetInvincibility(1)', off: 'SetInvincibility(0)' },
  { id: 'nodetect', label: 'Disable Detection',      kind: 'toggle',
    on: 'SetCanBeDetected(GetLocalPlayerEntityId(), 0)', off: 'SetCanBeDetected(GetLocalPlayerEntityId(), 1)' },
  { id: 'nofelony', label: 'Disable Felony System',  kind: 'toggle',
    on: 'FelonySystemEnable(0)', off: 'FelonySystemEnable(1)' },

  // ---- actions ----
  { id: 'endchase', label: 'End Felony Chase',       kind: 'action',
    run: 'FelonyEndChase(GetLocalPlayerEntityId())' },

  // ---- spawns (at reticle) ----
  { id: 'moto',      label: 'Spawn moto (Kurahawa Tourer)',        kind: 'action', run: spawn('{86E6BC07-DF6F-4189-996C-9BBC68B4A6A3}') },
  { id: 'auto',      label: 'Spawn auto (Bogen Hailkal EV4 Sport)', kind: 'action', run: spawn('{966B8C19-155B-411D-A1AC-96C50E8C4FB4}') },
  { id: 'sergei',    label: 'Spawn Sergei',                         kind: 'action', run: spawn('{E082946E-343D-40E6-AC9A-F3E17C31318E}') },
  { id: 'racedrone', label: 'Spawn race drone',                     kind: 'action', run: spawn('{9df9dde8-b514-4557-800b-2d6aa7f99c92}') },
];

export const byId = (id) => CHEATS.find((c) => c.id === id);

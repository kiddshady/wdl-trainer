// cheats.mjs — the whole catalog as Lua strings.
//   section: UI grouping — 'toggles' | 'spawns' | 'actions'
//   kind:    behaviour   — 'toggle' (on/off) | 'action' (fire once)
// Labels here are fallbacks; the UI shows t('cheat.'+id). Lua extracted from reg2k's WDL-E.CT.

const spawn = (guid) => [
  'local loc = GetReticleHitLocation()',
  'if not loc then return end',
  `SpawnEntityFromArchetype("${guid}", loc[1], loc[2], loc[3], 0, 0, 0)`,
].join('\n');

// like spawn(), but rotates the entity to face the player (the DedSec shop)
const spawnFacing = (guid) => [
  'local loc = GetReticleHitLocation()',
  'if not loc then return end',
  'local rotZ = GetEntityAngle(GetLocalPlayerEntityId(), 2)',
  `SpawnEntityFromArchetype("${guid}", loc[1], loc[2], loc[3], 0, 0, 180 + rotZ)`,
].join('\n');

// trigger a hack on every human in range (Distract / DisruptComm)
const hackAll = (hack) => [
  'local humans = CAIAgentManager_GetInstance():GetAIAgentsOfGroupFromLUA_v2("Human", 0, "", 0, 0)',
  'for i, v in ipairs(humans) do',
  `  TryTriggerHack("${hack}", GetLocalPlayerEntityId(), v)`,
  'end',
].join('\n');

const REFILL_ID = BigInt('0x80000002C6C24A70').toString(); // Bullet.RefillAll item id, unsigned decimal

export const CHEATS = [
  // ---- toggles ----
  { id: 'godmode',  section: 'toggles', kind: 'toggle', label: 'God Mode',
    on: 'SetInvincibility(1)', off: 'SetInvincibility(0)' },
  { id: 'nodetect', section: 'toggles', kind: 'toggle', label: 'Disable Detection',
    on: 'SetCanBeDetected(GetLocalPlayerEntityId(), 0)', off: 'SetCanBeDetected(GetLocalPlayerEntityId(), 1)' },
  { id: 'nofelony', section: 'toggles', kind: 'toggle', label: 'Disable Felony System',
    on: 'FelonySystemEnable(0)', off: 'FelonySystemEnable(1)' },

  // ---- spawns (at reticle) ----
  { id: 'auto',       section: 'spawns', kind: 'action', label: 'Bogen Hailkal EV4 Sport', run: spawn('{966B8C19-155B-411D-A1AC-96C50E8C4FB4}') },
  { id: 'dedsecshop', section: 'spawns', kind: 'action', label: 'DedSec Shop',             run: spawnFacing('{5991467D-8E99-431F-AE1B-724D46EDE1E9}') },
  { id: 'moto',       section: 'spawns', kind: 'action', label: 'Kurahawa Tourer',         run: spawn('{86E6BC07-DF6F-4189-996C-9BBC68B4A6A3}') },
  { id: 'racedrone',  section: 'spawns', kind: 'action', label: 'Race drone',              run: spawn('{9df9dde8-b514-4557-800b-2d6aa7f99c92}') },
  { id: 'sergei',     section: 'spawns', kind: 'action', label: 'Sergei',                  run: spawn('{E082946E-343D-40E6-AC9A-F3E17C31318E}') },

  // ---- actions ----
  { id: 'bulletrefill', section: 'actions', kind: 'action', label: 'Bullet Refill',        run: `AddItem("Items.${REFILL_ID}", 1)` },
  { id: 'distract',     section: 'actions', kind: 'action', label: 'Distract all in range', run: hackAll('Distract') },
  { id: 'disrupt',      section: 'actions', kind: 'action', label: 'Disrupt all in range',  run: hackAll('DisruptComm') },
  { id: 'endchase',     section: 'actions', kind: 'action', label: 'End Felony Chase',      run: 'FelonyEndChase(GetLocalPlayerEntityId())' },
];

export const byId = (id) => CHEATS.find((c) => c.id === id);

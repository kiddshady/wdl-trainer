// cheats.mjs — the whole catalog as Lua strings.
//   section: UI grouping — 'toggles' | 'spawns' | 'actions'
//   kind:    behaviour   — 'toggle' (on/off) | 'action' (fire once)
// Labels here are fallbacks; the UI shows t('cheat.'+id). Lua extracted from reg2k's WDL-E.CT.

// dz = extra height above the reticle hit (drones spawn airborne so they don't clip into the ground)
const spawn = (guid, dz = 0) => [
  'local loc = GetReticleHitLocation()',
  'if not loc then return end',
  `SpawnEntityFromArchetype("${guid}", loc[1], loc[2], loc[3]${dz ? ` + ${dz}` : ''}, 0, 0, 0)`,
].join('\n');

// like spawn(), but rotates the entity to face the player (the DedSec shop)
const spawnFacing = (guid) => [
  'local loc = GetReticleHitLocation()',
  'if not loc then return end',
  'local rotZ = GetEntityAngle(GetLocalPlayerEntityId(), 2) or 0',   // nil during respawn/transition → no rotation
  `SpawnEntityFromArchetype("${guid}", loc[1], loc[2], loc[3], 0, 0, 180 + rotZ)`,
].join('\n');

// trigger a hack on every human in range (Distract / DisruptComm)
const hackAll = (hack) => [
  'local mgr = CAIAgentManager_GetInstance()',
  'if not mgr then return end',                                      // nil in menus / before agents stream in
  'local humans = mgr:GetAIAgentsOfGroupFromLUA_v2("Human", 0, "", 0, 0)',
  'if not humans then return end',
  'local me = GetLocalPlayerEntityId()',                            // loop-invariant → hoist out of the loop
  'for i, v in ipairs(humans) do',
  `  TryTriggerHack("${hack}", me, v)`,
  'end',
].join('\n');

const REFILL_ID = BigInt('0x80000002C6C24A70').toString(); // Bullet.RefillAll item id, unsigned decimal
// Backs the manual Bullet Refill action. Guarded so it NO-OPS when there's no local operative:
// GetLocalPlayerEntityId() returns nil during loads / respawns / transitions (see spawnFacing above) —
// exactly the window where AddItem would refresh a torn-down operative's inventory and CLOSE THE GAME on
// a loading screen. The guard runs inside the VM on whichever thread executes it.
//
// There is deliberately NO Infinite Ammo toggle. Looping this refill exhausts the game's bounded "lua
// buffer slot" pool and closes the game, and neither value-freeze alternative delivers what the toggle was
// actually for (never reloading): every clip address a memory scan can reach is a HUD display copy, so
// freezing one holds the number while the gun keeps reloading; freezing the ammo reserve only stops you
// running out. Reading the real clip needs a debugger, and attaching one trips the game's anti-tamper and
// closes it instantly. A single on-demand refill can't exhaust the pool — only a loop can. See the
// value-freeze-ammo-hunt / infammo-crash-and-fix notes before re-adding anything here.
const REFILL_LUA = [
  'local p = GetLocalPlayerEntityId()',
  'if not p then return end',
  `AddItem("Items.${REFILL_ID}", 1)`,
].join('\n');

export const CHEATS = [
  // ---- toggles ----
  { id: 'godmode',  section: 'toggles', kind: 'toggle', label: 'God Mode',
    on: 'SetInvincibility(1)', off: 'SetInvincibility(0)' },
  { id: 'nodetect', section: 'toggles', kind: 'toggle', label: 'Disable Detection',
    on: 'SetCanBeDetected(GetLocalPlayerEntityId(), 0)', off: 'SetCanBeDetected(GetLocalPlayerEntityId(), 1)' },
  { id: 'nofelony', section: 'toggles', kind: 'toggle', label: 'Disable Felony System',
    on: 'FelonySystemEnable(0)', off: 'FelonySystemEnable(1)' },

  // ---- vehicles (spawn at reticle) ----
  { id: 'auto',       section: 'vehicles', kind: 'action', label: 'Bogen Hailkal EV4 Sport', run: spawn('{966B8C19-155B-411D-A1AC-96C50E8C4FB4}') },
  { id: 'moto',       section: 'vehicles', kind: 'action', label: 'Kurahawa Tourer',         run: spawn('{86E6BC07-DF6F-4189-996C-9BBC68B4A6A3}') },
  { id: 'racedrone',  section: 'vehicles', kind: 'action', label: 'Race drone',              run: spawn('{9df9dde8-b514-4557-800b-2d6aa7f99c92}') },
  { id: 'sergei',     section: 'vehicles', kind: 'action', label: 'Sergei',                  run: spawn('{E082946E-343D-40E6-AC9A-F3E17C31318E}') },

  // ---- enemies (spawn at reticle) ----
  { id: 'ctdrone',    section: 'enemies', kind: 'action', label: 'Albion Counter-Terrorism Drone', run: spawn('{18538a70-fcbc-4d1f-bd3c-5c9653d72161}', 2.5) },
  { id: 'bloodhound', section: 'enemies', kind: 'action', label: 'Albion Bloodhound Drone',        run: spawn('{b1dea99c-e3d7-434b-94e9-39c7dd6ea991}', 2.5) },
  { id: 'omniskull',  section: 'enemies', kind: 'action', label: 'Omni Skull',                     run: spawn('{040dd2eb-60d2-4d77-82fd-1f6298d9a302}') },

  // ---- allies (spawn at reticle) — friendly units that fight FOR you; ground-placed, no dz ----
  { id: 'blackspider', section: 'allies', kind: 'action', label: 'Black Spider Turret', run: spawn('{533880f7-25c0-4c8f-84df-9f968dc1717d}') },

  // ---- others ----
  { id: 'dedsecshop', section: 'others', kind: 'action', label: 'DedSec Shop',             run: spawnFacing('{5991467D-8E99-431F-AE1B-724D46EDE1E9}') },
  { id: 'eto',        section: 'others', kind: 'action', label: 'Add ETO (+1000)',         run: `TriggerRuleSmithRule('589221860', '', GetLocalPlayerEntityId())` },
  { id: 'techpts',    section: 'others', kind: 'action', label: 'Add Tech Points (+10)',    run: `TriggerRuleSmithRule('189922678', '', GetLocalPlayerEntityId())` },

  // ---- actions ----
  { id: 'bulletrefill', section: 'actions', kind: 'action', label: 'Bullet Refill',        run: REFILL_LUA },
  { id: 'distract',     section: 'actions', kind: 'action', label: 'Distract all in range', run: hackAll('Distract') },
  { id: 'disrupt',      section: 'actions', kind: 'action', label: 'Disrupt all in range',  run: hackAll('DisruptComm') },
  { id: 'endchase',     section: 'actions', kind: 'action', label: 'End Felony Chase',      run: 'FelonyEndChase(GetLocalPlayerEntityId())' },
];

export const byId = (id) => CHEATS.find((c) => c.id === id);

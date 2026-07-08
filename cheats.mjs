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
// Shared by Bullet Refill (once) + Infinite Ammo (loop). Guarded so it NO-OPS when there's no local
// operative: GetLocalPlayerEntityId() returns nil during loads / respawns / transitions (see spawnFacing
// above) — exactly the window where AddItem would refresh a torn-down operative's inventory and CLOSE THE
// GAME on a loading screen. The guard runs inside the VM on whichever thread executes it, so it protects
// the game-thread loop, the foreign-thread fallback, and the manual Bullet Refill alike.
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

  // 'loop' kind: while ON, main fires `run` every intervalMs through the command gate (so it can
  // never race a spawn). Bullet Refill is idempotent, so a dropped/repeated tick is harmless.
  //
  // CADENCE = THE crash lever (root cause, confirmed live 2026-07-07). Each tick runs AddItem via
  // ExecuteLuaString, which enqueues the Lua string into the game's BOUNDED pool of "lua buffer slots".
  // Hammering it in a loop exhausts the pool → the game prints "Out of lua buffer slots. Try again
  // later." → "Insufficient memory" → downstream calls return nil → the game closes. This was reproduced
  // even in Cheat Engine driving the same AddItem loop, so it's the ExecuteLuaString loop ITSELF, not our
  // injection. The pool DRAINS as the game runs, so the fix is to refill slowly enough that it drains
  // between ticks instead of filling. 3000ms keeps you effectively never out of ammo while cutting calls
  // ~3x vs the old 900ms. If it still closes over a long session, raise toward 5000 (rate-linked = a slot
  // leak → the real fix is below); if ammo ever feels short, lower toward 2000. Keep it above the gate's
  // settle (COOLDOWN_MS in main.js). THE definitive fix (zero VM calls, can't exhaust anything) is a
  // memory value-freeze on the ammo field instead of this loop — pending an ammo-address find.
  { id: 'infammo',  section: 'toggles', kind: 'loop', label: 'Infinite Ammo',
    run: REFILL_LUA, intervalMs: 3000 },

  // ---- vehicles (spawn at reticle) ----
  { id: 'auto',       section: 'vehicles', kind: 'action', label: 'Bogen Hailkal EV4 Sport', run: spawn('{966B8C19-155B-411D-A1AC-96C50E8C4FB4}') },
  { id: 'moto',       section: 'vehicles', kind: 'action', label: 'Kurahawa Tourer',         run: spawn('{86E6BC07-DF6F-4189-996C-9BBC68B4A6A3}') },
  { id: 'racedrone',  section: 'vehicles', kind: 'action', label: 'Race drone',              run: spawn('{9df9dde8-b514-4557-800b-2d6aa7f99c92}') },
  { id: 'sergei',     section: 'vehicles', kind: 'action', label: 'Sergei',                  run: spawn('{E082946E-343D-40E6-AC9A-F3E17C31318E}') },

  // ---- enemies (spawn at reticle) ----
  { id: 'ctdrone',    section: 'enemies', kind: 'action', label: 'Albion Counter-Terrorism Drone', run: spawn('{18538a70-fcbc-4d1f-bd3c-5c9653d72161}', 2.5) },
  { id: 'bloodhound', section: 'enemies', kind: 'action', label: 'Albion Bloodhound Drone',        run: spawn('{b1dea99c-e3d7-434b-94e9-39c7dd6ea991}', 2.5) },
  { id: 'omniskull',  section: 'enemies', kind: 'action', label: 'Omni Skull',                     run: spawn('{040dd2eb-60d2-4d77-82fd-1f6298d9a302}') },

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

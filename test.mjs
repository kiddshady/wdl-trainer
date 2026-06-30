// test.mjs — CLI to exercise the engine before we build the UI.
//
//   node test.mjs                      -> list all cheats
//   node test.mjs godmode on           -> toggle on   (off|on; default on)
//   node test.mjs nofelony off
//   node test.mjs sergei               -> fire an action (spawn at your reticle)
//   node test.mjs moto
//   node test.mjs lua "GiveMoney(50000)"   -> run ANY Lua string (the freeform console)
//
// Be IN-GAME (single-player), and for spawns, aim where you want it to appear.

import { attach } from './engine.mjs';
import { CHEATS, byId } from './cheats.mjs';

const [, , id, arg] = process.argv;

if (!id || id === 'list') {
  console.log('Cheats:');
  for (const c of CHEATS) console.log(`  ${c.id.padEnd(10)} ${c.kind === 'toggle' ? '[on/off]' : '[action]'}  ${c.label}`);
  console.log('  lua "<code>"  [action]  run any Lua string');
  process.exit(0);
}

let eng;
try {
  eng = attach();
} catch (e) {
  console.error('✗', e.message);
  process.exit(1);
}
console.log(`• attached  pid=${eng.info.pid}  ${eng.info.module}  ExecuteLuaString=${eng.info.execAddr}`);

try {
  if (id === 'lua') {
    const code = arg ?? '';
    if (!code) throw new Error('usage: node test.mjs lua "<lua code>"');
    eng.exec(code);
    console.log('✓ sent:', JSON.stringify(code));
  } else {
    const c = byId(id);
    if (!c) throw new Error(`unknown cheat "${id}" — run "node test.mjs" to list`);
    let lua, note;
    if (c.kind === 'toggle') {
      const state = (arg ?? 'on').toLowerCase();
      if (state !== 'on' && state !== 'off') throw new Error('state must be on|off');
      lua = state === 'off' ? c.off : c.on;
      note = `${c.label} → ${state.toUpperCase()}`;
    } else {
      lua = c.run;
      note = `${c.label} → fired`;
    }
    eng.exec(lua);
    console.log(`✓ ${note}`);
  }
} catch (e) {
  console.error('✗', e.message);
  process.exitCode = 1;
} finally {
  eng.close();
}

// hooksite.mjs — live hunt for a per-frame sim-thread hook site (Approach A discovery).
// Run from an ELEVATED terminal with Watch Dogs Legion OPEN and a save LOADED (in-world).
//
//   node scripts/hooksite.mjs scan                 → print A1 candidate + A2 vtable slots (+ their bytes)
//   node scripts/hooksite.mjs measure <addr> <len> → install a do-nothing probe there, sample the
//                                                     per-frame counter ~600ms, uninstall, print rate
//
// Flow: run `scan`, paste me the output, I decode the prologues and hand back exact `measure` cmds.
// For each candidate measure it (1) idle in-world and (2) in the PAUSE MENU — a real sim site ticks
// at your FPS in-world and DROPS TO ~0 when paused; a render site keeps ticking in menus (reject it).
// The probe handler only bumps a counter, so probing is low-risk; installing the FULL hook is not —
// that comes later, only after a candidate validates.

import { attach } from '../engine.mjs';

const [, , cmd, addrArg, lenArg, msArg] = process.argv;

function connect() {
  try { return attach(); }
  catch (e) { console.error('✗ attach failed:', e.message); console.error('  → game open + save loaded + terminal running as Administrator?'); process.exit(1); }
}

const eng = connect();
console.log(`✓ attached — pid ${eng.info.pid} · ${eng.info.module}`);
console.log(`  base ${eng.info.base} · execAddr ${eng.info.execAddr} · singletonPtr ${eng.info.singletonPtr}`);
console.log(`  spawnHook (AOB): ${eng.info.spawnHook || 'NOT FOUND — pattern not unique/absent; spawns fall back to old path'}\n`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function resolveAddr(arg) {                       // `a1` → the ASLR-fresh A1 candidate (no copying rebased addrs)
  if (arg !== 'a1') return arg;
  const c = eng.hook.candidates();
  if (!c.length) { console.error('no A1 candidate found'); process.exit(1); }
  console.log(`A1 candidate → ${c[0].addr}  (bytes ${c[0].firstBytes})`);
  return c[0].addr;
}

if (cmd === 'measure') {
  // measure <addr|a1> <len> [countdownSec] [windowSec] — countdown lets you alt-tab into position first
  if (!addrArg || !lenArg) { console.error('usage: measure <addr|a1> <len> [countdownSec=5] [windowSec=3]'); process.exit(1); }
  const addr = BigInt(resolveAddr(addrArg)), len = Number(lenArg);
  const cd = Number(process.argv[6]) || 5, win = (Number(process.argv[7]) || 3) * 1000;
  try {
    for (let n = cd; n > 0; n--) { process.stdout.write(`\r  ⏳ measuring in ${n}s …  ALT-TAB to the game NOW and get in position (walk in-world  /  or open PAUSE)      `); await sleep(1000); }
    process.stdout.write(`\r  ⏱  measuring for ${win / 1000}s … (stay in the game)                                            \n`);
    const r = await eng.hook.measure(addr, len, win);
    console.log(`\n  frameCounter delta: ${r.delta}   ≈ ${r.perSec}/sec`);
    console.log(r.perSec > 5
      ? `  → LIVE per-frame here. Do it once WALKING in-world and once in the PAUSE menu: sim site = ticks in-world, ~0 in pause.`
      : `  → ~0 here (paused / event-driven / wrong thread).`);
  } finally { try { eng.close(); } catch { /* ignore */ } }

} else if (cmd === 'spawntest') {
  // spawntest <addr:len> — install the FULL hook and run ONE car-spawn on the game thread via the
  // mailbox. The ultimate proof: if the car appears without crashing, this site fixes spawns.
  const [a, l] = (addrArg || '').split(':');
  if (!a || !l) { console.error('usage: spawntest <addr:len>   (e.g. spawntest 0x7ff9d7098bf0:16)'); process.exit(1); }
  try {
    console.log(`installing FULL hook at ${a} (len ${l}) …`);
    eng.hook.install(BigInt(a), Number(l));
    for (let n = 6; n > 0; n--) { process.stdout.write(`\r  ⏳ spawning in ${n}s …  ALT-TAB and AIM at open ground      `); await sleep(1000); }
    process.stdout.write(`\r  🚗 spawning via the game thread …                          \n`);
    const carLua = 'local l=GetReticleHitLocation() if l then SpawnEntityFromArchetype("{966B8C19-155B-411D-A1AC-96C50E8C4FB4}",l[1],l[2],l[3],0,0,0) end';
    const ok = eng.hook.exec(carLua, 1500);
    console.log(ok ? `  ✓ mailbox drained — the handler ran the spawn on the game thread.` : `  ✗ timed out — handler didn't drain (hook not firing at this site?).`);
    await sleep(400);
  } finally {
    try { eng.hook.uninstall(); } catch { /* ignore */ }
    try { eng.close(); } catch { /* ignore */ }
    console.log(`\n  hook removed.  → Did a car appear?  Did the game crash?`);
  }

} else if (cmd === 'batch') {
  // batch <addr:len> <addr:len> … — probe each candidate ~1.2s while you walk; reports each rate
  const pairs = process.argv.slice(3).map((x) => { const [a, l] = x.split(':'); return { addr: BigInt(a), len: Number(l), raw: a }; });
  if (!pairs.length) { console.error('usage: batch <addr:len> <addr:len> …'); process.exit(1); }
  const win = 1200, cd = Number(process.env.CD) || 6;
  try {
    for (let n = cd; n > 0; n--) { process.stdout.write(`\r  ⏳ starting in ${n}s …  ALT-TAB to the game and WALK — keep walking the whole time      `); await sleep(1000); }
    process.stdout.write(`\r  measuring ${pairs.length} candidates (~${(pairs.length * win / 1000).toFixed(1)}s) — keep walking …                     \n`);
    for (const p of pairs) {
      const r = await eng.hook.measure(p.addr, p.len, win);
      console.log(`  ${p.raw.padEnd(16)} len ${String(p.len).padStart(2)}  →  ≈ ${String(r.perSec).padStart(4)}/sec`);
    }
    console.log(`\n  ~your FPS ⇒ per-frame candidate (then we pause-test the winner). Paste the rates.`);
  } finally { try { eng.close(); } catch { /* ignore */ } }

} else if (cmd === 'monitor') {
  // monitor <addr|a1> <len> — installs the probe and prints the live rate every 0.5s until Ctrl+C
  if (!addrArg || !lenArg) { console.error('usage: monitor <addr|a1> <len>'); process.exit(1); }
  const addr = BigInt(resolveAddr(addrArg)), len = Number(lenArg);
  eng.hook.probe(addr, len);
  console.log(`\n  LIVE monitor installed. Alt-tab to the game; the rate updates every 0.5s.`);
  console.log(`  Walk in-world (should tick at your FPS) → open PAUSE (a SIM site drops to ~0).  Ctrl+C to stop & clean up.\n`);
  let last = eng.hook.frame() ?? 0;
  const iv = setInterval(() => {
    const now = eng.hook.frame() ?? 0;
    process.stdout.write(`\r  ≈ ${String(Math.round((now - last) / 0.5)).padStart(4)}/sec    (total ${now})        `);
    last = now;
  }, 500);
  process.on('SIGINT', () => { clearInterval(iv); try { eng.hook.uninstall(); } catch { /* ignore */ } try { eng.close(); } catch { /* ignore */ } console.log('\n\n✓ hook removed. bye.'); process.exit(0); });

} else if (cmd === 'selftest') {
  // POSITIVE CONTROL: hook ExecuteLuaString (we can trigger it on demand via exec()) and confirm the
  // counter climbs → proves the hook MECHANISM works, so a flat counter elsewhere means that site
  // just isn't per-frame (not a bug).  `selftest` dumps the real prologue; `selftest <len>` runs it.
  let ea = BigInt(eng.info.execAddr);
  const thunk = eng.hook.peek(ea, 5);
  if (thunk && thunk.slice(0, 2) === 'e9') {                 // follow an incremental-link jmp-thunk to the real fn
    const rel = Buffer.from(thunk, 'hex').readInt32LE(1);
    ea = ea + 5n + BigInt(rel);
    console.log(`ExecuteLuaString is a jmp-thunk → real function @ 0x${ea.toString(16)}`);
  } else {
    console.log(`ExecuteLuaString @ 0x${ea.toString(16)}`);
  }
  console.log(`  prologue bytes: ${eng.hook.peek(ea, 24)}`);
  try {
    if (!addrArg) {
      console.log('\n  → paste me those bytes; I pick the steal length, then you run:  selftest <len>');
    } else {
      const len = Number(addrArg);
      console.log(`\n  installing probe at the real ExecuteLuaString (stealing ${len}) and calling exec() 5× …`);
      eng.hook.probe(ea, len);
      let ran = 0;
      for (let i = 0; i < 5; i++) { try { eng.exec('local _ = 1'); ran++; } catch (e) { console.log('  exec err:', e.message); } await sleep(80); }
      const f = eng.hook.frame();
      try { eng.hook.uninstall(); } catch { /* ignore */ }
      console.log(`\n  exec() calls that ran: ${ran}/5   |   frameCounter after: ${f}`);
      console.log(f > 0
        ? `  ✓ HOOK MECHANISM WORKS — handler ran and counted. So A1's 0 means A1 is NOT per-frame. On to A2.`
        : `  ✗ counter still 0 with the hook triggered — the handler isn't running/counting (mechanism bug to fix).`);
    }
  } finally { try { eng.close(); } catch { /* ignore */ } }

} else if (cmd === 'hunt') {
  // RIP-sample all game threads → the goal is a function on ONE tid (the sim/main thread), not the
  // job-worker pool (which runs the same fns on ~11 tids and is the wrong thread for spawns).
  const rounds = Number(addrArg) || 220, gap = Number(lenArg) || 10, cd = Number(process.argv[6]) || 6;
  const hist = new Map();    // funcEntry → { count, tids:Set }
  const perTid = new Map();  // tid → sample count
  let total = 0;
  try {
    for (let n = cd; n > 0; n--) { process.stdout.write(`\r  ⏳ sampling in ${n}s …  ALT-TAB to the game and WALK around (stay in-world)      `); await sleep(1000); }
    process.stdout.write(`\r  📡 sampling ${rounds}×${gap}ms (~${Math.round(rounds * gap / 1000)}s) — keep walking, it'll stutter …                    \n`);
    for (let r = 0; r < rounds; r++) {
      for (const s of eng.hook.sampleRips()) {
        total++;
        perTid.set(s.tid, (perTid.get(s.tid) || 0) + 1);
        const fn = eng.hook.walkBack(s.rip);
        if (fn) { const rec = hist.get(fn) || { count: 0, tids: new Set() }; rec.count++; rec.tids.add(s.tid); hist.set(fn, rec); }
      }
      await sleep(gap);
    }
    console.log(`in-module RIP hits: ${total} across ${hist.size} functions.\n`);
    console.log(`samples per thread (busiest first — the pool shares tids; look for standout single tids):`);
    for (const [tid, c] of [...perTid.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)) console.log(`  tid ${String(tid).padStart(6)}: ${c}`);
    const solo = [...hist.entries()].filter(([, r]) => r.tids.size === 1).sort((a, b) => b[1].count - a[1].count).slice(0, 16);
    console.log(`\n⭐ thread-EXCLUSIVE hot functions (ONE tid only — these are main/sim/render specific, our real targets):`);
    for (const [fn, rec] of solo) console.log(`  ${String(rec.count).padStart(3)}×  tid ${String([...rec.tids][0]).padStart(6)}  ${fn}  ${eng.hook.peek(fn, 20)}`);
    console.log(`\nPaste ALL of this back — I identify the sim thread + pick clean-prologue single-tid candidates to measure.`);
  } finally { try { eng.close(); } catch { /* ignore */ } }

} else {
  // scan
  try {
    console.log('── A1: enclosing function of the ExecuteLuaString call (walk back to prologue) ──');
    const cands = eng.hook.candidates();
    if (!cands.length) console.log('  (none found — unexpected)');
    for (const c of cands) console.log(`  addr ${c.addr}\n  bytes ${c.firstBytes}`);

    console.log('\n── A2: script-singleton vtable — in-module method pointers ──');
    const slots = eng.hook.vtable();
    if (slots.length && slots[0].note) console.log('  ' + slots[0].note);
    for (const s of slots) if (s.target) console.log(`  slot ${String(s.slot).padStart(2)}  ${s.target}  ${s.firstBytes}`);

    console.log('\nPaste this whole output back — I decode the prologues and give you exact `measure` commands.');
  } finally { try { eng.close(); } catch { /* ignore */ } }
}

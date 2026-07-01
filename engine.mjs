// engine.mjs — the proven WDL engine, refactored into a reusable module.
//
//   import { attach } from './engine.mjs';
//   const eng = attach();          // discover + AOB-scan + resolve (once)
//   eng.exec('SetInvincibility(1)') // fire any Lua string into the game's VM
//
// Runs in Node (the Electron MAIN process, later). Requires Administrator + game open.

import koffi from 'koffi';
import { execFileSync } from 'node:child_process';

const hex = (v) => '0x' + BigInt(v).toString(16);

// ---- Win32 (handles = opaque uint64 BigInt) ----
const k = koffi.load('kernel32.dll');
const OpenProcess         = k.func('uint64 OpenProcess(uint32 access, bool inherit, uint32 pid)');
const ReadProcessMemory   = k.func('bool ReadProcessMemory(uint64 h, uint64 base, void* buf, size_t size, void* read)');
const WriteProcessMemory  = k.func('bool WriteProcessMemory(uint64 h, uint64 base, void* buf, size_t size, void* written)');
const VirtualAllocEx      = k.func('uint64 VirtualAllocEx(uint64 h, uint64 addr, size_t size, uint32 type, uint32 protect)');
const VirtualFreeEx       = k.func('bool VirtualFreeEx(uint64 h, uint64 addr, size_t size, uint32 type)');
const CreateRemoteThread  = k.func('uint64 CreateRemoteThread(uint64 h, void* attrs, size_t stack, uint64 start, uint64 param, uint32 flags, void* tid)');
const WaitForSingleObject = k.func('uint32 WaitForSingleObject(uint64 h, uint32 ms)');
const CloseHandle         = k.func('bool CloseHandle(uint64 h)');
const GetLastError        = k.func('uint32 GetLastError()');
// thread enumeration + suspend/resume — used ONLY to freeze the game while we patch code bytes
// (so no game thread can execute a half-written instruction). Part of the experimental main-thread hook.
const CreateToolhelp32Snapshot = k.func('uint64 CreateToolhelp32Snapshot(uint32 flags, uint32 pid)');
const Thread32First       = k.func('bool Thread32First(uint64 snap, void* entry)');
const Thread32Next        = k.func('bool Thread32Next(uint64 snap, void* entry)');
const OpenThread          = k.func('uint64 OpenThread(uint32 access, bool inherit, uint32 tid)');
const SuspendThread       = k.func('uint32 SuspendThread(uint64 h)');
const ResumeThread        = k.func('uint32 ResumeThread(uint64 h)');
const GetThreadContext    = k.func('bool GetThreadContext(uint64 h, void* ctx)'); // RIP-sampling to find per-frame code

const PROCESS_ACCESS = 0x0002 | 0x0008 | 0x0010 | 0x0020 | 0x0400;
const MEM_COMMIT_RESERVE = 0x3000, MEM_RELEASE = 0x8000;
const PAGE_READWRITE = 0x04, PAGE_EXECUTE_READWRITE = 0x40;
const WAIT_OBJECT_0 = 0;
const TH32CS_SNAPTHREAD = 0x04, THREAD_SUSPEND_RESUME = 0x0002, THREAD_GET_CONTEXT = 0x0008;
const CONTEXT_CONTROL_AMD64 = 0x00100001, CTX_FLAGS_OFF = 0x30, CTX_RIP_OFF = 0xF8; // x64 CONTEXT layout

const PATTERN = '48 8B 0D ? ? ? ? 48 8D 15 ? ? ? ? 45 31 C0 E8 ? ? ? ? 80 3D ? ? ? ? 00 74';

function discover() {
  const ps = `
$ErrorActionPreference='Stop'
try {
  $p = Get-Process -Name WatchDogsLegion -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $p) {
    $cand = Get-Process | Where-Object { $_.Name -match 'watch|dog|legion|dunia' } | Select-Object -Expand Name -Unique
    @{ error='process-not-found'; candidates=@($cand) } | ConvertTo-Json -Compress; return
  }
  $m = $p.Modules | Where-Object { $_.ModuleName -like 'DuniaDemo_clang_64*' } | Select-Object -First 1
  if (-not $m) { @{ error='dunia-module-not-found' } | ConvertTo-Json -Compress; return }
  [pscustomobject]@{ pid=$p.Id; base=$m.BaseAddress.ToInt64().ToString(); size=$m.ModuleMemorySize; module=$m.ModuleName } | ConvertTo-Json -Compress
} catch { @{ error=$_.Exception.Message } | ConvertTo-Json -Compress | Write-Output }`;
  const out = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], { encoding: 'utf8' });
  return JSON.parse(out.trim());
}

function rpm(h, addr, len) {
  const buf = Buffer.alloc(len);
  return ReadProcessMemory(h, addr, buf, len, null) ? buf : null;
}

const parsePattern = (s) => s.trim().split(/\s+/).map(t => t === '?' ? -1 : parseInt(t, 16));
function matchAt(buf, i, pat) {
  for (let j = 0; j < pat.length; j++) if (pat[j] !== -1 && buf[i + j] !== pat[j]) return false;
  return true;
}
function scanModule(h, base, size, pat, needle = Buffer.from([0x48, 0x8B, 0x0D])) {
  const CHUNK = 8 * 1024 * 1024, step = CHUNK - (pat.length - 1);
  const hits = new Map();
  for (let off = 0; off < size; off += step) {
    const len = Math.min(CHUNK, size - off);
    const buf = rpm(h, base + BigInt(off), len);
    if (!buf) continue;
    let idx = 0;
    while ((idx = buf.indexOf(needle, idx)) !== -1) {
      if (idx + pat.length <= buf.length && matchAt(buf, idx, pat))
        hits.set(off + idx, Buffer.from(buf.subarray(idx, idx + pat.length)));
      idx += 1;
    }
  }
  return [...hits.entries()].map(([moduleOff, bytes]) => ({ moduleOff, bytes }));
}

// AOB for the per-frame sim-thread function we hook to run spawns on the game thread (found live via
// RIP-sampling; see memory spawn-crash-rootcause). Pure-logic prologue (no RIP-relative), so it's
// build-portable — resolved by pattern each attach, not a hardcoded address. Steal 16 (clean boundary).
const HOOK_PATTERN = '48 83 EC 28 48 8B 01 FF 50 08 8B 48 08 83 C1 FF 8B 4C 88 10';
const HOOK_NEEDLE = Buffer.from([0x48, 0x83, 0xEC, 0x28, 0x48, 0x8B, 0x01]);
const HOOK_STOLEN = 16;

// koffi returns a uint64 as a JS Number when it fits in a safe integer, and only as BigInt above
// 2^53. A NULL/failure return is 0, which fits — so it comes back as Number 0, and `x === 0n` is
// FALSE. Compare value-agnostically so every handle/address failure guard actually fires.
const isNull = (v) => BigInt.asUintN(64, BigInt(v)) === 0n;

const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt.asUintN(64, BigInt(v))); return b; };

// Stub that bakes the singleton as an immediate — used for one-shot exec(), which re-reads & rebuilds
// it every call (the singleton can move between sessions/level loads).
const buildStub = (singleton, pCmd, fn) => Buffer.concat([
  Buffer.from([0x48, 0x83, 0xEC, 0x28]),     // sub rsp, 0x28
  Buffer.from([0x48, 0xB9]), u64(singleton), // mov rcx, singleton
  Buffer.from([0x48, 0xBA]), u64(pCmd),      // mov rdx, pCmd
  Buffer.from([0x4D, 0x31, 0xC0]),           // xor r8, r8
  Buffer.from([0x48, 0xB8]), u64(fn),        // mov rax, ExecuteLuaString
  Buffer.from([0xFF, 0xD0]),                 // call rax
  Buffer.from([0x48, 0x83, 0xC4, 0x28]),     // add rsp, 0x28
  Buffer.from([0x31, 0xC0]),                 // xor eax, eax
  Buffer.from([0xC3]),                       // ret
]);

// Stub that loads the singleton INDIRECTLY from its stable pointer slot at run time — used for
// persistent 'prepared' commands (loops). The stub is allocated once and reused for every fire, yet
// always calls with the CURRENT singleton, so it never needs rewriting (no stale baked immediate).
// Same stack layout as buildStub (proven in-game), with two extra non-stack instructions before call.
const buildStubIndirect = (pSlot, pCmd, fn) => Buffer.concat([
  Buffer.from([0x48, 0x83, 0xEC, 0x28]),     // sub rsp, 0x28
  Buffer.from([0x48, 0xB8]), u64(pSlot),     // mov rax, singletonPtrAddr
  Buffer.from([0x48, 0x8B, 0x08]),           // mov rcx, [rax]   ← live singleton
  Buffer.from([0x48, 0xBA]), u64(pCmd),      // mov rdx, pCmd
  Buffer.from([0x4D, 0x31, 0xC0]),           // xor r8, r8
  Buffer.from([0x48, 0xB8]), u64(fn),        // mov rax, ExecuteLuaString
  Buffer.from([0xFF, 0xD0]),                 // call rax
  Buffer.from([0x48, 0x83, 0xC4, 0x28]),     // add rsp, 0x28
  Buffer.from([0x31, 0xC0]),                 // xor eax, eax
  Buffer.from([0xC3]),                       // ret
]);

export function attach() {
  const info = discover();
  if (info.error) {
    throw new Error(`discovery failed: ${info.error} — is the game open and the terminal elevated?`);
  }
  const base = BigInt(info.base), size = Number(info.size);
  const h = OpenProcess(PROCESS_ACCESS, false, info.pid);
  if (isNull(h)) throw new Error(`OpenProcess failed (GetLastError ${GetLastError()}) — run as Administrator`);

  const matches = scanModule(h, base, size, parsePattern(PATTERN));
  if (!matches.length) throw new Error('in-game Lua signature not found (different game build?)');
  const { moduleOff, bytes } = matches[0];
  const matchAddr = base + BigInt(moduleOff);
  const singletonPtrAddr = matchAddr + 7n + BigInt(bytes.readInt32LE(3));
  const execAddr = matchAddr + 0x16n + BigInt(bytes.readInt32LE(18));

  // --- per-handle lifecycle bookkeeping ---
  let closed = false;            // set by close(); deferred frees skip once true (handle is gone)
  const freeTimers = new Set();  // pending setTimeout ids for deferred cmd frees (cleared on close)
  const prepared = new Set();    // live prepared commands (loops), so close() can reclaim their pages
  const leakedOnTimeout = [];    // addrs we couldn't free because a thread timed out still using them
  let mailbox = 0n, mtCmdPage = 0n;  // EXPERIMENTAL main-thread hook: mailbox page + reusable Lua cmd page
  let hookState = null;              // { target, stolenLen, stolen, pHandler, full } while a hook is installed
  let mtBusy = false;                // one-main-thread-command-in-flight guard (mtCmdPage is reused)
  let spawnSite;                     // spawn hook site: undefined=untried, null=not found, {addr,stolenLen}=resolved
  let spawnValidated = false;        // true once we've confirmed the site is a live per-frame callsite

  // read the live singleton (0n if not in a playable state — menu / loading / between level loads)
  function readSingleton() {
    const b = rpm(h, singletonPtrAddr, 8);
    return b ? b.readBigUInt64LE(0) : 0n;
  }
  // free a remote page after `delay`, unless the handle was closed meanwhile (then it dies with the process)
  function freeLater(addr, delay) {
    const id = setTimeout(() => {
      freeTimers.delete(id);
      if (closed) return;
      try { VirtualFreeEx(h, addr, 0, MEM_RELEASE); } catch { /* ignore */ }
    }, delay);
    freeTimers.add(id);
  }

  // Run any Lua string ONCE in the game's own VM (toggles / actions / spawns / Lua console).
  function exec(luaCode) {
    if (closed) throw new Error('engine closed');
    const singleton = readSingleton();
    if (singleton === 0n) throw new Error('script-system singleton is null — load a save / be in-game');

    const cmdBuf = Buffer.from(luaCode + '\0', 'utf8');
    const pCmd = VirtualAllocEx(h, 0n, cmdBuf.length, MEM_COMMIT_RESERVE, PAGE_READWRITE);
    if (isNull(pCmd)) throw new Error(`VirtualAllocEx(cmd) failed ${GetLastError()}`);
    WriteProcessMemory(h, pCmd, cmdBuf, cmdBuf.length, null);

    const stub = buildStub(singleton, pCmd, execAddr);
    const pStub = VirtualAllocEx(h, 0n, stub.length, MEM_COMMIT_RESERVE, PAGE_EXECUTE_READWRITE);
    if (isNull(pStub)) { try { VirtualFreeEx(h, pCmd, 0, MEM_RELEASE); } catch { /* ignore */ } throw new Error(`VirtualAllocEx(stub) failed ${GetLastError()}`); }
    WriteProcessMemory(h, pStub, stub, stub.length, null);

    const th = CreateRemoteThread(h, null, 0, pStub, 0n, 0, null);
    if (isNull(th)) { try { VirtualFreeEx(h, pStub, 0, MEM_RELEASE); VirtualFreeEx(h, pCmd, 0, MEM_RELEASE); } catch { /* ignore */ } throw new Error(`CreateRemoteThread failed ${GetLastError()}`); }
    const wr = WaitForSingleObject(th, 5000);
    CloseHandle(th);
    if (wr === WAIT_OBJECT_0) {
      VirtualFreeEx(h, pStub, 0, MEM_RELEASE);   // the stub finished executing → safe to free now
      // the game may read the Lua string a beat later (deferred execution), so freeing it
      // immediately can be a use-after-free crash — especially on heavier spawn scripts. Defer it.
      freeLater(pCmd, 4000);
    } else {
      // Timed out: the remote thread may STILL be running and reading both pages, so freeing now
      // would be a use-after-free. Don't leak them forever either — reclaim at close()/teardown.
      leakedOnTimeout.push(pStub, pCmd);
    }
    return true;
  }

  // Pre-build a reusable command for a hot loop (e.g. Infinite Ammo). Allocates the cmd buffer + an
  // indirect stub ONCE; each fire() only relaunches the thread — no per-tick alloc/free and no
  // per-tick use-after-free window. dispose() frees the pages; do it on stop / disconnect / reattach.
  function prepare(luaCode) {
    if (closed) throw new Error('engine closed');
    const cmdBuf = Buffer.from(luaCode + '\0', 'utf8');
    const pCmd = VirtualAllocEx(h, 0n, cmdBuf.length, MEM_COMMIT_RESERVE, PAGE_READWRITE);
    if (isNull(pCmd)) throw new Error(`VirtualAllocEx(prep cmd) failed ${GetLastError()}`);
    WriteProcessMemory(h, pCmd, cmdBuf, cmdBuf.length, null);

    const stub = buildStubIndirect(singletonPtrAddr, pCmd, execAddr);
    const pStub = VirtualAllocEx(h, 0n, stub.length, MEM_COMMIT_RESERVE, PAGE_EXECUTE_READWRITE);
    if (isNull(pStub)) { try { VirtualFreeEx(h, pCmd, 0, MEM_RELEASE); } catch { /* ignore */ } throw new Error(`VirtualAllocEx(prep stub) failed ${GetLastError()}`); }
    WriteProcessMemory(h, pStub, stub, stub.length, null);

    let disposed = false;
    const cmd = {
      pStub, pCmd,
      // fire the prepared command. Returns false (a harmless skip) if not in a playable state — the
      // indirect stub would otherwise call ExecuteLuaString with a null `this`.
      fire() {
        if (disposed || closed) return false;
        if (readSingleton() === 0n) return false;
        const th = CreateRemoteThread(h, null, 0, pStub, 0n, 0, null);
        if (isNull(th)) throw new Error(`CreateRemoteThread(prep) failed ${GetLastError()}`);
        // Short cap: the refill returns in <<1ms, so this bounds any stall-induced main-thread block
        // to ~1s instead of 5s. A timeout is harmless here — the persistent pages are never freed
        // mid-loop, so a lingering thread just re-reads constant content; the next fire reuses them.
        const wr = WaitForSingleObject(th, 1000);
        CloseHandle(th);
        return wr === WAIT_OBJECT_0;
      },
      // free the persistent pages. dispose() runs from stopLoop / disconnect / reattach — always
      // after the loop stops ticking and the last sub-ms fire has returned, so no thread is mid-read;
      // skipped if the handle is already closed (the pages die with the process).
      dispose() {
        if (disposed) return;
        disposed = true;
        prepared.delete(cmd);
        if (closed) return;
        try { VirtualFreeEx(h, pStub, 0, MEM_RELEASE); } catch { /* ignore */ }
        try { VirtualFreeEx(h, pCmd, 0, MEM_RELEASE); } catch { /* ignore */ }
      },
    };
    prepared.add(cmd);
    return cmd;
  }

  // ============================================================================================
  // EXPERIMENTAL — main-thread execution via a per-frame trampoline hook. OFF by default; nothing
  // in main.js/cheats routes through it yet. Purpose: run heavy Lua (spawns) ON the game's own
  // thread at a frame-safe point, the way stable Cheat Engine tables do — eliminating the
  // foreign-thread race that crashes SpawnEntityFromArchetype. See memory: spawn-crash-rootcause.
  //
  // Flow: we patch a 14-byte absolute JMP over `stolenLen` bytes at a callsite the game runs EVERY
  // FRAME on its update thread. The jmp lands in an RWX handler we inject; the handler (running on
  // the game thread) bumps a frameCounter, and — in 'full' mode — if a command is pending in a
  // shared mailbox, calls ExecuteLuaString(liveSingleton, cmdPtr, 0) right there, then replays the
  // stolen bytes and jmps back. Node just writes the mailbox and polls `done`; no CreateRemoteThread.
  //
  // THE UNKNOWN is the hook site: finding a real per-frame update-thread callsite needs the game
  // running. Use hook.probe(addr, stolenLen) first — it installs a do-nothing handler that only
  // bumps frameCounter; if RPM-polling shows the counter climbing at ~framerate, the site is valid.
  //
  // Mailbox layout (32B, zero-init): +0 i32 pending | +4 i32 done | +8 i32 disabled | +0xC i32
  // frameCounter | +0x10 u64 cmdPtr.
  const MB = { PENDING: 0x00, DONE: 0x04, DISABLED: 0x08, FRAME: 0x0C, CMDPTR: 0x10, SIZE: 0x20 };
  const i32 = (v) => { const b = Buffer.alloc(4); b.writeInt32LE(v | 0); return b; };
  const absJmp = (target) => Buffer.concat([Buffer.from([0xFF, 0x25, 0, 0, 0, 0]), u64(target)]); // jmp [rip+0]; dq target (14B)

  // Write code bytes into the game with ALL its threads frozen, so no thread can execute a
  // half-written instruction (the one real crash-on-install hazard). We only WPM while suspended —
  // never wait on anything the game holds — so there is no deadlock risk. If enumeration fails we
  // fall back to a bare write (best-effort). Used for both installing and restoring the patch.
  function patchAtomic(target, buf) {
    const threads = []; let snap = 0n;
    try {
      snap = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
      if (!isNull(snap)) {
        const e = Buffer.alloc(28); e.writeUInt32LE(28, 0);   // THREADENTRY32.dwSize
        let ok = Thread32First(snap, e);
        while (ok) {
          if (e.readUInt32LE(12) === info.pid) {               // th32OwnerProcessID
            const th = OpenThread(THREAD_SUSPEND_RESUME, false, e.readUInt32LE(8)); // th32ThreadID
            if (!isNull(th)) { SuspendThread(th); threads.push(th); }
          }
          ok = Thread32Next(snap, e);
        }
      }
      WriteProcessMemory(h, target, buf, buf.length, null);
    } finally {
      for (const th of threads) { try { ResumeThread(th); CloseHandle(th); } catch { /* ignore */ } }
      if (!isNull(snap)) { try { CloseHandle(snap); } catch { /* ignore */ } }
    }
  }

  // tiny label-resolving x64 emitter: parts are Buffers, { label } markers, or { jcc:'74'|'75', to }
  function asm(parts) {
    const labels = {}; let pos = 0;
    const sized = parts.map((p) => Buffer.isBuffer(p) ? { buf: p, size: p.length } : p.jcc ? { ...p, size: 2 } : { ...p, size: 0 });
    for (const s of sized) { if (s.label) labels[s.label] = pos; pos += s.size; }
    const out = []; pos = 0;
    for (const s of sized) {
      if (s.label) continue;
      if (s.jcc) { const rel = labels[s.to] - (pos + 2); if (rel < -128 || rel > 127) throw new Error('rel8 overflow'); out.push(Buffer.from([parseInt(s.jcc, 16), rel & 0xff])); pos += 2; }
      else { out.push(s.buf); pos += s.buf.length; }
    }
    return Buffer.concat(out);
  }

  // handler that ONLY bumps frameCounter (safe for probing an unknown callsite)
  function buildProbeHandler(stolen, target, stolenLen) {
    return Buffer.concat([
      Buffer.from([0x53, 0x9C]),                 // push rbx ; pushfq
      Buffer.from([0x48, 0xBB]), u64(mailbox),   // mov rbx, mailbox
      Buffer.from([0xFF, 0x43, MB.FRAME]),       // inc dword [rbx+0xC]
      Buffer.from([0x9D, 0x5B]),                 // popfq ; pop rbx
      stolen,                                    // original bytes (must be position-independent)
      absJmp(target + BigInt(stolenLen)),        // jmp back
    ]);
  }

  // full handler: bump frameCounter, and if pending && !disabled call ExecuteLuaString on this thread
  function buildFullHandler(stolen, target, stolenLen) {
    const body = asm([
      Buffer.from([0x53, 0x56, 0x50, 0x51, 0x52]),          // push rbx,rsi,rax,rcx,rdx
      Buffer.from([0x41, 0x50, 0x41, 0x51, 0x41, 0x52, 0x41, 0x53]), // push r8,r9,r10,r11
      Buffer.from([0x9C]),                                  // pushfq
      Buffer.concat([Buffer.from([0x48, 0xBB]), u64(mailbox)]),      // mov rbx, mailbox
      Buffer.from([0xFF, 0x43, MB.FRAME]),                  // inc dword [rbx+0xC]  (frameCounter++)
      Buffer.from([0x8B, 0x43, MB.DISABLED]),               // mov eax, [rbx+0x8]   (disabled)
      Buffer.from([0x85, 0xC0]),                            // test eax, eax
      { jcc: '75', to: 'epi' },                             // jnz epi
      Buffer.from([0x8B, 0x43, MB.PENDING]),                // mov eax, [rbx+0x0]   (pending)
      Buffer.from([0x85, 0xC0]),                            // test eax, eax
      { jcc: '74', to: 'epi' },                             // jz epi
      Buffer.concat([Buffer.from([0x48, 0xB9]), u64(singletonPtrAddr)]), // mov rcx, &singleton
      Buffer.from([0x48, 0x8B, 0x09]),                      // mov rcx, [rcx]       (live singleton)
      Buffer.from([0x48, 0x85, 0xC9]),                      // test rcx, rcx
      { jcc: '74', to: 'epi' },                             // jz epi (singleton null → leave pending, don't mark done; Node times out & disarms)
      Buffer.from([0x48, 0x8B, 0x53, MB.CMDPTR]),           // mov rdx, [rbx+0x10]  (cmdPtr)
      Buffer.from([0x4D, 0x31, 0xC0]),                      // xor r8, r8
      Buffer.from([0x48, 0x89, 0xE6]),                      // mov rsi, rsp         (save rsp)
      Buffer.from([0x48, 0x83, 0xE4, 0xF0]),                // and rsp, -16         (align)
      Buffer.from([0x48, 0x83, 0xEC, 0x20]),                // sub rsp, 0x20        (shadow)
      Buffer.concat([Buffer.from([0x48, 0xB8]), u64(execAddr)]),     // mov rax, ExecuteLuaString
      Buffer.from([0xFF, 0xD0]),                            // call rax
      Buffer.from([0x48, 0x89, 0xF4]),                      // mov rsp, rsi         (restore rsp)
      { label: 'clear' },
      Buffer.from([0xC7, 0x43, MB.PENDING, 0, 0, 0, 0]),    // mov dword [rbx+0x0], 0  (pending=0)
      Buffer.from([0xC7, 0x43, MB.DONE, 1, 0, 0, 0]),       // mov dword [rbx+0x4], 1  (done=1)
      { label: 'epi' },
      Buffer.from([0x9D]),                                  // popfq
      Buffer.from([0x41, 0x5B, 0x41, 0x5A, 0x41, 0x59, 0x41, 0x58]), // pop r11,r10,r9,r8
      Buffer.from([0x5A, 0x59, 0x58, 0x5E, 0x5B]),          // pop rdx,rcx,rax,rsi,rbx
    ]);
    return Buffer.concat([body, stolen, absJmp(target + BigInt(stolenLen))]);
  }

  function ensureMailbox() {
    if (mailbox !== 0n) return;
    // koffi returns a Number for addresses that fit in a safe integer, BigInt otherwise — force BigInt
    // so `mailbox + BigInt(offset)` pointer math never mixes types.
    const mb = VirtualAllocEx(h, 0n, MB.SIZE, MEM_COMMIT_RESERVE, PAGE_READWRITE);
    if (isNull(mb)) throw new Error(`VirtualAllocEx(mailbox) failed ${GetLastError()}`);
    mailbox = BigInt(mb);
    WriteProcessMemory(h, mailbox, Buffer.alloc(MB.SIZE), MB.SIZE, null);        // zero it
    const cp = VirtualAllocEx(h, 0n, 4096, MEM_COMMIT_RESERVE, PAGE_READWRITE);  // reusable Lua buffer
    if (isNull(cp)) throw new Error(`VirtualAllocEx(mtCmd) failed ${GetLastError()}`);
    mtCmdPage = BigInt(cp);
  }

  // install the trampoline at `addr`, stealing `stolenLen` (>=14) position-independent bytes.
  // full=false → probe handler (frameCounter only, safe); full=true → runs pending mailbox commands.
  function installHook(addr, stolenLen, full) {
    if (closed) throw new Error('engine closed');
    if (hookState) throw new Error('a hook is already installed — uninstall first');
    if (stolenLen < 14) throw new Error('stolenLen must be >=14 (absolute jmp is 14 bytes)');
    ensureMailbox();
    const target = BigInt(addr);
    const stolen = rpm(h, target, stolenLen);
    if (!stolen) throw new Error('cannot read stolen bytes at hook site');
    const handler = (full ? buildFullHandler : buildProbeHandler)(stolen, target, stolenLen);
    const pHandler = VirtualAllocEx(h, 0n, handler.length, MEM_COMMIT_RESERVE, PAGE_EXECUTE_READWRITE);
    if (isNull(pHandler)) throw new Error(`VirtualAllocEx(handler) failed ${GetLastError()}`);
    WriteProcessMemory(h, pHandler, handler, handler.length, null);
    // overwrite the site with `jmp pHandler`, padded with NOPs to exactly stolenLen bytes,
    // with the game's threads frozen so none executes a torn instruction mid-write.
    const patch = Buffer.concat([absJmp(pHandler), Buffer.alloc(stolenLen - 14, 0x90)]);
    patchAtomic(target, patch);
    hookState = { target, stolenLen, stolen, pHandler, full: !!full };
    return { handlerAddr: hex(pHandler), mailbox: hex(mailbox) };
  }

  // remove the hook: restore original bytes FIRST (game stops entering our handler), then leak the
  // handler page (freed when the game exits) — never free it out from under an in-flight game thread.
  function uninstallHook() {
    if (!hookState) return;
    try { WriteProcessMemory(h, mailbox + BigInt(MB.DISABLED), i32(1), 4, null); } catch { /* ignore */ }
    // if a full-handler command is mid-flight, briefly wait for it to clear before restoring/freeing
    if (hookState.full) { const t = Date.now() + 100; while (Date.now() < t) { const p = rpm(h, mailbox + BigInt(MB.PENDING), 4); if (!p || p.readInt32LE(0) === 0) break; } }
    // Restoring the original bytes (threads frozen) is what actually stops the game entering our
    // handler — `disabled` only gates the FULL handler's work path (the probe handler ignores it).
    try { patchAtomic(hookState.target, hookState.stolen); } catch { /* ignore */ }
    if (!closed) freeLater(hookState.pHandler, 5000);  // reclaim after any in-flight handler surely returned
    hookState = null;
  }

  const readFrame = () => { const b = rpm(h, mailbox + BigInt(MB.FRAME), 4); return b ? b.readInt32LE(0) : null; };

  // Run Lua on the game thread via an installed FULL hook. `pending` is armed LAST so the handler
  // never sees a stale cmdPtr (safe on x64 TSO given the ~1-frame consumer latency — no explicit
  // barrier). Busy-polls `done`; returns false and disarms on timeout, bailing fast if the
  // frameCounter shows the hook isn't firing at all (wrong site) so a bad site can't freeze the UI.
  function execOnMainThread(luaCode, timeoutMs = 150) {
    if (!hookState || !hookState.full) throw new Error('no full main-thread hook installed');
    if (mtBusy) throw new Error('a main-thread command is already in flight');
    const buf = Buffer.from(luaCode + '\0', 'utf8');
    if (buf.length > 4096) throw new Error('lua too long for the main-thread cmd page (max 4095 bytes + NUL)');
    mtBusy = true;
    try {
      const f0 = readFrame();
      WriteProcessMemory(h, mtCmdPage, buf, buf.length, null);
      WriteProcessMemory(h, mailbox + BigInt(MB.CMDPTR), u64(mtCmdPage), 8, null);
      WriteProcessMemory(h, mailbox + BigInt(MB.DONE), i32(0), 4, null);
      WriteProcessMemory(h, mailbox + BigInt(MB.PENDING), i32(1), 4, null);   // arm last
      const start = Date.now(), deadline = start + timeoutMs;
      while (Date.now() < deadline) {
        const d = rpm(h, mailbox + BigInt(MB.DONE), 4);
        if (d && d.readInt32LE(0) === 1) return true;
        if (Date.now() - start > 40 && f0 !== null && readFrame() === f0) break;  // hook not firing → bail
      }
      try { WriteProcessMemory(h, mailbox + BigInt(MB.PENDING), i32(0), 4, null); } catch { /* ignore */ }  // disarm so a late frame can't fire it
      return false;
    } finally { mtBusy = false; }
  }

  // Resolve the per-frame hook site by AOB (cached per attach). Requires a UNIQUE match for safety.
  function resolveHookSite() {
    if (spawnSite !== undefined) return spawnSite;
    try {
      const m = scanModule(h, base, size, parsePattern(HOOK_PATTERN), HOOK_NEEDLE);
      spawnSite = m.length === 1 ? { addr: base + BigInt(m[0].moduleOff), stolenLen: HOOK_STOLEN } : null;
    } catch { spawnSite = null; }
    return spawnSite;
  }

  // Run a heavy Lua spawn ON the game's own thread via the per-frame hook — eliminates the foreign-
  // thread race that crashes SpawnEntityFromArchetype. Validates the site is genuinely per-frame (a
  // SAFE probe) before ever full-installing; installs full → drains the mailbox → uninstalls per call.
  // Returns { ok, reason }; ok:false ⇒ the caller should fall back to exec() (the old, crash-prone path).
  function spawnOnMainThread(luaCode) {
    if (closed) return { ok: false, reason: 'closed' };
    const site = resolveHookSite();
    if (!site) return { ok: false, reason: 'hook site not found (game build?)' };
    if (hookState) return { ok: false, reason: 'a hook is already installed' };
    if (!spawnValidated) {   // probe-validate (retry until it passes once; spawns are in-world so the sim site ticks)
      try { installHook(site.addr, site.stolenLen, false); } catch { return { ok: false, reason: 'probe install failed' }; }
      const f0 = readFrame() ?? 0, t = Date.now() + 250;
      while (Date.now() < t && (readFrame() ?? 0) - f0 <= 2) { /* spin briefly */ }
      const advanced = (readFrame() ?? 0) - f0 > 2;
      try { uninstallHook(); } catch { /* ignore */ }
      if (!advanced) return { ok: false, reason: 'site not ticking (menu / not in-world?)' };
      spawnValidated = true;
    }
    try {
      installHook(site.addr, site.stolenLen, true);
      const done = execOnMainThread(luaCode, 1500);
      return { ok: done, reason: done ? 'ok' : 'hook did not fire' };
    } catch (e) { return { ok: false, reason: e.message }; }
    finally { try { uninstallHook(); } catch { /* ignore */ } }
  }

  // ---- hook-site DISCOVERY helpers (read-only; used to find a per-frame sim-thread callsite) ----

  // A1: our AOB match sits INSIDE the function that calls ExecuteLuaString (the E8 at matchAddr+0x16).
  // Walk backward to that function's entry (the byte right after the preceding int3 padding) and
  // return its first bytes so we can decode a >=14-byte position-independent steal. Probe this entry:
  // if frameCounter climbs at framerate while idle in-world, it's the per-frame pump.
  function findPumpCandidates() {
    const back = 0x800;
    const buf = rpm(h, matchAddr - BigInt(back), back);
    if (!buf) return [];
    for (let i = buf.length - 1; i >= 3; i--) {
      if (buf[i] === 0xCC && buf[i - 1] === 0xCC && buf[i - 2] === 0xCC) {
        const start = matchAddr - BigInt(back) + BigInt(i + 1);
        const head = rpm(h, start, 24);
        return [{ addr: hex(start), firstBytes: head ? head.toString('hex') : null }];
      }
    }
    return [];
  }

  // A2: read the script-system singleton → its vtable → the in-module method pointers. Returns each
  // virtual's address + prologue bytes; probe them one at a time to find the per-frame Update/Tick.
  function vtableSlots(maxSlots = 48) {
    const s = rpm(h, singletonPtrAddr, 8); if (!s) return [];
    const singleton = s.readBigUInt64LE(0); if (singleton === 0n) return [{ note: 'singleton null — load a save first' }];
    const v = rpm(h, singleton, 8); if (!v) return [];
    const vtbl = v.readBigUInt64LE(0);
    const end = base + BigInt(size);
    if (vtbl < base || vtbl >= end) return [{ note: 'first qword is not an in-module vtable ptr — object may be a plain struct', vtbl: hex(vtbl) }];
    const slotsBuf = rpm(h, vtbl, 8 * maxSlots); if (!slotsBuf) return [];
    const out = [];
    for (let i = 0; i < maxSlots; i++) {
      const p = slotsBuf.readBigUInt64LE(i * 8);
      if (p >= base && p < end) { const code = rpm(h, p, 20); out.push({ slot: i, target: hex(p), firstBytes: code ? code.toString('hex') : null }); }
    }
    return out;
  }

  // Install a probe handler at `addr`, sample the frameCounter over `ms`, then uninstall. Async so it
  // never blocks the UI. perSec ≈ display FPS ⇒ a live per-frame site; 0 ⇒ dead/wrong-thread/event-driven.
  function measure(addr, stolenLen, ms = 500) {
    installHook(addr, stolenLen, false);
    let f0;
    try { f0 = readFrame() ?? 0; } catch (e) { try { uninstallHook(); } catch { /* ignore */ } throw e; }
    return new Promise((resolve) => setTimeout(() => {
      let f1 = 0;
      try { f1 = readFrame() ?? 0; } catch { /* ignore */ }
      try { uninstallHook(); } catch { /* ignore */ }
      resolve({ delta: f1 - f0, perSec: Math.round((f1 - f0) / (ms / 1000)) });
    }, ms));
  }

  // walk a code address back to its function entry (byte after the preceding int3 padding)
  function walkBack(addr) {
    const a = BigInt(addr), backN = 0x1200;
    const buf = rpm(h, a - BigInt(backN), backN);
    if (!buf) return null;
    for (let i = buf.length - 1; i >= 3; i--) {
      if (buf[i] === 0xCC && buf[i - 1] === 0xCC && buf[i - 2] === 0xCC) return hex(a - BigInt(backN) + BigInt(i + 1));
    }
    return null;
  }

  // one RIP-sampling round: suspend each game thread briefly, read its RIP, resume. Returns in-module
  // {tid, rip} hits. Repeated by the caller with small gaps → functions the sim thread runs every
  // frame show up most. Read-only + one-thread-at-a-time suspend (no deadlock); just causes stutter.
  let ctxBuf = null;
  function sampleRips() {
    const out = [];
    const snap = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
    if (isNull(snap)) return out;
    if (!ctxBuf) ctxBuf = Buffer.alloc(8192);   // >4KB → its own 16-byte-aligned allocation (GetThreadContext needs it)
    const e = Buffer.alloc(28); e.writeUInt32LE(28, 0);
    const end = base + BigInt(size);
    let ok = Thread32First(snap, e);
    while (ok) {
      if (e.readUInt32LE(12) === info.pid) {
        const tid = e.readUInt32LE(8);
        const th = OpenThread(THREAD_GET_CONTEXT | THREAD_SUSPEND_RESUME, false, tid);
        if (!isNull(th)) {
          SuspendThread(th);
          ctxBuf.writeUInt32LE(CONTEXT_CONTROL_AMD64, CTX_FLAGS_OFF);
          const gok = GetThreadContext(th, ctxBuf);
          ResumeThread(th);
          CloseHandle(th);
          if (gok) { const rip = ctxBuf.readBigUInt64LE(CTX_RIP_OFF); if (rip >= base && rip < end) out.push({ tid, rip: hex(rip) }); }
        }
      }
      ok = Thread32Next(snap, e);
    }
    CloseHandle(snap);
    return out;
  }

  // Cheap, passive liveness probe: a tiny ReadProcessMemory on a known module address. No thread
  // injection, no alloc — just a read. Returns false once the game process exits (the handle's RPM
  // starts failing), which the main-process watchdog uses to auto-reset toggles on game close.
  function alive() {
    try { return !!rpm(h, singletonPtrAddr, 8); } catch { return false; }
  }

  function close() {
    closed = true;                                         // make pending deferred frees no-op first
    if (hookState) {                                        // remove any main-thread hook so the game
      try { WriteProcessMemory(h, mailbox + BigInt(MB.DISABLED), i32(1), 4, null); } catch { /* ignore */ }
      try { patchAtomic(hookState.target, hookState.stolen); } catch { /* ignore */ } // stops entering our handler
      hookState = null;                                     // leak the handler page (dies with the process) — never free under a live thread
    }
    for (const id of freeTimers) clearTimeout(id);
    freeTimers.clear();
    // reclaim still-allocated remote pages while the handle is valid (prepared loops, timeout leaks)
    for (const cmd of prepared) { try { VirtualFreeEx(h, cmd.pStub, 0, MEM_RELEASE); VirtualFreeEx(h, cmd.pCmd, 0, MEM_RELEASE); } catch { /* ignore */ } }
    prepared.clear();
    for (const addr of leakedOnTimeout) { try { VirtualFreeEx(h, addr, 0, MEM_RELEASE); } catch { /* ignore */ } }
    leakedOnTimeout.length = 0;
    CloseHandle(h);
  }

  resolveHookSite();                   // resolve the spawn hook site now (amortized into the attach scan cost)

  return {
    info: { pid: info.pid, module: info.module, base: hex(base), execAddr: hex(execAddr), singletonPtr: hex(singletonPtrAddr), spawnHook: spawnSite ? hex(spawnSite.addr) : null },
    exec,
    prepare,
    spawnOnMainThread,                 // heavy spawns → run on the game thread (crash-free); falls back to exec()
    alive,
    close,
    // EXPERIMENTAL main-thread hook (off by default; see the block above). Use probe() to validate a
    // candidate per-frame callsite with the game running BEFORE installing the full handler.
    hook: {
      probe: (addr, stolenLen) => installHook(addr, stolenLen, false),
      install: (addr, stolenLen) => installHook(addr, stolenLen, true),
      uninstall: uninstallHook,
      exec: execOnMainThread,
      frame: readFrame,
      installed: () => !!hookState,
      // discovery (read-only) — find & measure per-frame hook-site candidates with the game running
      candidates: findPumpCandidates,   // A1: enclosing fn of the ExecuteLuaString call
      vtable: vtableSlots,              // A2: script-singleton vtable method pointers
      measure,                          // install probe, sample frameCounter over ms, uninstall
      peek: (addr, n) => { const b = rpm(h, BigInt(addr), n); return b ? b.toString('hex') : null; },
      sampleRips,                       // one round of thread-RIP sampling (for the `hunt` command)
      walkBack,                         // a code addr → its function entry
    },
  };
}

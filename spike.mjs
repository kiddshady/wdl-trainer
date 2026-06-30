// WDL engine spike — proves we can drive the game's built-in Lua VM natively.
//
// Pipeline: attach -> AOB-scan the Dunia module -> resolve ExecuteLuaString +
// pScriptSystemSingleton (the door reg2k found) -> remote-call
// ExecuteLuaString(singleton, "SetInvincibility(1)", 0) via an x64 stub.
//
// If God Mode turns on in-game (and the game doesn't crash), the whole engine
// is proven and everything else is just UI + Lua strings.
//
// RUN: elevated (Administrator), with Watch Dogs Legion open and you IN-GAME
//      (single-player), controlling an operative. Then:  npm install && node spike.mjs

import koffi from 'koffi';
import { execFileSync } from 'node:child_process';

const hex = (v) => '0x' + BigInt(v).toString(16);

// ---- 0. The whole "cheat" is this one line. Flip to (0) to turn God Mode off. ----
const LUA_CMD = 'SetInvincibility(1)';

// ---- 1. Discover PID + Dunia module via PowerShell. (Pragmatic shortcut for the
//        spike; the real app will do this in pure koffi with Toolhelp.) ----
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
  [pscustomobject]@{
    pid    = $p.Id
    base   = $m.BaseAddress.ToInt64().ToString()
    size   = $m.ModuleMemorySize
    module = $m.ModuleName
  } | ConvertTo-Json -Compress
} catch {
  @{ error = $_.Exception.Message } | ConvertTo-Json -Compress | Write-Output
}`;
  const out = execFileSync('powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], { encoding: 'utf8' });
  return JSON.parse(out.trim());
}

// ---- 2. Win32 via koffi. Handles are opaque uint64 (BigInt) for simplicity. ----
const k = koffi.load('kernel32.dll');
const OpenProcess         = k.func('uint64 OpenProcess(uint32 access, bool inherit, uint32 pid)');
const ReadProcessMemory   = k.func('bool ReadProcessMemory(uint64 h, uint64 base, void* buf, size_t size, void* read)');
const WriteProcessMemory  = k.func('bool WriteProcessMemory(uint64 h, uint64 base, void* buf, size_t size, void* written)');
const VirtualAllocEx      = k.func('uint64 VirtualAllocEx(uint64 h, uint64 addr, size_t size, uint32 type, uint32 protect)');
const CreateRemoteThread  = k.func('uint64 CreateRemoteThread(uint64 h, void* attrs, size_t stack, uint64 start, uint64 param, uint32 flags, void* tid)');
const WaitForSingleObject = k.func('uint32 WaitForSingleObject(uint64 h, uint32 ms)');
const CloseHandle         = k.func('bool CloseHandle(uint64 h)');
const GetLastError        = k.func('uint32 GetLastError()');

const PROCESS_ACCESS = 0x0002 | 0x0008 | 0x0010 | 0x0020 | 0x0400; // create_thread|vm_op|vm_read|vm_write|query
const MEM_COMMIT_RESERVE = 0x3000;
const PAGE_READWRITE = 0x04;
const PAGE_EXECUTE_READWRITE = 0x40;

function rpm(h, addr, len) {
  const buf = Buffer.alloc(len);
  return ReadProcessMemory(h, addr, buf, len, null) ? buf : null;
}

// ---- 3. AOB scan. The SAME pattern resolves both symbols (reg2k lines 550-551). ----
const PATTERN = '48 8B 0D ? ? ? ? 48 8D 15 ? ? ? ? 45 31 C0 E8 ? ? ? ? 80 3D ? ? ? ? 00 74';
const parsePattern = (s) => s.trim().split(/\s+/).map(t => t === '?' ? -1 : parseInt(t, 16));
function matchAt(buf, i, pat) {
  for (let j = 0; j < pat.length; j++) if (pat[j] !== -1 && buf[i + j] !== pat[j]) return false;
  return true;
}
function scanModule(h, base, size, pat) {
  const NEEDLE = Buffer.from([0x48, 0x8B, 0x0D]); // concrete prefix -> native fast-path
  const CHUNK = 8 * 1024 * 1024;
  const step = CHUNK - (pat.length - 1);          // overlap so no match straddles a boundary
  const hits = new Map();                         // moduleOff -> matched bytes (dedup)
  for (let off = 0; off < size; off += step) {
    const len = Math.min(CHUNK, size - off);
    const buf = rpm(h, base + BigInt(off), len);
    if (!buf) continue;                           // unreadable region -> skip
    let idx = 0;
    while ((idx = buf.indexOf(NEEDLE, idx)) !== -1) {
      if (idx + pat.length <= buf.length && matchAt(buf, idx, pat))
        hits.set(off + idx, Buffer.from(buf.subarray(idx, idx + pat.length)));
      idx += 1;
    }
  }
  return [...hits.entries()].map(([moduleOff, bytes]) => ({ moduleOff, bytes }));
}

// ---- 4. x64 stub:  ExecuteLuaString(rcx=singleton, rdx=pCmd, r8=0)  ----
const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt.asUintN(64, BigInt(v))); return b; };
const buildStub = (singleton, pCmd, fn) => Buffer.concat([
  Buffer.from([0x48, 0x83, 0xEC, 0x28]),     // sub rsp, 0x28   (shadow space + align)
  Buffer.from([0x48, 0xB9]), u64(singleton), // mov rcx, singleton
  Buffer.from([0x48, 0xBA]), u64(pCmd),      // mov rdx, pCmd
  Buffer.from([0x4D, 0x31, 0xC0]),           // xor r8, r8
  Buffer.from([0x48, 0xB8]), u64(fn),        // mov rax, ExecuteLuaString
  Buffer.from([0xFF, 0xD0]),                 // call rax
  Buffer.from([0x48, 0x83, 0xC4, 0x28]),     // add rsp, 0x28
  Buffer.from([0x31, 0xC0]),                 // xor eax, eax
  Buffer.from([0xC3]),                       // ret
]);

// ---- main ----
const info = discover();
if (info.error) {
  console.error('✗ discovery failed:', info.error);
  if (info.candidates?.length) console.error('  running processes that might be it:', info.candidates.join(', '));
  console.error('  -> is the game open, and is this terminal running as Administrator?');
  process.exit(1);
}
const base = BigInt(info.base), size = Number(info.size);
console.log(`• process  WatchDogsLegion  pid=${info.pid}`);
console.log(`• module   ${info.module}  base=${hex(base)}  size=${(size / 1048576).toFixed(1)} MB`);

const h = OpenProcess(PROCESS_ACCESS, false, info.pid);
if (h === 0n) { console.error('✗ OpenProcess failed (GetLastError =', GetLastError(), ') — run as Administrator'); process.exit(1); }

console.log('• scanning for the in-game-Lua signature…');
const matches = scanModule(h, base, size, parsePattern(PATTERN));
if (matches.length === 0) { console.error('✗ pattern not found — different game build/module?'); process.exit(1); }
if (matches.length > 1) console.warn(`! ${matches.length} matches found — using the first`);

const { moduleOff, bytes } = matches[0];
const matchAddr        = base + BigInt(moduleOff);
const singletonPtrAddr = matchAddr + 7n   + BigInt(bytes.readInt32LE(3));   // mov rcx,[rip+disp]
const execAddr         = matchAddr + 0x16n + BigInt(bytes.readInt32LE(18)); // call rel32
const ssBuf = rpm(h, singletonPtrAddr, 8);
if (!ssBuf) { console.error('✗ could not read singleton pointer'); process.exit(1); }
const singleton = ssBuf.readBigUInt64LE(0);

console.log(`• match             @ ${hex(matchAddr)}`);
console.log(`• ExecuteLuaString  @ ${hex(execAddr)}`);
console.log(`• pScriptSystem*    @ ${hex(singletonPtrAddr)}  ->  singleton = ${hex(singleton)}`);
if (singleton === 0n) { console.error('✗ singleton is null — load a save / be in-game first'); process.exit(1); }

// write the Lua command string into the game
const cmdBuf = Buffer.from(LUA_CMD + '\0', 'latin1');
const pCmd = VirtualAllocEx(h, 0n, cmdBuf.length, MEM_COMMIT_RESERVE, PAGE_READWRITE);
if (pCmd === 0n) { console.error('✗ VirtualAllocEx(cmd) failed', GetLastError()); process.exit(1); }
if (!WriteProcessMemory(h, pCmd, cmdBuf, cmdBuf.length, null)) { console.error('✗ WPM(cmd) failed', GetLastError()); process.exit(1); }

// write the stub
const stub = buildStub(singleton, pCmd, execAddr);
const pStub = VirtualAllocEx(h, 0n, stub.length, MEM_COMMIT_RESERVE, PAGE_EXECUTE_READWRITE);
if (pStub === 0n) { console.error('✗ VirtualAllocEx(stub) failed', GetLastError()); process.exit(1); }
if (!WriteProcessMemory(h, pStub, stub, stub.length, null)) { console.error('✗ WPM(stub) failed', GetLastError()); process.exit(1); }

console.log(`• firing  ExecuteLuaString(singleton, "${LUA_CMD}", 0)  via remote thread…`);
const th = CreateRemoteThread(h, null, 0, pStub, 0n, 0, null);
if (th === 0n) { console.error('✗ CreateRemoteThread failed', GetLastError()); process.exit(1); }
WaitForSingleObject(th, 5000);
CloseHandle(th);
CloseHandle(h);

console.log('\n✓ sent. If the game did NOT crash, check in-game — God Mode should be ON.');
console.log('  Turn it off: set LUA_CMD = "SetInvincibility(0)" and run again.');

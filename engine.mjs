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

const PROCESS_ACCESS = 0x0002 | 0x0008 | 0x0010 | 0x0020 | 0x0400;
const MEM_COMMIT_RESERVE = 0x3000, MEM_RELEASE = 0x8000;
const PAGE_READWRITE = 0x04, PAGE_EXECUTE_READWRITE = 0x40;
const WAIT_OBJECT_0 = 0;

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
function scanModule(h, base, size, pat) {
  const NEEDLE = Buffer.from([0x48, 0x8B, 0x0D]);
  const CHUNK = 8 * 1024 * 1024, step = CHUNK - (pat.length - 1);
  const hits = new Map();
  for (let off = 0; off < size; off += step) {
    const len = Math.min(CHUNK, size - off);
    const buf = rpm(h, base + BigInt(off), len);
    if (!buf) continue;
    let idx = 0;
    while ((idx = buf.indexOf(NEEDLE, idx)) !== -1) {
      if (idx + pat.length <= buf.length && matchAt(buf, idx, pat))
        hits.set(off + idx, Buffer.from(buf.subarray(idx, idx + pat.length)));
      idx += 1;
    }
  }
  return [...hits.entries()].map(([moduleOff, bytes]) => ({ moduleOff, bytes }));
}

const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt.asUintN(64, BigInt(v))); return b; };
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

export function attach() {
  const info = discover();
  if (info.error) {
    const extra = info.candidates?.length ? ` (running: ${info.candidates.join(', ')})` : '';
    throw new Error(`discovery failed: ${info.error}${extra} — is the game open and the terminal elevated?`);
  }
  const base = BigInt(info.base), size = Number(info.size);
  const h = OpenProcess(PROCESS_ACCESS, false, info.pid);
  if (h === 0n) throw new Error(`OpenProcess failed (GetLastError ${GetLastError()}) — run as Administrator`);

  const matches = scanModule(h, base, size, parsePattern(PATTERN));
  if (!matches.length) throw new Error('in-game Lua signature not found (different game build?)');
  const { moduleOff, bytes } = matches[0];
  const matchAddr = base + BigInt(moduleOff);
  const singletonPtrAddr = matchAddr + 7n + BigInt(bytes.readInt32LE(3));
  const execAddr = matchAddr + 0x16n + BigInt(bytes.readInt32LE(18));

  // Run any Lua string in the game's own VM.
  function exec(luaCode) {
    // Re-read the singleton each call — it can move between sessions/level loads.
    const ssBuf = rpm(h, singletonPtrAddr, 8);
    const singleton = ssBuf ? ssBuf.readBigUInt64LE(0) : 0n;
    if (singleton === 0n) throw new Error('script-system singleton is null — load a save / be in-game');

    const cmdBuf = Buffer.from(luaCode + '\0', 'latin1');
    const pCmd = VirtualAllocEx(h, 0n, cmdBuf.length, MEM_COMMIT_RESERVE, PAGE_READWRITE);
    if (pCmd === 0n) throw new Error(`VirtualAllocEx(cmd) failed ${GetLastError()}`);
    WriteProcessMemory(h, pCmd, cmdBuf, cmdBuf.length, null);

    const stub = buildStub(singleton, pCmd, execAddr);
    const pStub = VirtualAllocEx(h, 0n, stub.length, MEM_COMMIT_RESERVE, PAGE_EXECUTE_READWRITE);
    if (pStub === 0n) throw new Error(`VirtualAllocEx(stub) failed ${GetLastError()}`);
    WriteProcessMemory(h, pStub, stub, stub.length, null);

    const th = CreateRemoteThread(h, null, 0, pStub, 0n, 0, null);
    if (th === 0n) throw new Error(`CreateRemoteThread failed ${GetLastError()}`);
    const wr = WaitForSingleObject(th, 5000);
    CloseHandle(th);
    if (wr === WAIT_OBJECT_0) {
      VirtualFreeEx(h, pStub, 0, MEM_RELEASE);   // the stub finished executing → safe to free now
      // the game may read the Lua string a beat later (deferred execution), so freeing it
      // immediately can be a use-after-free crash — especially on heavier spawn scripts. Defer it.
      const cmdToFree = pCmd;
      setTimeout(() => { try { VirtualFreeEx(h, cmdToFree, 0, MEM_RELEASE); } catch { /* ignore */ } }, 4000);
    }
    return true;
  }

  return {
    info: { pid: info.pid, module: info.module, base: hex(base), execAddr: hex(execAddr), singletonPtr: hex(singletonPtrAddr) },
    exec,
    close: () => CloseHandle(h),
  };
}

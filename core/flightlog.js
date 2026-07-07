'use strict';

/**
 * Flight recorder — an append-only JSONL trace of what the trainer did, so an intermittent
 * game close ("se cierra limpio") can be diagnosed after the fact instead of guessed at.
 *
 * The whole point: the game vanishing is random and leaves no crash dialog, so we record every
 * injection sub-step (which path it took, hook install/uninstall, foreign-thread exec, the
 * game-thread mailbox arm/result) with a timestamp, and mark the moment we notice the game gone.
 * The last few lines before a DISCONNECT then say exactly what was happening when it died:
 *   - last line `patch.begin`      → died mid code-patch (torn write on install/uninstall)
 *   - last line `mt.arm` (spawn)   → died in the game-thread handler running the spawn Lua
 *   - `spawn.fallback` then `exec.foreign.begin` → the heavy spawn ran on a foreign thread (the old crash)
 *
 * ONE FILE PER RUN (field-work mode): each app launch gets its own `flight-<stamp>-<pid>.log`, so a
 * campaign of many crash sessions never overwrites earlier captures — every close is an isolated,
 * comparable sample. Old files are pruned to the most recent KEEP so they can't grow unbounded.
 *
 * Best-effort and synchronous (appendFileSync) so ordering vs the game's death is accurate; it
 * never throws into the caller. Files live under <userData>/logs/.
 */

const fs = require('node:fs');
const path = require('node:path');

const KEEP = 40;   // most-recent session files to retain (each crash session is small — plenty of headroom)
let file = null;

// filename-safe timestamp: 2026-07-07T05:30:00.123Z → 2026-07-07_05-30-00 (Windows forbids ':' in paths)
function stamp() {
  return new Date().toISOString().replace('T', '_').replace(/:/g, '-').replace(/\..+$/, '');
}

// keep only the newest KEEP flight-*.log files (names are timestamp-led, so lexical sort = chronological)
function prune(dir) {
  try {
    const files = fs.readdirSync(dir).filter((n) => /^flight-.*\.log$/.test(n)).sort();
    for (const n of files.slice(0, Math.max(0, files.length - KEEP))) {
      try { fs.rmSync(path.join(dir, n), { force: true }); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

function init(dir, meta) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    file = path.join(dir, `flight-${stamp()}-${process.pid}.log`);   // unique per launch → nothing gets overwritten
    write('session', { ...(meta || {}) });                          // first line of this run's file
    prune(dir);
  } catch { file = null; }
}

function write(event, data) {
  if (!file) return;
  try {
    fs.appendFileSync(file, JSON.stringify({ t: new Date().toISOString(), event, ...(data || {}) }) + '\n');
  } catch { /* best-effort — logging must never break the trainer */ }
}

module.exports = { init, log: write, filePath: () => file };

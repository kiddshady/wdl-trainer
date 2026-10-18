# wdl-trainer

A native **Watch Dogs Legion** trainer for single-player — a dark, sober desktop app built on
[Penumbra](https://github.com/) (Electron + Vite-per-island), that talks **directly to the game's
own Lua engine** (no Cheat Engine required).

> ⚠️ **Single-player only.** Don't use it in online modes.

## Features

- **Toggles** — God Mode, Disable Detection, Disable Felony System.
- **Spawns** — moto, auto, Sergei, race drone (at your reticle).
- **Free global hotkeys** — bind any key to any cheat; works *inside* the game.
- **Lua console** — run any of the game's own Lua commands (infinite extensibility).
- **Auto-update** — installs itself from GitHub Releases.

## Install (for players)

Grab the latest `wdl-trainer-Setup-x.y.z.exe` from the [Releases](https://github.com/kiddshady/wdl-trainer/releases),
run it, then launch **wdl-trainer as administrator** (it needs to read the game's memory) with the
game open and in a save.

## How it works

The Dunia engine (Watch Dogs) ships an internal Lua VM. The trainer attaches to the process,
AOB-scans the Dunia module to resolve `ExecuteLuaString` + the script-system singleton, then runs
each cheat as a Lua string via a remote thread. Every cheat is just one line of Lua.

## Develop

```bash
npm install
npm run dev        # launch Electron (run the terminal as admin to attach to the game)
npm run gen:icon   # regenerate build/icon.png from build/icon.svg
npm run release    # build the NSIS installer and publish to GitHub Releases (needs GH_TOKEN)
```

### The UI is frozen (since 0.4.1)

Penumbra, the design system the UI was built on, no longer exists (deleted on 12 Oct 2026),
so `renderer/src/*.jsx` can't be rebuilt. The last builds made from it are committed instead:
`renderer/js/islands/*.bundle.js` (React inlined) plus `renderer/css/tokens.css` and
`renderer/css/ui.css`. The app runs and packages from those as they are. `build-islands.mjs`
and `scripts/copy-css.mjs` stay only for reference. Changing the UI means porting it to
another framework first.

---

by **Kidd Shady**

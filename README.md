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
npm run dev        # build islands + launch Electron (run the terminal as admin to attach to the game)
npm run gen:icon   # regenerate build/icon.png from build/icon.svg
npm run release    # build the NSIS installer and publish to GitHub Releases (needs GH_TOKEN)
```

---

by **Kidd Shady**

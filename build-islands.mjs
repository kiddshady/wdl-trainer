/**
 * Build every island IIFE bundle (one Vite lib build per island, selected by --mode).
 * Run by `npm run dev` / `npm run build:ui` before Electron loads the renderer.
 */
import { build } from 'vite';
import { ISLANDS } from './vite.config.mjs';

for (const mode of Object.keys(ISLANDS)) {
  console.log(`· building island "${mode}"…`);
  await build({ configFile: './vite.config.mjs', mode, logLevel: 'warn' });
}
console.log('islands → renderer/js/islands/');

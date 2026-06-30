// Rasterize build/icon.svg -> build/icon.png (512×512) for the Electron window icon
// and electron-builder (which generates the Windows .ico from this PNG). Run: npm run gen:icon
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const buildDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'build');
const svg = readFileSync(join(buildDir, 'icon.svg'), 'utf8');
const png = new Resvg(svg, { fitTo: { mode: 'width', value: 512 } }).render().asPng();
writeFileSync(join(buildDir, 'icon.png'), png);
console.log('wrote build/icon.png (512×512)');

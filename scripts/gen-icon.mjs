// Rasterize build/icon.svg into:
//   - build/icon.png  (512, for the Electron window/tray icon)
//   - build/icon.ico  (multi-size 256→16, each rendered STRAIGHT from the vector so it stays crisp
//                      at every size instead of being blurry-downscaled from one big image)
// electron-builder picks up build/icon.ico for the installer/exe. Run: npm run gen:icon
import { Resvg } from '@resvg/resvg-js';
import pngToIco from 'png-to-ico';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const buildDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'build');
const svg = readFileSync(join(buildDir, 'icon.svg'), 'utf8');
const render = (size) => new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();

writeFileSync(join(buildDir, 'icon.png'), render(512));
const ico = await pngToIco([256, 128, 64, 48, 32, 16].map(render));
writeFileSync(join(buildDir, 'icon.ico'), ico);
console.log('wrote build/icon.png (512) + build/icon.ico (256→16, per-size vector render)');

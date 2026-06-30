/**
 * Copy Penumbra's CSS into renderer/css/ so index.html can <link> them at file:// runtime.
 * (The renderer loads over file://, which can't resolve bare node_modules specifiers, so we
 * copy the two stylesheets next to the app — mirroring how Umbra links its CSS.)
 */
import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const cssDir = join(here, '..', 'renderer', 'css');

mkdirSync(cssDir, { recursive: true });
copyFileSync(require.resolve('@penumbra/tokens/tokens.css'), join(cssDir, 'tokens.css'));
copyFileSync(require.resolve('@penumbra/ui/styles.css'), join(cssDir, 'ui.css'));
console.log('copied penumbra css → renderer/css/');

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * One IIFE bundle per island (selected via --mode), exposed on window.App<Name> and written to
 * renderer/js/islands/<mode>.bundle.js. React is bundled into each island (only one is mounted at
 * a time). This mirrors Umbra's renderer architecture.
 *
 * To add an island: add an entry here, a <button data-view> + <script> in renderer/index.html,
 * and a line in the ISLANDS registry in renderer/js/app.js.
 */
export const ISLANDS = {
  home:        { entry: 'renderer/src/Home.jsx',        name: 'AppHome' },
  settings:    { entry: 'renderer/src/Settings.jsx',    name: 'AppSettings' },
  updatetoast: { entry: 'renderer/src/UpdateToast.jsx', name: 'AppUpdateToast' },
};

export default defineConfig(({ mode }) => {
  const island = ISLANDS[mode];
  if (!island) throw new Error(`Unknown island mode: "${mode}". One of: ${Object.keys(ISLANDS).join(', ')}`);
  return {
    plugins: [react()],
    // Vite lib mode doesn't replace process.env.NODE_ENV for bundled React — define it.
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
      outDir: path.resolve(__dirname, 'renderer/js/islands'),
      emptyOutDir: false,
      lib: {
        entry: path.resolve(__dirname, island.entry),
        name: island.name,
        formats: ['iife'],
        fileName: () => `${mode}.bundle.js`,
      },
    },
  };
});

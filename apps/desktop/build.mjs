// Bundles the app's main process (src/main.ts, with the app's name from packages/shared) into dist/main.cjs,
// and copies the app's own pages (static/) next to it. Electron itself is not bundled.
import { build } from 'esbuild';
import { cpSync, rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  sourcemap: true,
  logLevel: 'warning',
});
cpSync('static', 'dist/static', { recursive: true });

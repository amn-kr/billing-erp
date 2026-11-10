// Bundles the app's main process (src/main.ts, with the app's name from packages/shared) into dist/main.cjs,
// and copies the app's own pages (static/) next to it. Electron itself is not bundled.
import { build } from 'esbuild';
import { cpSync, readFileSync, rmSync } from 'node:fs';

// the app's version (package.json), shown in the title bar
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));

rmSync('dist', { recursive: true, force: true });
const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], sourcemap: true, logLevel: 'warning' };
// the window's pages get only preload.cjs (sandboxed: one file, nothing else loaded)
await build({ ...common, entryPoints: ['src/preload.ts'], outfile: 'dist/preload.cjs' });
await build({ ...common, entryPoints: ['src/preload-titlebar.ts'], outfile: 'dist/preload-titlebar.cjs' });
await build({
  define: { __APP_VERSION__: JSON.stringify(version) },
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

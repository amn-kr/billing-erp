// Downloads Electron's program the first time it is needed (desktop app only). pnpm does not run
// Electron's own download on install, so the web/API builds (CI, Render) never fetch it.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const dir = path.dirname(require.resolve('electron/package.json'));
if (!fs.existsSync(path.join(dir, 'path.txt'))) {
  console.log('Downloading Electron (first time only)…');
  execFileSync(process.execPath, [path.join(dir, 'install.js')], { stdio: 'inherit' });
}

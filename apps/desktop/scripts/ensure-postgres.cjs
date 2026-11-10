// The PostgreSQL 16 programs (initdb, pg_ctl, postgres) for single-PC mode, downloaded the first time
// they are needed into apps/desktop/.cache/postgres/<platform>/ — like Electron, never on a normal
// install, so the web/API builds (CI, Render) and the lockfile are unaffected.
//   node scripts/ensure-postgres.cjs [win32-x64|darwin-arm64|darwin-x64|linux-x64]   (default: this computer)
// Prints the folder that holds bin/, lib/ and share/. The package (@embedded-postgres/<platform>) is
// fetched with `npm pack`, which checks it against the registry's integrity hash.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

/** PostgreSQL 16.14 (released on npm 5 Jun 2026) */
const VERSION = '16.14.0-beta.17';
const PACKAGES = { 'win32-x64': 'windows-x64', 'darwin-arm64': 'darwin-arm64', 'darwin-x64': 'darwin-x64', 'linux-x64': 'linux-x64' };

function ensurePostgres(target = `${process.platform}-${process.arch}`) {
  const pkg = PACKAGES[target];
  if (!pkg) throw new Error(`No PostgreSQL package for ${target}`);
  const dir = path.join(__dirname, '..', '.cache', 'postgres', `${target}-${VERSION}`);
  const native = path.join(dir, 'package', 'native');
  if (fs.existsSync(path.join(native, '.ready'))) return native;

  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  console.error(`Downloading PostgreSQL ${VERSION} for ${target} (first time only)…`);
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const file = execFileSync(npm, ['pack', `@embedded-postgres/${pkg}@${VERSION}`, '--silent'], { cwd: dir, encoding: 'utf8', shell: process.platform === 'win32' }).trim().split('\n').pop();
  execFileSync('tar', ['xzf', file], { cwd: dir });
  fs.rmSync(path.join(dir, file));

  // the package keeps its library links in a list (npm cannot ship links); make them again
  const links = path.join(native, 'pg-symlinks.json');
  if (fs.existsSync(links)) {
    // source: the real file; target: the link to it (e.g. libzstd.1.dylib -> libzstd.1.5.dylib)
    for (const { source, target } of JSON.parse(fs.readFileSync(links, 'utf8'))) {
      const at = path.join(dir, 'package', target);
      fs.rmSync(at, { force: true });
      fs.symlinkSync(path.relative(path.dirname(at), path.join(dir, 'package', source)), at);
    }
  }
  fs.writeFileSync(path.join(native, '.ready'), VERSION);
  return native;
}

module.exports = { ensurePostgres, VERSION };
if (require.main === module) console.log(ensurePostgres(process.argv[2]));

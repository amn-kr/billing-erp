// Makes the Windows installer: release/<App name>-Setup-<version>.exe (electron-builder, NSIS).
//   node package.mjs              build only (pull requests: the installer to try)
//   node package.mjs --publish    build and put it on github.com/amn-kr/billing-erp-releases as v<version> (auto-update reads it)
// The app's name comes from packages/shared/src/brand.ts; the program's file name and id never change with it.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Arch, build, Platform } from 'electron-builder';
import { BRAND } from '@billing/shared';

// single-PC mode's parts, next to the app outside its archive (programs and native modules cannot run from inside it)
const { ensurePostgres } = createRequire(import.meta.url)('./scripts/ensure-postgres.cjs');
const postgres = ensurePostgres('win32-x64');

const publish = process.argv.includes('--publish') ? 'always' : 'never';

await build({
  targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64),
  publish,
  config: {
    appId: 'com.amnkr.billingerp.desktop',
    productName: BRAND.name,
    executableName: 'billing-erp',
    copyright: `© ${new Date().getFullYear()} ${BRAND.name}`,
    directories: { output: 'release', buildResources: 'resources' },
    // everything the app needs is bundled into dist/ (build.mjs); no node_modules go in
    files: ['dist/**/*', '!dist/**/*.map', '!dist/server/**', '!dist/web/**', 'package.json'],
    extraResources: [
      { from: postgres, to: 'postgres', filter: ['**/*', '!pg-symlinks.json', '!.ready'] },
      { from: 'dist/web', to: 'web' },
    ],
    // a plain internal name (folders, update cache); people see productName
    extraMetadata: { name: 'billing-erp-desktop' },
    asar: true,
    // the server (dist/server) is copied here, not as an extra file: electron-builder always leaves out
    // node_modules (and .prisma) from extra files, and the server needs its native modules from there
    afterPack: async ({ appOutDir }) => {
      const to = path.join(appOutDir, 'resources', 'server');
      fs.rmSync(to, { recursive: true, force: true });
      fs.cpSync('dist/server', to, { recursive: true, filter: (f) => !f.endsWith('.map') });
    },
    win: { icon: 'resources/icon.png' },
    nsis: {
      // one click, for this Windows user only: no administrator password, and updates install the same way
      oneClick: true,
      perMachine: false,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      shortcutName: BRAND.name,
      artifactName: `${BRAND.name}-Setup-\${version}.\${ext}`,
      // the shop's sign-in stays on the PC when the app is uninstalled (no surprise sign-out on reinstall)
      deleteAppDataOnUninstall: false,
    },
    // installers and updates go to a separate public page (the code stays private; owner, 11 Nov 2026):
    // installed apps read updates from there without any password
    // uploaded into a hidden draft the workflow makes first (electron-builder uploads files at the same
    // time and each tried to make the release: v0.1.0's first try failed so); the workflow makes it
    // public only after the installed app passed its checks
    publish: [{ provider: 'github', owner: 'amn-kr', repo: 'billing-erp-releases', releaseType: 'draft' }],
  },
});

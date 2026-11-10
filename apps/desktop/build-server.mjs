// Single-PC mode's server, for the Windows app: dist/server/ (server.cjs + the few modules that cannot be
// bundled + the migrations) and dist/web/ (the web app's pages). Needs apps/api and apps/web built first
// (pnpm build). The installer copies both folders next to the app, outside its archive (package.mjs).
import { build } from 'esbuild';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { offlineFonts } from './scripts/offline-fonts.mjs';

const api = path.resolve('../api');
const web = path.resolve('../web/dist');
for (const [what, file] of [['the API (pnpm --filter @billing/api build)', path.join(api, 'dist/app.factory.js')], ['the web app (pnpm --filter @billing/web build)', path.join(web, 'index.html')]]) {
  if (!fs.existsSync(file)) throw new Error(`Build ${what} first: ${file} is missing`);
}

const out = path.resolve('dist/server');
fs.rmSync(out, { recursive: true, force: true });

// modules with native parts or generated files: copied as they are, next to server.cjs
const KEEP = ['@prisma/client', '.prisma/client', '@node-rs/argon2'];
// loaded only if present (NestJS's optional parts, the old app's backup reader's browser): not needed here
const OPTIONAL = ['@nestjs/microservices', '@nestjs/microservices/*', '@nestjs/websockets', '@nestjs/websockets/*', 'class-transformer', 'class-transformer/*', 'class-validator', '@fastify/static'];

await build({
  entryPoints: ['src/server/main.ts'],
  outfile: path.join(out, 'server.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: [...KEEP, ...KEEP.map((m) => `${m}/*`), ...OPTIONAL],
  // NestJS reads its classes' names at run time
  // the old app's backup reader's browser is not part of the Windows app (src/server/no-browser.ts)
  alias: { 'playwright-core': './src/server/no-browser.ts' },
  keepNames: true,
  // the server's own packages are the API's (apps/api/node_modules)
  nodePaths: [path.join(api, 'node_modules')],
  sourcemap: true,
  logLevel: 'warning',
});

// copy a module (and the platform part it loads) from where the API finds it
const fromApi = createRequire(path.join(api, 'package.json'));
const copyModule = (name, from = fromApi) => {
  const dir = path.dirname(from.resolve(`${name}/package.json`));
  fs.cpSync(fs.realpathSync(dir), path.join(out, 'node_modules', name), { recursive: true, dereference: true });
  return dir;
};
const prisma = copyModule('@prisma/client');
// Prisma's generated client sits next to @prisma/client (node_modules/.prisma/client)
fs.cpSync(path.join(fs.realpathSync(prisma), '..', '..', '.prisma', 'client'), path.join(out, 'node_modules', '.prisma', 'client'), { recursive: true, dereference: true });
const argon = copyModule('@node-rs/argon2');
const argonReq = createRequire(path.join(fs.realpathSync(argon), 'package.json'));
for (const dep of Object.keys(JSON.parse(fs.readFileSync(path.join(argon, 'package.json'), 'utf8')).optionalDependencies ?? {})) {
  try { copyModule(dep, argonReq); } catch { /* another computer's part: not installed here */ }
}

fs.cpSync(path.join(api, 'prisma', 'migrations'), path.join(out, 'migrations'), { recursive: true });
fs.rmSync(path.resolve('dist/web'), { recursive: true, force: true });
fs.cpSync(web, path.resolve('dist/web'), { recursive: true });
// single-PC mode works without internet: the pages' fonts are kept with the app
console.log(`fonts kept with the app: ${await offlineFonts(path.resolve('dist/web'))}`);
console.log('dist/server and dist/web ready');

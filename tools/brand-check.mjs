#!/usr/bin/env node
/*
 * Brand check:  pnpm brand:check
 * Fails if the app's name (or the old name) is typed by hand in a place people see, instead of being
 * read from packages/shared/src/brand.ts. Warns if the name is too long for the sidebar and sign-in page.
 * Package, folder, database, cookie and file names (for example "billing-erp", "billing_erp") are
 * technical and are not checked: they never change with the name.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BRAND_FILE = 'packages/shared/src/brand.ts';

let brand;
try {
  brand = await import(path.join(ROOT, BRAND_FILE));
} catch (e) {
  console.error(`Brand check: could not read ${BRAND_FILE}. Is Node.js 22.18 or newer installed? (${e.message})`);
  process.exit(1);
}
const { BRAND, OLD_APP, BRAND_SAFE_LENGTH } = brand;

/* places people see (code, pages, tests that check them, README) */
const AREAS = ['README.md', 'apps/web/*.html', 'apps/web/src', 'apps/web/e2e', 'apps/web/public', 'apps/api/src', 'apps/api/test', 'packages/*/src'];
/* places that may keep the name typed by hand, and why */
const ALLOWED = {
  [BRAND_FILE]: 'the brand file itself: the one place the name is typed',
  'apps/web/e2e/approved/': 'approved pictures (the prototype shows the old name)',
};

const problems = [];
const name = String(BRAND.name ?? '');
if (!name.trim()) problems.push(`The name in ${BRAND_FILE} is empty.`);
if (/[{}<>]/.test(name)) problems.push(`The name in ${BRAND_FILE} must not contain { } < or >.`);
if (!String(BRAND.backupFolder ?? '').trim()) problems.push(`The Google Drive folder name (backupFolder) in ${BRAND_FILE} is empty.`);

const esc = (s) => s.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
const names = [...new Set([name, OLD_APP.name].filter((n) => n.trim()))];
const pattern = new RegExp(`(?<![\\w-])(${names.map(esc).join('|')})(?![\\w-])`, 'i');

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', ...AREAS], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter(Boolean)
  .filter((f) => !Object.keys(ALLOWED).some((a) => f === a || (a.endsWith('/') && f.startsWith(a))))
  .filter((f) => !/\.(png|jpe?g|gif|webp|ico|woff2?|pdf)$/i.test(f));
for (const f of files) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
    const m = line.match(pattern);
    if (m) problems.push(`${f}:${i + 1} has the name "${m[0]}" typed by hand. Use the brand file instead ({{APP_NAME}} in .html pages, APP_NAME in the app, BRAND or OLD_APP elsewhere).`);
  });
}

if (problems.length) {
  console.error(`Brand check FAILED (${problems.length}):\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`Brand check passed: the name is "${name}", read from ${BRAND_FILE} everywhere people see it (${files.length} files checked).`);
if (name.length > BRAND_SAFE_LENGTH)
  console.warn(`WARNING: "${name}" has ${name.length} letters. Above ${BRAND_SAFE_LENGTH} it may be cut off in the sidebar. Check the sidebar at 1280 px before merging.`);

/**
 * Rename test: builds the app with another name ("Test Name") into a temporary folder, like a rename would,
 * and checks every page and the app's code show it, and the old name is gone. No committed file changes.
 */
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OLD_APP } from '@billing/shared';
import { brand, PAGES } from '../vite.config';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NAME = 'Test Name';
const OLD = new RegExp(OLD_APP.name.replace(/\s+/g, '\\s+'), 'i');
let out = '';
const read = (f: string) => fs.readFileSync(path.join(out, f), 'utf8');

describe('renaming the app', () => {
  beforeAll(async () => {
    out = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-rename-'));
    await build({
      root: ROOT, configFile: false, logLevel: 'silent',
      plugins: [react(), brand({ name: NAME, backupFolder: `${NAME} Backup` })],
      build: { outDir: out, emptyOutDir: true, rollupOptions: { input: Object.fromEntries(Object.entries(PAGES).map(([k, f]) => [k, path.join(ROOT, f)])) } },
    });
  }, 180_000);
  afterAll(() => { if (out) fs.rmSync(out, { recursive: true, force: true }); });

  it('the pages show the new name and never the old one', () => {
    expect(read('index.html')).toContain(`<title>${NAME} – Dashboard</title>`);
    expect(read('login.html')).toContain(`<title>${NAME} — sign in</title>`);
    expect(read('privacy.html')).toContain(`<title>Privacy policy — ${NAME}</title>`);
    expect(read('privacy.html')).toContain(`<span class="logo">T</span><span>${NAME}</span>`);
    expect(read('privacy.html')).toContain(`“${NAME} Backup – &lt;your shop’s name&gt;”`);
    expect(read('terms.html')).toContain(`<title>Terms of service — ${NAME}</title>`);
    expect(read('terms.html')).toContain(`<span class="logo">T</span><span>${NAME}</span>`);
    for (const f of Object.values(PAGES)) {
      expect(read(f), f).not.toMatch(OLD);
      expect(read(f), f).not.toContain('{{');
    }
  });

  it('the app’s code (sidebar, sign-in page, page title) has the new name and never the old one', () => {
    const code = fs.readdirSync(path.join(out, 'assets')).filter((f) => f.endsWith('.js')).map((f) => read(path.join('assets', f))).join('\n');
    expect(code).toContain(JSON.stringify(NAME));
    expect(code).not.toMatch(OLD);
  });
});

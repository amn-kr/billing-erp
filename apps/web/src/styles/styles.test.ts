/**
 * CLAUDE.md: "Copy its CSS unchanged". These checks fail if anyone edits the
 * copied stylesheets, or if the prototype changes and the copies are stale.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../../..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const css = (f: string) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const proto = read('reference/design/app.html');
const between = (s: string, a: string, b: string, from = 0) => {
  const i = s.indexOf(a, from);
  if (i < 0) throw new Error(`not found: ${a}`);
  return s.slice(i + a.length, s.indexOf(b, i + a.length));
};

describe('stylesheets are unchanged copies of the prototype', () => {
  it('app.css = the <style> block of reference/design/app.html', () => {
    expect(css('app.css')).toBe(between(proto, '<style>', '</style>'));
  });
  it('auth.css = the <style> block of the website sign-in page', () => {
    expect(css('auth.css')).toBe(between(read('reference/firebase-site/public/index.html'), '<style>', '</style>'));
  });
  it('expenses.css, extras.css and sync.css appear verbatim in the prototype', () => {
    for (const f of ['expenses.css', 'extras.css', 'sync.css']) expect(proto.includes(css(f)), f).toBe(true);
  });
  it('palette.css = what the prototype generates from PAL', () => {
    const src = 'const PAL=' + between(proto, 'const PAL=', '];') + '];return PAL;';
    const PAL = new Function(src)() as Array<{ id: string; l: Record<string, string>; d: Record<string, string> }>;
    const v = (o: Record<string, string>) => Object.entries(o).map(([k, x]) => `--${k}:${x}`).join(';');
    let out = '';
    PAL.forEach((p) => {
      const L = `:root[data-pal="${p.id}"]`;
      out += `${L}{${v(p.l)}}@media (prefers-color-scheme:dark){${L}:not([data-theme="light"]){${v(p.d)}}}:root[data-theme="dark"][data-pal="${p.id}"]{${v(p.d)}}`;
    });
    expect(css('palette.css')).toBe(out);
  });
});

describe('icons are the prototype’s', () => {
  it('every icon path matches const P in the prototype', async () => {
    const { P } = await import('../components/icon-paths');
    for (const [k, d] of Object.entries(P)) expect(proto.includes(JSON.stringify(d).slice(1, -1)) || proto.includes(d), k).toBe(true);
  });
});

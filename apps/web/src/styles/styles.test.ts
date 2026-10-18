/// <reference types="node" />
// The web app only sees browser types; this test reads files from disk, so it asks for Node's.
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

/*
 * The one exception, approved by the owner in writing on 17 Oct 2026: the message strip (.toast) moves to the
 * top centre and is green after a save / red when a save failed. It lives in its own small file, loaded after
 * app.css (which stays an exact copy, checked above). This check allows exactly these three rules and nothing else.
 */
describe('owner-approved toast change', () => {
  it('features/shell/toast.css holds only the approved toast rules, with the prototype’s colours', () => {
    const t = fs.readFileSync(path.join(__dirname, '../features/shell/toast.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(t.split('\n').map((l) => l.trim()).filter(Boolean)).toEqual([
      '.toast{top:calc(28px + env(safe-area-inset-top,0px));bottom:auto;transform:translate(-50%,-16px)}',
      '.toast.ok{background:var(--green);color:#fff}',
      '.toast.bad{background:var(--red);color:#fff}',
    ]);
    // the prototype's own .toast (bottom 28px, 16px slide) is what this mirrors, and its colours exist there
    expect(proto).toContain('.toast{position:fixed;left:50%;bottom:calc(28px + env(safe-area-inset-bottom,0px));transform:translate(-50%,16px);');
    expect(proto).toContain('--green:#10b981;');
    expect(proto).toContain('--red:#ef4444;');
  });
});

/*
 * Searchable drop-down (components/SearchSelect), asked for by the owner on 18 Oct 2026 for Add item. Its list
 * is the prototype's own Add item suggestion list (.aisug / .aiso / .aish); its own small file adds only these rules.
 */
describe('owner-asked searchable drop-down', () => {
  it('components/search-select.css holds only the arrow, list place, locked field and "can’t pick" row rules', () => {
    const t = fs.readFileSync(path.join(__dirname, '../components/search-select.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(t.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => l.slice(0, l.indexOf('{')))).toEqual([
      '.ssel', '.ssel>.fi', '.ssel>.fi:focus', '.ssel>.fi:disabled', '.ssel .aiso[aria-disabled="true"]',
    ]);
    // the list and its rows are the prototype's
    for (const r of ['.aisug{position:absolute;', '.aiso{display:flex;', '.aiso.on,.aiso:hover{background:var(--acs)}', '.aish{']) expect(proto).toContain(r);
  });
});

/*
 * Owner's request, 18 Oct 2026: a ⋮ actions button on every document list. The prototype has the ⋮ rules only for the
 * Sales list (#slRows); features/shell/row-menu.css holds exactly those rules for the other lists, and nothing else.
 */
describe('row actions ⋮ on the other lists', () => {
  it('features/shell/row-menu.css = the prototype’s #slRows ⋮ and highlighted-row rules, for #dcRows, #cnRows, #rcRows and #qlRows', () => {
    const t = fs.readFileSync(path.join(__dirname, '../features/shell/row-menu.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const L = ['dcRows', 'cnRows', 'rcRows', 'qlRows'];
    // the prototype's own rules, as they are in app.css
    const pad = '#slRows td.slact{padding-top:0;padding-bottom:0}';
    const btn = '#slRows .slm{width:26px;height:26px;border-radius:7px;vertical-align:middle;border-color:transparent;background:transparent}';
    const hov = '#slRows .slm:hover,#slRows tr:focus-within .slm{border-color:var(--bd);background:var(--sf)}';
    const on = '#slRows tr.ctxon td{background:var(--acs)}';
    for (const r of [pad, btn, hov, on]) expect(proto).toContain(r);
    expect(t.split('\n').map((l) => l.trim()).filter(Boolean)).toEqual([pad, btn, hov, on].map((r) => {
      const i = r.indexOf('{');
      const sels = r.slice(0, i).split(',');
      return L.flatMap((id) => sels.map((x) => x.replace('#slRows', '#' + id))).join(',') + r.slice(i);
    }));
  });
});

describe('icons are the prototype’s', () => {
  it('every icon path matches const P in the prototype', async () => {
    const { P } = await import('../components/icon-paths');
    for (const [k, d] of Object.entries(P)) expect(proto.includes(JSON.stringify(d).slice(1, -1)) || proto.includes(d), k).toBe(true);
  });
});

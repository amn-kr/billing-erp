/// <reference types="node" />
// The web app only sees browser types; this test reads files from disk, so it asks for Node's.
/**
 * The small owner-approved style files each hold exactly their approved rules, and the theme rules they copy
 * are still in the theme (app.css). Since 22 Nov 2026 (owner) the theme is the app's own: nothing here reads the
 * prototype any more. Colours and fonts are guarded by look-guard.test.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = (f: string) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const theme = css('app.css');

/*
 * The one exception, approved by the owner in writing on 17 Oct 2026: the message strip (.toast) moves to the
 * top centre and is green after a save / red when a save failed. It lives in its own small file, loaded after
 * app.css (which stays an exact copy, checked above). This check allows exactly these three rules and nothing else.
 */
describe('owner-approved toast change', () => {
  it('features/shell/toast.css holds only the approved toast rules, with the theme’s colours', () => {
    const t = fs.readFileSync(path.join(__dirname, '../features/shell/toast.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(t.split('\n').map((l) => l.trim()).filter(Boolean)).toEqual([
      '.toast{top:calc(28px + env(safe-area-inset-top,0px));bottom:auto;transform:translate(-50%,-16px)}',
      '.toast.ok{background:var(--green);color:#fff}',
      '.toast.bad{background:var(--red);color:#fff}',
    ]);
    // the theme's own .toast (bottom 28px, 16px slide) is what this mirrors, and its colours exist there
    expect(theme).toContain('.toast{position:fixed;left:50%;bottom:calc(28px + env(safe-area-inset-bottom,0px));transform:translate(-50%,16px);');
    expect(theme).toContain('--green:#10b981;');
    expect(theme).toContain('--red:#ef4444;');
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
    // the list and its rows are the theme's
    for (const r of ['.aisug{position:absolute;', '.aiso{display:flex;', '.aiso.on,.aiso:hover{background:var(--acs)}', '.aish{']) expect(theme).toContain(r);
  });
});

/*
 * Owner's request, 18 Oct 2026: a ⋮ actions button on every document list. The prototype has the ⋮ rules only for the
 * Sales list (#slRows); features/shell/row-menu.css holds exactly those rules for the other lists, and nothing else.
 */
describe('row actions ⋮ on the other lists', () => {
  it('features/shell/row-menu.css = the theme’s #slRows ⋮ and highlighted-row rules, for the sales, purchase and group-3 lists', () => {
    const t = fs.readFileSync(path.join(__dirname, '../features/shell/row-menu.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const L = ['dcRows', 'cnRows', 'rcRows', 'qlRows', 'puRows', 'poRows', 'pxRows', 'dnRows', 'exRows', 'bkRows', 'caRows', 'adjRows', 'trRows'];
    // the theme's own rules, in app.css
    const pad = '#slRows td.slact{padding-top:0;padding-bottom:0}';
    const btn = '#slRows .slm{width:26px;height:26px;border-radius:7px;vertical-align:middle;border-color:transparent;background:transparent}';
    const hov = '#slRows .slm:hover,#slRows tr:focus-within .slm{border-color:var(--bd);background:var(--sf)}';
    const on = '#slRows tr.ctxon td{background:var(--acs)}';
    for (const r of [pad, btn, hov, on]) expect(theme).toContain(r);
    expect(t.split('\n').map((l) => l.trim()).filter(Boolean)).toEqual([pad, btn, hov, on].map((r) => {
      const i = r.indexOf('{');
      const sels = r.slice(0, i).split(',');
      return L.flatMap((id) => sels.map((x) => x.replace('#slRows', '#' + id))).join(',') + r.slice(i);
    }));
  });
});

/*
 * Owner's request, 25 Oct 2026 (answers 31 Oct 2026): every table row as tall as a Sales invoices row (39px),
 * heading rows 35px. features/shell/row-height.css holds exactly these rules, and nothing else.
 */
describe('grids that have to fit the screen', () => {
  it('features/sales/editor/grid-fit.css only touches tables marked data-fit, so a shop without these columns is unchanged', () => {
    const t = fs.readFileSync(path.join(__dirname, '../features/sales/editor/grid-fit.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const selectors = t.split('}').map((r) => r.split('{')[0]!.trim()).filter(Boolean).flatMap((s) => s.split(','));
    expect(selectors.length).toBeGreaterThan(0);
    for (const s of selectors) expect(s).toMatch(/^\.dgt\[data-fit(="tight")?\]/);
  });
});

describe('one row height for every table', () => {
  it('features/shell/row-height.css holds only the approved row, heading and amount-box rules', () => {
    const t = fs.readFileSync(path.join(__dirname, '../features/shell/row-height.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const rows = '.ptt2:not(.egt)>tbody>tr:not(.psit):not(:has(>td:only-child))>td,.ptt2:not(.egt)>tfoot>tr>td,#vDash .tw>table>tbody>tr:not(:has(>td:only-child))>td';
    const cells = '.ptt2:not(.egt)>tbody>tr>td,.ptt2:not(.egt)>tfoot>tr>td,#vDash .tw>table>tbody>tr>td';
    expect(t.split('\n').map((l) => l.trim()).filter(Boolean)).toEqual([
      `${rows}{height:39px;padding-top:0!important;padding-bottom:0!important;white-space:nowrap!important;vertical-align:middle}`,
      `${cells}{line-height:16px}`,
      `${cells.split(',').map((s) => s + ' small').join(',')}{line-height:13px}`,
      '.ptt2:not(.egt)>tbody>tr>td .fi{height:32px;margin-top:0}',
      '.ptt2:not(.egt)>thead>tr:only-child>th,#vDash .tw>table>thead>tr:only-child>th{height:35px;padding-top:0!important;padding-bottom:0!important;vertical-align:middle}',
    ]);
    // the Sales invoices row it copies (11px + 11px padding), and the theme's own 32px boxes in a table row
    expect(theme).toContain('.ptt2 td{padding:11px 10px;');
    expect(theme).toContain('.pmi{width:96px;height:32px!important;margin:0!important;');
  });
});

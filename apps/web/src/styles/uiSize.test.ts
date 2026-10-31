/// <reference types="node" />
/** Density and text size (styles/uiSize.ts): the size rules copied from the prototype's CSS. */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { scaleSheet, scaleValue, scopeSelector, UI_VARS, uiSizeSheet } from './uiSize';

const css = (f: string) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const SIZE = /^(font-size|font|line-height|padding(-\w+)?|margin(-\w+)?|gap|row-gap|column-gap|height|min-height|max-height|top|bottom|width|min-width|max-width)$/;

/** every size declaration of a sheet (outside animations), in order */
function sizeDecls(sheet: string): string[] {
  const out: string[] = [];
  const body = sheet.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@keyframes[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '');
  for (const m of body.matchAll(/\{([^{}]*)\}/g)) {
    for (const d of (m[1] ?? '').split(';')) {
      const i = d.indexOf(':');
      if (i > 0 && SIZE.test(d.slice(0, i).trim())) out.push(`${d.slice(0, i).trim()}:${d.slice(i + 1).trim()}`);
    }
  }
  return out;
}
/** what a copied value is when the variables are 1 (the default, and inside paper) */
const atOne = (v: string) => v.replace(/round\(calc\((-?[\d.]+px) \* var\(--ui-\w+,1\)\), 1px\)/g, '$1').replace(/calc\((-?[\d.]+px) \* var\(--ui-\w+,1\)\)/g, '$1');

describe('scaling one value', () => {
  it('text scales every px size, boxes and spacing are rounded to whole pixels', () => {
    expect(scaleValue('fs', '600 13px var(--font)')).toBe('600 calc(13px * var(--ui-fs,1)) var(--font)');
    expect(scaleValue('fs', '14px/1.45 var(--font)')).toBe('calc(14px * var(--ui-fs,1))/1.45 var(--font)');
    expect(scaleValue('sp', '0 16px')).toBe('0 round(calc(16px * var(--ui-sp,1)), 1px)');
    expect(scaleValue('sp', '2.5px 0!important')).toBe('calc(2.5px * var(--ui-sp,1)) 0!important');
    expect(scaleValue('h', '42px')).toBe('round(calc(42px * var(--ui-h,1)), 1px)');
  });
  it('icons, dots and wide layout widths keep their size', () => {
    expect(scaleValue('h', '16px')).toBe('16px');
    expect(scaleValue('h', 'calc(100% + 8px)')).toBe('calc(100% + 8px)');
    expect(scaleValue('w', '18px')).toBe('18px');
    expect(scaleValue('w', 'min(440px,100%)')).toBe('min(440px,100%)');
    expect(scaleValue('w', '42px')).toBe('round(calc(42px * var(--ui-h,1)), 1px)');
    expect(scaleValue('h', 'auto')).toBe('auto');
  });
});

describe('scoping', () => {
  it('puts :root[data-ui] in front of every selector, html and :root get the attribute themselves', () => {
    expect(scopeSelector('.a,.b .c')).toBe(':root[data-ui] .a,:root[data-ui] .b .c');
    expect(scopeSelector('html.noscroll body')).toBe('html[data-ui].noscroll body');
    expect(scopeSelector(':root[data-pal="x"] .a')).toBe(':root[data-ui][data-pal="x"] .a');
    expect(scopeSelector('tr:not(.a,.b)>td')).toBe(':root[data-ui] tr:not(.a,.b)>td');
  });
  it('keeps only size declarations, keeps @media, leaves out animations', () => {
    const out = scaleSheet('/* x */.a{color:red;height:40px}.b{color:blue}@media (max-width:900px){.c{padding:8px}}@keyframes k{0%{top:30px}to{top:0}}');
    expect(out).toBe(':root[data-ui] .a{height:round(calc(40px * var(--ui-h,1)), 1px)}@media (max-width:900px){:root[data-ui] .c{padding:round(calc(8px * var(--ui-sp,1)), 1px)}}');
  });
});

describe('the app’s stylesheets', () => {
  const sheets = ['app.css', 'expenses.css', 'sync.css', '../features/shell/row-height.css', '../components/edit-grid.css', '../components/sheet-grid.css'];
  it.each(sheets)('%s: every size declaration is repeated, in order, and is the original when the variables are 1', (f) => {
    const src = css(f);
    const copied = sizeDecls(scaleSheet(src));
    expect(copied.length).toBeGreaterThan(0);
    expect(copied.map(atOne)).toEqual(sizeDecls(src));
  });
  it('the prototype’s CSS gives about 1,200 rules and nothing that isn’t scoped', () => {
    const out = scaleSheet(css('app.css'));
    const rules = [...out.matchAll(/(?:^|})([^{}@][^{}]*)\{/g)].map((m) => m[1] ?? '');
    expect(rules.length).toBeGreaterThan(1000);
    for (const sel of rules) for (const s of sel.split(/,(?![^(]*\))/)) expect(s, sel).toMatch(/^(:root|html)\[data-ui\]/);
  });
  it('the whole sheet is for screens only, with Compact’s numbers and paper kept at 1', () => {
    const s = uiSizeSheet([css('app.css')]);
    expect(s.startsWith(UI_VARS + '@media screen{')).toBe(true);
    expect(UI_VARS).toContain(':root[data-density="compact"]{--ui-sp:.72;--ui-h:.8;--ui-fd:.93}');
    expect(UI_VARS).toContain(':root[data-text="small"]{--ui-ft:.92}:root[data-text="large"]{--ui-ft:1.1}');
    expect(UI_VARS).toContain(':is(.ivsheet,.rlsheet,.prclone,.ppage){--ui-sp:1;--ui-h:1;--ui-fs:1}');
  });
});

/// <reference types="node" />
// The web app only sees browser types; this test reads files from disk, so it asks for Node's.
/**
 * Look guard (owner, 22 Nov 2026; CLAUDE.md "The one hard rule"): the web app and the Windows app use only the
 * theme's colours and fonts, listed in theme-list.ts. A new colour or font anywhere (a stylesheet, an inline style,
 * the printed invoice, a PDF or Excel file, a Windows page) fails here until the owner has said yes and it is added
 * to the list.
 */
import { describe, expect, it } from 'vitest';
import { coloursIn, fontsIn, lookFiles, normColour, normFont } from './look-scan';
import { THEME_COLOURS, THEME_FONTS } from './theme-list';

const files = lookFiles();
const colours = new Set(Object.values(THEME_COLOURS).flat());
const fonts = new Set(Object.keys(THEME_FONTS));

describe('look guard: only the theme’s colours and fonts', () => {
  it('finds the places that are looked at (stylesheets, screens, print, Windows pages)', () => {
    for (const f of ['apps/web/src/styles/app.css', 'apps/web/src/features/print/print.css', 'apps/web/src/features/sales/editor/SaleEditor.tsx', 'apps/desktop/static/welcome.html']) {
      expect(files, f).toContain(f);
    }
  });

  it('every colour used is on the theme’s list', () => {
    const outside = files.flatMap((f) => coloursIn(f)).filter((c) => !colours.has(c.value));
    expect(outside.map((c) => `${c.value} in ${c.file}`), 'colour not in theme-list.ts: needs the owner’s OK').toEqual([]);
  });

  it('every font used is on the theme’s list', () => {
    const outside = files.flatMap((f) => fontsIn(f)).filter((c) => !fonts.has(c.value));
    expect(outside.map((c) => `${c.value} in ${c.file}`), 'font not in theme-list.ts: needs the owner’s OK').toEqual([]);
  });

  it('the list itself is written one way (so a colour cannot slip in twice in another spelling)', () => {
    for (const c of colours) expect(normColour(c), c).toBe(c);
    for (const f of fonts) expect(normFont(f.replace(/^(pdf|excel):/, '')), f).toBe(f.replace(/^(pdf|excel):/, ''));
    const all = Object.values(THEME_COLOURS).flat();
    expect(all.length, 'a colour is listed twice').toBe(colours.size);
  });

  it('catches a new colour or font (the guard really works)', () => {
    const fake = '.x{color:#123457;background:rgba(1,2,3,.5);border-color:white;font:600 13px Comic Sans MS}';
    const c = coloursIn('fake.css', fake).map((x) => x.value).filter((v) => !colours.has(v));
    expect(c).toEqual(['#123457', 'rgba(1,2,3,.5)', 'white']);
    const f = fontsIn('fake.css', fake).map((x) => x.value).filter((v) => !fonts.has(v));
    expect(f).toEqual(['Comic Sans MS']);
    // spelt differently, a theme colour is still the same colour
    expect(colours.has(normColour('#FFF'))).toBe(colours.has('#ffffff'));
  });
});

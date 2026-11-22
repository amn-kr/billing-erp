/// <reference types="node" />
// Used only by the look guard test (look-guard.test.ts); never part of the app.
/**
 * Finds every colour and every font named in the web app and the Windows app:
 * stylesheets, inline styles in screens, printed layouts, PDF and Excel files,
 * and the Windows app's own pages (welcome, starting, offline, title bar).
 */
import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(__dirname, '../../../..');

/** Folders that hold what people see. Tests, test pictures and build output are left out. */
const PLACES = ['apps/web/src', 'apps/web/index.html', 'apps/desktop/src', 'apps/desktop/static'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', 'release', '.cache', 'test-results']);
const KINDS = /\.(css|ts|tsx|html)$/;

export function lookFiles(): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) return;
    if (fs.statSync(abs).isFile()) {
      if (KINDS.test(rel) && !/\.test\.tsx?$/.test(rel) && !rel.endsWith('look-scan.ts') && !rel.endsWith('theme-list.ts')) out.push(rel);
      return;
    }
    for (const e of fs.readdirSync(abs)) if (!SKIP_DIRS.has(e)) walk(path.posix.join(rel, e));
  };
  PLACES.forEach(walk);
  return out.sort();
}

/** One way of writing each colour: lower case, #abc → #aabbcc, no spaces, 0.4 → .4 */
export function normColour(c: string): string {
  let s = c.toLowerCase().replace(/\s+/g, '');
  const short = /^#([0-9a-f]{3,4})$/.exec(s);
  if (short) s = '#' + [...short[1]!].map((x) => x + x).join('');
  return s.replace(/([(,])0\./g, '$1.');
}

const COLOUR = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3,4}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g;
/** Excel cell colours are written as 8 letters, alpha first: 'FFDC2626' = #dc2626 */
const EXCEL = /argb:\s*'([0-9A-Fa-f]{8})'/g;
/** Plain colour words in a style (white, red …); var(--red) is the theme's own and is fine */
const WORD = /(?:color|background|border|fill|stroke|outline|shadow)[\w-]*["']?\s*:\s*["']?[^;}"'\n]*?(?<![-\w])(white|black|red|green|blue|yellow|orange|purple|gray|grey|pink|navy|silver)(?![-\w])/gi;

export interface Found { file: string; value: string }

export function coloursIn(file: string, text = fs.readFileSync(path.join(ROOT, file), 'utf8')): Found[] {
  const found: Found[] = [];
  // a #123 in a comment or an HTML entity (&#8377;) is not a colour
  const t = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/&#x?[0-9a-f]+;/gi, '');
  for (const m of t.matchAll(COLOUR)) found.push({ file, value: normColour(m[0]) });
  for (const m of t.matchAll(EXCEL)) found.push({ file, value: '#' + m[1]!.slice(2).toLowerCase() });
  for (const m of t.matchAll(WORD)) found.push({ file, value: m[1]!.toLowerCase() });
  return found;
}

/** One way of writing each font list: no quotes, no spaces after commas */
export function normFont(f: string): string {
  return f.replace(/["']/g, '').split(',').map((x) => x.trim()).filter(Boolean).join(',');
}

const FAMILY = /(?:font-family|--font)\s*:\s*([^;}"\n]+)/g;
const FONT_SHORT = /(?<![-\w])font\s*:\s*([^;}\n]+)/g;
const JS_FAMILY = /fontFamily\s*:\s*(['"`])([^'"`]+)\1/g;
const PDF_FONT = /setFont\(\s*'([^']+)'/g;
const EXCEL_FONT = /font\s*=\s*\{[^}]*?name:\s*'([^']+)'/g;

export function fontsIn(file: string, text = fs.readFileSync(path.join(ROOT, file), 'utf8')): Found[] {
  const found: Found[] = [];
  const t = text.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of t.matchAll(FAMILY)) found.push({ file, value: normFont(m[1]!) });
  for (const m of t.matchAll(FONT_SHORT)) {
    const v = m[1]!.trim();
    if (v === 'inherit') { found.push({ file, value: 'inherit' }); continue; }
    // font: 600 13px/1.4 Inter, sans-serif → the part after the size is the font list
    const fam = /\d[\d.]*px(?:\/[\d.]+(?:px)?)?\s+(.+)$/.exec(v);
    if (fam) found.push({ file, value: normFont(fam[1]!) });
  }
  for (const m of t.matchAll(JS_FAMILY)) found.push({ file, value: normFont(m[2]!) });
  for (const m of t.matchAll(PDF_FONT)) found.push({ file, value: 'pdf:' + m[1]!.toLowerCase() });
  for (const m of t.matchAll(EXCEL_FONT)) found.push({ file, value: 'excel:' + m[1]! });
  return found;
}

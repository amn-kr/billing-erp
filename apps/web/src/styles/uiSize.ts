/**
 * Density and text size, chosen by each person (owner's request, 31 Oct 2026): Settings › General › Display,
 * or Display in the account menu. The prototype's CSS stays an exact copy (styles.test). This makes a second
 * sheet from it that repeats only the size declarations, multiplied by variables, under :root[data-ui]:
 *
 *   text      font-size, font, line-height              × --ui-fs  (density × text size)
 *   (boxes and spacing are rounded to whole pixels)
 *   spacing   padding, margin, gap                      × --ui-sp
 *   heights   height, min/max-height, top, bottom ≥24px × --ui-h   (smaller ones are icons and dots)
 *   widths    width, min/max-width from 24 to 48px      × --ui-h   (square buttons and avatars stay square)
 *
 * Every declaration of those properties is repeated (unchanged where nothing is scaled), so the rules keep
 * the same order of strength among themselves. Without the data-ui attribute (Comfortable + Normal text, the
 * default) none of the rules match, so the app looks exactly as before. They apply on screen only, and inside
 * paper (invoice, challan, statement and rate-list sheets) the variables are 1, so print never changes.
 */
import type { Density, TextSize } from '@billing/shared';


export const DENSITIES: [Density, string][] = [['comfortable', 'Comfortable'], ['compact', 'Compact']];
export const TEXT_SIZES: [TextSize, string][] = [['small', 'Small'], ['normal', 'Normal'], ['large', 'Large']];

/** the variables; Compact: spacing 72%, heights 80%, text 93% of Comfortable. Paper keeps its sizes. */
export const UI_VARS =
  ':root[data-density="compact"]{--ui-sp:.72;--ui-h:.8;--ui-fd:.93}' +
  ':root[data-text="small"]{--ui-ft:.92}:root[data-text="large"]{--ui-ft:1.1}' +
  ':root[data-ui]{--ui-fs:calc(var(--ui-fd,1) * var(--ui-ft,1))}' +
  ':root[data-ui] :is(.ivsheet,.rlsheet,.prclone,.ppage){--ui-sp:1;--ui-h:1;--ui-fs:1}';

type Kind = 'fs' | 'sp' | 'h' | 'w';
const KIND: Record<string, Kind> = {
  'font-size': 'fs', font: 'fs', 'line-height': 'fs',
  padding: 'sp', 'padding-top': 'sp', 'padding-right': 'sp', 'padding-bottom': 'sp', 'padding-left': 'sp',
  margin: 'sp', 'margin-top': 'sp', 'margin-right': 'sp', 'margin-bottom': 'sp', 'margin-left': 'sp',
  gap: 'sp', 'row-gap': 'sp', 'column-gap': 'sp',
  height: 'h', 'min-height': 'h', 'max-height': 'h', top: 'h', bottom: 'h',
  width: 'w', 'min-width': 'w', 'max-width': 'w',
};
const VAR: Record<Kind, string> = { fs: '--ui-fs', sp: '--ui-sp', h: '--ui-h', w: '--ui-h' };

/** One value with its px numbers scaled (those the kind scales); other numbers and words are kept. */
export function scaleValue(kind: Kind, value: string): string {
  return value.replace(/(-?\d*\.?\d+)px\b/g, (m, n: string) => {
    const a = Math.abs(Number(n));
    if (a === 0 || (kind === 'h' && a < 24) || (kind === 'w' && (a < 24 || a > 48))) return m;
    // whole pixels for boxes and spacing (text keeps its fractions); a size that was already a fraction is
    // left unrounded, so with the variables at 1 (paper) every value is exactly the original
    const v = `calc(${m} * var(${VAR[kind]},1))`;
    return kind !== 'fs' && Number.isInteger(a) ? `round(${v}, 1px)` : v;
  });
}

/** Split at top-level commas (not inside :not(…), :is(…) and the like). */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0, from = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) { out.push(s.slice(from, i)); from = i + 1; }
  }
  out.push(s.slice(from));
  return out.map((x) => x.trim()).filter(Boolean);
}

/** ':root[data-ui]' in front of each selector (html/:root selectors get the attribute themselves). */
export function scopeSelector(sel: string): string {
  return splitTop(sel).map((s) => {
    if (/^html(?![\w-])/.test(s)) return 'html[data-ui]' + s.slice(4);
    if (s.startsWith(':root')) return ':root[data-ui]' + s.slice(5);
    return ':root[data-ui] ' + s;
  }).join(',');
}

/** The size declarations of one rule body, scaled; '' when it has none. */
function scaleDecls(body: string): string {
  const out: string[] = [];
  for (const d of splitDecls(body)) {
    const i = d.indexOf(':');
    if (i < 0) continue;
    const prop = d.slice(0, i).trim().toLowerCase();
    const kind = KIND[prop];
    if (kind) out.push(`${prop}:${scaleValue(kind, d.slice(i + 1).trim())}`);
  }
  return out.join(';');
}

/** Split a rule body at semicolons outside brackets and quotes. */
function splitDecls(body: string): string[] {
  const out: string[] = [];
  let depth = 0, q = '', from = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (q) { if (c === q && body[i - 1] !== '\\') q = ''; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ';' && depth === 0) { out.push(body.slice(from, i)); from = i + 1; }
  }
  out.push(body.slice(from));
  return out;
}

/** Index of the brace that closes the block opened at `open` (quotes respected). */
function closing(css: string, open: number): number {
  let depth = 0, q = '';
  for (let i = open; i < css.length; i++) {
    const c = css[i];
    if (q) { if (c === q && css[i - 1] !== '\\') q = ''; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return css.length;
}

/** The size rules of one stylesheet, scoped and scaled (keyframes and font faces are left out). */
export function scaleSheet(css: string): string {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let out = '';
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const head = css.slice(i, open).trim();
    const end = closing(css, open);
    const body = css.slice(open + 1, end);
    if (head.startsWith('@media') || head.startsWith('@supports')) {
      const inner = scaleSheet(body);
      if (inner) out += `${head}{${inner}}`;
    } else if (head && !head.startsWith('@')) {
      const d = scaleDecls(body);
      if (d) out += `${scopeSelector(head)}{${d}}`;
    }
    i = end + 1;
  }
  return out;
}

const cache = new Map<string, string>();
/** All the app's size rules, for screens only, made once per set of sheets. */
export function uiSizeSheet(sheets: string[]): string {
  const key = sheets.join('\u0000');
  let s = cache.get(key);
  if (s === undefined) {
    s = `${UI_VARS}@media screen{${sheets.map(scaleSheet).join('')}}`;
    cache.set(key, s);
  }
  return s;
}

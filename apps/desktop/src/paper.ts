/** Pure rules for direct printing (no Electron here, so they are unit-tested). */

export interface PrinterInfo { name: string; displayName: string }

/** Paper the web app asks for: its print source's `page`, e.g. "A4 portrait" or "A5 landscape". A4 portrait when missing. */
export function paperOf(page: unknown): { pageSize: 'A4' | 'A5'; landscape: boolean } {
  const s = typeof page === 'string' ? page.trim().toLowerCase() : '';
  return { pageSize: /\ba5\b/.test(s) ? 'A5' : 'A4', landscape: /\blandscape\b/.test(s) };
}

export type Pick = { ok: true; name: string } | { ok: false; reason: 'none' | 'missing' };

/** The printer chosen on this PC, if it is still connected. */
export function pickPrinter(chosen: string | null | undefined, list: readonly PrinterInfo[]): Pick {
  if (!chosen) return { ok: false, reason: 'none' };
  return list.some((p) => p.name === chosen) ? { ok: true, name: chosen } : { ok: false, reason: 'missing' };
}

/** What is saved on this PC (printing.json): only a printer name, or nothing. */
export function readChoice(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = (raw as { printer?: unknown }).printer;
  return typeof p === 'string' && p.trim() && p.length <= 256 ? p : null;
}

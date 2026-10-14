/**
 * Document numbers (Settings › Transactions › Transaction prefixes): each document type has
 * several prefixes, one active. A number is the prefix plus a counter, e.g. JE/INV/0001.
 */

/** The types shown in Settings, in the prototype's order: [docType, label, default prefix]. */
export const PREFIX_TYPES: ReadonlyArray<readonly [docType: string, label: string, prefix: string]> = [
  ['invoice', 'Sale', 'INV-'],
  ['quotation', 'Estimate', 'Q-'],
  ['challan', 'Delivery challan', 'DC-'],
  ['credit_note', 'Credit note', 'CN-'],
  ['receipt', 'Payment in', 'PI-'],
  ['purchase_order', 'Purchase order', 'ORD-'],
  ['bill', 'Purchase bill', 'PB-'],
  ['debit_note', 'Debit note', 'DN-'],
  ['payment', 'Payment out', 'PO-'],
  ['expense', 'Expense', 'EXP-'],
];

/** Letters, digits, / - _ ; up to 10. Empty = "None". */
export const PREFIX_RE = /^[A-Za-z0-9/_-]{0,10}$/;
export const PREFIX_HELP = 'Use letters, digits, / - or _ (up to 10).';

export const PAD = 4;
export const formatNumber = (prefix: string, n: number, padding = PAD) => prefix + String(n).padStart(padding, '0');

/** The counter of `number` when it was made with `prefix` (the rest is digits only), else null. */
export function counterOf(number: string, prefix: string): number | null {
  if (!number.startsWith(prefix)) return null;
  const rest = number.slice(prefix.length);
  return /^\d{1,9}$/.test(rest) ? Number(rest) : null;
}

/**
 * Two prefixes of one type that could make the same number: one is the other plus digits
 * ("A" and "A1": A + 10001 = A1 + 0001). Such a pair is refused, so every number belongs to one prefix.
 */
export function prefixesClash(a: string, b: string): boolean {
  if (a.toUpperCase() === b.toUpperCase()) return true;
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  return l.startsWith(s) && /^\d+$/.test(l.slice(s.length));
}

/** A regular expression (Postgres ~) matching numbers made with `prefix`. */
export const prefixPattern = (prefix: string) => '^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[0-9]+$';

/**
 * Parties › ⋮ › Import Parties: the columns, and the one set of checks every row goes through —
 * for an Excel / CSV file, for the Bulk entry table (typed or pasted), and again on the server
 * when the rows are saved, so all three always agree.
 *
 * A row is OK (saved), Rejected (a value is wrong; nothing is saved) or Duplicate (a party with the
 * same name or phone already exists, or an earlier row of the same file has it; skipped, never
 * used to change the existing party).
 */
import { z } from 'zod';
import { D, MONEY_MAX, toDb } from './money.js';
import { GSTIN_RE, STATES, STATE_CODES, stateName } from './india.js';
import type { PartyInput } from './masters.js';

export const PARTY_IMPORT_COLUMNS = [
  { key: 'name', title: 'Party name', note: 'Required. Must be new: a party with the same name is skipped.', aliases: ['name'] },
  { key: 'type', title: 'Party type', note: 'Customer or Supplier. Blank = Customer.', aliases: ['type'] },
  { key: 'phone', title: 'Phone', note: '10-digit mobile number. Optional. Must be new: a party with the same phone is skipped.', aliases: ['mobile', 'phone number', 'mobile number', 'mobile no', 'phone no'] },
  { key: 'email', title: 'Email', note: 'Optional.', aliases: ['email id', 'e-mail'] },
  { key: 'gstin', title: 'GSTIN', note: 'Optional. 15 characters, like 27ABCDE1234F1Z0. A wrong GSTIN rejects the row.', aliases: ['gst number', 'gst no', 'gstin number'] },
  { key: 'address', title: 'Billing address', note: 'Optional. Shop no., street, area.', aliases: ['address'] },
  { key: 'city', title: 'City', note: 'Optional.', aliases: [] },
  { key: 'state', title: 'State', note: 'Optional. State name, e.g. Maharashtra. Blank = taken from the GSTIN.', aliases: [] },
  { key: 'opening', title: 'Opening balance', note: 'Old balance as of today. Optional. Up to 2 decimals, not negative.', aliases: ['opening balance amount', 'opening amount'] },
  { key: 'balType', title: 'Balance type', note: 'To receive (they owe you) or To pay (you owe them). Needed when there is an opening balance.', aliases: ['opening balance type'] },
  { key: 'limit', title: 'Credit limit', note: 'Optional. Blank = no limit. Up to 2 decimals, not negative.', aliases: [] },
] as const;

export type PartyImportKey = (typeof PARTY_IMPORT_COLUMNS)[number]['key'];
export const PARTY_IMPORT_KEYS = PARTY_IMPORT_COLUMNS.map((c) => c.key) as PartyImportKey[];
/** One row as typed: every cell is text. `line` is the row number in the file or the table. */
export type PartyImportRow = { line: number } & Record<PartyImportKey, string>;

export const PARTY_TYPES = ['Customer', 'Supplier'] as const;
export const BALANCE_TYPES = ['To receive', 'To pay'] as const;
export const PARTY_IMPORT_SHEET = 'Parties';
export const PARTY_IMPORT_MAX_ROWS = 1000;
export const PARTY_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
/** extra last column in the "rejected rows" file; ignored when the file comes back */
export const PARTY_IMPORT_PROBLEM_COLUMN = 'Problem';
/** the GST type Add party picks on its own (GTYPES[0] / GTYPES[1]) */
const GST_UNREGISTERED = 'Unregistered / consumer';
const GST_REGULAR = 'Registered business – regular';

/** What the shop already has, to check rows against. */
export interface PartyImportContext {
  /** live (not archived) parties */
  parties: { name: string; phone: string }[];
  /** Settings › GST is on (Add party then saves a GST type) */
  gst: boolean;
}

export type PartyRowStatus = 'ok' | 'rejected' | 'duplicate';
export interface PartyRowCheck {
  line: number;
  status: PartyRowStatus;
  /** problems by column (rejected rows); 'row' for the row as a whole (duplicates) */
  cells: Partial<Record<PartyImportKey | 'row', string[]>>;
  /** what is saved for an OK row: the same fields Add party sends (opening date is set when saved) */
  party: PartyInput | null;
}

const low = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
const blank = (r: Partial<Record<PartyImportKey, string>>) => PARTY_IMPORT_KEYS.every((k) => !(r[k] ?? '').trim());
export const isBlankPartyRow = blank;

/** A heading as typed → the column it means ('' when none). Ignores capital letters and extra spaces. */
export function partyColumnOf(heading: string): PartyImportKey | '' {
  const h = low(heading).replace(/\s*\*$/, '');
  if (!h) return '';
  const c = PARTY_IMPORT_COLUMNS.find((x) => low(x.title) === h || (x.aliases as readonly string[]).includes(h));
  return c ? c.key : '';
}

/** "₹ 1,250.50" → "1250.50"; blank → null; otherwise why it is wrong. */
export function parsePartyAmount(v: string): { value: string | null } | { error: string } {
  const s = v.replace(/[,₹\s]/g, '').replace(/^rs\.?/i, '');
  if (!s) return { value: null };
  if (/^-/.test(s) && /^-(\d+\.?\d*|\.\d+)$/.test(s)) return { error: 'Cannot be negative.' };
  if (!/^\+?(\d+\.?\d*|\.\d+)$/.test(s)) return { error: 'Enter a number, like 2500 or 2500.50.' };
  const n = new D(s.replace(/^\+/, ''));
  if ((s.split('.')[1] ?? '').replace(/0+$/, '').length > 2) return { error: 'At most 2 decimals (paise).' };
  if (n.gt(MONEY_MAX)) return { error: 'This amount is too large.' };
  return { value: toDb(n) };
}

const GST_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** The GSTIN's last character, worked out from the first 14 (the GST portal's check digit). */
export function gstinCheckChar(first14: string): string {
  let total = 0;
  for (let i = 0; i < 14; i++) {
    const p = GST_CHARS.indexOf(first14[i]!) * (i % 2 ? 2 : 1);
    total += Math.floor(p / 36) + (p % 36);
  }
  return GST_CHARS[(36 - (total % 36)) % 36]!;
}

/** Why a GSTIN is wrong, or null when it is right (pattern, state code and check digit). */
export function gstinProblem(g: string): string | null {
  if (!GSTIN_RE.test(g)) return 'GSTIN has 15 characters, like 27ABCDE1234F1Z0.';
  if (!STATE_CODES.includes(g.slice(0, 2))) return `GSTIN starts with ${g.slice(0, 2)}, which is not a state code.`;
  if (gstinCheckChar(g.slice(0, 14)) !== g[14]) return 'This GSTIN is not valid: its last character does not match. Check it for a typing mistake.';
  return null;
}

/** "Maharashtra" / "maharashtra" / "27" / "7" → "27"; blank → ''; unknown → null. */
export function stateCodeOf(v: string): string | null {
  const s = low(v);
  if (!s) return '';
  if (/^\d{1,2}$/.test(s)) { const c = s.padStart(2, '0'); return STATE_CODES.includes(c) ? c : null; }
  const norm = (x: string) => low(x).replace(/\band\b/g, '&').replace(/\s*&\s*/g, ' & ');
  return STATES.find(([, n]) => norm(n) === norm(s))?.[0] ?? null;
}

/** "+91 98765-43210" → "9876543210" (a number as Add party saves it; other text is left for the check). */
export const normPhone = (v: string) => {
  const s = v.replace(/[\s\-()]/g, '');
  return /^(\+?91)[6-9]\d{9}$/.test(s) ? s.slice(-10) : /^0[6-9]\d{9}$/.test(s) ? s.slice(1) : s;
};

/** Customer / Supplier, or the problem. */
function partyKind(v: string): 'customer' | 'supplier' | { error: string } {
  const s = low(v);
  if (!s || s === 'customer') return 'customer';
  if (s === 'supplier') return 'supplier';
  if (s === 'both') return { error: 'This app has no “Both” party type yet. Choose Customer or Supplier.' };
  return { error: 'Choose Customer or Supplier.' };
}

/** To receive (or To collect) / To pay; blank → null. */
function balanceType(v: string): 'receive' | 'pay' | null | { error: string } {
  const s = low(v);
  if (!s) return null;
  if (s === 'to receive' || s === 'to collect') return 'receive';
  if (s === 'to pay') return 'pay';
  return { error: 'Choose To receive or To pay.' };
}

/**
 * Checks every row against the shop and against the earlier rows (blank rows are left out).
 * Only rows that will be saved count for the duplicate check, so a rejected row never makes a
 * later good row a duplicate.
 */
export function checkPartyRows(rows: PartyImportRow[], ctx: PartyImportContext): PartyRowCheck[] {
  const names = new Map(ctx.parties.map((p) => [low(p.name), p.name]));
  const phones = new Map(ctx.parties.filter((p) => p.phone).map((p) => [p.phone, p.name]));
  const seenName = new Map<string, number>();
  const seenPhone = new Map<string, number>();
  const out: PartyRowCheck[] = [];

  for (const r of rows) {
    if (blank(r)) continue;
    const c: PartyRowCheck = { line: r.line, status: 'ok', cells: {}, party: null };
    const bad = (k: PartyImportKey, m: string) => (c.cells[k] ??= []).push(m);
    const v = (k: PartyImportKey) => (r[k] ?? '').trim();

    const name = v('name').replace(/\s+/g, ' ');
    if (!name) bad('name', 'Enter the party name.');
    else if (name.length > 160) bad('name', 'At most 160 characters.');

    const kind = partyKind(v('type'));
    if (typeof kind === 'object') bad('type', kind.error);

    const phone = normPhone(v('phone'));
    if (phone && !/^[6-9]\d{9}$/.test(phone)) bad('phone', 'Enter a 10-digit mobile number.');

    const email = v('email');
    if (email && (!/^\S+@\S+\.\S+$/.test(email) || email.length > 160)) bad('email', 'Enter a valid email address.');

    const gstin = v('gstin').replace(/\s/g, '').toUpperCase();
    const gp = gstin ? gstinProblem(gstin) : null;
    if (gp) bad('gstin', gp);

    let state = stateCodeOf(v('state'));
    if (state === null) bad('state', 'Choose a state from the list, e.g. Maharashtra.');
    else if (gstin && !gp) {
      const g = gstin.slice(0, 2);
      if (!state) state = g;
      else if (state !== g) bad('gstin', `GSTIN starts with ${g} (${stateName(g)}), but the state is ${stateName(state)}.`);
    }

    const address = v('address');
    if (address.length > 240) bad('address', 'At most 240 characters.');
    const city = v('city');
    if (city.length > 80) bad('city', 'At most 80 characters.');

    const ob = parsePartyAmount(v('opening'));
    if ('error' in ob) bad('opening', ob.error);
    const hasOb = 'value' in ob && !!ob.value && new D(ob.value).gt(0);
    const bt = balanceType(v('balType'));
    if (bt && typeof bt === 'object') bad('balType', bt.error);
    else if (hasOb && !bt) bad('balType', 'Choose To receive or To pay for the opening balance.');

    const lim = parsePartyAmount(v('limit'));
    if ('error' in lim) bad('limit', lim.error);

    if (Object.keys(c.cells).length) {
      c.status = 'rejected';
    } else {
      const dup: string[] = [];
      const key = low(name);
      if (names.has(key)) dup.push(`A party named “${names.get(key)}” already exists.`);
      else if (seenName.has(key)) dup.push(`Same party name as row ${seenName.get(key)}.`);
      if (phone && phones.has(phone)) dup.push(`Phone ${phone} is already used by “${phones.get(phone)}”.`);
      else if (phone && seenPhone.has(phone)) dup.push(`Same phone as row ${seenPhone.get(phone)}.`);
      if (dup.length) {
        c.status = 'duplicate';
        c.cells.row = dup;
      } else {
        seenName.set(key, r.line);
        if (phone) seenPhone.set(phone, r.line);
        c.party = {
          name, billingName: '', kind: kind as 'customer' | 'supplier', group: 'General', phone, email, gstin,
          gstType: ctx.gst ? (gstin ? GST_REGULAR : GST_UNREGISTERED) : '', state: state ?? '',
          billing: { line: address, city, pin: '', state: '' }, shipping: '',
          openingBalance: hasOb ? (ob as { value: string }).value : null,
          openingType: hasOb ? (bt as 'receive' | 'pay') : (kind === 'supplier' ? 'pay' : 'receive'),
          creditLimit: 'value' in lim ? lim.value : null, creditDays: 0, contacts: [],
        };
      }
    }
    out.push(c);
  }
  return out;
}

/** Plain-words reasons for a row, for the preview, the summary and the rejected-rows file. */
export function partyRowProblems(c: PartyRowCheck): string[] {
  const title = new Map<string, string>(PARTY_IMPORT_COLUMNS.map((x) => [x.key, x.title]));
  return Object.entries(c.cells).flatMap(([k, list]) => (list ?? []).map((m) => (k === 'row' ? m : `${title.get(k)}: ${m}`)));
}

/**
 * Text copied from Excel or Google Sheets → rows of cells (tab between cells, a new line between
 * rows; a cell with a tab, new line or quote comes in "quotes"). Trailing empty lines are dropped.
 */
export function splitPasted(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', i = 0;
  const t = text.replace(/\r\n?/g, '\n');
  while (i < t.length) {
    const ch = t[i]!;
    if (ch === '"' && cell === '') {
      // quoted cell: "" inside is one quote
      let j = i + 1, q = '';
      while (j < t.length) {
        if (t[j] === '"') { if (t[j + 1] === '"') { q += '"'; j += 2; continue; } break; }
        q += t[j++];
      }
      if (j < t.length && (j + 1 === t.length || t[j + 1] === '\t' || t[j + 1] === '\n')) { cell = q; i = j + 1; continue; }
    }
    if (ch === '\t') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
    i++;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  while (rows.length && rows[rows.length - 1]!.every((c) => !c.trim())) rows.pop();
  return rows;
}

/**
 * Is this pasted (or file) row the headings? Yes when at least two cells, and more than half of the
 * filled cells, are column headings — then the columns are those headings, in that order.
 */
export function headerColumns(cells: string[]): (PartyImportKey | '')[] | null {
  const filled = cells.filter((c) => c.trim());
  const keys = cells.map(partyColumnOf);
  const hits = keys.filter(Boolean).length;
  return hits >= 2 && hits * 2 > filled.length ? keys : null;
}

/** Pasted text → the rows' cells by column, with a heading row (when there is one) used and left out. */
export type Pasted = { header: true; cells: Partial<Record<PartyImportKey, string>>[] } | { header: false; cells: string[][] };
export function readPasted(text: string): Pasted {
  const rows = splitPasted(text);
  const head = rows.length ? headerColumns(rows[0]!) : null;
  if (!head) return { header: false, cells: rows };
  return {
    header: true,
    cells: rows.slice(1).map((r) => Object.fromEntries(head.flatMap((k, i) => (k ? [[k, (r[i] ?? '').trim()]] : []))) as Partial<Record<PartyImportKey, string>>),
  };
}

const cell = z.string().max(500).optional().default('');
const rowSchema = z.object({
  line: z.number().int().min(1),
  name: cell, type: cell, phone: cell, email: cell, gstin: cell, address: cell, city: cell, state: cell, opening: cell, balType: cell, limit: cell,
}) satisfies z.ZodType<PartyImportRow, z.ZodTypeDef, unknown>;
export const partyImportSchema = z.object({
  rows: z
    .array(rowSchema)
    .min(1, 'There are no rows to import.')
    .max(PARTY_IMPORT_MAX_ROWS, `At most ${PARTY_IMPORT_MAX_ROWS.toLocaleString('en-IN')} parties can be imported at once. Split the rows into smaller files.`),
});
export type PartyImportInput = z.infer<typeof partyImportSchema>;

export interface PartyImportSummary {
  saved: { line: number; id: string; name: string }[];
  rejected: { line: number; reasons: string[] }[];
  skipped: { line: number; reasons: string[] }[];
}

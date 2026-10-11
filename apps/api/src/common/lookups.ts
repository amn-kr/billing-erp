import type { Tx } from './db.service';

/** Find a named list entry (group, category, brand, …) or add it. Blank → null. */
export async function namedId(tx: Tx, model: 'partyGroup' | 'category' | 'brand' | 'itemGroup', businessId: string, userId: string, name: string | undefined): Promise<string | null> {
  const n = (name ?? '').trim();
  if (!n) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = tx[model] as any;
  const hit = await m.findFirst({ where: { name: { equals: n, mode: 'insensitive' } } });
  if (hit) return hit.id;
  return (await m.create({ data: { businessId, name: n, createdBy: userId } })).id;
}

export async function unitIdFor(tx: Tx, businessId: string, userId: string, code: string | undefined, name = ''): Promise<string | null> {
  const c = (code ?? '').trim().toUpperCase();
  if (!c) return null;
  const n = name.trim();
  const hit = await tx.unit.findFirst({ where: { code: c } });
  if (hit && n && !hit.name) await tx.unit.update({ where: { id: hit.id }, data: { name: n } });
  return hit ? hit.id : (await tx.unit.create({ data: { businessId, code: c, name: n, createdBy: userId } })).id;
}

export const day = (iso: string) => new Date(iso + 'T00:00:00Z');
export const isoOf = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

/** Postgres "unique violation" on one of our name/code indexes → a plain message. */
export function uniqueMessage(e: unknown): string | null {
  const err = e as { code?: string; message?: string; meta?: { modelName?: string; target?: string[] | string } };
  if (err?.code !== 'P2002' && !/unique constraint|duplicate key/i.test(String(err?.message ?? ''))) return null;
  const msg = String(err.message ?? '');
  const model = err.meta?.modelName ?? (/tx\.party\.|\bparties\b/.test(msg) ? 'Party' : /tx\.item\.|\bitems\b/.test(msg) ? 'Item' : /godown/.test(msg) ? 'Godown' : /priceList|price_lists/.test(msg) ? 'PriceList' : '');
  const target = String(err.meta?.target ?? '') + ' ' + String(err.message ?? '');
  if (model === 'Party') return 'A party with this name already exists.';
  if (model === 'Item') return /code/.test(target) ? 'This item code is already used.' : 'An item with this name already exists.';
  if (model === 'Godown') return 'A godown with this name already exists.';
  if (model === 'PriceList') return 'A price list with this name already exists.';
  return 'This name is already used.';
}

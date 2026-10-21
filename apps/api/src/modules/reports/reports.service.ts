import { Injectable, NotFoundException } from '@nestjs/common';
import { formatDmy, money, round2, todayIst, type Money } from '@billing/shared';
import { DbService, type Tx } from '../../common/db.service';
import { LedgerService } from '../../common/ledger.service';
import type { RequestContext } from '../../common/context';
import { isoOf } from '../../common/lookups';
import { CommissionService } from '../commission/commission.service';
import { billBalances, usedOut } from '../purchases/dues';
import { invoiceBalances, unusedAmounts } from '../sales/dues';
import { documentCost, goodsCosts } from '../stock/stock-value';

const m = (v: { toString(): string } | null | undefined) => money(v ? v.toString() : 0);
const n2 = (v: Money) => Number(round2(v).toFixed(2));
const plural = (k: number, w: string) => `${k} ${w}${k === 1 ? '' : 's'}`;

/** One line on a party's account (prototype psEntries): debit = they owe more, credit = they owe less. */
export interface StEntry { date: string; no: string; type: string; kind: string; info: string; dr: number; cr: number; o: number; ref?: string }
const ORD: Record<string, number> = { 'Opening balance': 0, Sale: 1, Purchase: 1, 'Debit note': 2, 'Credit note': 2, 'Cheque bounce': 3, Refund: 3, 'Payment-In': 4, 'Payment-Out': 4 };

interface PartyRow { id: string; name: string; kind: string; group: string; phone: string; city: string; gstin: string; limit: number | null; sup: boolean; type: 'Supplier' | 'Electrician' | 'Customer' }
interface Line { itemId: string | null; name: string; unit: string; qty: number; price: number; disc: number; amt: number; tv: number; cat: string; iunit: string; iname: string }
interface Doc { id: string; no: string; date: string; partyId: string | null; total: number; lines: Line[] }

/**
 * Party reports (prototype RPT.pstmt / ppl / allp / pitem / spp / spg). Every figure comes from
 * the saved documents in the same way the prototype reads its party transactions; the closing
 * balance of a statement equals the party balance in the books.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly db: DbService, private readonly ledger: LedgerService, private readonly commission: CommissionService) {}

  private scope(ctx: RequestContext) {
    return { businessId: ctx.businessId, userId: ctx.userId, email: ctx.email };
  }

  /** Everything the party reports read, loaded once. */
  private async load(tx: Tx, partyId?: string) {
    const pw = partyId ? { partyId } : { partyId: { not: null } };
    const [parties, items, sales, pays, purch, cheques] = await Promise.all([
      tx.party.findMany({ where: partyId ? { id: partyId } : { archivedAt: null }, include: { group: true, addresses: { where: { kind: 'billing' }, take: 1 } }, orderBy: { name: 'asc' } }),
      tx.item.findMany({ include: { unit: true, category: true } }),
      // deleted documents are left out (they count for nothing, like cancelled ones, and are hidden)
      tx.salesDocument.findMany({ where: { kind: { in: ['invoice', 'credit_note'] }, deletedAt: null, ...pw }, include: { lines: { orderBy: { position: 'asc' } } }, orderBy: [{ date: 'asc' }, { number: 'asc' }] }),
      tx.payment.findMany({ where: { cancelledAt: null, ...pw }, orderBy: [{ date: 'asc' }, { number: 'asc' }] }),
      tx.purchaseDocument.findMany({ where: { kind: { in: ['bill', 'debit_note'] }, cancelledAt: null, ...(partyId ? { partyId } : {}) }, include: { lines: { orderBy: { position: 'asc' } } }, orderBy: [{ date: 'asc' }, { number: 'asc' }] }),
      tx.cheque.findMany({ where: { status: 'bounced', ...pw } }),
    ]);
    const it = new Map(items.map((i) => [i.id, i]));
    const P: PartyRow[] = parties.map((p) => {
      const g = p.group?.name ?? '';
      const sup = p.kind === 'supplier';
      return { id: p.id, name: p.name, kind: p.kind, group: g, phone: p.phone, city: p.addresses[0]?.city ?? '', gstin: p.gstin, limit: p.creditLimit ? Number(p.creditLimit) : null, sup, type: sup ? 'Supplier' : g === 'Electricians' ? 'Electrician' : 'Customer' };
    });
    const line = (l: { itemId: string | null; name: string; unit: string; qty: unknown; discPct: unknown; gstRate: unknown; taxable: unknown; amount: unknown }, price: unknown): Line => {
      const i = l.itemId ? it.get(l.itemId) : undefined;
      const qty = Number(l.qty);
      return {
        itemId: l.itemId, name: l.name, unit: l.unit, qty, price: Number(price), disc: Number(l.discPct), amt: Number(l.amount), tv: Number(l.taxable),
        cat: i?.category?.name ?? '', iunit: i?.unit?.code ?? '', iname: i?.name ?? '',
      };
    };
    const doc = (d: { id: string; number: string; date: Date; partyId: string | null; total: unknown }, lines: Line[]): Doc => ({ id: d.id, no: d.number, date: isoOf(d.date)!, partyId: d.partyId, total: Number(d.total), lines });
    const inv = sales.filter((s) => s.kind === 'invoice');
    const cns = sales.filter((s) => s.kind === 'credit_note' && !s.cancelledAt);
    const invNo = new Map(inv.map((v) => [v.id, v.number]));
    return {
      parties, P, it,
      invoices: inv.map((v) => ({ ...doc(v, v.lines.map((l) => line(l, l.price))), cancelled: !!v.cancelledAt, due: v.mode === 'credit' && v.dueDate ? isoOf(v.dueDate)! : '', referred: !!v.referrerId })),
      creditNotes: cns.map((c) => ({ ...doc(c, c.lines.map((l) => line(l, l.price))), refund: c.status === 'refund', refundMode: String((c.extra as Record<string, unknown>)?.refundMode ?? ''), reason: c.reason, against: [...new Set(c.lines.flatMap((l) => (l.againstId && invNo.get(l.againstId) ? [invNo.get(l.againstId)!] : [])))] })),
      pays: pays.map((p) => ({ id: p.id, no: p.number, date: isoOf(p.date)!, partyId: p.partyId, amount: Number(p.amount), dir: p.direction, mode: p.mode, ref: p.reference })),
      bills: purch.filter((d) => d.kind === 'bill').map((d) => ({ ...doc(d, d.lines.map((l) => line(l, l.rate))), due: d.dueDate ? isoOf(d.dueDate)! : '', supplierRef: d.supplierRef })),
      debitNotes: purch.filter((d) => d.kind === 'debit_note').map((d) => ({ ...doc(d, []), supplierRef: d.supplierRef })),
      cheques: cheques.map((c) => ({ no: 'CB-' + (c.chequeNo.replace(/\D/g, '') || c.chequeNo), date: isoOf(c.statusDate ?? c.chequeDate)!, partyId: c.partyId, amount: Number(c.amount), out: c.direction === 'issued' })),
    };
  }

  /** Every entry on one party's account (prototype psEntries). */
  private entries(L: Awaited<ReturnType<ReportsService['load']>>, pid: string): StEntry[] {
    const p = L.parties.find((x) => x.id === pid)!;
    const sup = p.kind === 'supplier';
    const E: StEntry[] = [];
    const push = (e: Omit<StEntry, 'o'>) => E.push({ ...e, o: ORD[e.type] ?? 5 });
    const ob = Number(p.openingBalance);
    if (ob) {
      const recv = p.openingType !== 'pay';
      push({ date: isoOf(p.openingDate) ?? '2000-01-01', no: '—', type: 'Opening balance', kind: 'Opening balance', info: 'Balance brought forward', dr: recv ? ob : 0, cr: recv ? 0 : ob });
    }
    for (const v of L.invoices.filter((x) => x.partyId === pid)) {
      const k = v.lines.length;
      push(v.cancelled
        ? { date: v.date, no: v.no, type: 'Sale', kind: 'Sale (cancelled)', info: 'Cancelled', dr: 0, cr: 0, ref: v.id }
        : { date: v.date, no: v.no, type: 'Sale', kind: 'Sale', ref: v.id, info: [k ? plural(k, 'item') : '', v.due ? 'due ' + formatDmy(v.due) : ''].filter(Boolean).join(' · '), dr: v.total, cr: 0 });
    }
    for (const x of L.pays.filter((y) => y.partyId === pid)) {
      if (x.dir === 'in') push({ date: x.date, no: x.no, type: 'Payment-In', kind: 'Payment received', info: [x.mode, x.ref].filter((s) => s && s !== '—').join(' · '), dr: 0, cr: x.amount });
      else push({ date: x.date, no: x.no, type: 'Payment-Out', kind: 'Payment made', info: [x.mode, x.ref].filter(Boolean).join(' · '), dr: x.amount, cr: 0 });
    }
    for (const b of L.bills.filter((x) => x.partyId === pid)) push({ date: b.date, no: b.no, type: 'Purchase', kind: 'Purchase', info: b.due ? 'due ' + formatDmy(b.due) : '', dr: 0, cr: b.total });
    for (const c of L.creditNotes.filter((x) => x.partyId === pid)) {
      push({ date: c.date, no: c.no, type: 'Credit note', kind: 'Credit note', info: [c.against.length ? 'against ' + c.against.join(', ') : '', c.reason].filter(Boolean).join(' · ') || 'Goods returned', dr: 0, cr: c.total });
      if (c.refund) push({ date: c.date, no: c.no, type: 'Refund', kind: 'Refund paid', info: c.refundMode, dr: c.total, cr: 0 });
    }
    for (const d of L.debitNotes.filter((x) => x.partyId === pid)) push({ date: d.date, no: d.no, type: 'Debit note', kind: 'Debit note', info: 'Goods returned to supplier', dr: d.total, cr: 0 });
    for (const c of L.cheques.filter((x) => x.partyId === pid)) push({ date: c.date, no: c.no, type: 'Cheque bounce', kind: 'Cheque bounce', info: 'Cheque returned unpaid', dr: sup ? 0 : c.amount, cr: sup ? c.amount : 0 });
    return E.sort((a, b) => a.date.localeCompare(b.date) || a.o - b.o || a.no.localeCompare(b.no));
  }

  /**
   * A party's transactions for the Parties page (prototype p.tx): every sale, purchase, payment in / out,
   * credit note, debit note, cheque bounce and the opening balance, newest first, each with its total,
   * what is still open on it (unpaid, or unused for payments and notes) and its due date.
   * Sales-side rows need sales.view and purchase-side rows purchases.view. Bills and debit notes also carry
   * the supplier's own number (supplierRef) when one was entered; other rows have no such field.
   */
  partyTx(ctx: RequestContext, pid: string) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const L = await this.load(tx, pid);
      const p = L.parties[0];
      if (!p) throw new NotFoundException('Party not found');
      const sales = ctx.permissions.includes('sales.view'), purch = ctx.permissions.includes('purchases.view');
      const open = (total: Money, used: Money | undefined) => { const b = total.minus(used ?? 0); return b.isNegative() ? money(0) : b; };
      const R: { type: string; no: string; date: string; total: string; bal: string; due: string; supplierRef?: string }[] = [];
      const push = (type: string, no: string, date: string, total: Money | number, bal: Money, due = '', supplierRef = '') =>
        R.push({ type, no, date, total: money(total).toFixed(2), bal: bal.toFixed(2), due, ...(supplierRef ? { supplierRef } : {}) });

      const ob = money(p.openingBalance.toString());
      if (!ob.isZero()) {
        const [r] = await tx.$queryRaw<{ used: string | null }[]>`
          SELECT sum(a.amount)::text AS used FROM payment_allocations a
          LEFT JOIN payments x ON x.id = a.payment_id LEFT JOIN sales_documents n ON n.id = a.note_id LEFT JOIN purchase_documents d ON d.id = a.note_id
          WHERE a.kind = 'opening' AND a.party_id = ${pid}::uuid AND x.cancelled_at IS NULL AND n.cancelled_at IS NULL AND d.cancelled_at IS NULL`;
        push('Opening balance', '—', isoOf(p.openingDate) ?? '', ob, open(ob, money(r?.used ?? 0)));
      }
      if (sales) {
        const inv = L.invoices.filter((v) => !v.cancelled);
        const ib = await invoiceBalances(tx, inv.map((v) => v.id));
        for (const v of inv) push('Sale', v.no, v.date, v.total, ib.get(v.id) ?? money(0), v.due);
        const pin = L.pays.filter((x) => x.dir === 'in');
        const pu = await unusedAmounts(tx, 'payment', pin.map((x) => x.id));
        for (const x of pin) push('Payment-In', x.no, x.date, x.amount, open(money(x.amount), pu.get(x.id)));
        const cu = await unusedAmounts(tx, 'note', L.creditNotes.map((c) => c.id));
        for (const c of L.creditNotes) push('Credit note', c.no, c.date, c.total, c.refund ? money(0) : open(money(c.total), cu.get(c.id)));
      }
      if (purch) {
        const bb = await billBalances(tx, L.bills.map((b) => b.id));
        for (const b of L.bills) push('Purchase', b.no, b.date, b.total, bb.get(b.id) ?? money(0), b.due, b.supplierRef);
        const pout = L.pays.filter((x) => x.dir !== 'in');
        const ou = await usedOut(tx, 'payment', pout.map((x) => x.id));
        for (const x of pout) push('Payment-Out', x.no, x.date, x.amount, open(money(x.amount), ou.get(x.id)));
        const du = await usedOut(tx, 'note', L.debitNotes.map((d) => d.id));
        for (const d of L.debitNotes) push('Debit note', d.no, d.date, d.total, open(money(d.total), du.get(d.id)), '', d.supplierRef);
      }
      // a bounced cheque is owed again from its bounce date (prototype: bal = amount, due = date)
      for (const c of L.cheques) if (c.out ? purch : sales) push('Cheque bounce', c.no, c.date, c.amount, money(c.amount), c.date);
      return R.sort((a, b) => b.date.localeCompare(a.date) || b.no.localeCompare(a.no));
    });
  }

  /** Party Statement: opening, every entry in the period with a running balance, closing. */
  statement(ctx: RequestContext, pid: string, from: string, to: string) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const L = await this.load(tx, pid);
      const p = L.P[0];
      if (!p) throw new NotFoundException('Party not found');
      let open = money(0);
      const R: (StEntry & { run: number; lines: { name: string; qty: number; unit: string; rate: number; amt: number }[] })[] = [];
      for (const e of this.entries(L, pid)) {
        if (e.date < from) open = open.plus(e.dr).minus(e.cr);
        else if (e.date <= to) R.push({ ...e, run: 0, lines: [] });
      }
      let run = open;
      for (const e of R) {
        run = run.plus(e.dr).minus(e.cr);
        e.run = n2(run);
        const d = e.type === 'Sale' ? L.invoices.find((v) => v.no === e.no) : e.type === 'Purchase' ? L.bills.find((b) => b.no === e.no) : undefined;
        if (d) e.lines = d.lines.map((l) => ({ name: l.name, qty: l.qty, unit: l.unit, rate: n2(m(String(l.price)).times(1 - l.disc / 100)), amt: l.amt || n2(m(String(l.qty)).times(l.price)) }));
      }
      const dr = n2(R.reduce((a, e) => a.plus(e.dr), money(0))), cr = n2(R.reduce((a, e) => a.plus(e.cr), money(0)));
      // overdue: unpaid credit invoices past their due date
      const t = todayIst();
      const live = L.invoices.filter((v) => !v.cancelled && v.partyId === pid && v.due && v.due < t);
      const bal = await invoiceBalances(tx, live.map((v) => v.id));
      const overdue = p.sup ? 0 : n2(live.reduce((a, v) => a.plus(bal.get(v.id) ?? 0), money(0)));
      return { party: p, from, to, open: n2(open), rows: R, dr, cr, close: n2(open.plus(dr).minus(cr)), overdue };
    });
  }

  /** Customers, suppliers and electricians to choose from, with whether they have any entries (the statement opens on the first customer with entries). */
  partyList(ctx: RequestContext) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const L = await this.load(tx);
      return L.P.map((p) => ({ ...p, entries: this.entries(L, p.id).length, sales: L.invoices.some((v) => v.partyId === p.id) }));
    });
  }

  /** All parties: type, group, contact, credit limit, last transaction and balance (as on today). */
  allParties(ctx: RequestContext) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const L = await this.load(tx);
      const bal = await this.ledger.partyBalances(tx, L.P.map((p) => p.id));
      return L.P.map((p) => {
        const E = this.entries(L, p.id).filter((e) => e.type !== 'Opening balance');
        return { ...p, balance: n2(bal.get(p.id) ?? money(0)), last: E.length ? E.reduce((a, e) => (e.date > a ? e.date : a), '') : '' };
      });
    });
  }

  /** Per party in a period: sales (with value before GST, cost and commission), returns and purchases. */
  activity(ctx: RequestContext, from: string, to: string) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const L = await this.load(tx);
      const inR = (d: string) => d >= from && d <= to;
      const bills = await this.commission.bills(tx);
      const C = await goodsCosts(tx);
      const cm = new Map(bills.flatMap((e) => e.invoices.map((b) => [b.id, money(b.comm).minus(b.ret)] as const)));
      return L.P.map((p) => {
        const S = L.invoices.filter((v) => v.partyId === p.id && !v.cancelled && inR(v.date));
        const CN = L.creditNotes.filter((c) => c.partyId === p.id && inR(c.date));
        const Pu = L.bills.filter((b) => b.partyId === p.id && inR(b.date));
        const DN = L.debitNotes.filter((d) => d.partyId === p.id && inR(d.date));
        const sum = (A: { total: number }[]) => n2(A.reduce((a, x) => a.plus(x.total), money(0)));
        const tv = n2(S.reduce((a, v) => a.plus(v.lines.reduce((s, l) => s.plus(l.tv), money(0)).isZero() ? v.total : v.lines.reduce((s, l) => s.plus(l.tv), money(0))), money(0)));
        // cost of goods from the purchase-rate lots each sale used, less what its returns put back (owner's rule, Oct 2026)
        const cost = n2(S.reduce((a, v) => a.plus(documentCost(C, v.id, v.lines)), money(0)));
        const rv = n2(CN.reduce((a, c) => a.plus(c.lines.reduce((s, l) => s.plus(l.tv), money(0))), money(0)));
        const rc = n2(CN.reduce((a, c) => a.plus(documentCost(C, c.id, c.lines)), money(0)));
        const comm = n2(S.reduce((a, v) => a.plus(cm.get(v.id) ?? 0), money(0)));
        return {
          id: p.id, name: p.name, group: p.group || 'General', groupName: p.group, type: p.type, sup: p.sup,
          sn: S.length, sale: sum(S), sr: sum(CN), pn: Pu.length, pur: sum(Pu), pr: sum(DN),
          tv: n2(m(String(tv)).minus(rv)), cost: n2(m(String(cost)).minus(rc)), comm,
        };
      });
    });
  }

  /** Items bought from or sold to one party in a period (amounts include GST). */
  partyItems(ctx: RequestContext, pid: string, from: string, to: string) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const L = await this.load(tx, pid);
      const p = L.P[0];
      if (!p) throw new NotFoundException('Party not found');
      const inR = (d: string) => d >= from && d <= to;
      const M = new Map<string, { name: string; cat: string; unit: string; sq: number; sa: Money; pq: number; pa: Money }>();
      const add = (l: Line, k: 's' | 'p', a: Money) => {
        const key = l.itemId || l.name;
        const o = M.get(key) ?? { name: l.iname || l.name, cat: l.cat, unit: l.iunit || l.unit, sq: 0, sa: money(0), pq: 0, pa: money(0) };
        if (k === 's') { o.sq += l.qty; o.sa = o.sa.plus(a); } else { o.pq += l.qty; o.pa = o.pa.plus(a); }
        M.set(key, o);
      };
      for (const v of L.invoices.filter((x) => !x.cancelled && inR(x.date))) for (const l of v.lines) add(l, 's', l.amt ? m(String(l.amt)) : m(String(l.qty)).times(l.price));
      for (const b of L.bills.filter((x) => inR(x.date))) for (const l of b.lines) add(l, 'p', m(String(l.qty)).times(l.price).times(1 - l.disc / 100));
      const rows = [...M.values()].map((o) => ({ ...o, sa: n2(o.sa), pa: n2(o.pa) })).sort((a, b) => b.sa + b.pa - (a.sa + a.pa));
      return { party: p, rows };
    });
  }
  /**
   * Home (prototype homeLive / hmGst / bkDash): today's and yesterday's sales, this month's GST
   * (output on bills less returns, input on purchases less returns and on expenses), top selling
   * items this financial year, the six latest invoices and today's cash and bank movement.
   */
  home(ctx: RequestContext, date = todayIst()) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const t = date;
      const y = new Date(Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10) - 1)).toISOString().slice(0, 10);
      const mS = t.slice(0, 8) + '01', mE = t.slice(0, 8) + '31';
      const fy = +t.slice(5, 7) >= 4 ? +t.slice(0, 4) : +t.slice(0, 4) - 1;
      const day = (d: string) => new Date(d + 'T00:00:00Z');
      const [inv, cns, purch, exps, cb] = await Promise.all([
        tx.salesDocument.findMany({ where: { kind: 'invoice', cancelledAt: null }, include: { lines: true, party: { include: { addresses: { where: { kind: 'billing' }, take: 1 } } } }, orderBy: [{ date: 'desc' }, { number: 'desc' }] }),
        tx.salesDocument.findMany({ where: { kind: 'credit_note', cancelledAt: null, date: { gte: day(mS), lte: day(mE) } }, include: { lines: true } }),
        tx.purchaseDocument.findMany({ where: { kind: { in: ['bill', 'debit_note'] }, cancelledAt: null, date: { gte: day(mS), lte: day(mE) } } }),
        tx.expense.findMany({ where: { cancelledAt: null, date: { gte: day(mS), lte: day(mE) } } }),
        tx.$queryRaw<{ amt: string | null }[]>`
          SELECT sum(l.debit - l.credit)::text AS amt FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN ledger_accounts a ON a.id = l.account_id
          WHERE e.cancelled_at IS NULL AND a.key LIKE 'cb:%' AND e.date = ${t}::date`,
      ]);
      const on = (d: string) => inv.filter((v) => isoOf(v.date) === d);
      const sum = <T,>(A: T[], f: (x: T) => Money) => n2(A.reduce((a, x) => a.plus(f(x)), money(0)));
      const out = sum(inv.filter((v) => isoOf(v.date)! >= mS && isoOf(v.date)! <= mE), (v) => m(v.cgst).plus(m(v.sgst)).plus(m(v.igst)))
        - sum(cns.flatMap((c) => c.lines), (l) => { const a = m(l.amount), g = Number(l.gstRate); return g ? a.minus(a.div(1 + g / 100)) : money(0); });
      const inp = sum(purch, (d) => (d.kind === 'debit_note' ? m(d.tax).negated() : m(d.tax))) + sum(exps, (x) => m(x.tax));
      const by = new Map<string, Money>();
      for (const v of inv) {
        const d = isoOf(v.date)!;
        if (d < `${fy}-04-01` || d > `${fy + 1}-03-31`) continue;
        for (const l of v.lines) if (l.itemId) by.set(l.name, (by.get(l.name) ?? money(0)).plus(m(l.qty).times(m(l.price))));
      }
      const recent = inv.slice(0, 6);
      const bal = await invoiceBalances(tx, recent.map((v) => v.id));
      const pay = await tx.payment.findMany({ where: { sourceId: { in: recent.map((v) => v.id) }, atSale: true, cancelledAt: null }, orderBy: { createdAt: 'asc' } });
      // paid later: how it was paid (a receipt's mode, or "Commission adjust")
      const later = await tx.paymentAllocation.findMany({ where: { salesDocumentId: { in: recent.map((v) => v.id) }, payment: { cancelledAt: null } }, include: { payment: { select: { mode: true } } }, orderBy: { createdAt: 'asc' } });
      const modeOf = (id: string) => pay.find((p) => p.sourceId === id)?.mode ?? later.find((a) => a.salesDocumentId === id && a.payment)?.payment?.mode ?? '';
      return {
        today: sum(on(t), (v) => m(v.total)), todayBills: on(t).length, yesterday: sum(on(y), (v) => m(v.total)),
        gst: { out: n2(m(String(out))), inp: n2(m(String(inp))) },
        top: [...by.entries()].map(([k, v]) => [k, n2(v)] as [string, number]).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 5),
        cashToday: n2(m(cb[0]?.amt ?? 0)),
        recent: recent.map((v) => ({
          id: v.id, number: v.number, date: isoOf(v.date)!, due: isoOf(v.dueDate) ?? '', total: Number(v.total), balance: n2(bal.get(v.id) ?? money(0)),
          party: v.mode === 'cash' || !v.party ? v.cashName || 'Walk-in customer' : v.party.name, city: v.party?.addresses[0]?.city ?? '',
          items: v.lines.filter((l) => l.itemId || l.name).length, payMode: modeOf(v.id),
        })),
      };
    });
  }
}

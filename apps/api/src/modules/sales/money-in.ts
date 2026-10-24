import { isBankMode, money, type Money, type PayPart } from '@billing/shared';
import type { Tx } from '../../common/db.service';
import type { LedgerService, PostLine } from '../../common/ledger.service';
import { day } from '../../common/lookups';

/**
 * The cash or bank account money of each mode goes into or comes out of (prototype modeAcct): cash
 * in the cash account; UPI, bank transfer and card in the bank account picked — the default bank
 * account when none is picked (or the one picked is gone), or cash when the shop has no bank
 * account yet. A cheque has none until it is cleared (null).
 */
export async function cashBankFor(tx: Tx, mode: string, accountId?: string | null): Promise<string | null> {
  if (mode === 'Cheque') return null;
  const accs = await tx.cashBankAccount.findMany({ where: { archivedAt: null }, orderBy: { createdAt: 'asc' } });
  const cash = accs.find((a) => a.kind === 'cash' && a.isDefault) ?? accs.find((a) => a.kind === 'cash');
  if (/cash/i.test(mode)) return cash!.id;
  const banks = accs.filter((a) => a.kind === 'bank');
  const picked = accountId && isBankMode(mode) ? banks.find((a) => a.id === accountId) : undefined;
  return (picked ?? banks.find((a) => a.isDefault) ?? banks[0] ?? cash!).id;
}

/** Where money received lands in the books: its cash / bank account, or "cheques in hand" until the cheque is cleared. */
export async function accountFor(tx: Tx, mode: string, accountId?: string | null): Promise<string> {
  const id = await cashBankFor(tx, mode, accountId);
  return id ? 'cb:' + id : 'cheques_in_hand';
}

/** The debit side of money received, one line per mode; cheques are also put in the cheque register. */
export async function moneyInLines(
  tx: Tx,
  ctx: { businessId: string; userId: string },
  o: { splits: { mode: string; amount: Money; ref: string; accountId?: string | null }[]; paymentId: string; partyId: string | null; date: string; memo: string },
): Promise<PostLine[]> {
  const lines: PostLine[] = [];
  for (const s of o.splits) {
    if (!s.amount.gt(0)) continue;
    lines.push({ account: await accountFor(tx, s.mode, s.accountId), debit: s.amount, memo: `${s.mode}${s.ref ? ' · ' + s.ref : ''} · ${o.memo}` });
    if (s.mode === 'Cheque') {
      await tx.cheque.create({
        data: { businessId: ctx.businessId, createdBy: ctx.userId, direction: 'received', chequeNo: s.ref, chequeDate: day(o.date), amount: s.amount.toFixed(2), partyId: o.partyId, paymentId: o.paymentId },
      });
    }
  }
  return lines;
}

/**
 * Scale split parts down to a total (walk-in sale paid more than the bill: only the
 * bill is recorded). Takes from the last part first.
 */
export function capSplits(parts: PayPart[], cap: Money) {
  let over = parts.reduce((a, p) => a.plus(money(p.amount)), money(0)).minus(cap);
  const out = parts.map((p) => ({ mode: p.mode as string, amount: money(p.amount), ref: p.ref }));
  for (let i = out.length - 1; i >= 0 && over.gt(0); i--) {
    const cut = over.lt(out[i]!.amount) ? over : out[i]!.amount;
    out[i]!.amount = out[i]!.amount.minus(cut);
    over = over.minus(cut);
  }
  return out.filter((p) => p.amount.gt(0));
}

/**
 * Cancels a payment received: its entry in the books no longer counts and a cheque still waiting
 * is cancelled. What it settled stops counting by itself (a cancelled payment settles nothing).
 * Used when a walk-in sale is cancelled (its money is refunded) and when a payment is deleted.
 */
export async function cancelPayment(tx: Tx, ledger: LedgerService, o: { id: string; userId: string; date: string; at?: Date }) {
  await tx.payment.update({ where: { id: o.id }, data: { cancelledAt: o.at ?? new Date(), cancelledBy: o.userId } });
  await ledger.cancel(tx, 'payment', o.id);
  await cancelPendingCheques(tx, o.id, o.date);
}

/** A payment's cheque still waiting in the register no longer counts (payment cancelled, or replaced by an edit). */
export async function cancelPendingCheques(tx: Tx, paymentId: string, date: string, note?: string) {
  await tx.cheque.updateMany({ where: { paymentId, status: 'pending' }, data: { status: 'cancelled', statusDate: day(date), ...(note && { note }) } });
}

import { money, type Money, type PayPart } from '@billing/shared';
import type { Tx } from '../../common/db.service';
import type { PostLine } from '../../common/ledger.service';
import { day } from '../../common/lookups';

/**
 * Where money of each mode lands (prototype modeAcct): cash in the cash account,
 * cheques wait in "cheques in hand" until cleared, everything else in the default
 * bank account — or cash when the shop has no bank account yet.
 */
export async function accountFor(tx: Tx, mode: string): Promise<string> {
  if (mode === 'Cheque') return 'cheques_in_hand';
  const accs = await tx.cashBankAccount.findMany({ where: { archivedAt: null }, orderBy: { createdAt: 'asc' } });
  const cash = accs.find((a) => a.kind === 'cash' && a.isDefault) ?? accs.find((a) => a.kind === 'cash');
  if (/cash/i.test(mode)) return 'cb:' + cash!.id;
  const banks = accs.filter((a) => a.kind === 'bank');
  const bank = banks.find((a) => a.isDefault) ?? banks[0] ?? cash!;
  return 'cb:' + bank.id;
}

/** The debit side of money received, one line per mode; cheques are also put in the cheque register. */
export async function moneyInLines(
  tx: Tx,
  ctx: { businessId: string; userId: string },
  o: { splits: { mode: string; amount: Money; ref: string }[]; paymentId: string; partyId: string | null; date: string; memo: string },
): Promise<PostLine[]> {
  const lines: PostLine[] = [];
  for (const s of o.splits) {
    if (!s.amount.gt(0)) continue;
    lines.push({ account: await accountFor(tx, s.mode), debit: s.amount, memo: `${s.mode}${s.ref ? ' · ' + s.ref : ''} · ${o.memo}` });
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

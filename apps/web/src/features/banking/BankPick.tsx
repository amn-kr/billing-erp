/**
 * Which bank account a UPI, bank transfer or card payment went into or came from — the
 * expense window's "Paid from" drop-down. It shows only when the shop has two or more bank
 * accounts; otherwise the screen stays as it was and the money goes to the default bank.
 */
import { isBankMode } from '@billing/shared';
import { useAccounts, type Account } from './model';

export interface BankPick { banks: Account[]; def: string; show: boolean }

export function useBankPick(): BankPick {
  const q = useAccounts();
  const banks = (q.data ?? []).filter((a) => a.kind === 'bank');
  return { banks, def: (banks.find((a) => a.isDefault) ?? banks[0])?.id ?? '', show: banks.length > 1 };
}

/** The account shown for a payment: the one picked while it still exists, else the default bank. */
export const bankOf = (bp: BankPick, id: string | null | undefined) => (id && bp.banks.some((b) => b.id === id) ? id : bp.def);

/** What is sent with a payment: the bank picked for a bank mode (null = the server's default). */
export const bankFor = (bp: BankPick, mode: string, id: string | null | undefined) => (bp.show && isBankMode(mode) ? bankOf(bp, id) : null);

/** The drop-down in a payment window ("Received in" / "Paid from"); nothing for cash, cheque or one bank. */
export function BankSelect({ bp, mode, id, label, value, onChange }: { bp: BankPick; mode: string; id: string; label: string; value: string; onChange: (v: string) => void }) {
  if (!bp.show || !isBankMode(mode)) return null;
  return (
    <label className="fl" htmlFor={id}>{label}<select className="fi" id={id} value={bankOf(bp, value)} onChange={(e) => onChange(e.target.value)}>{bp.banks.map((a) => <option value={a.id} key={a.id}>{a.name}</option>)}</select></label>
  );
}

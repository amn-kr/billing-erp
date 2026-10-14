import { formatDmy, formatInr0, formatInr2, type MoneyInput } from '@billing/shared';

/** Prototype inr(): "₹25,000" (the ₹ is removed later by curFix when the shop hides the symbol). */
export const inr = (v: MoneyInput) => '₹' + formatInr0(money0(v));
/** Prototype inr2f(): "25,000.00" (no symbol). */
export const inr2f = (v: MoneyInput) => formatInr2(v);
const money0 = (v: MoneyInput) => v;
/** Prototype dates in tables: dd/mm/yyyy. */
export const dmy = (iso: string | null | undefined) => (iso ? formatDmy(iso) : '');

/** Prototype curFix(): with the currency symbol off (Settings), "₹" and "(₹)" are removed from text. */
export const curFix = (t: string) => t.replace(/\s?\(₹\)/g, '').replace(/₹\s?/g, '');
/** Prototype fmtD: 1 Oct 2026. */
export const fmtD = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
/** "4:35 pm", India time (Settings › Transactions › Add time on transactions) */
export const timeIst = (at: string) => new Date(at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();

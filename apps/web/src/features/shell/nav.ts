import type { IconName } from '../../components/icon-paths';

/**
 * The sidebar, as the prototype finally renders it (NAV plus its later
 * changes: Commission under Sales, report sections, Accounting hidden).
 * `view` is the prototype's data-view id; `soon` items show a toast.
 */
export interface NavLink {
  label: string;
  view?: string;
  soon?: string;
  rsec?: string;
  /** rendered without the <span class="lb"> wrapper, as in the prototype */
  bare?: boolean;
}

export interface NavEntry {
  icon: IconName;
  label: string;
  view?: string;
  soon?: string;
  /** quick-add "+" button title, e.g. "New party" */
  add?: string;
  /** low-stock counter (Items & stock) */
  count?: boolean;
  badge?: string;
  cls?: string;
  hidden?: boolean;
  kids?: NavLink[];
}

export type NavRow = NavEntry | { heading: string };

export const NAV: NavRow[] = [
  { icon: 'home', label: 'Home', view: 'dash' },
  { icon: 'users', label: 'Parties', view: 'parties', add: 'New party' },
  {
    icon: 'box', label: 'Items & stock', count: true, add: 'New item',
    kids: [{ label: 'Items', view: 'items' }, { label: 'Price manager', view: 'prices' }, { label: 'Stock adjustments', view: 'adjs' }, { label: 'Godowns', view: 'gds' }],
  },
  {
    icon: 'receipt', label: 'Sales', add: 'New invoice',
    kids: [
      { label: 'Quotations', view: 'quo' }, { label: 'Sales invoices', view: 'sales' }, { label: 'Delivery challans', view: 'dcs' },
      { label: 'Payments received', view: 'pin' }, { label: 'Credit notes', view: 'cns' }, { label: 'Commission', view: 'com', bare: true },
    ],
  },
  {
    icon: 'cart', label: 'Purchases', add: 'New bill',
    kids: [{ label: 'Purchase orders', view: 'pos' }, { label: 'Purchase bills', view: 'pur' }, { label: 'Payments made', view: 'pmade' }, { label: 'Debit notes', view: 'dns' }],
  },
  { icon: 'wallet', label: 'Expenses', view: 'exp', add: 'New expense' },
  {
    icon: 'bank', label: 'Banking & cash',
    kids: [{ label: 'Bank accounts', view: 'bks' }, { label: 'Cash in hand', view: 'cash' }, { label: 'Cheques', view: 'chq' }, { label: 'Reconciliation', view: 'rec' }],
  },
  {
    icon: 'book', label: 'Accounting', hidden: true,
    kids: [{ label: 'Chart of accounts', soon: 'Chart of accounts' }, { label: 'Journal vouchers', soon: 'Journal vouchers' }, { label: 'Day book', soon: 'Day book' }],
  },
  {
    icon: 'pct', label: 'GST', cls: 'needs-gst',
    kids: [{ label: 'GSTR-1', soon: 'GSTR-1' }, { label: 'GSTR-3B', soon: 'GSTR-3B' }, { label: 'E-invoices', soon: 'E-invoices' }, { label: 'E-way bills', soon: 'E-way bills' }],
  },
  {
    icon: 'chart', label: 'Reports',
    kids: [
      { label: 'Transaction reports', view: 'rep', rsec: 'txn', bare: true }, { label: 'Party reports', view: 'rep', rsec: 'party', bare: true },
      { label: 'Item & stock reports', view: 'rep', rsec: 'item', bare: true }, { label: 'Business status', view: 'rep', rsec: 'biz', bare: true },
      { label: 'Taxes', view: 'rep', rsec: 'tax', bare: true }, { label: 'Expense reports', view: 'rep', rsec: 'exp', bare: true },
      { label: 'Order reports', view: 'rep', rsec: 'ord', bare: true }, { label: 'Loan accounts', view: 'rep', rsec: 'loan', bare: true },
    ],
  },
  { icon: 'gear', label: 'Settings', view: 'set' },
  { heading: 'Apps' },
  { icon: 'phone', label: 'Payment links', soon: 'Payment links', badge: 'New' },
  { icon: 'chat', label: 'WhatsApp reminders', soon: 'WhatsApp reminders' },
];

/** Prototype view id → route path in the rebuild. Only built screens are routed. */
export const VIEW_PATH: Record<string, string> = { dash: '/', parties: '/parties', items: '/items', gds: '/godowns' };

/** Names used in the "… screen is coming next" toast for screens not rebuilt yet. */
export const VIEW_LABEL: Record<string, string> = {
  dash: 'Home', parties: 'Parties', items: 'Items', prices: 'Price manager', adjs: 'Stock adjustments', gds: 'Godowns',
  quo: 'Quotations', sales: 'Sales invoices', dcs: 'Delivery challans', pin: 'Payments received', cns: 'Credit notes',
  com: 'Commission', pos: 'Purchase orders', pur: 'Purchase bills', pmade: 'Payments made', dns: 'Debit notes',
  exp: 'Expenses', bks: 'Bank accounts', cash: 'Cash in hand', chq: 'Cheques', rec: 'Reconciliation', rep: 'Reports',
  set: 'Settings', sub: 'Subscription',
};

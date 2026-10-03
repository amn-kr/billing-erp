/**
 * The "snapshot": the prototype's books after it has loaded a backup, read
 * out of the prototype itself (see extract.ts). Numbers are as the prototype
 * holds them (JavaScript numbers); load.ts turns money into Decimal.
 */
import { z } from 'zod';

const num = z.number().finite();

export const partySchema = z.object({
  id: z.string(),
  name: z.string(),
  /** c = customer, s = supplier */
  role: z.enum(['c', 's']),
  group: z.string(),
  phone: z.string(),
  email: z.string(),
  gstin: z.string(),
  gstType: z.string(),
  state: z.string(),
  billing: z.object({ line: z.string(), city: z.string(), pin: z.string(), state: z.string() }),
  shipping: z.string(),
  creditLimit: num,
  creditDays: num,
  opening: z.object({ amount: num, date: z.string(), kind: z.enum(['receive', 'pay']) }).nullable(),
  extra: z.array(z.object({ field: z.string(), value: z.string() })),
  addedOn: z.string(),
  /** true for the prototype's built-in sample parties */
  sample: z.boolean(),
});

export const itemSchema = z.object({
  id: z.string(),
  name: z.string(),
  service: z.boolean(),
  code: z.string(),
  hsn: z.string(),
  unit: z.string(),
  category: z.string(),
  gst: num,
  group: z.string(),
  brand: z.string(),
  series: z.string(),
  sale: num,
  purchase: num,
  mrp: num,
  listPrice: num,
  wholesale: num,
  wholesaleQty: num,
  minStock: num,
  location: z.string(),
  hasImage: z.boolean(),
  /** opening stock rows (prototype tx type "Opening stock") */
  opening: z.array(z.object({ qty: num, price: num, date: z.string() })),
  /** stock the prototype shows today (opening + all movements) */
  stock: num.nullable(),
  sample: z.boolean(),
});

export const priceListSchema = z.object({
  id: z.string(),
  name: z.string(),
  isDefault: z.boolean(),
  /** base | disc (sale price − %) | mark (purchase price + %) */
  rule: z.string(),
  value: num,
  /** round to nearest (0 = paise) */
  round: num,
  groups: z.array(z.string()),
  active: z.boolean(),
  /** fixed prices for single items: item id → price */
  overrides: z.record(z.string(), num),
});

export const snapshotSchema = z.object({
  format: z.literal('billing-erp-snapshot'),
  version: z.literal(1),
  backup: z.object({ at: z.string(), biz: z.string(), fresh: z.boolean(), keptSampleItems: z.boolean() }),
  business: z.object({
    name: z.string(), short: z.string(), owner: z.string(), phone: z.string(), email: z.string(),
    addr: z.string(), city: z.string(), pin: z.string(), state: z.string(), gstin: z.string(),
    gstEnabled: z.boolean(), upi: z.string(), invoiceNext: num,
    /** cash in hand when the books were started (Start fresh) */
    cashOpen: num.optional().default(0),
  }),
  settings: z.record(z.string(), z.unknown()),
  taxes: z.array(z.object({ id: z.string(), type: z.string(), rate: num, name: z.string(), note: z.string(), old: z.boolean() })),
  partyGroups: z.array(z.string()),
  units: z.array(z.string()),
  categories: z.array(z.string()),
  brands: z.array(z.string()),
  parties: z.array(partySchema),
  items: z.array(itemSchema),
  priceLists: z.array(priceListSchema),
  priceHistory: z.array(z.record(z.string(), z.unknown())),
  /** Price manager › Price setup rules (erp-prules), kept as the prototype stores them */
  priceRules: z.record(z.string(), z.unknown()),
  /** a price-lock PIN was set (its hash is not carried over) */
  pricePinSet: z.boolean(),
  godowns: z.array(z.object({ id: z.string(), name: z.string(), addr: z.string(), manager: z.string(), phone: z.string(), isDefault: z.boolean() })),
  referrers: z.array(z.object({ id: z.string(), name: z.string(), phone: z.string(), city: z.string(), partyId: z.string() })),
  commissionRules: z.record(z.string(), z.object({ t: z.string(), v: num })),
  expenseCategories: z.array(z.string()),
  accounts: z.array(z.record(z.string(), z.unknown())),
  quotationGrid: z.record(z.string(), z.unknown()).nullable(),
  /** raw keys for the transaction importer (Phase 3) */
  documents: z.record(z.string(), z.unknown()),
});

export type Snapshot = z.infer<typeof snapshotSchema>;
export type SnapshotParty = z.infer<typeof partySchema>;
export type SnapshotItem = z.infer<typeof itemSchema>;

/** The backup file the prototype downloads (Settings › General › Backup & restore). */
export const backupSchema = z.object({
  app: z.literal('billing-erp'),
  v: z.number(),
  at: z.string(),
  biz: z.string().optional().default(''),
  fresh: z.boolean().optional().default(false),
  keys: z.record(z.string(), z.string().nullable()),
});
export type Backup = z.infer<typeof backupSchema>;

# How the prototype stores its books (for the importer)

The prototype (`reference/design/app.html`) keeps its books in the browser's
`localStorage` under `erp-*` keys. A backup file (Settings › General › Backup &
restore) is `{ app: "billing-erp", v: 1, at, biz, fresh, keys: { "erp-…": "<JSON text>" } }`.

## The catch: not everything is in the file
The prototype ships with a sample shop **in its code** and overlays the saved
keys on top:
- `erp-items` holds only items the shop **added** (`isNew: 1`). The sample
  catalogue (288 items) lives in code. A shop that chose "Start fresh" without
  "keep items" has no sample items; with "keep items" it keeps the sample
  catalogue (with no stock) — and those items are **not** in the backup.
- `erp-parties` holds only parties the shop added, in their raw form-field shape.
- Godowns (`GD`) are **never saved** — a fresh shop always has one "Main shop".
- Documents (`erp-invoices`, `erp-pdocs`, …) are replayed on load to compute
  balances and stock.

So the importer does not re-implement any of this. **Step 1 (`extract.ts`)**
opens the prototype in a headless browser, restores the backup exactly as
"Restore books" does (clock set to the backup's time), and reads the finished
books out of the page into a *snapshot* (`snapshot.ts`). **Step 2 (`load.ts`)**
writes the snapshot into the new database.

## Keys
| Key | Holds | Phase |
|---|---|---|
| `erp-biz` | business details, `fresh`, `keepItems`, `invNext`, `cashOpen` | 2 |
| `erp-settings` | GST on/off, GSTIN, state, tax list, UPI, print options | 2 |
| `erp-parties` | added parties (name, phone, group, gstin, gtype, state, email, billing, ship, ob, obDate, obType, lim/limit, days, extra) | 2 |
| `erp-party-set` | which party-form sections are shown | 2 |
| `erp-items` | added items (code, hsn, unit, cat, gst, sale, purch, mrp, lp, brand, series, grp, min, loc, img, opening-stock tx) | 2 |
| `erp-brands`, `erp-grp` | extra brands, item group overrides | 2 |
| `erp-prices`, `erp-prules`, `erp-pl-active`, `erp-price-pin` | price edits + history, price rules, price lists on/off, price lock PIN | 2 |
| `erp-quo` | quotation grid (rows × brand ranges) | 2 |
| `erp-elec`, `erp-crules`, `erp-compay` | electricians (referrers), commission rules, payouts | 2 / 3 |
| `erp-ecats`, `erp-accts` | expense categories, cash & bank accounts | 3 |
| `erp-invoices`, `erp-precv`, `erp-cnotes`, `erp-dchal`, `erp-quotes`, `erp-pdocs`, `erp-ppays`, `erp-exps`, `erp-btx`, `erp-chq`, `erp-recon`, `erp-salehist`, `erp-salemod` | documents and money | 3 |
| `erp-pal`, `erp-open`, `erp-mini`, `erp-sitabs`, `erp-rpfull`, `erp-sub` | screen preferences, trial state | not imported |

## Things to watch
- Item ids are `'n' + Date.now()`: two items added in the same millisecond get
  the **same id**. The importer re-keys duplicates and reports it.
- Opening balances default to the day the party was added when no date was typed.
- Item photos are data URLs inside `erp-items`; they move to file storage later.

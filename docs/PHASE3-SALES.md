# Phase 3 — how sales work (read from the prototype)

Notes taken from `reference/design/app.html` before porting. Line numbers are in that file.
They describe the behaviour the new app must keep; "New app" says how it is stored.

## Sale invoice (editor `#vNewInv`, `saveSI` 5888, patched at 7612, 7708, 7726, 8593, 8703)
- Credit sale needs a party: "Choose who this bill is for. For a counter sale, switch to Cash."
- Cash (counter) sale: optional name/mobile; name defaults to "Walk-in customer". The full amount is received now.
- Only rows with an item are saved. Messages: "Add at least one item.", "Enter a quantity for “X”.",
  "“X” isn’t in your items. Pick it from the list or add it as a new item.", "Enter an invoice number.",
  "Invoice number X is already used."
- The number can be typed over (it must stay unique).
- Credit limit: going over asks once — "This sale goes over the credit limit. Press Save again to save anyway."
  New app: the API refuses with code `over_credit_limit` unless `confirmOverLimit` is sent.
- Discount & charges must be "checked" once before the first save (footer pop-up) — client only.
- Price comes from the price list and is read-only; the typed **final rate** sets the discount %
  (`frSet` 7889: disc = round((p−v)/p×100, 8 dp); a final rate above the price-list rate is refused).
- Payment at sale: split across Cash / UPI / Bank transfer / Cheque / Card, each with a reference.
  Received = min(paid, total). Paid above the total:
  - party: the extra settles that party's older dues, oldest first, the rest is an advance (`xpApply` 7813);
  - walk-in: change is returned; only the total is recorded.
  New app (same as the prototype): a receipt (PI-) for what is kept on the bill, and from a party a second
  entry "XP-<invoice no.>" for the extra, settling older dues oldest first; the rest stays unused (= advance).
  One helper does this for new, edited and imported invoices (apps/api/src/modules/sales/at-sale.ts).
- Referral (electrician): commission is loaded on top of the rate per category rule (or a per-bill /
  per-item override) — `cmApply` 8661. Line keeps base price, rule and commission. Not printed.
- Quotation / challan it came from are linked; saving marks them converted / invoiced.
- Extra print fields: billing name, challan no., PO no./date, e-way bill, transport, vehicle, delivery
  date, description, attachments (file names), terms (notes). New app: `sales_documents.extra` (JSON).

## Editing and cancelling (7363–7400)
- Edit = undo the old effects and apply the new ones. New app: lines replaced, stock re-moved,
  journal re-posted, at-sale receipt updated; an audit entry "update" is written.
- Cancel: the invoice stays, marked Cancelled; it no longer counts in dues; items go back into stock;
  money already received becomes an advance for the party.
  New app: journal entry cancelled, reversing stock movements (kind `cancel`), the receipt stays
  and its allocation to the cancelled invoice stops counting, so it shows as unused (advance).
- **Delete is not allowed** (CLAUDE.md: documents are never deleted). The menu item stays, disabled,
  with the title "Invoices are never deleted — cancel instead".

## Payments received (`rcSave` 8159)
- Customer required; amount > 0; cheque needs the cheque number.
- Settles open dues oldest first (invoices, opening balance, bounced cheques); amounts can be changed;
  the allocations may not add up to more than the amount; the rest is an advance.
- Number series PI-.

## Credit notes (`cnSave` 8215)
- Customer, or "Counter sales" (refund only). Reason list. One or more invoices; per line the quantity
  that can still be returned (sold − already returned). Items not on an invoice can be added.
- Amount = qty × final rate (GST included); tax part = amount − amount/(1+gst%).
- Settle as: adjust (reduces the invoice dues, rest kept as credit) or refund now by Cash/UPI/Bank.
- Stock comes back. Commission on the returned goods is taken back from the electrician.

## Delivery challans (`dcSave` 8247)
- Customer or walk-in (name required); items + qty; transport, vehicle, note.
- No effect on stock or dues. Convert opens the invoice editor filled in; saving marks it Invoiced.
- Cancel (click twice) marks it Cancelled.

## Books (journal) for each document
| Document | Debit | Credit |
|---|---|---|
| Invoice | receivable (party; or cash/bank for walk-in via the receipt) | sales (taxable), output CGST/SGST/IGST, TCS, charges, round off |
| Receipt | cash / bank / cheques in hand per mode | receivable (party) |
| Credit note | sales returns, output tax | receivable (party) — refund: then receivable / cash |
| Challan, quotation | — | — |

Walk-in sales post to `receivable` with no party and the at-sale receipt clears it at once.

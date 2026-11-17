# Mobile app plan (Android first, iPhone later)

Owner's decisions from 13 to 15 Nov 2026. This file is the full plan for Phases 7 and 8. `docs/ARCHITECTURE.md` keeps the short version.

## 1. Owner's decisions
| Date | Decision |
|---|---|
| 10 Nov | The Android app is online only, for staff, field salesmen and the owner. It has its own phone screens (an exception to the "look exactly like the prototype" rule). Invoices are shared as PDFs (WhatsApp and other apps). No Bluetooth printing. |
| 13 Nov | Phase 7 (mobile design) may start now, while the Windows trial (Phase 6 step 8) runs. Phase 8 (the app itself) waits until that trial passes. |
| 14–15 Nov | One colour specification for every app (section 2). The phone app uses it from the start. The web and Windows apps switch to it after the Windows trial. |
| 15 Nov | The phone app has **everything the web app has**, except the items in section 3 marked "not on the phone". |
| 15 Nov | **One screen design that fits every phone** (section 4). Each screen has one approved picture at 390 px, and automatic fit checks run at every width from 320 to 480 px. |
| 15 Nov | **Portrait only.** The app does not turn sideways. |
| 15 Nov | The web app moves to the same test method (one picture plus fit checks) after the Windows trial, together with the colour change. |
| 15 Nov | The server stays on the current free plan. The app shows "Server is waking up…" while it starts. |
| 15 Nov | The app's name and icon are the same as the Windows app's. |
| 15 Nov | Languages: **English and Hindi**. |
| 15 Nov | Lowest Android version: **Android 7.0** (chosen by us, as the owner asked). It covers almost every phone in use, and fingerprint unlock works on it. |
| 15 Nov | Field salesman screens and staff access rules come **after the owner's app is built**, as a separate discussion. |

## 2. Colour specification (20 colours)
No other colour is allowed. All colours live in one shared file, and a test fails if any screen uses a colour outside this list. Each colour has one meaning. Every money amount also shows an arrow or a word (↓ to get, ↑ to give, Paid, Overdue), so the meaning never depends on colour alone.

| # | Code | Name | Use | Contrast |
|---|---|---|---|---|
| 1 | `#F8FAFC` | Page | Background behind everything | |
| 2 | `#FFFFFF` | Card | Boxes for bills, parties, items | |
| 3 | `#E2E8F0` | Border | Thin lines around boxes | |
| 4 | `#111827` | Text | Names, amounts, totals | 17.7 |
| 5 | `#4B5563` | Text 2 | Small details | 7.6 |
| 6 | `#6B7280` | Text 3 | Dates, hints | 4.8 |
| 7 | `#1D4ED8` | Main blue | + New Bill, Add, Share, links | 6.7 |
| 8 | `#EFF6FF` | Light blue | Fill of second buttons (Add item, Scan, Payment) | |
| 9 | `#DBEAFE` | Selected | Selected tab or row | |
| 10 | `#1E3A8A` | Navy | Summary cards, side menu, party header | 10.4 |
| 11 | `#FFFFFF` | On colour | Text on blue, green and navy buttons | |
| 12 | `#15803D` | Green | Save, Collect Payment, money to get | 5.0 / 4.8 |
| 13 | `#F0FDF4` | Light green | "Paid" badge fill | |
| 14 | `#C81E1E` | Red | Delete, cancel, overdue, money to give | 5.8 / 5.3 |
| 15 | `#FEF2F2` | Light red | Delete button and Overdue badge fill (delete is never solid red) | |
| 16 | `#B45309` | Orange | Credit (udhaar), part paid, low stock | 5.0 / 4.9 |
| 17 | `#FFFBEB` | Light orange | Credit badge fill | |
| 18 | `#F3F4F6` | Light slate | Draft and Cancelled (text `#4B5563`; cancelled is struck through, never red) | 6.9 |
| 19 | `#4ADE80` | Bright green | On navy only: money to get | 5.9 |
| 20 | `#FCA5A5` | Bright red | On navy only: money to give | 5.5 |

Contrast is against white, or against the colour's own light fill after the "/". For 19 and 20 it is against navy. Text must be at least 4.5. Charts use only blue, green, orange, red and slate.

**Shadows and shine (owner, 16 Nov 2026):** the phone app is not flat. Main buttons have a soft shine and a shadow in their own colour and press down when tapped; cards and list rows are slightly raised; the selected tab is a raised white pill. Shadows and shine are made only from these 20 colours made see-through (for example `#111827` at 8%), never a new colour. The colour test allows these see-through versions and nothing else.

## 3. What the phone app has
Every screen of the web app (audited on `main`, 15 Nov 2026) is listed below.

| Area | On the phone |
|---|---|
| Sign in, demo shop, switch company, search everything | Yes |
| Home: today's sales, to get / to give, cash and bank, GST payable, low stock, recent bills, receivables aging, top items, quick actions | Yes, as cards |
| Parties: list, party page with running balance, statement, add and edit (same fields as the web), call, WhatsApp reminder | Yes, plus **pick from phone contacts** |
| Parties: Excel import | Computer only |
| Parties: bulk entry (type or paste a table) | Not on the phone |
| Items: list, add and edit, batch and expiry, MRP, packs and units, brands, stock adjustments, godowns and transfers | Yes |
| Items: bulk price update, bulk active/inactive | Yes |
| Items: Excel import | Computer only |
| Price manager (price lists, brand rules, price history) | Yes, one item at a time instead of the big table |
| Barcode scan with the phone camera | Yes (phone only) |
| New sale: credit/cash, items, discount and charges, GST, referral commission, quotation import, batch pick, price history, received amount, Save and Share | Yes, tap and scan instead of keyboard rapid entry |
| Quick sale, quotations, delivery challans, payments received, credit notes, commission, cancel/delete, invoice view | Yes |
| Printing | A PDF shared to WhatsApp or other apps. It looks exactly like the printed invoice. |
| Purchases: orders, bills (with batches), payments made, debit notes | Yes |
| Photo of a purchase bill | Not now (later) |
| Expenses, bank accounts, cash in hand, cheques | Yes |
| Bank reconciliation | Not on the phone |
| Reports: the 12 built ones (9 party and expense reports, plus batch, expiry and batch-wise sales) | Yes, as cards, with PDF/Excel share |
| Reports: the other ~30 ("being built" in the web too) | When built in the web |
| Settings: business details, modules, transaction prefixes, taxes and GST, item settings, **Print and invoice**, team, transaction passcode, Google Drive backup | Yes |
| Fingerprint unlock (app and passcode) | Yes (phone only) |
| Display and keyboard shortcuts | Not needed on the phone |
| Windows-only: This PC only, pen drive backup, recovery key, Move to cloud, printer on this PC | Not on the phone |
| "Coming soon" in the web (GSTR-1/3B, e-invoice, e-way bill, payment links, WhatsApp reminders, sale orders, loans, accounting, subscription) | When built in the web |
| Field salesman screens, staff access rules | Later, after the owner's app (section 1) |

## 4. One design that fits every phone, and how it is checked
**Building.** Each screen is built once, from flexible pieces, with no fixed widths:
- Buttons, cards and lists stretch or shrink with the screen.
- Long names wrap to 2 lines, then end with "…". They never run outside the screen or over other things.
- Amounts are never cut. If space is short, the text gets a little smaller.
- The bottom buttons (Save, New Bill) always show at the bottom, above the phone's own buttons and above the keyboard.
- Phones from 320 to 480 px wide use the same screen. Tablets show the app centred with a maximum width.
- The phone's "large text" setting must not break anything.
- Portrait only.

**Checking (automatic, every change):**
1. **Fit checks** open every screen at every width from 320 to 480 px (every 10 px), with large text, and on a tablet. They ask yes/no questions, with no pictures:
   - Does anything run outside the screen, or need sideways scrolling?
   - Do any two things overlap?
   - Is any text or amount cut?
   - Is every button at least 44 px, big enough for a finger?
   - Are the bottom buttons visible, also with the keyboard open?
2. **One picture per screen at 390 px**, compared with the approved design. It allows a small tolerance, so tiny pixel differences don't fail it, but a wrong colour, layout or missing part does.

## 5. Rules for every step
- Only the 20 colours (section 2).
- The server keeps every business rule: numbering, GST and rounding (`packages/shared`), permissions, audit log. The phone repeats none of it.
- No internet: a clear "No internet" message. A half-made bill stays on the phone. Sending it again when the internet is back makes **one** bill, never two (idempotency keys).
- English and Hindi for all phone text. Numbers and ₹ use the Indian format in both.
- **Wording (owner, 15 Nov 2026):**
  - Every word of a button, field, tab, badge or heading starts with a capital letter in English (Purchase Bill, Take Payment, Payment In). Full sentences stay normal. This applies to the phone app only; the web app follows the prototype.
  - Dates look the same everywhere: day, short month, year, as in 16 Nov 2026 (Hindi: 16 नव॰ 2026) (owner, 16 Nov 2026; this replaces the earlier full-date rule).
  - Names (party, supplier, item) always stay on **one line**. What doesn't fit ends with "…". A name never takes 2 lines.
  - A bill row in a list of many parties shows the party name first, then the number | date under it (INV-0107 | 25 Sep 2026).
  - A transaction row inside one party (party page, statement) shows the transaction name first (Sale Bill, Payment In), then the number | date under it (INV-0107 | 14 Nov 2026) (owner, 16 Nov 2026).
  - An item row shows the purchase and sale price (Purchase Price ₹70 · Sale Price ₹85 Per Pc), not MRP.
- **Lists (owner, 16 Nov 2026):** where a list has search, a filter and a status, they sit in **one line**: search (about half), a filter button (for example brand) and a status dropdown. Tabs above a list are slim. A row of 4 filter buttons takes equal widths. Big amounts use a small ₹ with a gap.
- The work is done in its own branch. Each step comes as a PR, which is merged only with the owner's go-ahead.
- Each step is shown to the owner before the next one starts.
- **Fit check (owner, 17 Nov 2026):** while a step is being changed, each edit gets only a quick look before it is published. The full fit check (section 4, plus the earlier steps and the colour check) runs once, just before the owner approves the step.

## 6. Phase 7: mobile design (`reference/design/mobile.html`), about 3 weeks
Each part is a page the owner can open on their own phone.

| Step | What | Gate |
|---|---|---|
| 7.1 | The 20 colours at the top of the design page | ✅ Approved (15 Nov 2026) |
| 7.2 | Building blocks: buttons, cards, list rows, badges, form fields, bottom sheet, tabs, empty states, "No internet", "Server is waking up…", loading; English and Hindi | ✅ Approved (15 Nov 2026), after the wording changes in section 5; new look with shadows and shine approved 16 Nov 2026 (section 2) |
| 7.3 | App map: what opens from where, side menu, bottom buttons | ✅ Approved (15 Nov 2026): side menu plus 3 Home bottom buttons (no bottom tab bar); "coming soon" items show with a Soon badge; Home tabs Parties, Bills, Items |
| 7.4a | Sign in, switch company, Home, side menu, search, language switch. From 7.4a on, every screen is a tap-through sample: tapping a button opens the next screen (sample data) | ✅ Approved (16 Nov 2026): Sign In layout 2 (centred logo, card, pill button, Create An Account, language button); party rows have no letter circle |
| 7.4b | Parties: list, party page, add/edit with contacts, statement, reminder | ✅ Approved (16 Nov 2026): slim balance card with Reminder, Call and Statement and only the credit limit; small ₹ with a gap; equal-width filter chips; dates as 16 Nov 2026; transaction rows show the name, then number | date |
| 7.4c | Items and stock: list, item page, batch/MRP/packs, brands, adjustments, godowns and transfers, bulk price update and active/inactive, prices of one item, camera scan | ✅ Approved (16 Nov 2026): slim All / Products / Services tabs; search, brand button and stock dropdown in one line; Price Manager asks for the PIN; New Item has Product, Service, Single, Variant in one line |
| 7.4d | **New sale** (the hardest): customer, items, scan, discount and charges, GST, referral, quotation import, batch pick, price history, received, Save and Share, "Bill saved" | ✅ Approved (17 Nov 2026): title Sale with a Credit / Cash capsule beside the ⋮ (Import From Quotation, Add Referral, Bill Details); a slim strip with the editable invoice number and the date (calendar pop-up); a slim Choose Customer field, the same in both modes, opening the full party list (Showing N Parties, Add New Party, mobile and balance); Add Item opens a page for one item with the item search dropdown already open (name or code), then quantity, unit, list price, rate, discount, batch, with Save & New and Save (Delete there when editing); item cards show #, name, amount, then Item Subtotal (qty × rate) and the discount, with no delete on the card; Discount & Charges, Received and Bill Total in one box; the bottom bar has only Save & New, Save and ⋮ (Share, Print) |
| 7.4e | Quotations, challans, payments received, credit notes, commission: list, view, cancel | ✅ Approved (17 Nov 2026): each area has a list (two summary cards, search and status in one line), a view (Share, Edit, Print, Cancel in ⋮; never delete) and a form; sale bills with cancel; brand-wise quotation (a total per brand, lowest marked, convert by picking a brand) and item-wise quotation (the Sale screen without payment); delivery challans without prices, converted to a bill; Receive Payment settles the oldest bill first, the rest is advance; credit notes against ticked bills with return quantities, adjusted in balance or refunded; electrician commission ledger (earned, waiting for customer, paid, deducted), pay-out and rules by category |
| 7.4f | Purchases: orders, bills, payments made, debit notes | ✅ Approved (17 Nov 2026): purchase bills and orders use the Sale screen with purchase rates; the supplier field shows To Pay; supplier's bill number; batch number and expiry (calendar) per item; Paid Now; orders show the expected date and convert to a bill (marked Received); Pay Supplier settles the oldest bill first, the rest is advance; debit notes against ticked bills with return quantities, adjusted in balance or refund received; lists, views and cancel as in 7.4e, with a warning when bought goods were already sold |
| 7.4g | Expenses, bank accounts, cash in hand, cheques | ✅ Approved (17 Nov 2026): expenses with category (+ new category), paid to, paid from, reference and GST lines, GST input credit, categories with totals; Bank And Cash with a book per account (every receipt, payment, cash sale, expense, refund, commission payout, transfer and cleared cheque, with running balance and This Month / Last Month / All), Transfer Money (deposit, withdraw, bank to bank), Count Cash (short or excess recorded), add / edit bank account; cheques received and issued: deposit, clear (enters the bank book), bounce (undoes the payment, records charges) and undo; bank reconciliation stays off the phone |
| 7.4h | The 12 reports as cards, PDF/Excel share | ✅ Approved (17 Nov 2026): report list in 8 sections with search, ready reports first, the other 29 marked Soon; each report has a period choice (this month, last month, this quarter, this year, all time) and a party or type choice where needed, summary cards, one card per line (tapping opens the bill or payment), a total box, and PDF / Excel / WhatsApp share at the bottom |
| 7.4i | Settings, including Print and invoice, team, passcode and fingerprint, Google Drive backup | ✅ Approved (17 Nov 2026): settings in Business, Bills And Items, Safety And Backup and Coming Soon groups; business and payment details; display and modules; transactions with prefixes (a used prefix can't change, a new one is added); taxes and GST (off hides tax, Composition makes a Bill Of Supply, tax list, TCS/TDS); item settings; print and invoice (layout, colour, paper, what prints, copies) with a live invoice preview; transaction passcode; team (invite, reset password, remove; roles later); Google Drive backup and restore into new books; Windows-only items stay off the phone |
| 7.4j | Special states: no internet, server waking up, errors, no permission, view-only shop (moved to a PC), trial ended | ✅ Approved (17 Nov 2026): a No Internet banner on every screen, bills kept on the phone and sent once when back online (waiting list, retry); a server waking up screen; an error screen and a could-not-save dialog; a staff banner and Ask The Owner for owner-only actions; view-only after the shop moves to a PC; trial ended (view, share and backup still work); also update needed and signed out |

**Phase 7 gate:** every item in section 3 that is on the phone has a screen in the design, and the owner has approved every part. ✅ **Passed on 17 Nov 2026:** all parts (7.1 to 7.4j) are approved and merged; the full fit check passed for every step.

## 7. Phase 8: Android app (APK), about 8–10 weeks
| Step | What | Gate |
|---|---|---|
| 8.0 | Starts only when Phase 7 is approved **and** the Windows trial has passed (or the owner allows otherwise) | — |
| 8.1 | **Groundwork, nothing new on screen:** (a) the web screens' server calls (about 236 places) move into shared code that the phone also uses; (b) a phone sign-in mode: today the "stay signed in" key lives in a browser cookie, which apps can't rely on, so on the phone it is kept in Android's secure store; (c) the server accepts the app's address | All existing web tests and pictures still pass unchanged; new API tests pass |
| 8.2 | **App frame** (`apps/mobile`, Capacitor + React): sign in, Home with real data, side menu, switch company, language, "No internet", "Server is waking up…", "Update available" check; the APK is built on GitHub and published on the releases page; the **signing key** is made (see risk 3) | Owner installs the APK on their phone and signs in |
| 8.3 | Parties, with contacts | Every step 8.3–8.10: flow tests on an Android emulator, fit checks, one picture per screen against the design, a new APK, owner tries it on their phone |
| 8.4 | Items and stock, with camera scan | " |
| 8.5 | **New sale, the invoice PDF and WhatsApp share** | " and the PDF looks exactly like the printed invoice |
| 8.6 | Quotations, challans, payments received, credit notes, commission | " |
| 8.7 | Purchases | " |
| 8.8 | Expenses, bank, cash, cheques | " |
| 8.9 | Reports | " |
| 8.10 | Settings, with fingerprint | " |
| 8.11 | **Full testing and trial:** a cheap and a mid-range Android phone, Android 7 and the newest, slow internet (2G/3G-like), reading in sunlight, Hindi throughout; about two weeks of use in the owner's shop; checklist `docs/ANDROID-TRIAL.md` | The checklist passes and the owner is happy to give it to another shop |
| 8.12 | Play Store (₹2,100 once) | Later, owner's decision |
| Later | Field salesman screens and staff access | After the owner's discussion (section 1) |

## 8. Alongside, after the Windows trial: web and Windows apps
- Switch to the 20 colours. This needs the owner's written exception to the "look exactly like the prototype" rule in `CLAUDE.md`.
- Switch the tests to one picture per screen plus fit checks, instead of pictures at 1280, 1366 and 1920. That is 633 pictures today, all remade once for the owner's approval.

## 9. Phase 9: iPhone and Mac
Unchanged (see `docs/ARCHITECTURE.md`).

## 10. Risks and how they are handled
1. **The free server sleeps** after 15 idle minutes, so the first open can take up to a minute. The owner decided to keep the free plan for now. The app shows "Server is waking up…" so nobody thinks it is broken.
2. **Invoice PDF on the phone:** the web prints through the browser, which the phone can't do. Step 8.5 makes a real PDF file, checked against the printed invoice.
3. **APK signing key:** if it is lost, installed apps can never be updated. It is kept as a GitHub secret, and the owner keeps a second copy (pen drive or printout), like the recovery key.
4. **Double bills on weak internet:** idempotency keys, with a test.
5. **Breaking the web app while sharing code (8.1):** the existing web tests and pictures must pass unchanged.
6. **Phase order:** starting Phase 7 before the Phase 6 gate is the owner's decision of 13 Nov 2026, recorded in section 1.

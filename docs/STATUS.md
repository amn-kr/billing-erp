# Rebuild status

## Phase 0 — Prepare ✅ (screenshots approved by the owner, 3 Oct 2026)
- `pnpm baseline` photographs the prototype: the sign-in page, 26 app screens
  and 42 dialogs (41 + the invoice drawer) at 1280, 1366 and 1920 px.
- Repeatable: clock frozen at 1 Oct 2026 14:00 IST, fonts served locally.
- The old "Price lists" screen is retired inside the prototype (it opens the
  Price manager), so it has no screenshot; its "New price list" dialog does.

## Phase 1 — Foundations ✅ (gate passed: sign-in + app frame match the screenshots)
| Item | State |
|---|---|
| Repo: pnpm + Turborepo, TypeScript strict | done |
| CI (GitHub Actions): typecheck, unit, API, e2e + screenshot tests | done |
| Shared maths: Decimal money, Indian number format, April–March years, IST | done, 26 tests |
| Database: accounts, shops, roles, invites, sessions, plans, subscriptions, settings, financial years, numbering, GST rates, audit log | done |
| Row-level security per shop; app role cannot delete; audit log insert-only | done, tested in Postgres |
| Sign-up, sign-in, refresh, sign-out, rate limit, password reset (API) | done |
| Shops: set up, switch, update; 14-day trial | done |
| Staff: invite, join, change role, remove; 4 roles checked on every endpoint | done |
| CSS copied unchanged, checked by a test | done |
| Sign-in page + app frame (sidebar, top bar, menus, sign-out) | done — 0 pixel difference at 1280/1366/1920 |
| API tests | 41 passing |
| Browser tests | 8 flows + 12 screenshot comparisons passing |

## Owner decisions (3 Oct 2026)
- **Email provider:** not now — set up before selling starts. Until then "Forgot password"
  says reset by email isn't switched on, and staff join by signing up with the invited email.
- **Google sign-in:** not now, later. The button says it isn't set up.
- **Free trial:** 14 days (`TRIAL_DAYS=14`, the default).

## On hold (waiting for a later phase or an owner decision)
| Item | Waiting for |
|---|---|
| **Hosting** (AWS Mumbai + Cloudflare Pages) — nothing is deployed. Web app and API must share a domain (e.g. app.yourshop.in / api.yourshop.in) so the sign-in cookie works. Costs money: owner approval first. | owner decision (Phase 5) |
| **Email provider** (password reset by email, invite emails) | owner: before selling starts |
| **Google sign-in** | owner: later |
| Importing **invoices, purchases, payments and expenses** from old backups (the Restore window says so) | Phase 3 |
| **Next invoice number** must not go below invoices already made | Phase 3 (no invoices exist yet) |
| **Cash in hand** from the old backup (kept in settings) becomes the cash book's opening balance | Phase 3 |
| Bell: **overdue purchase bills and sales invoices** | Phase 3 |
| "Discard this …?" question for the Phase 3 documents (payment, credit note, challan, quick sale, bank/cheque entries) | Phase 3 |
| **Restoring a backup made by the new app**, and daily cloud copies | Phase 5 (with hosting) |
| **Security updates** for packages set up in Phase 1 (NestJS, React Router: about 23 advisories) | before launch (Phase 5) |
| **Mobile screens** — not to be built until the owner asks | owner: do not build yet |
| **Staff roles / limited staff access** (screens and rules for what each staff member may do). The server's existing role check from Phase 1 stays as it is; nothing more is added | owner: do not build yet |
| **The ~30 placeholder reports** — only the 9 reports that already work in the prototype are rebuilt | owner: do not build yet |
| **Sale orders and loans** | owner: do not build yet |
| **Item/stock reports and GST reports (GSTR-1, GSTR-3B)** | owner: do not build yet |

## Phase 2 — Masters ✅ (gate passed: the owner's real backup imports cleanly)
| Item | State |
|---|---|
| Database: parties, groups, addresses, contacts, items, units, categories, brands, item groups, HSN, godowns, stock ledger, adjustments, transfers, price lists, group rules, fixed prices, price history, electricians, commission rules, price PIN | done, row-level security on all |
| New shops start with the prototype's lists (taxes, groups, units, categories, price lists, Main shop, commission) | done |
| API for parties, items, stock, godowns, price lists, prices, price PIN, brand rules, settings, tax list, business details, backup, electricians, commission | done, 62 API tests |
| Importer: old app backup → new shop (checked first, all-or-nothing, refuses a shop that already has data); brings parties, items, opening stock and balances, prices, price lists (on/off), brand rules, godowns, electricians, commission, tax list, Settings switches, owner, cash in hand | done |
| Parties screen + Add party | done — 0 pixel difference at 1280/1366/1920 |
| Items screen + Add item (product, service, brands/sizes) + Adjust stock; sidebar and bell low-stock count | done — 0 pixel difference |
| Godowns + Add godown + Transfer stock | done — 0 pixel difference |
| Stock adjustments + New adjustment | done — 0 pixel difference |
| Price manager: Price View, price PIN, Price Setup (brand rules, fine-tune items), preview, undo, history, rate list (Excel / PDF / WhatsApp / print), Excel export and import, New price list | done — 0 pixel difference; Excel files match the prototype's cell for cell |
| Settings: Taxes & GST (GST/TCS/TDS, GSTIN check, live preview, tax list), Items & prices (price lists on/off), General (business details, ₹ and MRP display, payment links, Accounting module, backup & restore, start fresh, cloud sync) | done — 0 pixel difference |
| Import upload: Settings › General › Backup & restore › Restore from file takes the old app's backup | done — flow test from file to imported parties |
| "Discard this …?" question when closing a filled-in window (Enter twice / Esc) | done for Adjust stock, Start fresh and Restore; Phase 3 documents will use the same piece |
| Currency symbol switch (₹ hidden by default) works on every screen | done |
| **Gate:** a real backup file imports cleanly | ✅ the owner's backup imports cleanly (rechecked 4 Oct 2026; the file is not stored in the repository) |

### Differences from the prototype (on purpose)
- Unticking "comes in different brands or sizes" in Add item returns to the single-item form (the prototype's script crashes there).
- Document numbers are real and per financial year (ADJ-0001, TRF-0001); the prototype makes up random ones.
- The price PIN is checked by the server, with the same 5 tries / 60-second wait; the prototype kept it in the browser.
- Prices are worked out with exact decimal maths, so a few prototype results that were off by 1 paisa (computer rounding) are now exact.
- The tax list shows how many of your items really use each rate (the prototype shows sample numbers). Removing a rate switches it off; it is kept for old documents.
- **Start fresh never deletes anything:** it starts a new, empty set of books (optionally with your item list) and keeps the current books in the shop menu. The prototype wiped all entries.
- **Restore from file** adds the old app's backup to empty books instead of replacing books. Backups made by the new app are restored with the hosting work (Phase 5).
- "Storage on this device" says the books are kept on the server (the prototype measured the browser's storage).
- The bell's low-stock count and the General settings button work straight away (in the prototype the count refreshed only when opened, and General needed another tab opened first).

### Owner decisions (4 Oct 2026)
- **Sample entries:** not needed. The old app's demo entries stay out of the import (the default).
- **New price list** asks for the price PIN and then opens (in the prototype it could no longer be reached). Prices lock again when it closes; the server checks the PIN too.

## Phase 3 — Transactions (in progress)
| Item | State |
|---|---|
| Invoice and bill maths (GST incl./excl., discounts, charges, TCS, round off, amount in words) in exact decimals | done — checked against the prototype's own maths on 4,000 generated bills |
| Database: sales and purchase documents, payments and settlements, cash and bank accounts, cheques, reconciliation, expenses, commission payouts, double-entry books | done, row-level security on all; the database refuses a journal entry that doesn't balance |
| Books: every sale, payment and return posts a balanced entry; party, cash and bank balances come from the books | done |
| Sales API: invoices (save, edit, cancel), payments received, credit notes, delivery challans, item-wise quotations; prototype checks and wording; numbers like the prototype (Q-0101, PI-, CN-, DC-, XP-) | done, API tests |
| Importer: invoices, payments, returns, challans and item-wise quotations from old backups | done — dues, stock and balances match the prototype's own figures for the same backup |
| Sales invoices screen (filters, actions menu, preview, cancel, history) | done — 0 pixel difference at 1280/1366/1920 |
| Payments received + Receive payment | done — 0 pixel difference |
| Credit notes + New credit note | done — 0 pixel difference |
| Delivery challans + New challan + print view | done — 0 pixel difference |
| Invoice editor: party, rapid entry, items grid, discount & charges, payment, save / save & new / save & print, edit, copy, from challan, credit-limit question | done — 0 pixel difference at 1280/1366/1920 (new, filled, charges, payment, footer); flow test saves an invoice and opens it again |
| Several open bills (tabs) in the invoice editor | done — tests for the owner's four rules (see below) |
| Editor extras: tools pop-up (transport, terms, description, attachments, profit & loss), referral (add electrician, commission on this bill), previous rates, import from quotation, Quick sale (⚡ / Alt+N) | done — matching screenshots at 1280/1366/1920; flow tests for saving |
| Quotations page: brand-wise grid (rows × brand ranges, rates from Price manager, totals and "Lowest"), saved list, convert to invoice with the chosen brand, add range / row / item, referral, WhatsApp / PDF / Excel; item-wise quotations in the editor; brand-wise quotations and the grid come across from old backups | done — matching screenshots at 1280/1366/1920; API, importer and flow tests (save → convert → locked) |
| Purchases, expenses, banking & cash, cheques, reconciliation, commission | next |
| CI reliability: screenshot tests wait until the page is still (fixes the failure on main after PR #2) | done here; confirmed by CI on the Phase 3 pull request |

### Differences from the prototype (on purpose)
- **Invoices are never deleted.** "Delete" in the invoice menu is greyed out ("cancel instead"); cancelling keeps the record, returns stock and turns money received into an advance.
- Escape closes the invoice preview and the small confirmation window, as in the prototype (the rebuild had missed this).
- **Quotations are cancelled, never deleted.** The "×" in Saved quotations asks "Cancel?"; the quotation leaves the list and stays in the books. The list shows the newest first (the prototype lists them in the order it stored them).
- Opening Referral or a window on the Quotation page closes the share menu and the ranges list (the prototype left them open underneath).
- **Import from quotation keeps the quoted rates.** When the quotation's customer is filled in for you, the prototype re-prices every line from the price list, losing the rates its own message promises; the rebuild applies the price list only to lines that were already on the invoice.
- Adding an electrician links them to the customer with the same mobile or name, or adds them as a party in "Electricians" (15 days' credit), as the prototype does; party names stay unique.

### Owner decisions (Phase 3)
- **Screenshot comparison allows tiny text-edge differences.** Chrome sometimes shades the edges of the same letters differently between runs, or rounds a line of text that sits on a half pixel to the pixel above or below. A differing pixel is forgiven only when its colour is one already present within 2 pixels of that spot in the other picture (a letter edge), and at most 0.5% of the picture, never more than 1,500 pixels (a few short lines of text), may be forgiven. Sizes must match exactly; any colour change on a flat area, and anything bigger, still fails. Forgiven pixels show in blue in the diff pictures (real differences in red). Rule and checks: `apps/web/e2e/compare.ts`.
- **A plain click on a sales invoice row opens its preview** (the right-click menu stays). In the prototype only the menu opened it.
- **Several bills open at once, one tab each** (the prototype had removed this; its own test checks for "no bill tabs", which the port will turn round). The tabs use the prototype's leftover bill-tab styles; the screenshot test copies the strip into the prototype so the rest is still compared pixel for pixel. Rules, each with a test:
  1. Closing the last tab just closes the editor — no new bill opens and no number is used.
  2. Closing a tab never changes or overwrites another open bill (every change is tied to its own tab).
  3. A sale number is used only when the bill is saved. Unsaved bills show the next number; when another bill is saved first, they move on to the following one. A number you type yourself is kept.
  4. A tab with unsaved changes asks "Discard this bill?" before closing (the back arrow closes the bill on screen the same way).
- Open bills stay while you visit other screens and come back with "New invoice"; they are kept in this browser window only (not on the server), and are cleared on sign-out or when switching shop. Saving a bill while others are open shows the saved invoice over the editor; saving the last one goes to the sales list as before.

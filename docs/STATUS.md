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
| **Phase 5 — SaaS + launch**: Razorpay payments, admin console, shop sign-up / onboarding, security review, load test, beta. **On hold by the owner's decision (4 Oct 2026): do not start until the owner asks.** Hosting was done separately by the owner ("Phase 5-lite", below). | owner: do not start yet |
| **Paid hosting** (AWS Mumbai + Cloudflare Pages, as planned in ARCHITECTURE.md). For now the app runs on free plans set up by the owner — see *Live app* below and `docs/DEPLOY.md`. Moving to paid hosting costs money: owner approval first. | owner decision |
| **Email provider** (password reset by email, invite emails) | owner: before selling starts |
| **Google sign-in** | owner: later |
| Importing **invoices, purchases, payments and expenses** from old backups (the Restore window says so) | Phase 3 |
| **Next invoice number** must not go below invoices already made | Phase 3 (no invoices exist yet) |
| **Cash in hand** from the old backup (kept in settings) becomes the cash book's opening balance | Phase 3 |
| "Discard this …?" question for the Phase 3 documents (payment, credit note, challan, quick sale, bank/cheque entries) | Phase 3 |
| **Restoring a backup made by the new app from inside the app** (Settings › Restore). Daily database backups with a restore test now run in GitHub Actions, in the separate private repository `amn-kr/billing-erp-backups` — see *Live app* | later |
| **Security updates** for packages set up in Phase 1 (NestJS, React Router: about 23 advisories). Dependabot is on (owner, 5 Oct 2026); its pull requests are merged one by one when every check passes | ongoing |
| **Mobile screens** — not to be built until the owner asks | owner: do not build yet |
| **Staff roles / limited staff access** (screens and rules for what each staff member may do). The server's existing role check from Phase 1 stays as it is; nothing more is added | owner: do not build yet |
| **The ~30 placeholder reports** — only the 9 reports that already work in the prototype are rebuilt | owner: do not build yet |
| **Sale orders and loans** | owner: do not build yet |
| **Item/stock reports and GST reports (GSTR-1, GSTR-3B)** | owner: do not build yet |

## Live app — "Phase 5-lite", free plans (set up by the owner by hand, 5 Oct 2026)
The app is live and the owner has created an account and signed in. Details (no secrets): `docs/DEPLOY.md`.

| Item | State |
|---|---|
| Database: Neon (free), project `billing-erp`, AWS Singapore, Postgres 16, database `neondb`; migrations as `neondb_owner`, the API as `erp_app` (no RLS bypass, direct connection) | done by the owner |
| Server: Render Web Service (free) `billing-erp-api`, Singapore, https://billing-erp-api.onrender.com, health check `/api/health` | done by the owner |
| Screens: Render Static Site (free) `billing-erp`, https://billing-erp-ynqf.onrender.com; `/api/*` is passed to the server, so web and API share one address and the sign-in cookie works | done by the owner |
| GitHub: Dependency graph, Dependabot alerts, security updates and grouped security updates | on (owner) |
| **Auto-deploy:** every change to `main` goes live, and the server's build runs the database migrations — merge carefully | ⚠️ standing rule |
| Row-level security on the live database (one shop cannot see another's data) | check written and tested locally (`infra/db/backup/rls-live-check.sql`); it runs against the live database every night once the owner adds the backup secrets — it cannot be run from Claude's machine, whose network does not reach Render or Neon |
| Daily backups (encrypted, kept 30 days in GitHub) with a restore test and a shop-by-shop isolation check on the restored copy | done: runs every night in the separate private repository `amn-kr/billing-erp-backups` (first run green 20 Oct 2026; workflow copy and steps in `infra/backup-repo/`, see `docs/DEPLOY.md`) |
| Free-plan limits (server sleeps after 15 minutes, 0.5 GB database, short Neon restore window, …) | listed in `docs/DEPLOY.md` |

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
- Document numbers are real (ADJ-0001, TRF-0001), from the active prefix of Settings › Transactions; the prototype makes up random ones.
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

## Phase 3 — Transactions ✅ (gate passed: all flow tests pass against the API; merged in PR #3, 4 Oct 2026)
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
| Purchases API: bills, orders, debit notes, payments made; stock, dues and books; last purchase rates per supplier | done, API tests |
| Importer: purchase bills, orders, debit notes and payments made from old backups (the old app's demo orders are left out) | done — balances, stock and next numbers match the prototype's figures |
| Purchase bills, Purchase orders, Payments made, Debit notes, document view, Record payment made | done — matching screenshots at 1280/1366/1920 |
| Purchase editor (bill / order / debit note): supplier and item search, stock before → after, price changes, payment made with the bill, dues button, convert an order, return goods | done — matching screenshots at 1280/1366/1920; flow tests save each kind |
| Bell: overdue purchase bills and sales invoices | done |
| Banking & cash: Bank accounts and Cash in hand pages (cards, money book, periods), add / edit account, Move money, Count cash; accounts and hand entries come across from old backups | done — matching screenshots at 1280/1366/1920; API, importer and flow tests; imported balances match the prototype's |
| Expenses: list with category breakdown, Add / Edit expense (lines, GST input credit, paid from cash / bank / cheque), categories window; cash-book shop expenses, salary and bank charges listed too; expenses and categories come across from old backups | done — matching screenshots at 1280/1366/1920; API, importer and flow tests |
| Cheques (received / issued, deposited or cleared, bounced with bank charges, undo) and Reconciliation (statement date and balance, tick entries, difference); cheque states come across from old backups | done — matching screenshots at 1280/1366/1920; API, importer and flow tests |
| Electrician commission page: commission on referred bills less returns, earned as customers pay, pay in cash / UPI / bank or adjust against his own bills, electrician details, add / edit, commission rules; payouts come across from old backups | done — matching screenshots at 1280/1366/1920; API, importer and flow tests; imported figures match the prototype's |
| The prototype's own business-flow checks (`reference/tests/flows.js`) ported: sale raises the balance, cash payment settles it and reaches the cash book, credit note gives credit, purchase bill and payment made, expense lowers cash, challan → invoice, closing a bill asks first, bill number not used up, reload keeps data and screen, quoted names are safe | done — `apps/web/e2e/proto-flows.spec.ts`, 12 checks pass against the API. "No bill tabs" is replaced by the bill-tab rules (owner's request); "party statement = balance" moves to the Phase 4 statement report |
| Owner's real backup with all documents | imports cleanly; invoices, cash, bank and commission match the old app's own figures once its demo data is set aside (the owner decided how demo data and the default bank are handled — see Owner decisions below) |
| A bounced customer cheque as its own line in Receive payment (the customer's balance already goes up) | later |
| CI reliability: screenshot tests wait until the page is still (fixes the failure on main after PR #2) | done here; confirmed by CI on the Phase 3 pull request |

### Differences from the prototype (on purpose)
- **Invoices are never deleted.** "Delete" in the invoice menu is greyed out ("cancel instead"); cancelling keeps the record, returns stock and turns money received into an advance.
- Escape closes the invoice preview and the small confirmation window, as in the prototype (the rebuild had missed this).
- **Quotations are cancelled, never deleted.** The "×" in Saved quotations asks "Cancel?"; the quotation leaves the list and stays in the books. The list shows the newest first (the prototype lists them in the order it stored them).
- Opening Referral or a window on the Quotation page closes the share menu and the ranges list (the prototype left them open underneath).
- **Import from quotation keeps the quoted rates.** When the quotation's customer is filled in for you, the prototype re-prices every line from the price list, losing the rates its own message promises; the rebuild applies the price list only to lines that were already on the invoice.
- **Prototype reload quirks are not copied.** When the old app reopens its saved data it replays a debit note before the bill it was made against (so the note stops reducing that bill) and counts some saved sales twice in an item's stock. The rebuild keeps the figures the old app showed right after saving; the screenshot tests put the prototype back in that state before comparing.
- **Bank and cash entries typed by hand are cancelled, never deleted.** The entry window's button reads "Cancel entry" (the prototype says "Delete entry"); the entry leaves the book and stays in the records.
- **Expenses are cancelled, never deleted.** The edit window's button reads "Cancel expense" (the prototype says "Delete"); the money goes back into its account and the record stays.
- **No demo dates in cheques and reconciliation.** The prototype treats every cheque dated before 20 Sep 2026 as already cleared, and starts reconciliation with entries up to 25 Sep 2026 ticked and a demo statement balance. The rebuild starts cheques as pending and reconciliation with nothing ticked (statement date: the last day of last month). The screenshot tests start the prototype the same way. Your own backup has no cheques affected by this.
- **Expense numbers start at EXP-0001.** The prototype's first expense is EXP-0002 (it counts from "1 + 1"); numbers from an old backup are kept as they were.
- **Demo bank accounts are not brought across.** A shop that did not start fresh carries the old app's demo HDFC / SBI accounts and four demo entries; the import leaves them out unless the demo data is asked for. A demo account that one of your own entries uses is kept with a zero opening balance, and the import says so.
- **The demo default bank is kept when it received your money.** If your own sales, payments or expenses used UPI, card or bank, the old app put that money in its demo default bank (HDFC Bank). The import keeps that account with a zero opening balance and says so, so the money doesn't show up as cash.
- **Old bills that saved the base rate but not the commission** get the commission worked out the same way the old app worked it out when saving. **Two bills that shared a receipt number** keep both receipts; the second becomes e.g. PI-0629/2, and the import says so.
- Adding an electrician links them to the customer with the same mobile or name, or adds them as a party in "Electricians" (15 days' credit), as the prototype does; party names stay unique.

**Known occasional test flake:** the first Quotations screenshot at 1366 px came out a different size once in a full run and passed on re-run; watching it.

### Owner decisions (Phase 3)
- **Screenshot comparison allows tiny text-edge differences.** Chrome sometimes shades the edges of the same letters differently between runs, or rounds a line of text that sits on a half pixel to the pixel above or below. A differing pixel is forgiven only when its colour is one already present within 2 pixels of that spot in the other picture (a letter edge), and at most 0.5% of the picture, never more than 1,500 pixels (a few short lines of text), may be forgiven. Sizes must match exactly; any colour change on a flat area, and anything bigger, still fails. Forgiven pixels show in blue in the diff pictures (real differences in red). Rule and checks: `apps/web/e2e/compare.ts`.
- **A plain click on a sales invoice row opens its preview** (the right-click menu stays). In the prototype only the menu opened it.
- **Several bills open at once, one tab each** (the prototype had removed this; its own test checks for "no bill tabs", which the port will turn round). The tabs use the prototype's leftover bill-tab styles; the screenshot test copies the strip into the prototype so the rest is still compared pixel for pixel. Rules, each with a test:
  1. Closing the last tab just closes the editor — no new bill opens and no number is used.
  2. Closing a tab never changes or overwrites another open bill (every change is tied to its own tab).
  3. A sale number is used only when the bill is saved. Unsaved bills show the next number; when another bill is saved first, they move on to the following one. A number you type yourself is kept.
  4. A tab with unsaved changes asks "Discard this bill?" before closing (the back arrow closes the bill on screen the same way).
- Open bills stay while you visit other screens and come back with "New invoice"; they are kept in this browser window only (not on the server), and are cleared on sign-out or when switching shop. Saving a bill while others are open shows the saved invoice over the editor; saving the last one goes to the sales list as before.
- **Demo customers and items used for real count only the shop's own documents** (owner, 4 Oct 2026). The old app's built-in demo history for them (made-up sales, purchases and payments) is not brought across, so their balances and stock are opening figures plus the shop's own documents. Money received above an invoice's total settles the shop's own older bills (so the owner's INV-0414 shows paid, where the old app used that money on demo bills).

## Phase 4 — Reports + Home ✅ (gate passed on the owner's backup, 4 Oct 2026)
Scope set by the owner: only the 9 reports that already work in the prototype, plus Home. GST reports, stock reports and the ~30 placeholder reports stay on hold.

**Gate ("figures match the pilot"):** the owner decided on 4 Oct 2026 that their own shop's backup alone is the pilot, since no other shop uses the app yet. Result on that backup (checked locally, the backup is never committed):
- All 6 of the shop's own parties: the statement closes on the party balance in the books (6/6), and 5/6 match the prototype's statement and sale / purchase figures exactly.
- The 6th is listed twice in the old app under the same name (one copy holds the bills); the import merges exact duplicates (Phase 2), so the rebuild shows both together — the same closing balance the old app shows on the copy with the bills.
- Expenses: the old app lists 16, all of them its built-in demo expenses and demo cash-book entries; the shop has none of its own, so the rebuild shows none (demo data stays out, owner decision).

| Item | State |
|---|---|
| Reports screen: the prototype's catalogue of 39 reports with search, sidebar sections, hide / show the list; reports not rebuilt show the prototype's "This report is being built" | done — 0 pixel difference at 1280/1366/1920 |
| Party Statement (party, period, show items, opening / closing, overdue; print, PDF, Excel, WhatsApp) | done — 0 pixel difference; API test: every statement closes on the party balance in the books |
| Party wise Profit & Loss, All parties, Party Report By Item, Sale Purchase By Party, Sale Purchase By Party Group | done — 0 pixel difference; figures match the prototype's for the same books |
| Expense, Expense Category Report, Expense Item Report | done — 0 pixel difference |
| Links: a statement row opens the invoice, receipt or credit note; a report row opens the party's statement, the expense or the book entry; Parties page "Statement" opens the report | done — flow tests |
| Home: seven tiles, recent invoices, receivables by age, top selling items, quick actions, cash & bank, GST this month, low stock — all from the books | done — 0 pixel difference at 1280/1366/1920 (brand-new shop and a shop with books) |

### Differences from the prototype (on purpose)
- **Purchase bill lines in a party statement show their rate and amount.** With "Show items" ticked, the prototype shows "NaN" for purchase bill lines; the rebuild shows the real figures.
- **A cancelled invoice is not a top seller.** The prototype's "Top selling items" on Home still counts the items of a cancelled invoice.
- **Recent invoices on Home show how a bill was actually paid.** For a bill paid later, the prototype shows the payment choice left in the bill editor (e.g. "UPI" for a bill settled by a commission adjustment); the rebuild shows the real way it was paid ("Commission adjust", or "Cash" when it was settled by extra cash taken on another bill).

- **Profit uses the purchase-rate lots, not one purchase price (owner's rule, Oct 2026).** A sale's cost is what the lots it used up cost, oldest first — the same lot calculation as the stock value (`costOfGoods` in `packages/shared/src/stock.ts`, read through `goodsCosts` / `draftSaleCosts` in `apps/api/src/modules/stock/stock-value.ts`). A sale return gives back the cost of the lots its invoice used; an edit or cancel works the cost out again; a late bill can change older sales' profit. Stock that came in without a purchase rate costs 0 for profit (no fallback), and stock sold beyond what was in costs 0 until the purchase that fills it is entered. Today this is the sale editor's "Profit & loss · this bill" pop-up (one row per lot rate each line used) and Party wise Profit & Loss. **Any profit report built later must take its cost from this same calculation** — `apps/api/test/one-stock-value.test.ts` fails if a file multiplies a quantity by the purchase price on its own.

## How the GitHub check (CI) works
`.github/workflows/ci.yml` runs on every pull request and on every push to main. Since Oct 2026 it runs on
six free GitHub machines at the same time instead of one (same tests, same pictures, about 20 minutes instead of about 54):

| Job (as GitHub lists it) | What it does |
|---|---|
| What changed | Lists the changed files. If only `docs/` or `.md` files changed, the browser and picture tests are skipped (everything else still runs). |
| Quick checks (brand, typecheck, unit and API tests, build) | The fast checks, about 4 minutes, so a mistake there shows early. |
| Browser and picture tests (part 1 of 4) … (part 4 of 4) | All Playwright tests (flows and pictures at 1280, 1366 and 1920 px), split into 4 parts by test file (`--shard`). Each part has its own machine and its own fresh database. A failing part does not stop the others. |
| **test** | The required check of the `protect main` ruleset. It always runs, waits for all the jobs above and is green only when every one of them passed. Anything failed, cancelled or skipped by mistake makes it red (`.github/scripts/gate.sh`). |
| Same files already tested on the PR? / Full check skipped … | After a merge to main only: if a green PR run already tested exactly these files, the other jobs are skipped and `test` is green at once. |

**Pictures from a failed run:** on the run's page, under *Artifacts*, download **visual-diffs**. It holds the pictures of
every failed part, one folder each (`visual-diffs-part-1/visual/…`). Each part's own download
(`visual-diffs-part-1` … `-4`) is there too.

**Re-running only the part that failed:** open the run on GitHub and click **Re-run jobs › Re-run failed jobs**. GitHub
re-runs only the red part(s) and then `test`; the parts that passed are not run again. After a re-run the run page
lists **visual-diffs** more than once: the newest one belongs to the re-run. A part that passed on the re-run makes no new
pictures, so its folder there still holds the pictures from the first try.

**Approved pictures** are still made only on GitHub's Linux machine, with a temporary `quick-check.yml` on a `tmp/`
branch; `ci.yml` does not run on `tmp/` branches.

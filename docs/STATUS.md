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

## Still open
- **Hosting** (AWS Mumbai + Cloudflare Pages) — not set up; nothing is deployed. The web app and
  the API must sit on the same domain (e.g. app.yourshop.in and api.yourshop.in) so the
  sign-in cookie works.

## Phase 2 — Masters (in progress)
| Item | State |
|---|---|
| Database: parties, groups, addresses, contacts, items, units, categories, brands, item groups, HSN, godowns, stock ledger, adjustments, transfers, price lists, group rules, fixed prices, price history, electricians, commission rules, price PIN | done, row-level security on all |
| New shops start with the prototype's lists (taxes, groups, units, categories, price lists, Main shop, commission) | done |
| API for parties, items, stock, godowns, price lists, prices, price PIN, brand rules, settings, electricians, commission | done, 58 API tests |
| Importer: old app backup → new shop (dry run, all-or-nothing, refuses a shop that already has data) | done; price-list on/off and brand rules now come across correctly |
| Parties screen + Add party | done — 0 pixel difference at 1280/1366/1920 |
| Items screen + Add item (product, service, brands/sizes) + Adjust stock; sidebar low-stock count | done — 0 pixel difference |
| Godowns + Add godown + Transfer stock | done — 0 pixel difference |
| Stock adjustments + New adjustment | done — 0 pixel difference |
| Price manager: Price View, price PIN, Price Setup (brand rules, fine-tune items), preview, undo, history, rate list (Excel / PDF / WhatsApp / print), Excel export and import | done — 0 pixel difference; Excel files match the prototype's cell for cell |
| Currency symbol switch (₹ hidden by default) works on every screen, as in the prototype | done |
| Settings (Taxes & GST, tax list, Items & prices, General: display, MRP, UPI, business details, backup & restore, import from the old app) | next |
| Discard-changes question when closing a filled-in dialog | to do |
| **Gate:** a real backup file imports cleanly | done — the owner's backup imports cleanly (tested 3 Oct 2026; the file is not stored in the repository) |

### Differences from the prototype (on purpose)
- Unticking "comes in different brands or sizes" in Add item returns to the single-item form (the prototype's script crashes there).
- Document numbers are real and per financial year (ADJ-0001, TRF-0001); the prototype makes up random ones.
- The price PIN is checked by the server, with the same 5 tries / 60-second wait; the prototype kept it in the browser.
- Prices are worked out with exact decimal maths, so a few prototype results that were off by 1 paisa (computer rounding) are now exact.

### Questions for the owner
- **New price list:** in the prototype's final version this button always says "Prices are locked", because the only way to unlock is Price Setup, which then covers the button. Should entering the PIN open "New price list"? (Until decided it behaves like the prototype.)

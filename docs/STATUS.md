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
| Database: parties, groups, addresses, contacts, items, units, categories, brands, item groups, HSN, godowns, stock ledger, adjustments, transfers, price lists, group rules, fixed prices, price history, electricians, commission rules | done, row-level security on all |
| New shops start with the prototype's lists (taxes, groups, units, categories, price lists, Main shop, commission) | done |
| API for parties, items, stock, godowns, price lists, prices, settings, electricians, commission | done, 56 API tests |
| Importer: old app backup → new shop (dry run, all-or-nothing, refuses a shop that already has data) | done, tested with backups made in the old app |
| Screens: Parties, Items, Price manager, Stock adjustments, Godowns, Settings (+ their dialogs) matching the prototype | next |
| **Gate:** a real backup file imports cleanly | needs a real backup from the owner |

# Rebuild status

## Phase 0 — Prepare ✅ (waiting for the owner's approval of the screenshots)
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

## Waiting on the owner (decisions that cost money or need accounts)
- **Email provider** for "Forgot password" and staff invite emails (e.g. AWS SES,
  ~₹0.01 per email). Until then the sign-in page says reset by email is not on yet.
- **Google sign-in** needs a Google Cloud OAuth client in your name. Until then the
  button says it isn't set up.
- **Trial length:** the website version used 14 days, the prototype shows 7. The
  rebuild uses 14 (`TRIAL_DAYS`).
- **Hosting** (AWS Mumbai + Cloudflare Pages) — not set up; nothing is deployed. The web app and
  the API must sit on the same domain (e.g. app.yourshop.in and api.yourshop.in) so the
  sign-in cookie works.

## Next: Phase 2 — Masters
Parties, items/variants, price lists, godowns, settings, and the importer for the
prototype's backup file. Gate: a real backup file imports cleanly.

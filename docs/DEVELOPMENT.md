# Running the rebuild locally

Needs Node 22, pnpm 10 and PostgreSQL 16.

```bash
pnpm install                                   # also generates the Prisma client
psql -U postgres -f infra/db/init-ci.sql       # roles erp_owner / erp_app and the dev/test databases
cp apps/api/.env.example apps/api/.env         # then set JWT_SECRET (openssl rand -base64 48)

# database
cd apps/api
set -a; . ./.env; set +a
pnpm db:migrate                                # applies migrations as erp_owner
pnpm db:seed                                   # demo shop: aman@sharma.example.com / demo-password-1
cd ../..

# run (two terminals)
pnpm --filter @billing/api dev                 # http://localhost:3000/api
pnpm --filter @billing/web dev                 # http://localhost:5173  (sign-in at /login)
```

## Tests

```bash
pnpm typecheck
pnpm test                         # unit tests (shared, web) + API tests against billing_erp_test
pnpm --filter @billing/web e2e    # Playwright: flows + pixel comparison with the prototype
pnpm baseline                     # Phase 0 screenshots of the prototype → reference/baseline/
```

The screenshot tests start their own API (port 3100, database `billing_erp_e2e`,
reset on every run) and web server (port 5174). When a comparison fails, the
expected / actual / diff images are in `apps/web/test-results/visual/`.

## Layout

```
apps/api/        NestJS API (modules/, common/, prisma/ schema + migrations + demo seed)
apps/web/        React app: index.html = the app, login.html = the sign-in page
                 src/styles/ = the prototype's CSS, unchanged
                 e2e/ = Playwright tests
packages/shared/ money, dates, roles, form rules — used by both
tools/design-baseline/  Phase 0 screenshot tool + local copy of the Google fonts
infra/db/        database role setup
```

## Things to know

- **Two database roles.** Migrations run as `erp_owner`. The API runs as `erp_app`,
  which can read, add and change rows but never delete, and is always subject to
  row-level security. Every query goes through `DbService.scoped()`, which sets the
  shop for that transaction.
- **The app page has no `<!doctype>`.** The prototype has none, so browsers draw it
  in quirks mode; the app copies that so it looks identical. The sign-in page has a
  doctype, like the website version. That is why they are two HTML pages.
- **Copied CSS is checked.** `apps/web/src/styles/styles.test.ts` fails if anyone
  edits the copied stylesheets.

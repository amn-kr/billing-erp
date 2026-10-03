# Billing ERP

Billing, stock and accounting software for Indian shops and small businesses. It covers:

- GST invoices, quotations and delivery challans
- Purchases, payments, expenses, and cash and bank
- Electrician commission and party statements
- Reports

**Status:** Phase 0 and Phase 1 of the rebuild are done (see `docs/STATUS.md`). The prototype in `reference/` is still the design and behaviour reference.

```
reference/design/app.html     The current app (single file, 1 MB). Open it in a browser to use it.
                              THIS IS THE DESIGN SPEC: the rebuild must look identical.
reference/firebase-site/      Interim website version (Firebase login + per-shop data), ready to deploy.
                              See its README.md.
reference/tests/              Playwright test scripts used on the prototype (flows, sync, backup, website).
docs/ARCHITECTURE.md          The rebuild plan: stack, database, project structure, phases.
CLAUDE.md                     Working rules for anyone (human or AI) building the rebuild.
```

## Try the prototype
Open `reference/design/app.html` in Chrome. It starts with a sample shop.
Use **Settings › General › Start fresh** to try it with empty books.

## Run the prototype tests
```
cd reference/tests
npm init -y && npm install playwright@1 && npx playwright install chromium
mkdir -p out
node flows.js     # 16 business-flow checks
node crawl.js     # opens every page and button, reports errors
node empty.js     # same with empty books
node saas.js      # website version (needs: cd ../firebase-site/public && python3 -m http.server 8765)
```

## Rebuild in one line
React + TypeScript (Vite) frontend reusing the current CSS unchanged. NestJS API. PostgreSQL with row-level security per shop. Redis/BullMQ for jobs. S3 for files. Hosted on AWS Mumbai. About 6 phases. See `docs/ARCHITECTURE.md`.

## Run the rebuild
See `docs/DEVELOPMENT.md`. Short version: `pnpm install`, set up Postgres with
`infra/db/init-ci.sql`, then `pnpm --filter @billing/api dev` and `pnpm --filter @billing/web dev`.

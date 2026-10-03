# Working rules for this repository

## The one hard rule
**The rebuild must look exactly like `reference/design/app.html`.**
- Copy its CSS unchanged and keep its class names and DOM structure.
- Do not redesign, restyle or "modernise" anything unless the owner asks.
- Every rebuilt screen is checked with a Playwright screenshot against the prototype at 1280, 1366 and 1920 px.

## Who you are working for
The owner runs a business in India and is not a programmer.
- Explain results in plain words.
- Say what you tested.
- Ask before decisions that cost money or can't be undone (hosting, paid services, deleting data).

## Plan
Follow `docs/ARCHITECTURE.md`, phase by phase. Do not start a phase until the previous phase's gate passes.

## Before you start (environment check)
The rebuild needs npm packages. If `npm view react version` fails with 403, this environment blocks package installs:
- Stop and tell the owner.
- Do not hand-write vendored copies of libraries.

## Conventions
- **Repo and language:** pnpm workspaces + Turborepo, TypeScript strict.
- **Money:** `numeric(14,2)` in the database. In code, use the shared Decimal helpers in `packages/shared`, never floats for totals.
- **Dates:** ISO `date`. The business timezone is Asia/Kolkata. The financial year runs April to March.
- **Tenancy:** every shop-owned table has `business_id`. Set the RLS context per request in the API.
- **Documents:** never deleted, only cancelled. Write audit-log entries for create, update and cancel.
- **Tests:** unit tests for maths, API tests per endpoint, Playwright for flows. Port `reference/tests/flows.js` checks to the new app.
- **Commits:** small, with descriptive messages. Never commit secrets; use `.env.example`.

## Useful facts about the prototype
- Its data shapes are visible in a backup file: Settings › General › Backup & restore › Download backup. The importer in `packages/importer` maps that file into the new tables.
- The 39-report catalogue is in `REPS`. The 9 built reports are in the `RPT.*` functions.
- The sale editor logic (rapid entry, discount & charges, referral commission, quotation import) is the most complex part. Read it carefully before porting.

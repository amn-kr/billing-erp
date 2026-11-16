# Working rules for this repository

## The one hard rule
**The rebuild must look exactly like `reference/design/app.html`.**
- Copy its CSS unchanged and keep its class names and DOM structure.
- Do not redesign, restyle or "modernise" anything unless the owner asks.
- Every rebuilt screen is checked with a Playwright screenshot against the prototype at 1280, 1366 and 1920 px.
- The web app and the Windows/Mac app follow this rule. **Exception (owner, 10 Nov 2026):** the Android/iPhone app has its own mobile screens. They are checked against the approved mobile design (`reference/design/mobile.html`) instead. See "Desktop and mobile apps" in `docs/ARCHITECTURE.md`.

## Phone app rules (owner, 15 Nov 2026; full plan in `docs/MOBILE-PLAN.md`)
- **Colours:** only the 20 colours in `docs/MOBILE-PLAN.md` section 2, kept in one shared file. A test fails on any other colour. Every money amount also shows an arrow or a word, never colour alone. Shadows and shine use only these colours made see-through (owner, 16 Nov 2026: the phone app is not flat).
- **One design for every phone:** no fixed widths. Each screen has one approved picture at 390 px, and automatic fit checks run at every width from 320 to 480 px (nothing outside the screen, no overlaps, no cut text or amounts, buttons at least 44 px). Portrait only.
- **English and Hindi** for all phone text. Lowest Android version: 7.0.
- **Wording:** every word of a button, field, tab, badge or heading starts with a capital letter (Purchase Bill). Dates are written in full (September 25, 2026). Names stay on one line and end with "…" when they don't fit.
- **Order:** Phase 7 (mobile design) may run during the Windows trial. Phase 8 (the app) starts after the trial passes.
- **Later, after the Windows trial (owner's decision):** the web and Windows apps move to the same 20 colours and the same test method (one picture plus fit checks instead of 1280, 1366 and 1920). Until then, the rule above stays as it is.

## Who you are working for
The owner runs a business in India and is not a programmer.
- Explain results in plain words.
- Say what you tested.
- Ask before decisions that cost money or can't be undone (hosting, paid services, deleting data).

## Plan
Follow `docs/ARCHITECTURE.md`, phase by phase. Do not start a phase until the previous phase's gate passes.

## Keep README.md current (owner, 16 Nov 2026)
Update `README.md` after every merge to `main`, every deployment, and every build or release (Windows installer, version tag). Do it in the same pull request when you can.
- Refresh the **Latest** table (where we are, latest Windows release, live app, needs attention, next), the **Progress** table and the "Last updated" date.
- Keep it consistent with `docs/STATUS.md`. Write only facts that are true; never guess a status.
- Keep it easy on the eye: headings, tables, short sentences. Do not turn it into a wall of text.

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

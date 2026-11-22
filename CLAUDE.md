# Working rules for this repository

## The one hard rule (owner, 22 Nov 2026)
**The look comes from the app's own theme. How things work comes from the prototype.**
- **Look:** the app's own theme is the design: the stylesheets in `apps/web/src/styles/`, the Inter font, and the existing buttons, tables, forms, cards and dialogs with their class names and DOM structure. The theme was copied unchanged from `reference/design/app.html`, so today the app looks exactly like the prototype.
- **New screens and dialogs** are built only from that theme. A new colour, font, size or kind of control needs the owner's OK first.
- Do not redesign, restyle or "modernise" anything unless the owner asks. Every look change the owner asks for gets one picture per changed screen, approved by the owner.
- **How it works stays with the prototype:** calculations, formulas, rounding, taxes, stock, document numbers, reports, flows, backup and import still follow `reference/design/app.html` (plus the differences on purpose listed in `docs/STATUS.md`). A look change never touches them, and its pull request lists the changed files to show it.
- **Font (owner, 19 Nov 2026):** the web and Windows apps use **Inter**, the same English font as the phone app. `reference/design/app.html` and `owner-panel.html` were changed to Inter too.
- **Checks:** one approved picture per screen at 1366 px; automatic fit checks at 1280, 1366, 1440, 1536, 1600 and 1920 px (nothing outside the screen, no overlaps, no cut text or amounts, buttons not too small); and a test that fails on any colour or font outside the theme. **This switch is made in 3 parts (see "Look rule change" in `docs/STATUS.md`). Until parts 2 and 3 are merged, the old checks keep running:** the stylesheets are compared with the prototype, and every screen is pictured at 1280, 1366 and 1920 px.
- The web app and the Windows/Mac app follow this rule. **Exception (owner, 10 Nov 2026):** the Android/iPhone app has its own mobile screens. They are checked against the approved mobile design (`reference/design/mobile.html`) instead. See "Desktop and mobile apps" in `docs/ARCHITECTURE.md`.

## Phone app rules (owner, 15 Nov 2026; full plan in `docs/MOBILE-PLAN.md`)
- **Colours:** only the 20 colours in `docs/MOBILE-PLAN.md` section 2, kept in one shared file. A test fails on any other colour. Every money amount also shows an arrow or a word, never colour alone. Shadows and shine use only these colours made see-through (owner, 16 Nov 2026: the phone app is not flat).
- **One design for every phone:** no fixed widths. Each screen has one approved picture at 390 px, and automatic fit checks run at every width from 320 to 480 px (nothing outside the screen, no overlaps, no cut text or amounts, buttons at least 44 px). Portrait only.
- **English and Hindi** for all phone text. Lowest Android version: 7.0.
- **Android app (owner, 18 Nov 2026):** Kotlin with Jetpack Compose in `apps/android`, App ID `in.billingo.app` (permanent). Fonts: Inter for English, Noto Sans Devanagari for Hindi. The on-phone preview maths must pass the shared list of examples in `packages/shared`, the same as the web. Detailed plan: `docs/PHASE8-PLAN.md`.
- **Wording:** every word of a button, field, tab, badge or heading starts with a capital letter (Purchase Bill). Dates look the same everywhere: 16 Nov 2026 (day, short month, year). A transaction row shows its name, then "INV-0107 | 14 Nov 2026" under it. Names stay on one line and end with "…" when they don't fit.
- **Order:** Phase 7 (mobile design) may run during the Windows trial. **Phase 8 (the app) starts now; the rest of the Windows trial (sections D, F, F2, G and the shop trial I) comes after the phone app is launched (owner, 18 Nov 2026).**
- **Later, after the Windows trial (owner's decision):** the web and Windows apps move to the same 20 colours, only when the owner asks. (The switch to one picture plus fit checks was brought forward by the owner on 22 Nov 2026; see the hard rule.)

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
- **Document numbers (owner, 18 Nov 2026):** always assigned by the server, never typed or edited by anyone, in every app (web, Windows, phone). Open screens show the next number live and update it when another device saves the same kind of document.
- **Tests:** unit tests for maths, API tests per endpoint, Playwright for flows. Port `reference/tests/flows.js` checks to the new app.
- **Commits:** small, with descriptive messages. Never commit secrets; use `.env.example`.

## Useful facts about the prototype
- Its data shapes are visible in a backup file: Settings › General › Backup & restore › Download backup. The importer in `packages/importer` maps that file into the new tables.
- The 39-report catalogue is in `REPS`. The 9 built reports are in the `RPT.*` functions.
- The sale editor logic (rapid entry, discount & charges, referral commission, quotation import) is the most complex part. Read it carefully before porting.

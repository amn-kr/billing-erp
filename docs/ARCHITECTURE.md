# Architecture & migration plan

The full plan, with diagrams, is in the Claude doc "Billing ERP — Architecture & Migration Plan". This file is the working summary.

## Decisions
- **Frontend:** React 18 + TypeScript + Vite, React Router 6, TanStack Query, React Hook Form + Zod, Zustand.
- **Styling:** the CSS from `reference/design/app.html`, copied unchanged into `apps/web/src/styles/`. Every class name and the DOM structure are kept. There is no Tailwind and no UI kit.
- **Backend:** Node 22 + NestJS 10, Prisma ORM (raw SQL for reports), PostgreSQL 16 with row-level security on `business_id`.
- **Jobs:** Redis + BullMQ. **Files:** S3 (ap-south-1). **Live updates:** Socket.IO room per business.
- **Auth:** argon2 passwords, JWT access + refresh tokens, MSG91 phone OTP (optional).
- **Payments:** Razorpay subscriptions and payment links.
- **Hosting:** AWS Mumbai (ECS Fargate, RDS, ElastiCache). The web app goes on Cloudflare Pages.
- **Quality:** Vitest, Supertest, Playwright (flows + screenshot comparison against `reference/design/app.html`), GitHub Actions. Errors go to Sentry.
- **Repo:** pnpm workspaces + Turborepo.

## Structure
```
apps/web/        React app: app/ (shell, router), styles/ (current CSS), components/ (shared),
                 features/<area>/ (pages, components, api.ts, hooks.ts), lib/, offline/, e2e/
apps/api/        NestJS: modules/<area>/ (controller, service, dto, policies, tests), jobs/, common/,
                 prisma/ (schema, migrations, demo seed, reference seed)
packages/shared/ types, Zod schemas, GST + rounding maths, number formats
packages/importer/ prototype backup file (.json) → database
infra/           Docker, Terraform, env templates
```

## Database (about 45 tables)
- **Common columns:** every shop-owned table has `business_id` (with RLS), UUID ids, `created_by`, `created_at` and `updated_at`.
- **Types:** money is `numeric(14,2)`, quantities are `numeric(14,3)`.
- **No deletes:** documents are cancelled with `cancelled_at`, never deleted. "Delete" on screen (from Oct 2026: sales documents and payments received) runs the same steps as cancel and also sets `deleted_at`, which only hides the document from the lists; the row is kept (`apps/api/src/common/deleting.ts`).

Tables by area:
- **Accounts and SaaS:** users, businesses, memberships, invites, roles, role_permissions, sessions, plans, subscriptions, subscription_payments
- **Setup:** business_settings, tax_rates, document_series (several prefixes per type, one active; counters keep going across financial years), financial_years
- **Parties:** parties, party_groups, party_addresses, party_contacts
- **Catalogue:** items, item_groups, brands, categories, units, hsn_codes
- **Pricing:** price_lists, price_list_rules, item_prices, price_history, quotation_grids, quotation_grid_rates
- **Stock:** godowns, stock_movements (ledger), stock_transfers, stock_adjustments
- **Sales:** sales_documents (quotation / challan / invoice / credit note) + sales_document_lines
- **Purchases:** purchase_documents (order / bill / debit note) + purchase_document_lines
- **Money:** payments, payment_allocations, cash_bank_accounts, bank_transactions, cheques, reconciliations, expenses, expense_lines, expense_categories
- **Commission:** referrers, commission_rules, commission_entries, commission_payouts
- **Accounting:** ledger_accounts, journal_entries, journal_lines (every document posts a balanced entry)
- **System:** audit_log, attachments, notifications, message_log, backups, idempotency_keys

## Phases (about 19 weeks for 2 developers)
| # | Phase | Weeks | Gate to move on |
|---|---|---|---|
| 0 | Prepare: freeze design, screenshot 27 screens + 41 dialogs | 0–1 | Baseline screenshots approved |
| 1 | Foundations: repo, CI, auth, businesses/roles, schema, CSS port, app shell | 1–3 | Login + shell match screenshots |
| 2 | Masters: parties, items/variants, price lists, godowns, settings, importer | 4–6 | A real backup file imports cleanly |
| 3 | Transactions: sale editor, quotations, challans, credit notes, payments, purchases, expenses, banking, commission | 7–12 | All flow tests pass against the API |
| 4 | Reports + Home: tiles, 9 built reports, GSTR-1/3B, P&L, stock, day book, exports | 13–15 | Figures match the pilot for 3 shops |
| 5 | SaaS + launch: Razorpay, admin console, onboarding, security review, load test, beta | 16–19 | Beta sign-off, restore drill passes |

## Desktop and mobile apps (owner's decisions, 10 Nov 2026)
**Order (owner, 10 Nov 2026):** Phase 6 (Windows app) is built now, before Phase 5, which stays on hold until the owner asks. The offline subscription check (15 days without internet, then renew) moves into Phase 5, because there is no subscription to check before Razorpay. Phases 7–9 follow Phase 6 in order.

**Two ways a shop runs the software**
- **Single PC (offline):** the shop's data lives on one Windows PC. Billing works without internet. That PC assigns document numbers itself, using the same prefix and counter rules as the server.
- **Multi-device (online):** the data lives on the cloud server. PCs, staff phones and field salesmen all connect to it. Internet is required.
- **Move to cloud:** a single-PC shop can switch to multi-device once. The whole book is uploaded and the PC then works online. There is no two-way sync between offline copies.

**Who uses what**
- Windows app (Mac later): counter staff and owner. It uses **the prototype screens exactly**, with the same CSS, classes and DOM as the web app.
- Android app (iPhone later): staff, field salesmen and owner. It is online only. It has **its own mobile screens**, designed separately (the owner's exception to the "look exactly like the prototype" rule). Invoices and quotations are shared as PDFs on WhatsApp through the Android share sheet. No Bluetooth printing.

**Technology**
- **Windows/Mac:** Electron, because it has Node built in, so the existing NestJS API runs inside the app in single-PC mode. A bundled PostgreSQL 16 runs locally, so Prisma, raw-SQL reports and RLS work unchanged. In online mode the same app talks to the cloud API.
- **Android/iPhone:** Capacitor with React (`apps/mobile`). The data layer (`api.ts`, `hooks.ts`, Zod schemas) is shared with the web app. Only the screens are new.
- **Printing:** the Windows app prints directly to thermal receipt printers and to A4 printers. Paper sizes come from Settings.

| # | Phase | Gate to move on |
|---|---|---|
| 6 | Windows app + single-PC offline mode: Electron shell, local API + bundled PostgreSQL, local numbering, direct thermal/A4 printing, automatic cloud backup when online + backup to pen drive, Move to cloud, installer with auto-update | All flow tests pass in the Windows app with the internet off. Move to cloud test passes. A restore drill from both backup types passes. Screens match the prototype at 1280, 1366 and 1920 px |
| 7 | Mobile design: phone screens for the jobs staff, field salesmen and owner do on a phone (`reference/design/mobile.html`) | Owner approves the mobile design |
| 8 | Android app (APK): Capacitor, online only, WhatsApp PDF sharing, in-app "update available" check. The APK is shared directly at first; Play Store comes later | Flow tests pass on an Android emulator. Screens match the approved mobile design |
| 9 | iPhone + Mac builds from the same code | Same tests pass on iPhone simulator and Mac. Apple developer account (about ₹8,500 a year) approved by owner |

## Production rules that differ from the prototype
1. The server assigns document numbers from the type's active prefix (Settings › Transactions). Each prefix has its own counter, which keeps going across financial years (owner's choice, 14 Oct 2026); a number already used is never given again.
2. Saving a document is one transaction covering stock, party balance, cash/bank and the journal.
3. Saved invoices are cancelled, never deleted. Every change goes to the audit log.
4. All GST and rounding maths lives in `packages/shared`, with unit tests.
5. Permissions are checked server-side on every endpoint: owner, manager, billing staff, accountant.
6. Sample data exists only in the demo seed, never in app code.

### Phase 6 steps (each one shown to the owner before the next)
1. **Windows app shell, online** (`apps/desktop`): one window showing the live app; the app's pages stay inside, WhatsApp/e-mail/other websites open outside, anything else is refused; "Not connected" page that retries. ✅
2. **Installer + auto-update**: `Setup.exe` (electron-builder), built on GitHub's Windows machines; updates itself from GitHub Releases. ✅
3. **Direct printing (A4/A5)**: Print buttons go straight to the printer chosen on this PC (Settings › Print & invoice › *Printer on this PC*, Windows app only), on the shop's paper and orientation; Ctrl+P still opens the print window. Thermal receipts later: the prototype has no receipt layout, so one must be designed and approved first (owner, 10 Nov 2026). ✅
4. **Local server + bundled PostgreSQL** inside the app; safe start/stop, data upgrades on update. ✅
   - PostgreSQL 16.14 programs (initdb, pg_ctl, postgres) from `@embedded-postgres/<platform>`, fetched by `apps/desktop/scripts/ensure-postgres.cjs` only when the Windows app is built or tested; the installer carries the Windows ones in `resources/postgres`.
   - The books live in `%APPDATA%\billing-erp-desktop\local\pgdata`, reachable only from this PC (127.0.0.1, password). Passwords and the sign-in key are made on first start (`local/settings.json`).
   - The server is the same API (`apps/api/dist`, bundled by `apps/desktop/build-server.mjs`) plus the web app's pages, at a fixed `http://127.0.0.1:<port>`, run in its own process. It applies the same migrations as the live server, each in one transaction, recorded in Prisma's `_prisma_migrations` (same checksums).
   - An app update first copies the stopped database (`local/backups/before-<version>-<date>`, newest 3 kept).
   - Not yet in single-PC mode: reading the old prototype's backup files (needs a separate browser).
5. **First start: "This PC only" or "Connect to cloud"**; local sign-in and numbering. ✅
   - The choice is a page of the Windows app (`apps/desktop/static/welcome.html`), shown once per computer; the answer is kept in `%APPDATA%\billing-erp-desktop\mode.json` (`BILLING_MODE` overrides it for tests and support). There is no switch back from cloud to this PC; this PC to cloud is step 7.
   - Single-PC sign-in and bill numbers are the same API code as online, run against the PC's own database, so the same rules apply (one counter per prefix, never reused).
   - The web app's pages load their fonts from Google; the single-PC copy (`dist/web`) is rewritten at build time to use copies kept with the app (`apps/desktop/scripts/offline-fonts.mjs`), so screens look the same without internet. The live site is unchanged.
   - The sign-in page hides "Open the demo shop" in single-PC mode (there is no demo shop on the PC).
6. **Backups**: automatic encrypted cloud backup when online, backup to pen drive, restore from both.
   Owner decisions (10 Nov 2026): cloud backups go to the shop's own Google Drive now, and also to our own server's file storage later (chosen with the hosting work in Phase 5); the backup lock is a **recovery key** the owner prints; the pen drive backs up **automatically whenever it is plugged in**.
   - **6a. Pen drive or folder + recovery key + restore from files** ✅
     - Same real-time backup as online (`apps/api/src/modules/backup`): each change within a minute, a full copy each day, locked files. In single-PC mode the PC's own server writes them into the chosen folder (`folder.ts`, only with `BACKUP_FOLDERS=on`, which the live server never has): `<folder>/<app> Backup - <shop code>/`, newest 7 full copies kept. A missing folder (pen drive out) waits quietly; after a day an amber line asks to plug it in.
     - The recovery key is this PC's `BACKUP_MASTER_KEY`: 32 characters A–Z/2–7, made on first start (`local/settings.json`), shown and printed from Settings (an A4 page with what to do).
     - Restore from files works on any computer: choose the pen drive or folder, type the key; the backup is opened and checked, then becomes new books (the books open at the time are untouched).
   - **6b. Google Drive in single-PC mode** ✅ (built; works once the owner has made the Google "Desktop app" client, docs/DEPLOY.md)
     - The same Drive backup as online, from the PC's own server. Google sign-in opens in the computer's web browser (Google doesn't allow it inside apps); Google sends that browser back to the PC's bare address `http://127.0.0.1:<port>/`, which the PC's server passes on to the Drive step; the browser then shows "Google Drive is connected — go back to the app", and the app's Settings notice it by themselves.
     - The client's ID and secret are built into the installer from GitHub secrets `DESKTOP_GOOGLE_CLIENT_ID` / `DESKTOP_GOOGLE_CLIENT_SECRET`.
     - Restore from files › Google Drive: on a new computer, after connecting the same Google account, the newest backup folder in that Drive that the typed recovery key opens is restored (never the books' own folder); only its latest full copy and the changes after it are downloaded.
7. **Move to cloud**: upload the whole book once, then work online. ✅
   - Settings › General › Cloud sync shows *On this computer only* with **Move to cloud…** in single-PC mode. The owner signs in to their online account (or makes one) in that window.
   - The PC's server (`apps/api/src/modules/backup/cloud.ts`, `POST /api/cloud/move`, single-PC mode only) packs the books as they are now (the same full copy the backups make) and sends them to the online app's `POST /api/cloud/import`, which makes them a shop of that account exactly as a restore makes new books (new ids, a new free trial). The same PC books sent twice by the same person give one shop (a fixed new id), never two. Books with columns the online app doesn't know yet are refused until it is updated.
   - The counts (invoices, parties, items, purchase bills, payments, this year's sales) are compared on both sides and shown. Then the PC switches to online (`mode.json` records where the books went), stops its own server and database, and opens the online app; the books stay on the disk, no longer opened.
   - Staff accounts made on the PC are invited again online. The move is written in the PC books' activity log.
8. **Full testing + pilot** on real Windows 10/11 PCs.
   Owner decisions (11 Nov 2026): installers and updates are published on a separate public page, [amn-kr/billing-erp-releases](https://github.com/amn-kr/billing-erp-releases) (the code stays private); no code signing for the trial (decided before other shops get it); the trial is the owner's own shop in **This PC only** mode; thermal receipts come after the trial.
   - **8a. Ready to release** (owner): the releases access key (`RELEASES_TOKEN`) and the Google "Desktop app" client (`DESKTOP_GOOGLE_CLIENT_*`), docs/DEPLOY.md.
   - **8b. First release v0.1.0** (owner's go-ahead): tag `v0.1.0`; GitHub builds, checks and publishes the installer on the releases page.
   - **8c. Checks on real PCs** (owner, with the checklist in `docs/WINDOWS-TRIAL.md`): Windows 10 and 11; install past the SmartScreen warning; This PC only and Connect to cloud; bills, a real printer on A4/A5; Wi-Fi off; pen drive backup, unplugged and back; recovery key printed; restore on a second PC or Windows user; Google Drive connect and restore; Move to cloud with a test account; uninstall keeps the books.
   - **8d. Update check:** release v0.1.1 (a small fix or the first trial findings); the installed app finds it, downloads it and restarts into it, with the books intact (the before-update copy is made).
   - **8e. Trial in the owner's shop** (This PC only, about two weeks): daily use; backups checked weekly with *Test restore*; problems noted in the checklist and fixed in v0.1.x releases.
   - **Gate:** the checklist passes on Windows 10 and 11, the update check passes, a restore drill from both backup kinds passes on a real PC, and the owner is happy to give it to another shop.

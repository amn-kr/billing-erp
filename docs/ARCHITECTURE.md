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
- **No deletes:** documents are cancelled with `cancelled_at`, never deleted.

Tables by area:
- **Accounts and SaaS:** users, businesses, memberships, invites, roles, role_permissions, sessions, plans, subscriptions, subscription_payments
- **Setup:** business_settings, tax_rates, document_series (per type per financial year), financial_years
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

## Production rules that differ from the prototype
1. The server assigns document numbers, per financial year (April–March).
2. Saving a document is one transaction covering stock, party balance, cash/bank and the journal.
3. Saved invoices are cancelled, never deleted. Every change goes to the audit log.
4. All GST and rounding maths lives in `packages/shared`, with unit tests.
5. Permissions are checked server-side on every endpoint: owner, manager, billing staff, accountant.
6. Sample data exists only in the demo seed, never in app code.

#!/usr/bin/env bash
# Starts the API for Playwright on a fresh e2e database seeded with the
# prototype's shop (Sharma Electricals & Hardware, trial ending 8 Oct 2026).
set -euo pipefail
cd "$(dirname "$0")/../../api"
export MIGRATE_DATABASE_URL="${E2E_MIGRATE_DATABASE_URL:-postgresql://erp_owner:erp_owner@localhost:5432/billing_erp_e2e}"
export DATABASE_URL="${E2E_DATABASE_URL:-postgresql://erp_app:erp_app@localhost:5432/billing_erp_e2e}"
node scripts/reset-db.mjs
SEED_TODAY=2026-10-01 SEED_TRIAL_DAYS=7 SEED_BUSINESS_CODE=BE-1012 DEMO_EMAIL=aman@sharma.example.com DEMO_PASSWORD=demo-password-1 \
  node -r @swc-node/register prisma/seed-demo.ts
node -r @swc-node/register scripts/e2e-seed-masters.ts
export NODE_ENV=test PORT=3100 JWT_SECRET=e2e-secret-e2e-secret-e2e-secret-0123 WEB_ORIGINS=http://localhost:5174 \
  DEMO_ENABLED=true DEMO_EMAIL=aman@sharma.example.com TEST_THROTTLE=0
exec node -r @swc-node/register src/main.ts

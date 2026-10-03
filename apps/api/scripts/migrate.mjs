// Applies migrations as the owner role (MIGRATE_DATABASE_URL), never as the app role.
import { execSync } from 'node:child_process';
const url = process.env.MIGRATE_DATABASE_URL;
if (!url) { console.error('Set MIGRATE_DATABASE_URL (the erp_owner connection string).'); process.exit(1); }
execSync('npx prisma migrate deploy', { stdio: 'inherit', env: { ...process.env, DATABASE_URL: url } });

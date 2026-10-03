/** Test database settings (override with env vars in CI). */
export const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgresql://erp_app:erp_app@localhost:5432/billing_erp_test';
export const TEST_MIGRATE_DB = process.env.TEST_MIGRATE_DATABASE_URL ?? 'postgresql://erp_owner:erp_owner@localhost:5432/billing_erp_test';

export function applyTestEnv(): void {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DB,
    JWT_SECRET: 'test-secret-test-secret-test-secret-123',
    WEB_ORIGINS: 'http://localhost:5173',
    DEMO_ENABLED: 'true',
    TRIAL_DAYS: '14',
  });
}

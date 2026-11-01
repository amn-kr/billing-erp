import { todayIst } from '@billing/shared';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  /** The app role (erp_app). Never the owner role: RLS must apply. */
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_MINUTES: z.coerce.number().default(15),
  REFRESH_TOKEN_DAYS: z.coerce.number().default(30),
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  /** Comma-separated origins allowed to call the API from a browser (the web app). */
  WEB_ORIGINS: z.string().default('http://localhost:5173'),
  TRIAL_DAYS: z.coerce.number().default(14),
  /** Lets "Open the demo shop" sign in to the demo account. */
  DEMO_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  DEMO_EMAIL: z.string().default('demo@billing-erp.example.com'),
  /**
   * Real-time backup: the master key every backup file is locked with (each shop gets its own key
   * made from it). At least 32 random characters, e.g. Render's "Generate" value. Without it no
   * backups are sent. Losing it makes every backup unreadable: keep a copy in a safe place.
   */
  BACKUP_MASTER_KEY: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(32, 'BACKUP_MASTER_KEY must be at least 32 characters').optional()),
  /** off: this server does not run the every-minute backup sender (tests call it directly). */
  BACKUP_WORKER: z.enum(['on', 'off']).optional(),
  /** The database plan's size limit, for the "space for your books" bar and warnings (Neon free plan: 500 MB). */
  DB_SPACE_LIMIT_MB: z.coerce.number().positive().default(500),
  /**
   * Google Drive backups: the OAuth client made in Google Cloud (Google Auth Platform › Clients, a
   * "Web application" whose redirect URI is APP_URL/api/backup/drive/callback). Without them the
   * "Connect Google Drive" button says Drive isn't set up on this server. Never logged.
   */
  GOOGLE_CLIENT_ID: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  GOOGLE_CLIENT_SECRET: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  /** The address people open the app at (Google sends them back here); default: the first of WEB_ORIGINS. */
  APP_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
  /** Tests only: Google's addresses (sign-in, tokens, Drive), pointed at a pretend Google. */
  GOOGLE_ACCOUNTS_URL: z.string().url().default('https://accounts.google.com'),
  GOOGLE_OAUTH2_URL: z.string().url().default('https://oauth2.googleapis.com'),
  GOOGLE_API_URL: z.string().url().default('https://www.googleapis.com'),
  /**
   * Owner panel: the one-time setup code for /login?setup (making the software owner's account). Set it in
   * Render yourself, use it once, then delete it. Without it, or once an owner account exists, setup is closed.
   */
  OWNER_SETUP_CODE: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(12, 'OWNER_SETUP_CODE must be at least 12 characters').optional()),
  /** Browser tests only (ignored unless NODE_ENV=test): the date the plan's days left are counted from, matching the tests' frozen clock. */
  TEST_TODAY: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type Config = z.infer<typeof schema>;

let cached: Config | null = null;
export function config(): Config {
  if (!cached) {
    const r = schema.safeParse(process.env);
    if (!r.success) {
      throw new Error('Bad environment: ' + r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    }
    cached = r.data;
  }
  return cached;
}

/** Today in India; under NODE_ENV=test, TEST_TODAY when set. */
export function planToday(): string {
  const c = config();
  return c.NODE_ENV === 'test' && c.TEST_TODAY ? c.TEST_TODAY : todayIst();
}

/** Where the web app is opened (no trailing slash). */
export const appUrl = (): string => (config().APP_URL ?? config().WEB_ORIGINS.split(',')[0]!.trim()).replace(/\/+$/, '');

/** Tests change env between files. */
export function resetConfig(): void {
  cached = null;
}

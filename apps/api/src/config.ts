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

/** Tests change env between files. */
export function resetConfig(): void {
  cached = null;
}

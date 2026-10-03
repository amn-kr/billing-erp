/**
 * Demo seed: the "Sharma Electricals & Hardware" shop from the prototype, with
 * its owner Aman Kumar. Sample data lives here only — never in app code.
 *
 *   DATABASE_URL=... pnpm --filter @billing/api db:seed
 *
 * Env: DEMO_EMAIL, DEMO_PASSWORD, SEED_TODAY (YYYY-MM-DD, for repeatable
 * screenshot tests), SEED_TRIAL_DAYS (default 14; the screenshot tests pass 7 to match the prototype),
 * SEED_BUSINESS_CODE (e.g. BE-1012, the code the prototype shows).
 */
import 'reflect-metadata';
import { hash } from '@node-rs/argon2';
import { todayIst } from '@billing/shared';
import { AuditService } from '../src/common/audit.service';
import { DbService } from '../src/common/db.service';
import { BusinessesService } from '../src/modules/businesses/businesses.service';

const EMAIL = process.env.DEMO_EMAIL ?? 'aman@sharma.example.com';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'demo-password-1';

async function main() {
  const db = new DbService();
  const existing = await db.user.findUnique({ where: { email: EMAIL } });
  if (existing) {
    console.log(`Demo user ${EMAIL} already exists — nothing to do.`);
    await db.$disconnect();
    return;
  }
  const user = await db.user.create({
    data: { email: EMAIL, name: 'Aman Kumar', phone: '+91 98765 43210', passwordHash: await hash(PASSWORD, { memoryCost: 19456, timeCost: 2, parallelism: 1 }) },
  });
  const svc = new BusinessesService(db, new AuditService());
  const b = await svc.create(
    { userId: user.id, email: user.email, ip: '' },
    {
      name: 'Sharma Electricals & Hardware', owner: 'Aman Kumar', phone: '+91 98765 43210', addr: 'Shop 12, Naka Hindola',
      city: 'Lucknow', pin: '226018', state: '09', gstin: '09ABCPS4821K1Z6', inv: '1',
    },
    { today: process.env.SEED_TODAY ?? todayIst(), trialDays: Number(process.env.SEED_TRIAL_DAYS ?? 14) },
  );
  if (process.env.SEED_BUSINESS_CODE) {
    await db.scoped({ businessId: b.id, userId: user.id, email: user.email }, (tx) =>
      tx.business.update({ where: { id: b.id }, data: { code: process.env.SEED_BUSINESS_CODE } }),
    );
    b.code = process.env.SEED_BUSINESS_CODE;
    // move the shop-code counter past the fixed code, so later shops never get it again
    const want = Number(b.code.replace(/\D/g, ''));
    for (let v = 0; v < want; ) v = Number((await db.$queryRaw<{ v: bigint }[]>`SELECT nextval('business_code_seq') AS v`)[0]!.v);
  }
  console.log(`Demo shop ${b.name} (${b.code}) — sign in as ${EMAIL}`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

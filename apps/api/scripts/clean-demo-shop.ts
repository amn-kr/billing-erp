/**
 * Removes the demo shops (and the demo login) made by seed-demo-shop.ts, then gives the space back
 * to the database. Nothing else is touched: only shops with the four demo names that belong to the
 * demo login are removed, and it stops if anyone else is a member of one of them.
 *
 *   MIGRATE_DATABASE_URL=<owner connection string> \
 *   pnpm --filter @billing/api db:demo-clean
 *
 * Use db:demo-reset to clean and fill again (needs API_URL and DEMO_PASSWORD too, see seed-demo-shop.ts).
 * Why the owner connection: the app's own login may not delete (documents are never deleted in the app).
 * Row security and the backup triggers are switched off for the few seconds the delete takes, inside
 * one transaction, and switched on again before it ends; if anything fails, nothing changes.
 */
import { PrismaClient } from '@prisma/client';

const URL = process.env.MIGRATE_DATABASE_URL;
// fixed on purpose: Prisma quietly loads apps/api/.env, whose DEMO_EMAIL once named another login. To clear another
// login's demo-named shops, say so on the command line: --email=someone@example.com
const EMAIL = process.argv.find((a) => a.startsWith('--email='))?.slice(8) ?? 'demo@billing-erp.example.com';
export const DEMO_SHOP_NAMES = ['Sharma Electricals & Hardware', 'Sanjeevani Medical Store', 'Royal Fashion Point', 'Gupta Kirana & General Store'];

async function main() {
  if (!URL) throw new Error('Set MIGRATE_DATABASE_URL (the owner connection string).');
  const db = new PrismaClient({ datasourceUrl: URL });
  const size = async () => (await db.$queryRawUnsafe<{ s: string }[]>(`select pg_size_pretty(pg_database_size(current_database())) as s`))[0]!.s;
  const before = await size();

  const users = await db.$queryRawUnsafe<{ id: string }[]>(`select id from users where email = $1`, EMAIL);
  if (!users.length) {
    console.log(`No demo login (${EMAIL}) here, nothing to remove.`);
    return void (await db.$disconnect());
  }
  const userId = users[0]!.id;
  const tables = (await db.$queryRawUnsafe<{ table_name: string }[]>(
    `select c.table_name from information_schema.columns c join information_schema.tables t on t.table_name = c.table_name and t.table_schema = c.table_schema
     where c.table_schema = 'public' and c.column_name = 'business_id' and t.table_type = 'BASE TABLE' order by 1`,
  )).map((r) => r.table_name);
  console.log(`Database size before: ${before}`);

  await db.$transaction(
    async (tx) => {
      for (const t of tables) {
        await tx.$executeRawUnsafe(`ALTER TABLE "${t}" NO FORCE ROW LEVEL SECURITY`);
        await tx.$executeRawUnsafe(`ALTER TABLE "${t}" DISABLE TRIGGER USER`);
      }
      await tx.$executeRawUnsafe(`ALTER TABLE businesses NO FORCE ROW LEVEL SECURITY`);
      // (row security hides these rows from the owner login until it is switched off above)
      const shops = await tx.$queryRawUnsafe<{ id: string; name: string }[]>(
        `select b.id, b.name from businesses b join memberships m on m.business_id = b.id where m.user_id = $1::uuid and b.name = any($2::text[])`,
        userId, DEMO_SHOP_NAMES,
      );
      const ids = shops.map((x) => x.id);
      const others = await tx.$queryRawUnsafe<{ n: bigint }[]>(`select count(*) as n from memberships where business_id = any($1::uuid[]) and user_id <> $2::uuid`, ids, userId);
      if (Number(others[0]!.n) > 0) throw new Error('Someone else is a member of a demo shop. Nothing was removed.');
      console.log(`Removing ${ids.length} demo shop(s) and the login ${EMAIL}.`);
      // children first: keep trying the tables that are still blocked by another table's rows
      let left = [...tables];
      for (let round = 0; round < tables.length && left.length; round++) {
        const blocked: string[] = [];
        for (const t of left) {
          await tx.$executeRawUnsafe('SAVEPOINT s');
          try {
            if (t === 'sessions') await tx.$executeRawUnsafe(`DELETE FROM sessions WHERE business_id = ANY($1::uuid[]) OR user_id = $2::uuid`, ids, userId);
            else await tx.$executeRawUnsafe(`DELETE FROM "${t}" WHERE business_id = ANY($1::uuid[])`, ids);
            await tx.$executeRawUnsafe('RELEASE SAVEPOINT s');
          } catch {
            await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT s');
            blocked.push(t);
          }
        }
        if (blocked.length === left.length) throw new Error(`Could not remove rows of: ${blocked.join(', ')}`);
        left = blocked;
      }
      await tx.$executeRawUnsafe(`DELETE FROM businesses WHERE id = ANY($1::uuid[])`, ids);
      await tx.$executeRawUnsafe(`DELETE FROM password_resets WHERE user_id = $1::uuid`, userId);
      await tx.$executeRawUnsafe(`DELETE FROM recovery_codes WHERE user_id = $1::uuid`, userId);
      await tx.$executeRawUnsafe(`DELETE FROM users WHERE id = $1::uuid`, userId);
      await tx.$executeRawUnsafe(`ALTER TABLE businesses FORCE ROW LEVEL SECURITY`);
      for (const t of tables) {
        await tx.$executeRawUnsafe(`ALTER TABLE "${t}" ENABLE TRIGGER USER`);
        await tx.$executeRawUnsafe(`ALTER TABLE "${t}" FORCE ROW LEVEL SECURITY`);
      }
    },
    { timeout: 120_000, maxWait: 30_000 },
  );

  // give the space back to the database (one table at a time; each is locked only for a moment)
  for (const t of [...tables, 'users']) await db.$executeRawUnsafe(`VACUUM FULL "${t}"`);
  console.log(`Done. Database size after: ${await size()}`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

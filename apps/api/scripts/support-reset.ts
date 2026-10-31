/**
 * Support reset: a temporary password for someone who can't sign in, after their identity was checked
 * (the steps are kept in the private backups repository). Nobody edits the database by hand.
 *
 *   pnpm --filter @billing/api support:reset -- --email owner@shop.in                          shows information only
 *   pnpm --filter @billing/api support:reset -- --email owner@shop.in --ticket T-12 --confirm  makes the temporary password
 *
 * Without --confirm nothing is changed. The temporary password is printed once and never saved; it
 * works for 48 hours and only to choose a new password. Every sign-in of that person ends, and each of
 * their shops' activity log gets "password reset by support" with the ticket.
 *
 * DATABASE_URL must be the app role (erp_app), so row-level security applies. A database that is not on
 * this computer is refused unless --live is also given: only the shop owner decides that.
 */
import 'reflect-metadata';
import { AuditService } from '../src/common/audit.service';
import { DbService } from '../src/common/db.service';
import { issueTempPassword } from '../src/modules/members/temp-password';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes('--' + name);
const LOCAL = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '—');

async function main() {
  const email = arg('email')?.trim().toLowerCase();
  const ticket = arg('ticket')?.trim();
  const confirm = flag('confirm');
  if (!email) throw new Error('Usage: --email <email> [--ticket <note number> --confirm] [--live]');
  if (confirm && !ticket) throw new Error('--confirm needs --ticket <note number> (where the identity checks are written down).');

  let host = '';
  try {
    host = new URL(process.env.DATABASE_URL ?? '').hostname;
  } catch {
    throw new Error('DATABASE_URL is missing or not a database address.');
  }
  if (!LOCAL.has(host) && !flag('live')) throw new Error(`Refused: the database at ${host} is not on this computer. Only the shop owner decides when this runs on the live database (then add --live).`);

  const db = new DbService();
  try {
    const user = await db.user.findUnique({ where: { email } });
    if (!user) throw new Error(`No account with the email ${email}. Nothing was changed.`);
    const shops = await db.scoped({ userId: user.id, email }, (tx) =>
      tx.membership.findMany({ where: { userId: user.id }, include: { business: true, role: true }, orderBy: { createdAt: 'asc' } }),
    );
    const active = shops.filter((m) => m.status === 'active');

    console.log(`Database:     ${host}${LOCAL.has(host) ? ' (this computer)' : ' (LIVE)'}`);
    console.log(`Account:      ${user.name || '(no name)'} <${user.email}>`);
    console.log(`Created:      ${day(user.createdAt)}`);
    console.log(`Last sign-in: ${day(user.lastLoginAt)}`);
    if (user.mustChangePassword) console.log(`Waiting:      a temporary password is already out, valid until ${day(user.tempPasswordExpiresAt)}`);
    console.log(`Shops:        ${shops.length ? '' : 'none'}`);
    for (const m of shops) {
      const b = m.business;
      console.log(`  - ${b.name} (${b.code}) · ${m.role.name}${m.status === 'active' ? '' : ' · removed'}`);
      console.log(`    GSTIN ${b.gstin || '—'} · ${b.city || '—'} · phone on file ${b.phone || '—'}`);
    }

    if (!confirm) {
      console.log('\nInformation only — nothing was changed. After the identity checks, run again with --ticket <note number> --confirm.');
      return;
    }

    const t = await db.scoped({ userId: user.id, email }, async (tx) => {
      const out = await issueTempPassword(tx, user.id);
      const audit = new AuditService();
      for (const m of active) {
        await tx.$queryRaw`SELECT set_config('app.business_id', ${m.businessId}, true)`;
        await audit.log(tx, { businessId: m.businessId, userId: null, action: 'reset_password', entity: 'user', entityId: user.id, after: { by: 'support', ticket, expiresAt: out.expiresAt }, ip: 'support' });
      }
      return out;
    });
    console.log(`\nTemporary password (read it out on the call-back only; it is not saved anywhere):\n\n    ${t.temporaryPassword}\n`);
    console.log(`Valid until ${day(t.expiresAt)}. They must choose a new password when they sign in. All their sign-ins have ended.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e: Error) => {
  console.error(e.message ?? e);
  process.exit(1);
});

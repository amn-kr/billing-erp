import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { money, todayIst, toDb, type Money, type PartyInput, DEFAULT_PARTY_GROUPS } from '@billing/shared';
import type { Prisma } from '@prisma/client';
import { DbService, type Tx } from '../../common/db.service';
import { AuditService } from '../../common/audit.service';
import { LedgerService } from '../../common/ledger.service';
import type { RequestContext } from '../../common/context';
import { day, isoOf, namedId, uniqueMessage } from '../../common/lookups';

const include = { group: true, addresses: true, contacts: true } satisfies Prisma.PartyInclude;
type Row = Prisma.PartyGetPayload<{ include: typeof include }>;

/** What the API sends for a party. Balance comes from the books (opening + live entries) when given. */
export function partyView(p: Row, bal?: Money) {
  const billing = p.addresses.find((a) => a.kind === 'billing');
  const shipping = p.addresses.find((a) => a.kind === 'shipping');
  const ob = money(p.openingBalance.toString());
  return {
    id: p.id, name: p.name, billingName: p.billingName, kind: p.kind, group: p.group?.name ?? '', phone: p.phone, email: p.email, gstin: p.gstin, gstType: p.gstType,
    state: p.stateCode, creditLimit: p.creditLimit ? toDb(p.creditLimit.toString()) : null, creditDays: p.creditDays,
    openingBalance: toDb(ob), openingType: p.openingType, openingDate: isoOf(p.openingDate),
    /** + they owe us (receivable), − we owe them (payable) */
    balance: toDb(bal ?? (p.openingType === 'pay' ? ob.neg() : ob)),
    billing: billing ? { line: billing.line, city: billing.city, pin: billing.pin, state: billing.stateCode } : null,
    shipping: shipping?.line ?? '',
    contacts: p.contacts.map((c) => ({ label: c.label, value: c.value })),
    archived: !!p.archivedAt, createdAt: p.createdAt,
  };
}

@Injectable()
export class PartiesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
  ) {}

  private scope(ctx: RequestContext) {
    return { businessId: ctx.businessId, userId: ctx.userId, email: ctx.email };
  }

  list(ctx: RequestContext, q: { search?: string; kind?: string; group?: string; archived?: boolean }) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const s = q.search?.trim();
      const rows = await tx.party.findMany({
        where: {
          archivedAt: q.archived ? { not: null } : null,
          ...(q.kind === 'customer' || q.kind === 'supplier' ? { kind: q.kind } : {}),
          ...(q.group ? { group: { name: q.group } } : {}),
          ...(s ? { OR: [{ name: { contains: s, mode: 'insensitive' } }, { phone: { contains: s } }, { gstin: { contains: s.toUpperCase() } }] } : {}),
        },
        include,
        orderBy: [{ createdAt: 'asc' }, { name: 'asc' }],
      });
      const bal = await this.ledger.partyBalances(tx, rows.map((r) => r.id));
      return rows.map((r) => partyView(r, bal.get(r.id)));
    });
  }

  get(ctx: RequestContext, id: string) {
    return this.db.scoped(this.scope(ctx), async (tx) => partyView(await this.find(tx, id), (await this.ledger.partyBalances(tx, [id])).get(id)));
  }

  private async find(tx: Tx, id: string) {
    const p = await tx.party.findFirst({ where: { id }, include });
    if (!p) throw new NotFoundException({ message: 'That party was not found.' });
    return p;
  }

  private fields(input: Partial<PartyInput>) {
    const ob = input.openingBalance;
    return {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.billingName !== undefined && { billingName: input.billingName }),
      ...(input.kind !== undefined && { kind: input.kind }),
      ...(input.phone !== undefined && { phone: input.phone }),
      ...(input.email !== undefined && { email: input.email }),
      ...(input.gstin !== undefined && { gstin: input.gstin }),
      ...(input.gstType !== undefined && { gstType: input.gstType }),
      ...(input.state !== undefined && { stateCode: input.state }),
      ...(input.creditLimit !== undefined && { creditLimit: input.creditLimit === null ? null : toDb(input.creditLimit) }),
      ...(input.creditDays !== undefined && { creditDays: input.creditDays }),
      ...(ob !== undefined && { openingBalance: ob === null ? '0' : toDb(ob) }),
      ...(input.openingType !== undefined && { openingType: input.openingType }),
      ...(input.openingDate !== undefined && { openingDate: day(input.openingDate) }),
    };
  }

  private async writeAddresses(tx: Tx, ctx: RequestContext, partyId: string, input: Partial<PartyInput>) {
    const base = { businessId: ctx.businessId!, partyId, createdBy: ctx.userId };
    if (input.billing) {
      const b = { line: input.billing.line, city: input.billing.city, pin: input.billing.pin, stateCode: input.billing.state };
      await tx.partyAddress.upsert({ where: { partyId_kind: { partyId, kind: 'billing' } }, create: { ...base, kind: 'billing', ...b }, update: b });
    }
    if (input.shipping !== undefined) {
      await tx.partyAddress.upsert({ where: { partyId_kind: { partyId, kind: 'shipping' } }, create: { ...base, kind: 'shipping', line: input.shipping }, update: { line: input.shipping } });
    }
    if (input.contacts) {
      // contacts are replaced as a set; old ones are kept as history by the audit log
      await tx.partyContact.updateMany({ where: { partyId }, data: { value: '' } });
      const existing = await tx.partyContact.findMany({ where: { partyId } });
      for (const c of input.contacts) {
        const hit = existing.find((e) => e.label === c.label);
        if (hit) await tx.partyContact.update({ where: { id: hit.id }, data: { value: c.value } });
        else await tx.partyContact.create({ data: { ...base, label: c.label, value: c.value } });
      }
    }
  }

  /**
   * Adds one party inside the caller's transaction: the party, its opening balance, addresses,
   * contacts and the audit entry. Add party and Import Parties both save through here.
   * `note` is added to the audit entry (e.g. which import row it came from).
   */
  async insert(tx: Tx, ctx: RequestContext, input: PartyInput, note?: Record<string, unknown>) {
    const groupId = await namedId(tx, 'partyGroup', ctx.businessId!, ctx.userId, input.group || 'General');
    const hasOb = !!input.openingBalance && money(input.openingBalance).gt(0);
    const p = await tx.party.create({
      data: {
        businessId: ctx.businessId!, createdBy: ctx.userId, groupId, ...this.fields(input), name: input.name, kind: input.kind,
        openingType: input.openingType ?? (input.kind === 'supplier' ? 'pay' : 'receive'),
        openingDate: hasOb ? day(input.openingDate ?? todayIst()) : null,
      },
    });
    await this.writeAddresses(tx, ctx, p.id, input);
    const full = partyView(await this.find(tx, p.id));
    await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'create', entity: 'party', entityId: p.id, after: { ...full, ...note }, ip: ctx.ip });
    return full;
  }

  async create(ctx: RequestContext, input: PartyInput) {
    try {
      return await this.db.scoped(this.scope(ctx), (tx) => this.insert(tx, ctx, input));
    } catch (e) {
      const m = uniqueMessage(e);
      if (m) throw new ConflictException({ message: m, field: 'name' });
      throw e;
    }
  }

  async update(ctx: RequestContext, id: string, input: Partial<PartyInput>) {
    try {
      return await this.db.scoped(this.scope(ctx), async (tx) => {
        const before = partyView(await this.find(tx, id));
        const groupId = input.group !== undefined ? await namedId(tx, 'partyGroup', ctx.businessId!, ctx.userId, input.group || 'General') : undefined;
        await tx.party.update({ where: { id }, data: { ...this.fields(input), ...(groupId !== undefined && { groupId }) } });
        await this.writeAddresses(tx, ctx, id, input);
        const after = partyView(await this.find(tx, id));
        await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'update', entity: 'party', entityId: id, before, after, ip: ctx.ip });
        return after;
      });
    } catch (e) {
      const m = uniqueMessage(e);
      if (m) throw new ConflictException({ message: m, field: 'name' });
      throw e;
    }
  }

  /** Parties are never deleted: archived ones disappear from lists and pickers but keep their history. */
  setArchived(ctx: RequestContext, id: string, archived: boolean) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const p = await this.find(tx, id);
      if (archived === !!p.archivedAt) return partyView(p);
      try {
        await tx.party.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
      } catch (e) {
        if (uniqueMessage(e)) throw new ConflictException({ message: 'A party with this name already exists. Rename one of them first.' });
        throw e;
      }
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: archived ? 'cancel' : 'update', entity: 'party', entityId: id, before: { archived: !archived }, after: { archived }, ip: ctx.ip });
      return partyView(await this.find(tx, id));
    });
  }

  groups(ctx: RequestContext) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const gs = await tx.partyGroup.findMany({ where: { archivedAt: null }, include: { _count: { select: { parties: { where: { archivedAt: null } } } } }, orderBy: { createdAt: 'asc' } });
      // the prototype's built-in groups first, in its order (rows made together share a timestamp), then your own by date added
      const order = (n: string) => { const k = (DEFAULT_PARTY_GROUPS as readonly string[]).indexOf(n); return k < 0 ? 999 : k; };
      gs.sort((a, b) => order(a.name) - order(b.name) || a.createdAt.getTime() - b.createdAt.getTime() || a.name.localeCompare(b.name));
      return gs.map((g) => ({ id: g.id, name: g.name, parties: g._count.parties }));
    });
  }

  addGroup(ctx: RequestContext, name: string) {
    return this.db.scoped(this.scope(ctx), async (tx) => {
      const id = await namedId(tx, 'partyGroup', ctx.businessId!, ctx.userId, name);
      await this.audit.log(tx, { businessId: ctx.businessId!, userId: ctx.userId, action: 'create', entity: 'party_group', entityId: id, after: { name }, ip: ctx.ip });
      return { id, name };
    });
  }
}

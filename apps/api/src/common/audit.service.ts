import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Tx } from './db.service';

export interface AuditEntry {
  businessId: string;
  userId: string | null;
  action: 'create' | 'update' | 'cancel' | 'sign_in' | 'invite' | 'revoke_invite' | 'join' | 'role_change' | 'remove_member' | 'switch_business';
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string;
}

const json = (v: unknown) => (v === undefined || v === null ? Prisma.DbNull : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue));

/** Writes to audit_log inside the caller's transaction, so the change and its record commit together. */
@Injectable()
export class AuditService {
  async log(tx: Tx, e: AuditEntry): Promise<void> {
    await tx.auditLog.create({
      data: {
        businessId: e.businessId,
        userId: e.userId,
        action: e.action,
        entity: e.entity,
        entityId: e.entityId ?? null,
        before: json(e.before),
        after: json(e.after),
        ip: e.ip ?? '',
      },
    });
  }

  /** Many entries at once (imports), 500 per insert. */
  async logMany(tx: Tx, entries: AuditEntry[]): Promise<void> {
    for (let i = 0; i < entries.length; i += 500) {
      await tx.auditLog.createMany({
        data: entries.slice(i, i + 500).map((e) => ({ businessId: e.businessId, userId: e.userId, action: e.action, entity: e.entity, entityId: e.entityId ?? null, before: json(e.before), after: json(e.after), ip: e.ip ?? '' })),
      });
    }
  }
}

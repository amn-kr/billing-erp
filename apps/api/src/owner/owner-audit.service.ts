import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Tx } from '../common/db.service';
import { DbService } from '../common/db.service';

export interface OwnerAuditEntry {
  adminId: string | null;
  action: 'setup' | 'sign_in' | 'sign_in_failed' | 'locked' | 'sign_out' | 'suspend' | 'reactivate';
  businessId?: string | null;
  entity: 'super_admin' | 'business';
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string;
}

const json = (v: unknown) => (v === undefined || v === null ? Prisma.DbNull : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue));

/** Writes to owner_audit_log (append-only), inside the caller's transaction when there is one. */
@Injectable()
export class OwnerAuditService {
  constructor(private readonly db: DbService) {}

  async log(e: OwnerAuditEntry, tx?: Tx): Promise<void> {
    await (tx ?? this.db).ownerAuditLog.create({
      data: { adminId: e.adminId, action: e.action, businessId: e.businessId ?? null, entity: e.entity, entityId: e.entityId ?? null, before: json(e.before), after: json(e.after), ip: e.ip ?? '' },
    });
  }
}

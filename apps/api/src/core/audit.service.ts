import { Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import type { AuditCategory } from '@ananda/shared';
import { InjectDb, type Db, type DbOrTx } from '../db/db.module';
import { auditLog } from '../db/schema';
import type { AuthContext } from '../common/context';

export interface AuditEntry {
  category: AuditCategory;
  action: string;
  recordType?: string;
  recordId?: string;
  recordLabel?: string;
  /** Before → after per field; money fields are kept for the "money only" filter. */
  changes?: Record<string, { from: unknown; to: unknown }>;
  money?: boolean;
  meta?: Record<string, unknown>;
}

/** How long a one-tap action can be taken back (Undo on the toast, and from Overview for decisions). */
export const UNDO_MINUTES = 30;

/** Every write creates a permanent entry (FR-ADM-2). Pass the transaction so it commits with the change. */
@Injectable()
export class AuditService {
  constructor(@InjectDb() private readonly db: Db) {}

  async log(actor: AuthContext | { id: string | null; name: string } | null, entry: AuditEntry, tx: DbOrTx = this.db) {
    const who = actor && 'user' in actor ? { id: actor.user.id, name: actor.user.name } : actor;
    await tx.insert(auditLog).values({
      actorId: who?.id ?? null,
      actorName: who?.name ?? 'System',
      category: entry.category,
      action: entry.action,
      recordType: entry.recordType,
      recordId: entry.recordId,
      recordLabel: entry.recordLabel,
      changes: entry.changes,
      money: entry.money ?? false,
      meta: entry.meta,
    });
  }

  /**
   * The newest entry for a record. An Undo uses it to refuse when anything else happened to the record
   * after the action it takes back, and to read the "before" values it puts back.
   */
  async latest(recordType: string, recordId: string, tx: DbOrTx = this.db) {
    const [row] = await tx.select().from(auditLog).where(and(eq(auditLog.recordType, recordType), eq(auditLog.recordId, recordId))).orderBy(desc(auditLog.at)).limit(1);
    return row;
  }
}

/** Builds before → after pairs for the fields that changed. */
export function diff<T extends Record<string, unknown>>(before: Partial<T>, after: Partial<T>, keys: (keyof T)[]) {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of keys) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) out[String(k)] = { from: before[k] ?? null, to: after[k] ?? null };
  }
  return out;
}

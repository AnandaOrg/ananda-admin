import { Injectable } from '@nestjs/common';
import { and, desc, eq, gte, ilike, inArray, isNotNull, lt, or, sql } from 'drizzle-orm';
import { AUDIT_CATEGORIES, type AuditCategory } from '@ananda/shared';
import { InjectDb, type Db } from '../db/db.module';
import { auditLog } from '../db/schema';
import { periodOf } from '../core/figures.service';

export interface AuditQuery {
  category?: string;
  period?: string;
  from?: string;
  to?: string;
  actorId?: string;
  money?: string;
  q?: string;
  before?: string;
  limit?: string;
}

/** Read-only view of the append-only audit log (FR-ADM-2). */
@Injectable()
export class AuditLogService {
  constructor(@InjectDb() private readonly db: Db) {}

  private where(q: AuditQuery) {
    const cats = (q.category ?? '')
      .split(',')
      .map((c) => c.trim())
      .filter((c): c is AuditCategory => (AUDIT_CATEGORIES as readonly string[]).includes(c));
    const p = q.period && q.period !== 'any' ? periodOf(q.period, q.from, q.to) : null;
    const term = q.q?.trim();
    return and(
      cats.length ? inArray(auditLog.category, cats) : undefined,
      p ? and(gte(auditLog.at, p.from), lt(auditLog.at, p.to)) : undefined,
      q.actorId ? eq(auditLog.actorId, q.actorId) : undefined,
      q.money === '1' || q.money === 'true' ? eq(auditLog.money, true) : undefined,
      term
        ? or(
            ilike(auditLog.action, `%${term.replace(/\s+/g, '_')}%`),
            ilike(auditLog.recordLabel, `%${term}%`),
            ilike(auditLog.actorName, `%${term}%`),
            ilike(auditLog.recordId, `%${term}%`),
            sql`${auditLog.meta}::text ilike ${'%' + term + '%'}`,
          )
        : undefined,
    );
  }

  async list(q: AuditQuery) {
    const limit = Math.min(Math.max(Number(q.limit) || 100, 1), 500);
    const before = q.before ? new Date(q.before) : null;
    const where = this.where(q);
    const rows = await this.db
      .select()
      .from(auditLog)
      .where(and(where, before && !Number.isNaN(before.getTime()) ? lt(auditLog.at, before) : undefined))
      .orderBy(desc(auditLog.at), desc(auditLog.id))
      .limit(limit + 1);
    const [{ total }] = await this.db.select({ total: sql<number>`count(*)::int` }).from(auditLog).where(where);
    const items = rows.slice(0, limit);
    return { items, total: Number(total), next: rows.length > limit ? items[items.length - 1].at.toISOString() : null };
  }

  async exportRows(q: AuditQuery) {
    return this.db.select().from(auditLog).where(this.where(q)).orderBy(desc(auditLog.at)).limit(20_000);
  }

  async people() {
    const rows = await this.db
      .selectDistinctOn([auditLog.actorId], { id: auditLog.actorId, name: auditLog.actorName })
      .from(auditLog)
      .where(isNotNull(auditLog.actorId))
      .orderBy(auditLog.actorId, desc(auditLog.at));
    return rows.filter((r) => r.id).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }

  async counts() {
    const rows = await this.db.select({ category: auditLog.category, n: sql<number>`count(*)::int` }).from(auditLog).groupBy(auditLog.category);
    return Object.fromEntries(rows.map((r) => [r.category, Number(r.n)]));
  }
}

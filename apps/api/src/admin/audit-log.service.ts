import { Injectable } from '@nestjs/common';
import { and, desc, eq, getTableColumns, gte, ilike, inArray, isNotNull, lt, or, sql } from 'drizzle-orm';
import { AUDIT_CATEGORIES, type AuditCategory } from '@ananda/shared';
import { InjectDb, type Db } from '../db/db.module';
import { auditLog, customers, documents, orders, roles, sessions, users } from '../db/schema';
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  /** Entries with the person's role, the customer behind an order or document, and the device for sign-ins. */
  private async enrich(where: ReturnType<AuditLogService['where']>, extra: ReturnType<typeof and> | undefined, limit: number) {
    const rows = await this.db
      .select({ ...getTableColumns(auditLog), actorRoleKey: roles.key, actorRoleName: roles.name, actorRoleSystem: roles.isSystem })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorId))
      .leftJoin(roles, eq(roles.id, users.roleId))
      .where(and(where, extra))
      .orderBy(desc(auditLog.at), desc(auditLog.id))
      .limit(limit);

    const ids = (type: string) => [...new Set(rows.filter((r) => r.recordType === type && r.recordId && UUID.test(r.recordId)).map((r) => r.recordId!))];
    const orderIds = ids('order');
    const docIds = ids('document');
    const [orderRows, docRows] = await Promise.all([
      orderIds.length ? this.db.select({ id: orders.id, customer: customers.companyName }).from(orders).leftJoin(customers, eq(customers.id, orders.customerId)).where(inArray(orders.id, orderIds)) : [],
      docIds.length
        ? this.db.select({ id: documents.id, order: orders.number, customer: customers.companyName }).from(documents).leftJoin(orders, eq(orders.id, documents.orderId)).leftJoin(customers, eq(customers.id, documents.customerId)).where(inArray(documents.id, docIds))
        : [],
    ]);
    const orderCustomer = new Map(orderRows.map((o) => [o.id, o.customer]));
    const docInfo = new Map(docRows.map((d) => [d.id, d]));

    // A sign-in opens a session at the same moment; its browser and address tell where it came from.
    const signIns = rows.filter((r) => r.action === 'signed_in' && r.actorId);
    let sess: { userId: string; userAgent: string | null; ip: string | null; device: string; createdAt: Date }[] = [];
    if (signIns.length) {
      const times = signIns.map((r) => r.at.getTime());
      sess = await this.db
        .select({ userId: sessions.userId, userAgent: sessions.userAgent, ip: sessions.ip, device: sessions.device, createdAt: sessions.createdAt })
        .from(sessions)
        .where(and(inArray(sessions.userId, [...new Set(signIns.map((r) => r.actorId!))]), gte(sessions.createdAt, new Date(Math.min(...times) - 10_000)), lt(sessions.createdAt, new Date(Math.max(...times) + 10_000))));
    }

    return rows.map(({ actorRoleKey, actorRoleName, actorRoleSystem, ...r }) => {
      const doc = r.recordType === 'document' && r.recordId ? docInfo.get(r.recordId) : undefined;
      const s = r.action === 'signed_in' ? sess.filter((x) => x.userId === r.actorId).sort((a, b) => Math.abs(a.createdAt.getTime() - r.at.getTime()) - Math.abs(b.createdAt.getTime() - r.at.getTime()))[0] : undefined;
      return {
        ...r,
        actorRole: actorRoleKey ? { key: actorRoleKey, name: actorRoleName, isSystem: !!actorRoleSystem } : null,
        customerName: (r.recordType === 'order' && r.recordId ? orderCustomer.get(r.recordId) : doc?.customer) ?? null,
        orderNumber: doc?.order ?? null,
        device: s && Math.abs(s.createdAt.getTime() - r.at.getTime()) < 10_000 ? { kind: s.device, userAgent: s.userAgent, ip: s.ip } : null,
      };
    });
  }

  async list(q: AuditQuery) {
    const limit = Math.min(Math.max(Number(q.limit) || 100, 1), 500);
    const before = q.before ? new Date(q.before) : null;
    const where = this.where(q);
    const rows = await this.enrich(where, before && !Number.isNaN(before.getTime()) ? lt(auditLog.at, before) : undefined, limit + 1);
    const [{ total }] = await this.db.select({ total: sql<number>`count(*)::int` }).from(auditLog).where(where);
    const items = rows.slice(0, limit);
    return { items, total: Number(total), next: rows.length > limit ? items[items.length - 1].at.toISOString() : null };
  }

  async exportRows(q: AuditQuery) {
    return this.enrich(this.where(q), undefined, 20_000);
  }

  /** Everyone who appears in the log, with their current role. */
  async people() {
    const rows = await this.db
      .selectDistinctOn([auditLog.actorId], { id: auditLog.actorId, name: auditLog.actorName, roleKey: roles.key, roleName: roles.name, roleSystem: roles.isSystem })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorId))
      .leftJoin(roles, eq(roles.id, users.roleId))
      .where(isNotNull(auditLog.actorId))
      .orderBy(auditLog.actorId, desc(auditLog.at));
    return rows
      .filter((r) => r.id)
      .map(({ roleKey, roleName, roleSystem, ...r }) => ({ ...r, role: roleKey ? { key: roleKey, name: roleName, isSystem: !!roleSystem } : null }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }

  /** Counts per category within the date and person filters, so the chips match what the table can show. */
  async counts(q: AuditQuery = {}) {
    const base = this.where({ period: q.period, from: q.from, to: q.to, actorId: q.actorId, money: q.money, q: q.q });
    const rows = await this.db.select({ category: auditLog.category, n: sql<number>`count(*)::int` }).from(auditLog).where(base).groupBy(auditLog.category);
    const [{ all }] = await this.db.select({ all: sql<number>`count(*)::int` }).from(auditLog);
    return { ...Object.fromEntries(rows.map((r) => [r.category, Number(r.n)])), _all: Number(all) };
  }
}

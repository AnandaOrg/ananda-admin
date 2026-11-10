import { Injectable } from '@nestjs/common';
import { and, eq, gte, inArray, lt, notInArray, sql, type SQL } from 'drizzle-orm';
import { isoDate } from '@ananda/shared';
import { InjectDb, type Db } from '../db/db.module';
import { documents, orders } from '../db/schema';

export interface Period {
  from: Date;
  to: Date;
}

export function periodOf(kind: string | undefined, from?: string, to?: string, now = new Date()): Period {
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (kind) {
    case 'this_month':
      return { from: new Date(y, m, 1), to: new Date(y, m + 1, 1) };
    case 'last_month':
      return { from: new Date(y, m - 1, 1), to: new Date(y, m, 1) };
    case 'last_year':
      return { from: new Date(y - 1, 0, 1), to: new Date(y, 0, 1) };
    case 'last_12_months':
      return { from: new Date(y, m - 11, 1), to: new Date(y, m + 1, 1) };
    case 'custom':
      if (from && to) {
        const day = (v: string) => {
          const [yy, mm, dd] = v.split('-').map(Number);
          return new Date(yy, mm - 1, dd);
        };
        const end = day(to);
        end.setDate(end.getDate() + 1);
        return { from: day(from), to: end };
      }
      return { from: new Date(y, 0, 1), to: new Date(y + 1, 0, 1) };
    case 'this_year':
    default:
      return { from: new Date(y, 0, 1), to: new Date(y + 1, 0, 1) };
  }
}

/** Unpaid share of an order (incl. VAT), net of credit notes. */
export const outstandingSql = sql<number>`greatest(${orders.totalCents} - ${orders.paidCents} - ${orders.creditedCents}, 0)`;
/** Statuses in which a payment request has gone out and money can still be owed. */
export const OWED_STATUSES = ['payment_to_confirm', 'waiting_for_stock', 'ready_to_send', 'at_warehouse', 'delivered', 'delivered_part', 'invoiced'] as const;

/**
 * Each headline figure has exactly one definition, used by every screen (PRD §1.2, §7.2).
 * `agentId` limits the figure to one agent's records (record scope).
 */
@Injectable()
export class FiguresService {
  constructor(@InjectDb() private readonly db: Db) {}

  private agentCond(agentId: string | null): SQL | undefined {
    return agentId ? eq(orders.agentId, agentId) : undefined;
  }

  /** Owed to us = all unpaid customer amounts; "late" = past the payment due date. Same on Home and Collections. */
  async owed(agentId: string | null) {
    const today = isoDate();
    const weekEnd = isoDate(new Date(Date.now() + 7 * 86_400_000));
    const [row] = await this.db
      .select({
        totalCents: sql<number>`coalesce(sum(${outstandingSql}), 0)::int`,
        count: sql<number>`count(*) filter (where ${outstandingSql} > 0)::int`,
        lateCents: sql<number>`coalesce(sum(${outstandingSql}) filter (where ${orders.paymentDueOn} < ${today}), 0)::int`,
        lateCount: sql<number>`count(*) filter (where ${orders.paymentDueOn} < ${today} and ${outstandingSql} > 0)::int`,
        oldestDue: sql<string | null>`min(${orders.paymentDueOn}) filter (where ${outstandingSql} > 0)::text`,
        dueWeekCents: sql<number>`coalesce(sum(${outstandingSql}) filter (where ${orders.paymentDueOn} >= ${today} and ${orders.paymentDueOn} <= ${weekEnd}), 0)::int`,
        dueWeekCount: sql<number>`count(*) filter (where ${orders.paymentDueOn} >= ${today} and ${orders.paymentDueOn} <= ${weekEnd} and ${outstandingSql} > 0)::int`,
      })
      .from(orders)
      .where(and(inArray(orders.status, [...OWED_STATUSES]), this.agentCond(agentId)));
    const oldestDays = row.oldestDue ? Math.max(0, Math.floor((Date.now() - new Date(row.oldestDue).getTime()) / 86_400_000)) : 0;
    return { ...row, oldestLateDays: row.lateCount > 0 ? oldestDays : 0 };
  }

  /** Net sales excl. VAT of orders paid in full in the period, less credit notes issued in it (B2). */
  async netSales(period: Period, agentId: string | null) {
    const [paid] = await this.db
      .select({ cents: sql<number>`coalesce(sum(${orders.netCents}), 0)::int`, count: sql<number>`count(*)::int`, units: sql<number>`coalesce(sum(${orders.totalUnits}), 0)::int` })
      .from(orders)
      .where(and(gte(orders.paidAt, period.from), lt(orders.paidAt, period.to), notInArray(orders.status, ['cancelled', 'draft']), this.agentCond(agentId)));
    const [credit] = await this.db
      .select({ cents: sql<number>`coalesce(sum((${documents.data}->>'netCents')::int), 0)::int` })
      .from(documents)
      .innerJoin(orders, eq(orders.id, documents.orderId))
      .where(and(eq(documents.type, 'credit_note'), gte(documents.createdAt, period.from), lt(documents.createdAt, period.to), this.agentCond(agentId)));
    return { cents: Number(paid.cents) - Number(credit.cents), count: Number(paid.count), units: Number(paid.units) };
  }

  /** Payment requests sent this month that are not paid yet: "€X could close". */
  async couldClose(period: Period, agentId: string | null) {
    const [row] = await this.db
      .select({ cents: sql<number>`coalesce(sum(${orders.netCents}), 0)::int`, count: sql<number>`count(*)::int` })
      .from(orders)
      .where(and(eq(orders.status, 'payment_to_confirm'), gte(orders.requestSentAt, period.from), lt(orders.requestSentAt, period.to), this.agentCond(agentId)));
    return row;
  }

  /** Deal profit = net sales − purchase cost − commission, counted once on the date paid in full. */
  async dealProfit(period: Period, agentId: string | null) {
    const [row] = await this.db
      .select({
        netCents: sql<number>`coalesce(sum(${orders.netCents}), 0)::int`,
        purchaseCostCents: sql<number>`coalesce(sum(${orders.purchaseCostCents}), 0)::int`,
        commissionCents: sql<number>`coalesce(sum(${orders.commissionCents}), 0)::int`,
        units: sql<number>`coalesce(sum(${orders.totalUnits}), 0)::int`,
        deals: sql<number>`count(*)::int`,
      })
      .from(orders)
      .where(and(gte(orders.paidAt, period.from), lt(orders.paidAt, period.to), notInArray(orders.status, ['cancelled', 'draft']), this.agentCond(agentId)));
    const [credit] = await this.db
      .select({
        netCents: sql<number>`coalesce(sum((${documents.data}->>'netCents')::int), 0)::int`,
        costCents: sql<number>`coalesce(sum((${documents.data}->>'costCents')::int), 0)::int`,
        commissionCents: sql<number>`coalesce(sum((${documents.data}->>'commissionCents')::int), 0)::int`,
      })
      .from(documents)
      .innerJoin(orders, eq(orders.id, documents.orderId))
      .where(and(eq(documents.type, 'credit_note'), gte(documents.createdAt, period.from), lt(documents.createdAt, period.to), this.agentCond(agentId)));
    const netCents = Number(row.netCents) - Number(credit.netCents);
    const purchaseCostCents = Number(row.purchaseCostCents) - Number(credit.costCents);
    const commissionCents = Number(row.commissionCents) - Number(credit.commissionCents);
    return {
      netCents,
      purchaseCostCents,
      commissionCents,
      profitCents: netCents - purchaseCostCents - commissionCents,
      grossCents: netCents - purchaseCostCents,
      units: Number(row.units),
      deals: Number(row.deals),
    };
  }
}

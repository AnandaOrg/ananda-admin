import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, lt, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import { addDays, addMonths, isoDate, type CustomerInput } from '@ananda/shared';
import { InjectDb, type Db } from '../db/db.module';
import { approvalRequests, auditLog, customerContacts, customers, documents, orders, payments, users } from '../db/schema';
import { AuditService, diff } from '../core/audit.service';
import { NotifyService } from '../core/notify.service';
import { SettingsService } from '../core/settings.service';
import { outstandingSql } from '../core/figures.service';
import { customerScope } from '../core/scope';
import type { AuthContext } from '../common/context';

type CustomerRow = typeof customers.$inferSelect;

/** Derived state shown in lists: Late while an invoice is overdue; Free to claim after ownership ends. */
function displayStatus(c: CustomerRow, lateCents: number, today: string, freeAtEnd = true) {
  if (c.status !== 'active') return c.status;
  if (lateCents > 0) return 'late';
  if (freeAtEnd && c.ownedUntil && c.ownedUntil < today) return 'free_to_claim';
  return 'active';
}

@Injectable()
export class CustomersService {
  private readonly log = new Logger(CustomersService.name);

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly notify: NotifyService,
    private readonly settings: SettingsService,
  ) {}

  private owesSql = sql<number>`coalesce((select sum(${outstandingSql}) from ${orders} where ${orders.customerId} = ${customers.id} and ${orders.status} not in ('draft','cancelled')), 0)::int`;
  private lateSql = sql<number>`coalesce((select sum(${outstandingSql}) from ${orders} where ${orders.customerId} = ${customers.id} and ${orders.status} not in ('draft','cancelled') and ${orders.paymentDueOn} < current_date), 0)::int`;
  private lastOrderSql = sql<string | null>`(select max(${orders.requestSentAt})::text from ${orders} where ${orders.customerId} = ${customers.id} and ${orders.status} <> 'draft')`;

  async list(auth: AuthContext, q: { filter?: string; q?: string; agentId?: string }) {
    const today = isoDate();
    const base: SQL[] = [];
    const scope = customerScope(auth);
    if (scope) base.push(scope);
    if (q.agentId) base.push(eq(customers.agentId, q.agentId));
    if (q.q) {
      const like = `%${q.q.trim()}%`;
      base.push(or(ilike(customers.companyName, like), ilike(customers.vatNumber, like))!);
    }
    const filters: Record<string, SQL> = {
      needs_approval: eq(customers.status, 'needs_approval'),
      late: and(eq(customers.status, 'active'), sql`${this.lateSql} > 0`)!,
      free: and(eq(customers.status, 'active'), lt(customers.ownedUntil, today))!,
      archived: eq(customers.status, 'archived'),
      drafts: eq(customers.status, 'draft'),
    };
    const active = q.filter && filters[q.filter] ? filters[q.filter] : ne(customers.status, 'archived');
    const rows = await this.db
      .select({
        c: customers,
        agentName: users.name,
        owesCents: this.owesSql,
        lateCents: this.lateSql,
        lastOrderAt: this.lastOrderSql,
      })
      .from(customers)
      .leftJoin(users, eq(users.id, customers.agentId))
      .where(and(...base, active))
      .orderBy(asc(customers.companyName))
      .limit(500);
    const [counts] = await this.db
      .select({
        all: sql<number>`count(*) filter (where ${customers.status} <> 'archived')::int`,
        needs_approval: sql<number>`count(*) filter (where ${filters.needs_approval})::int`,
        late: sql<number>`count(*) filter (where ${filters.late})::int`,
        free: sql<number>`count(*) filter (where ${filters.free})::int`,
        archived: sql<number>`count(*) filter (where ${filters.archived})::int`,
      })
      .from(customers)
      .where(and(...base));
    // Rule "what happens at the end": customers either become free to claim or stay with their agent.
    const freeAtEnd = (await this.settings.rules()).ownership.atEnd === 'free_to_claim';
    const visible = freeAtEnd || auth.perms.scope !== 'own' ? rows : rows.filter((r) => r.c.agentId === auth.user.id);
    return {
      items: visible.map((r) => {
        const mine = auth.perms.scope !== 'own' || r.c.agentId === auth.user.id;
        return {
          id: r.c.id,
          companyName: r.c.companyName,
          vatNumber: r.c.vatNumber,
          city: r.c.city,
          agentId: r.c.agentId,
          agentName: r.agentName,
          ownedUntil: r.c.ownedUntil,
          lastOrderAt: r.lastOrderAt,
          // Agents see the money of their own customers only.
          owesCents: mine ? Number(r.owesCents) : null,
          lateCents: mine ? Number(r.lateCents) : null,
          status: displayStatus(r.c, Number(r.lateCents), today, freeAtEnd),
          mine,
        };
      }),
      counts,
    };
  }

  async load(auth: AuthContext, id: string) {
    const [c] = await this.db.select().from(customers).where(and(eq(customers.id, id), customerScope(auth)));
    if (!c) throw new NotFoundException({ message: 'Customer not found' });
    return c;
  }

  async card(auth: AuthContext, id: string) {
    const c = await this.load(auth, id);
    const freeAtEnd = (await this.settings.rules()).ownership.atEnd === 'free_to_claim';
    if (auth.perms.scope === 'own' && c.agentId !== auth.user.id && !freeAtEnd) throw new NotFoundException({ message: 'Customer not found' });
    if (auth.perms.scope === 'own' && c.agentId !== auth.user.id) {
      // Free to claim: show who it is, not their money or history.
      return { customer: { id: c.id, companyName: c.companyName, vatNumber: c.vatNumber, city: c.city, country: c.country, ownedUntil: c.ownedUntil }, freeToClaim: true };
    }
    const [agent] = c.agentId ? await this.db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, c.agentId)) : [null];
    const [ords, pays, docs, contacts, history, pending] = await Promise.all([
      this.db
        .select({ id: orders.id, number: orders.number, status: orders.status, createdAt: orders.createdAt, totalCents: orders.totalCents, totalCartons: orders.totalCartons, outstandingCents: outstandingSql, paymentDueOn: orders.paymentDueOn })
        .from(orders)
        .where(eq(orders.customerId, id))
        .orderBy(desc(orders.createdAt)),
      this.db
        .select({ id: payments.id, receivedOn: payments.receivedOn, amountCents: payments.amountCents, method: payments.method, bankReference: payments.bankReference, orderNumber: orders.number, orderId: orders.id })
        .from(payments)
        .innerJoin(orders, eq(orders.id, payments.orderId))
        .where(eq(orders.customerId, id))
        .orderBy(desc(payments.receivedOn)),
      this.db.select({ id: documents.id, type: documents.type, number: documents.number, createdAt: documents.createdAt, totalCents: documents.totalCents, language: documents.language, orderId: documents.orderId, supersededById: documents.supersededById }).from(documents).where(eq(documents.customerId, id)).orderBy(desc(documents.createdAt)),
      this.db.select().from(customerContacts).where(eq(customerContacts.customerId, id)),
      this.db.select().from(auditLog).where(and(eq(auditLog.recordType, 'customer'), eq(auditLog.recordId, id))).orderBy(desc(auditLog.at)).limit(50),
      this.db.select().from(approvalRequests).where(and(eq(approvalRequests.customerId, id), eq(approvalRequests.type, 'new_customer'))).orderBy(desc(approvalRequests.createdAt)).limit(1),
    ]);
    const today = isoDate();
    const owes = ords.reduce((s, o) => s + (['draft', 'cancelled'].includes(o.status) ? 0 : Number(o.outstandingCents)), 0);
    const late = ords.reduce((s, o) => s + (!['draft', 'cancelled'].includes(o.status) && o.paymentDueOn && o.paymentDueOn < today ? Number(o.outstandingCents) : 0), 0);
    const delivered = ords.filter((o) => ['delivered', 'delivered_part', 'invoiced'].includes(o.status)).reduce((s, o) => s + o.totalCents, 0);
    const credits = docs.filter((d) => d.type === 'credit_note');
    return {
      customer: { ...c, displayStatus: displayStatus(c, late, today, freeAtEnd) },
      agent,
      tiles: {
        owesCents: owes,
        lateCents: late,
        lastOrder: ords.find((o) => o.status !== 'draft') ?? null,
        deliveredSalesCents: delivered,
        vatRegime: c.country === 'BG' ? 'domestic' : c.vatValid ? 'eu_reverse_charge' : 'eu_vat',
      },
      orders: ords.map((o) => ({ ...o, outstandingCents: Number(o.outstandingCents) })),
      payments: pays,
      credits,
      documents: docs,
      contacts,
      history: history.map((h) => ({ id: h.id, at: h.at, actorName: h.actorName, action: h.action, changes: h.changes, meta: h.meta })),
      approval: pending[0] ?? null,
      freeToClaim: false,
    };
  }

  /** Duplicate check by VAT number or name (FR-CUST-2). */
  async duplicates(vatNumber: string, companyName?: string, excludeId?: string) {
    const vat = normalizeVat(vatNumber);
    const conds: SQL[] = [sql`regexp_replace(upper(${customers.vatNumber}), '[^A-Z0-9]', '', 'g') = ${vat}`];
    if (companyName && companyName.trim().length >= 3) conds.push(ilike(customers.companyName, companyName.trim()));
    const rows = await this.db
      .select({ id: customers.id, companyName: customers.companyName, vatNumber: customers.vatNumber, status: customers.status, agentName: users.name })
      .from(customers)
      .leftJoin(users, eq(users.id, customers.agentId))
      .where(and(or(...conds), excludeId ? ne(customers.id, excludeId) : undefined));
    return rows;
  }

  /** EU VIES check: fills company name and registered address when the number is valid. */
  async vatCheck(country: string, vatNumber: string) {
    const cc = country.toUpperCase();
    const number = normalizeVat(vatNumber).replace(new RegExp(`^${cc}`), '');
    const duplicates = await this.duplicates(cc + number);
    try {
      const res = await fetch('https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ countryCode: cc === 'GR' ? 'EL' : cc, vatNumber: number }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`VIES ${res.status}`);
      const j = (await res.json()) as { valid?: boolean; name?: string; address?: string };
      const clean = (s?: string) => (s && s !== '---' ? s.replace(/\s*\n\s*/g, ', ').trim() : null);
      return { checked: true, valid: !!j.valid, vatNumber: cc + number, companyName: clean(j.name), address: clean(j.address), duplicates };
    } catch (e) {
      this.log.warn(`VIES check failed: ${(e as Error).message}`);
      return { checked: false, valid: null, vatNumber: cc + number, companyName: null, address: null, duplicates };
    }
  }

  async create(auth: AuthContext, input: CustomerInput & { agentId?: string }) {
    return this.db.transaction(async (tx) => {
      const isAdmin = auth.perms.scope === 'all';
      const dup = await this.duplicates(input.vatNumber, input.companyName);
      if (dup.some((d) => d.status !== 'declined' && normalizeVat(d.vatNumber) === normalizeVat(input.vatNumber))) {
        throw new ConflictException({ message: 'A customer with this VAT number already exists', fields: { vatNumber: 'Already a customer' } });
      }
      // Customers an Admin creates are approved straight away; agents send theirs for approval.
      const status = isAdmin ? 'active' : input.submit ? 'needs_approval' : 'draft';
      const agentId = isAdmin ? (input.agentId ?? null) : auth.user.id;
      const [c] = await tx
        .insert(customers)
        .values({
          companyName: input.companyName,
          vatNumber: normalizeVat(input.vatNumber),
          vatValid: input.vatValid ?? null,
          vatCheckedAt: input.vatValid != null ? new Date() : null,
          country: input.country,
          registeredAddress: input.registeredAddress,
          deliveryAddress: input.deliveryAddress || null,
          city: input.city || null,
          contactName: input.contactName,
          phone: input.phone,
          invoiceEmail: input.invoiceEmail,
          proformaLanguage: input.proformaLanguage,
          paymentTermsDays: input.paymentTermsDays,
          note: input.note,
          agentId,
          status,
          approvedAt: isAdmin ? new Date() : null,
          approvedById: isAdmin ? auth.user.id : null,
          createdById: auth.user.id,
        })
        .returning();
      await tx.insert(customerContacts).values({ customerId: c.id, name: input.contactName, phone: input.phone, email: input.invoiceEmail, role: 'Main contact' });
      if (status === 'needs_approval') await this.openApproval(tx, auth, c.id, input.note);
      await this.audit.log(auth, { category: 'customers', action: status === 'active' ? 'customer_created' : status === 'draft' ? 'customer_draft_saved' : 'customer_sent_for_approval', recordType: 'customer', recordId: c.id, recordLabel: c.companyName }, tx);
      return { id: c.id, status };
    });
  }

  private async openApproval(tx: Parameters<Parameters<Db['transaction']>[0]>[0], auth: AuthContext, customerId: string, reason?: string | null) {
    const [req] = await tx.insert(approvalRequests).values({ type: 'new_customer', customerId, requestedById: auth.user.id, reason: reason ?? null }).returning();
    const [c] = await tx.select({ name: customers.companyName }).from(customers).where(eq(customers.id, customerId));
    await this.notify.toRoles(['system_admin', 'admin'], { type: 'approval', title: `New customer: ${c.name}`, body: `From ${auth.user.name}`, link: `/home?review=${req.id}` }, tx);
  }

  async update(auth: AuthContext, id: string, input: Partial<CustomerInput>) {
    return this.db.transaction(async (tx) => {
      const c = await this.load(auth, id);
      const isAdmin = auth.perms.scope === 'all';
      if (!isAdmin && (c.agentId !== auth.user.id || !['draft', 'declined'].includes(c.status))) {
        throw new ForbiddenException({ message: 'Ask an admin to change an approved customer' });
      }
      const patch = {
        companyName: input.companyName ?? c.companyName,
        vatNumber: input.vatNumber ? normalizeVat(input.vatNumber) : c.vatNumber,
        vatValid: input.vatValid ?? c.vatValid,
        country: input.country ?? c.country,
        registeredAddress: input.registeredAddress ?? c.registeredAddress,
        deliveryAddress: input.deliveryAddress ?? c.deliveryAddress,
        city: input.city ?? c.city,
        contactName: input.contactName ?? c.contactName,
        phone: input.phone ?? c.phone,
        invoiceEmail: input.invoiceEmail ?? c.invoiceEmail,
        proformaLanguage: input.proformaLanguage ?? c.proformaLanguage,
        paymentTermsDays: input.paymentTermsDays ?? c.paymentTermsDays,
        note: input.note ?? c.note,
      };
      const status = !isAdmin && input.submit ? 'needs_approval' : c.status;
      await tx.update(customers).set({ ...patch, status }).where(eq(customers.id, id));
      if (status === 'needs_approval' && c.status !== 'needs_approval') await this.openApproval(tx, auth, id, input.note);
      await this.audit.log(auth, { category: 'customers', action: 'customer_updated', recordType: 'customer', recordId: id, recordLabel: patch.companyName, changes: diff(c, patch, Object.keys(patch) as (keyof typeof patch)[]) }, tx);
      return { ok: true, status };
    });
  }

  async claim(auth: AuthContext, id: string) {
    return this.db.transaction(async (tx) => {
      const [c] = await tx.select().from(customers).where(eq(customers.id, id)).for('update');
      if (!c || c.status !== 'active' || !c.ownedUntil || c.ownedUntil >= isoDate()) throw new ConflictException({ message: 'This customer is not free to claim' });
      const rules = await this.settings.rules(tx);
      if (rules.ownership.atEnd !== 'free_to_claim') throw new ConflictException({ message: 'Customers stay with their agent when ownership ends' });
      const ownedUntil = isoDate(addMonths(new Date(), rules.ownership.months));
      await tx.update(customers).set({ agentId: auth.user.id, ownedUntil, ownershipWarnedAt: null }).where(eq(customers.id, id));
      await this.audit.log(auth, { category: 'customers', action: 'customer_claimed', recordType: 'customer', recordId: id, recordLabel: c.companyName, changes: { agentId: { from: c.agentId, to: auth.user.id }, ownedUntil: { from: c.ownedUntil, to: ownedUntil } } }, tx);
      return { ok: true, ownedUntil };
    });
  }

  /** Admin moves a customer to another agent; open orders stay with the previous agent (FR-CUST-5). */
  async changeAgent(auth: AuthContext, id: string, agentId: string, reason: string, note?: string) {
    return this.db.transaction(async (tx) => {
      const c = await this.load(auth, id);
      const [agent] = await tx.select().from(users).where(eq(users.id, agentId));
      if (!agent) throw new BadRequestException({ message: 'Choose an agent' });
      const rules = await this.settings.rules(tx);
      const ownedUntil = isoDate(addMonths(new Date(), rules.ownership.months));
      await tx.update(customers).set({ agentId, ownedUntil, ownershipWarnedAt: null }).where(eq(customers.id, id));
      await this.audit.log(auth, { category: 'customers', action: 'agent_changed', recordType: 'customer', recordId: id, recordLabel: c.companyName, changes: { agentId: { from: c.agentId, to: agentId } }, meta: { reason, note } }, tx);
      await this.notify.toUsers([agentId], { type: 'customer_assigned', title: `${c.companyName} is now yours`, link: `/customers/${id}` }, tx);
      if (c.agentId && c.agentId !== agentId) await this.notify.toUsers([c.agentId], { type: 'customer_moved', title: `${c.companyName} moved to ${agent.name}`, body: 'Open orders stay with you.', link: `/customers` }, tx);
      return { ok: true };
    });
  }

  async archive(auth: AuthContext, id: string, archived: boolean) {
    const c = await this.load(auth, id);
    await this.db.update(customers).set({ status: archived ? 'archived' : 'active' }).where(eq(customers.id, id));
    await this.audit.log(auth, { category: 'customers', action: archived ? 'customer_archived' : 'customer_restored', recordType: 'customer', recordId: id, recordLabel: c.companyName });
    return { ok: true };
  }

  async addContact(auth: AuthContext, id: string, input: { name: string; role?: string; phone?: string; email?: string }) {
    const c = await this.load(auth, id);
    await this.db.insert(customerContacts).values({ customerId: id, ...input });
    await this.audit.log(auth, { category: 'customers', action: 'contact_added', recordType: 'customer', recordId: id, recordLabel: c.companyName, meta: input });
    return { ok: true };
  }

  /** Daily: warn agents 30 days before ownership ends (in-app). */
  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async warnExpiringOwnership() {
    const rules = await this.settings.rules();
    const today = new Date();
    const limit = isoDate(addDays(today, rules.ownership.warningDays));
    const rows = await this.db
      .select()
      .from(customers)
      .where(and(eq(customers.status, 'active'), isNotNull(customers.agentId), gte(customers.ownedUntil, isoDate(today)), lte(customers.ownedUntil, limit), sql`${customers.ownershipWarnedAt} is null`));
    for (const c of rows) {
      await this.db.update(customers).set({ ownershipWarnedAt: new Date() }).where(eq(customers.id, c.id));
      await this.notify.toUsers([c.agentId], { type: 'ownership_expiring', title: `${c.companyName}: ownership ends ${c.ownedUntil}`, body: 'Place an order to keep this customer.', link: `/customers/${c.id}` });
    }
    return rows.length;
  }

  /** Active agents, for pickers. */
  async agents() {
    return this.db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(and(inArray(users.roleId, sql`(select id from roles where base_role = 'agent')`), eq(users.status, 'active')))
      .orderBy(asc(users.name));
  }
}

export function normalizeVat(v: string) {
  return v.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

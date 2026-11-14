import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, lt, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import { addDays, addMonths, formatDate, isoDate } from '@ananda/shared';
import { InjectDb, type Db } from '../db/db.module';
import { approvalRequests, auditLog, customerContacts, customers, documents, orders, payments, users } from '../db/schema';
import { AuditService, diff } from '../core/audit.service';
import { NotifyService } from '../core/notify.service';
import { MailService } from '../core/mail.service';
import { SettingsService } from '../core/settings.service';
import { outstandingSql } from '../core/figures.service';
import { customerScope } from '../core/scope';
import type { AuthContext } from '../common/context';

type CustomerRow = typeof customers.$inferSelect;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export type PaymentTerms = 'before_shipping' | 'half_before_shipping' | 'after_delivery_30';
export const PAYMENT_TERMS: PaymentTerms[] = ['before_shipping', 'half_before_shipping', 'after_delivery_30'];

/** EU member states the add-customer form offers, by ISO code; VIES uses EL for Greece. */
export const EU_COUNTRIES = ['BG', 'GR', 'RO', 'CY', 'DE', 'AT', 'IT', 'NL', 'FR', 'ES'];
const VIES_PREFIX: Record<string, string> = { EL: 'GR' };

/** The full set of fields the add/edit customer form sends (VAT number and phone are optional). */
export interface CustomerFormInput {
  vatNumber?: string;
  country: string;
  vatValid?: boolean | null;
  companyName: string;
  registeredAddress: string;
  postcode?: string;
  city: string;
  deliveryAddress?: string;
  contactName: string;
  phone?: string;
  invoiceEmail: string;
  proformaLanguage?: 'en' | 'bg';
  paymentTerms?: PaymentTerms;
  paymentTermsDays?: number;
  note?: string;
  submit?: boolean;
  /** Admin only: an agent's id, or 'none' for a house customer (no agent, no commission). */
  agentId?: string;
}

/** Derived state shown in lists: Late while an invoice is overdue; Free to claim after ownership ends. */
function displayStatus(c: CustomerRow, lateCents: number, today: string, freeAtEnd = true) {
  if (c.status !== 'active') return c.status;
  if (lateCents > 0) return 'late';
  if (freeAtEnd && c.agentId && c.ownedUntil && c.ownedUntil < today) return 'free_to_claim';
  return 'active';
}

/** VAT treatment on proformas, from the country and the VIES result. */
export function vatRegime(country: string, vatValid: boolean | null) {
  if (country === 'BG') return 'domestic';
  if (EU_COUNTRIES.includes(country)) return vatValid ? 'eu_reverse_charge' : 'eu_vat';
  return 'export';
}

interface ViesResult {
  checked: boolean;
  valid: boolean | null;
  vatNumber: string;
  country: string | null;
  companyName: string | null;
  address: string | null;
  street: string | null;
  postcode: string | null;
  city: string | null;
}

@Injectable()
export class CustomersService {
  private readonly log = new Logger(CustomersService.name);
  /** Recent register answers, so saving right after Check doesn't ask VIES twice. */
  private readonly viesCache = new Map<string, { at: number; r: ViesResult }>();

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly notify: NotifyService,
    private readonly mail: MailService,
    private readonly settings: SettingsService,
  ) {}

  private owesSql = sql<number>`coalesce((select sum(${outstandingSql}) from ${orders} where ${orders.customerId} = ${customers.id} and ${orders.status} not in ('draft','cancelled')), 0)::int`;
  private lateSql = sql<number>`coalesce((select sum(${outstandingSql}) from ${orders} where ${orders.customerId} = ${customers.id} and ${orders.status} not in ('draft','cancelled') and ${orders.paymentDueOn} < current_date), 0)::int`;
  private lastOrderSql = sql<string | null>`(select max(${orders.requestSentAt})::text from ${orders} where ${orders.customerId} = ${customers.id} and ${orders.status} not in ('draft','cancelled'))`;

  async list(auth: AuthContext, q: { filter?: string; q?: string; agentId?: string }) {
    const today = isoDate();
    const base: SQL[] = [];
    const scope = customerScope(auth);
    if (scope) base.push(scope);
    if (q.agentId) base.push(eq(customers.agentId, q.agentId));
    if (q.q) {
      const like = `%${q.q.trim()}%`;
      base.push(or(ilike(customers.companyName, like), ilike(customers.vatNumber, like), ilike(customers.city, like))!);
    }
    const filters: Record<string, SQL> = {
      needs_approval: eq(customers.status, 'needs_approval'),
      late: and(eq(customers.status, 'active'), sql`${this.lateSql} > 0`)!,
      free: and(eq(customers.status, 'active'), isNotNull(customers.agentId), lt(customers.ownedUntil, today))!,
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
      .orderBy(sql`case when ${customers.status} = 'needs_approval' then 0 when ${this.lateSql} > 0 then 1 else 2 end`, asc(customers.companyName))
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
    // Who asked for the customers that wait for approval, and the request to open from the row.
    const waiting = rows.filter((r) => r.c.status === 'needs_approval').map((r) => r.c.id);
    const requests = waiting.length
      ? await this.db
          .select({ id: approvalRequests.id, customerId: approvalRequests.customerId, createdAt: approvalRequests.createdAt, name: users.name })
          .from(approvalRequests)
          .innerJoin(users, eq(users.id, approvalRequests.requestedById))
          .where(and(inArray(approvalRequests.customerId, waiting), eq(approvalRequests.type, 'new_customer'), eq(approvalRequests.status, 'pending')))
      : [];
    // Rule "what happens at the end": customers either become free to claim or stay with their agent.
    const freeAtEnd = (await this.settings.rules()).ownership.atEnd === 'free_to_claim';
    const visible = freeAtEnd || auth.perms.scope !== 'own' ? rows : rows.filter((r) => r.c.agentId === auth.user.id);
    return {
      items: visible.map((r) => {
        const mine = auth.perms.scope !== 'own' || r.c.agentId === auth.user.id;
        const req = requests.find((x) => x.customerId === r.c.id);
        const status = displayStatus(r.c, Number(r.lateCents), today, freeAtEnd);
        return {
          id: r.c.id,
          companyName: r.c.companyName,
          vatNumber: r.c.vatNumber,
          city: r.c.city,
          phone: mine ? r.c.phone : null,
          agentId: status === 'free_to_claim' ? null : r.c.agentId,
          agentName: status === 'free_to_claim' ? null : r.agentName,
          ownedUntil: r.c.ownedUntil,
          lastOrderAt: r.lastOrderAt,
          // Agents see the money of their own customers only.
          owesCents: mine ? Number(r.owesCents) : null,
          lateCents: mine ? Number(r.lateCents) : null,
          status,
          approvalId: req?.id ?? null,
          requestedBy: req?.name ?? null,
          requestedAt: req?.createdAt ?? null,
          mine,
        };
      }),
      counts,
      ownershipMonths: (await this.settings.rules()).ownership.months,
    };
  }

  async load(auth: AuthContext, id: string) {
    const [c] = await this.db.select().from(customers).where(and(eq(customers.id, id), customerScope(auth)));
    if (!c) throw new NotFoundException({ message: 'Customer not found' });
    return c;
  }

  async card(auth: AuthContext, id: string) {
    const c = await this.load(auth, id);
    const rules = await this.settings.rules();
    const freeAtEnd = rules.ownership.atEnd === 'free_to_claim';
    if (auth.perms.scope === 'own' && c.agentId !== auth.user.id && !freeAtEnd) throw new NotFoundException({ message: 'Customer not found' });
    if (auth.perms.scope === 'own' && c.agentId !== auth.user.id) {
      // Free to claim: show who it is, not their money or history.
      return { customer: { id: c.id, companyName: c.companyName, vatNumber: c.vatNumber, city: c.city, country: c.country, ownedUntil: c.ownedUntil }, freeToClaim: true, ownershipMonths: rules.ownership.months };
    }
    const [agent] = c.agentId ? await this.db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, c.agentId)) : [null];
    const [ords, pays, docs, contacts, history, pending] = await Promise.all([
      this.db
        .select({ id: orders.id, number: orders.number, status: orders.status, createdAt: orders.createdAt, requestSentAt: orders.requestSentAt, totalCents: orders.totalCents, totalCartons: orders.totalCartons, outstandingCents: outstandingSql, paymentDueOn: orders.paymentDueOn, commissionCents: orders.commissionCents })
        .from(orders)
        .where(eq(orders.customerId, id))
        .orderBy(desc(orders.createdAt)),
      this.db
        .select({ id: payments.id, receivedOn: payments.receivedOn, amountCents: payments.amountCents, method: payments.method, bankReference: payments.bankReference, orderNumber: orders.number, orderId: orders.id })
        .from(payments)
        .innerJoin(orders, eq(orders.id, payments.orderId))
        .where(eq(orders.customerId, id))
        .orderBy(desc(payments.receivedOn)),
      this.db.select({ id: documents.id, type: documents.type, number: documents.number, createdAt: documents.createdAt, totalCents: documents.totalCents, language: documents.language, orderId: documents.orderId, supersededById: documents.supersededById, label: documents.label, fileName: documents.fileName }).from(documents).where(eq(documents.customerId, id)).orderBy(desc(documents.createdAt)),
      this.db.select().from(customerContacts).where(eq(customerContacts.customerId, id)),
      this.db.select().from(auditLog).where(and(eq(auditLog.recordType, 'customer'), eq(auditLog.recordId, id))).orderBy(desc(auditLog.at)).limit(50),
      this.db.select().from(approvalRequests).where(and(eq(approvalRequests.customerId, id), eq(approvalRequests.type, 'new_customer'))).orderBy(desc(approvalRequests.createdAt)).limit(1),
    ]);
    const today = isoDate();
    const open = (s: string) => !['draft', 'cancelled'].includes(s);
    const owes = ords.reduce((s, o) => s + (open(o.status) ? Number(o.outstandingCents) : 0), 0);
    const late = ords.reduce((s, o) => s + (open(o.status) && o.paymentDueOn && o.paymentDueOn < today ? Number(o.outstandingCents) : 0), 0);
    const delivered = ords.filter((o) => ['delivered', 'delivered_part', 'invoiced'].includes(o.status)).reduce((s, o) => s + o.totalCents, 0);
    const credits = docs.filter((d) => d.type === 'credit_note');
    const lastOrder = ords.find((o) => open(o.status)) ?? null;
    const status = displayStatus(c, late, today, freeAtEnd);
    return {
      customer: { ...c, displayStatus: status },
      agent: status === 'free_to_claim' ? null : agent,
      previousAgent: status === 'free_to_claim' ? agent : null,
      tiles: {
        owesCents: owes,
        lateCents: late,
        lastOrder: lastOrder && { id: lastOrder.id, number: lastOrder.number, createdAt: lastOrder.requestSentAt ?? lastOrder.createdAt },
        deliveredSalesCents: delivered,
        vatRegime: vatRegime(c.country, c.vatValid),
      },
      orders: ords.map((o) => ({ ...o, outstandingCents: Number(o.outstandingCents) })),
      payments: pays,
      credits,
      documents: docs,
      contacts,
      history: history.map((h) => ({ id: h.id, at: h.at, actorName: h.actorName, action: h.action, changes: h.changes, meta: h.meta })),
      approval: pending[0] ?? null,
      rules: { minOrderCartons: rules.minOrderCartons, ownershipMonths: rules.ownership.months },
      freeToClaim: false,
    };
  }

  /** Duplicate check by VAT number or name (FR-CUST-2). */
  async duplicates(vatNumber: string | null | undefined, companyName?: string, excludeId?: string) {
    const vat = normalizeVat(vatNumber ?? '');
    const conds: SQL[] = [];
    if (vat.length >= 5) conds.push(sql`regexp_replace(upper(${customers.vatNumber}), '[^A-Z0-9]', '', 'g') = ${vat}`);
    if (companyName && companyName.trim().length >= 3) conds.push(ilike(customers.companyName, companyName.trim()));
    if (!conds.length) return [];
    const rows = await this.db
      .select({ id: customers.id, companyName: customers.companyName, vatNumber: customers.vatNumber, status: customers.status, agentId: customers.agentId, agentName: users.name, ownedUntil: customers.ownedUntil, lastOrderAt: this.lastOrderSql })
      .from(customers)
      .leftJoin(users, eq(users.id, customers.agentId))
      .where(and(or(...conds), excludeId ? ne(customers.id, excludeId) : undefined));
    const today = isoDate();
    return rows.map((r) => ({ ...r, freeToClaim: r.status === 'active' && !!r.agentId && !!r.ownedUntil && r.ownedUntil < today }));
  }

  /** Splits a VAT number typed with or without its country prefix into country and number. */
  private splitVat(vatNumber: string, country?: string | null) {
    const v = normalizeVat(vatNumber);
    const pfx = v.slice(0, 2);
    if (/^[A-Z]{2}$/.test(pfx) && (EU_COUNTRIES.includes(pfx) || VIES_PREFIX[pfx])) {
      const cc = VIES_PREFIX[pfx] ?? pfx;
      return { country: cc, number: v.slice(2), full: cc === 'GR' ? `EL${v.slice(2)}` : `${cc}${v.slice(2)}` };
    }
    const cc = (country ?? '').toUpperCase();
    if (!EU_COUNTRIES.includes(cc)) return null;
    return { country: cc, number: v, full: (cc === 'GR' ? 'EL' : cc) + v };
  }

  /** Asks the EU register (VIES); `checked: false` when it doesn't answer. */
  private async vies(vatNumber: string, country?: string | null): Promise<ViesResult> {
    const split = this.splitVat(vatNumber, country);
    if (!split) return { checked: true, valid: false, vatNumber: normalizeVat(vatNumber), country: null, companyName: null, address: null, street: null, postcode: null, city: null };
    const hit = this.viesCache.get(split.full);
    if (hit && Date.now() - hit.at < 10 * 60_000) return hit.r;
    try {
      const res = await fetch('https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ countryCode: split.country === 'GR' ? 'EL' : split.country, vatNumber: split.number }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`VIES ${res.status}`);
      const j = (await res.json()) as { valid?: boolean; name?: string; address?: string; userError?: string };
      if (j.userError && j.userError !== 'VALID' && j.userError !== 'INVALID') throw new Error(`VIES ${j.userError}`);
      const clean = (s?: string) => (s && s.trim() !== '---' ? s.trim() : null);
      const address = clean(j.address);
      const parts = splitAddress(address);
      const r: ViesResult = { checked: true, valid: !!j.valid, vatNumber: split.full, country: split.country, companyName: clean(j.name), address: address?.replace(/\s*\n\s*/g, ', ') ?? null, ...parts };
      this.viesCache.set(split.full, { at: Date.now(), r });
      return r;
    } catch (e) {
      this.log.warn(`VIES check failed: ${(e as Error).message}`);
      return { checked: false, valid: null, vatNumber: split.full, country: split.country, companyName: null, address: null, street: null, postcode: null, city: null };
    }
  }

  /** EU VIES check: fills company name, country and registered address when the number is valid. */
  async vatCheck(vatNumber: string, country?: string | null) {
    const r = await this.vies(vatNumber, country);
    const duplicates = await this.duplicates(r.vatNumber);
    return { ...r, duplicates };
  }

  /**
   * The register didn't answer when the customer was added: check the VAT number again before the
   * first proforma goes out (called by Orders when a payment request is sent).
   */
  async recheckVatBeforeProforma(auth: AuthContext, orderId: string) {
    const [row] = await this.db
      .select({ c: customers })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .where(eq(orders.id, orderId));
    const c = row?.c;
    if (!c || !c.vatNumber || c.vatCheckedAt) return null;
    const r = await this.vies(c.vatNumber, c.country);
    if (!r.checked) return { checked: false };
    await this.db.update(customers).set({ vatValid: r.valid, vatCheckedAt: new Date() }).where(eq(customers.id, c.id));
    await this.audit.log(auth, { category: 'customers', action: 'vat_rechecked', recordType: 'customer', recordId: c.id, recordLabel: c.companyName, changes: { vatValid: { from: c.vatValid, to: r.valid } }, meta: { before: 'first_proforma' } });
    return { checked: true, valid: r.valid };
  }

  async create(auth: AuthContext, input: CustomerFormInput) {
    const isAdmin = auth.perms.scope === 'all';
    if (isAdmin && !input.agentId) throw new BadRequestException({ message: 'Choose an agent, or No agent', fields: { agentId: 'Required' } });
    const vatNumber = input.vatNumber ? normalizeVat(input.vatNumber) : '';
    // The server asks the register itself; when it doesn't answer, the number is checked again before the first proforma.
    const check = vatNumber ? await this.vies(vatNumber, input.country) : null;
    return this.db.transaction(async (tx) => {
      const dup = await this.duplicates(vatNumber, input.companyName);
      if (vatNumber && dup.some((d) => d.status !== 'declined' && normalizeVat(d.vatNumber) === normalizeVat(check?.vatNumber ?? vatNumber))) {
        throw new BadRequestException({ message: 'A customer with this VAT number is already in ANANDA', fields: { vatNumber: 'Already in ANANDA' } });
      }
      // Customers an Admin creates are approved straight away; agents send theirs for approval.
      const status = isAdmin ? 'active' : input.submit === false ? 'draft' : 'needs_approval';
      const agentId = isAdmin ? (input.agentId === 'none' ? null : (input.agentId ?? null)) : auth.user.id;
      if (agentId && isAdmin) {
        const [a] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, agentId), inArray(users.roleId, sql`(select id from roles where base_role = 'agent')`)));
        if (!a) throw new BadRequestException({ message: 'Choose an agent', fields: { agentId: 'Choose an agent' } });
      }
      const rules = await this.settings.rules(tx);
      const [c] = await tx
        .insert(customers)
        .values({
          companyName: input.companyName.trim(),
          vatNumber: check?.vatNumber && check.vatNumber.length > 2 ? check.vatNumber : vatNumber,
          vatValid: check?.checked ? check.valid : null,
          vatCheckedAt: check?.checked ? new Date() : null,
          country: input.country,
          registeredAddress: input.registeredAddress.trim(),
          postcode: input.postcode?.trim() || null,
          deliveryAddress: input.deliveryAddress?.trim() || null,
          city: input.city.trim(),
          contactName: input.contactName.trim(),
          phone: input.phone?.trim() ?? '',
          invoiceEmail: input.invoiceEmail.trim(),
          proformaLanguage: input.proformaLanguage ?? (input.country === 'BG' ? 'bg' : 'en'),
          paymentTerms: input.paymentTerms ?? 'before_shipping',
          paymentTermsDays: input.paymentTermsDays ?? 7,
          note: input.note || null,
          agentId,
          // The agent keeps the customer for N months from each order; an Admin-added one from today.
          ownedUntil: isAdmin && agentId ? isoDate(addMonths(new Date(), rules.ownership.months)) : null,
          status,
          approvedAt: isAdmin ? new Date() : null,
          approvedById: isAdmin ? auth.user.id : null,
          createdById: auth.user.id,
        })
        .returning();
      await tx.insert(customerContacts).values({ customerId: c.id, name: c.contactName, phone: c.phone || null, email: c.invoiceEmail, role: 'Main contact' });
      if (status === 'needs_approval') await this.openApproval(tx, auth, c.id, input.note);
      await this.audit.log(
        auth,
        {
          category: 'customers',
          action: status === 'active' ? 'customer_created' : status === 'draft' ? 'customer_draft_saved' : 'customer_sent_for_approval',
          recordType: 'customer',
          recordId: c.id,
          recordLabel: c.companyName,
          meta: { vatChecked: !!check?.checked, vatValid: check?.valid ?? null, agentId, paymentTerms: c.paymentTerms },
        },
        tx,
      );
      if (isAdmin && agentId && agentId !== auth.user.id) await this.notify.toUsers([agentId], { type: 'customer_assigned', title: `${c.companyName} is now yours`, body: 'Added by an Admin. You can start a sale.', link: `/customers/${c.id}` }, tx);
      return { id: c.id, status, companyName: c.companyName, vatChecked: !!check?.checked };
    });
  }

  private async openApproval(tx: Tx, auth: AuthContext, customerId: string, reason?: string | null) {
    const [req] = await tx.insert(approvalRequests).values({ type: 'new_customer', customerId, requestedById: auth.user.id, reason: reason ?? null }).returning();
    const [c] = await tx.select({ name: customers.companyName, vatValid: customers.vatValid }).from(customers).where(eq(customers.id, customerId));
    await this.notify.send('customer_approval', { roles: ['system_admin', 'admin'] }, { agent: auth.user.name, customer: c.name, ...(c.vatValid ? { vatValid: 1 } : {}) }, `/home?review=${req.id}`, tx);
    await this.notify.send('sent_for_approval', { users: [auth.user.id] }, { customer: c.name }, `/customers/${customerId}`, tx);
  }

  async update(auth: AuthContext, id: string, input: Partial<CustomerFormInput>) {
    return this.db.transaction(async (tx) => {
      const c = await this.load(auth, id);
      const isAdmin = auth.perms.scope === 'all';
      if (!isAdmin && (c.agentId !== auth.user.id || !['draft', 'declined'].includes(c.status))) {
        throw new ForbiddenException({ message: 'Ask an admin to change an approved customer' });
      }
      const vatChanged = input.vatNumber != null && normalizeVat(input.vatNumber) !== c.vatNumber;
      const patch = {
        companyName: input.companyName ?? c.companyName,
        vatNumber: input.vatNumber != null ? normalizeVat(input.vatNumber) : c.vatNumber,
        vatValid: vatChanged ? (input.vatValid ?? null) : c.vatValid,
        vatCheckedAt: vatChanged ? (input.vatValid != null ? new Date() : null) : c.vatCheckedAt,
        country: input.country ?? c.country,
        registeredAddress: input.registeredAddress ?? c.registeredAddress,
        postcode: input.postcode ?? c.postcode,
        deliveryAddress: input.deliveryAddress !== undefined ? input.deliveryAddress || null : c.deliveryAddress,
        city: input.city ?? c.city,
        contactName: input.contactName ?? c.contactName,
        phone: input.phone ?? c.phone,
        invoiceEmail: input.invoiceEmail ?? c.invoiceEmail,
        proformaLanguage: input.proformaLanguage ?? c.proformaLanguage,
        paymentTerms: input.paymentTerms ?? c.paymentTerms,
        paymentTermsDays: input.paymentTermsDays ?? c.paymentTermsDays,
        note: input.note ?? c.note,
      };
      const status = !isAdmin && input.submit ? 'needs_approval' : c.status;
      await tx.update(customers).set({ ...patch, status }).where(eq(customers.id, id));
      if (status === 'needs_approval' && c.status !== 'needs_approval') await this.openApproval(tx, auth, id, input.note);
      const keys = (Object.keys(patch) as (keyof typeof patch)[]).filter((k) => k !== 'vatCheckedAt');
      await this.audit.log(auth, { category: 'customers', action: 'customer_updated', recordType: 'customer', recordId: id, recordLabel: patch.companyName, changes: diff(c, patch, keys) }, tx);
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

  /** Admin moves a customer to another agent (or to no agent); open orders stay with the previous agent (FR-CUST-5). */
  async changeAgent(auth: AuthContext, id: string, agentId: string | null, reason: string, note?: string) {
    return this.db.transaction(async (tx) => {
      const c = await this.load(auth, id);
      const [agent] = agentId ? await tx.select().from(users).where(eq(users.id, agentId)) : [null];
      if (agentId && !agent) throw new BadRequestException({ message: 'Choose an agent' });
      const rules = await this.settings.rules(tx);
      const ownedUntil = agentId ? isoDate(addMonths(new Date(), rules.ownership.months)) : null;
      await tx.update(customers).set({ agentId, ownedUntil, ownershipWarnedAt: null }).where(eq(customers.id, id));
      await this.audit.log(auth, { category: 'customers', action: 'agent_changed', recordType: 'customer', recordId: id, recordLabel: c.companyName, changes: { agentId: { from: c.agentId, to: agentId } }, meta: { reason, note } }, tx);
      if (agentId) await this.notify.toUsers([agentId], { type: 'customer_assigned', title: `${c.companyName} is now yours`, body: `Yours until ${ownedUntil}, and longer with each order.`, link: `/customers/${id}` }, tx);
      if (c.agentId && c.agentId !== agentId) await this.notify.toUsers([c.agentId], { type: 'customer_moved', title: `${c.companyName} moved to ${agent?.name ?? 'no agent'}`, body: 'Open orders stay with you.', link: `/customers` }, tx);
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

  /**
   * Daily: warn the agent N days (Settings) before ownership ends if no new order came in,
   * in the app and by e-mail. After that day any agent may claim the customer.
   */
  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async warnExpiringOwnership() {
    const rules = await this.settings.rules();
    if (rules.ownership.atEnd !== 'free_to_claim') return 0;
    const today = new Date();
    const limit = isoDate(addDays(today, rules.ownership.warningDays));
    const rows = await this.db
      .select({ c: customers, email: users.email, lastOrderAt: this.lastOrderSql })
      .from(customers)
      .innerJoin(users, eq(users.id, customers.agentId))
      .where(and(eq(customers.status, 'active'), isNotNull(customers.agentId), gte(customers.ownedUntil, isoDate(today)), lte(customers.ownedUntil, limit), sql`${customers.ownershipWarnedAt} is null`));
    for (const { c, email, lastOrderAt } of rows) {
      const days = Math.max(0, Math.round((new Date(c.ownedUntil!).getTime() - new Date(isoDate(today)).getTime()) / 86_400_000));
      const until = formatDate(c.ownedUntil, 'en');
      const title = `${days} days left with ${c.companyName}`;
      const body = `${lastOrderAt ? `No order since ${formatDate(lastOrderAt, 'en')}. ` : ''}If ${c.companyName} doesn't order by ${until}, it becomes free for any agent to claim.`;
      await this.db.update(customers).set({ ownershipWarnedAt: new Date() }).where(eq(customers.id, c.id));
      await this.notify.toUsers([c.agentId], { type: 'ownership_expiring', title, body, link: `/customers/${c.id}` });
      await this.mail.send({ kind: 'ownership_expiring', to: [email], subject: title, body, recordType: 'customer', recordId: c.id });
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

/**
 * Best effort split of the register's address into street, postcode and city. Bulgarian VIES
 * addresses come as one line ("бул. … №115 обл.СОФИЯ, гр.СОФИЯ 1784"); others in lines.
 */
export function splitAddress(address: string | null): { street: string | null; postcode: string | null; city: string | null } {
  if (!address) return { street: null, postcode: null, city: null };
  const title = (v: string) => v.toLocaleLowerCase('bg').replace(/(^|[\s-])(\p{L})/gu, (_m, a: string, b: string) => a + b.toLocaleUpperCase('bg'));
  const one = address.replace(/\s*\n\s*/g, ', ').replace(/\s+/g, ' ').trim();
  const town = one.match(/(?:^|[\s,])(?:гр|с)\.\s*([^\d,]+?)(?=\s*\d{4,5}\b|,|$)/i);
  if (town) {
    const postcode = one.match(/\b(\d{4})\b\s*$/)?.[1] ?? one.match(/\b(\d{4})\b/)?.[1] ?? null;
    const street = one.split(/\s*(?:обл\.|(?:^|[\s,])гр\.|(?:^|[\s,])с\.)/i)[0].replace(/[\s,]+$/, '').replace(/\s+(?=№)/g, ' ').trim();
    return { street: street || null, postcode, city: title(town[1].trim()) };
  }
  const lines = address
    .split(/\n|,(?=\s*\d{4,5}\b)/)
    .map((l) => l.trim())
    .filter(Boolean);
  const i = lines.findIndex((l) => /\b\d{4,5}\b/.test(l));
  if (i < 0) return { street: lines.join(', '), postcode: null, city: null };
  const line = lines[i];
  const postcode = line.match(/\b\d{4,5}\b/)![0];
  const city = line.replace(postcode, '').replace(/^[\s,.-]+|[\s,.-]+$/g, '').trim();
  const street = lines.filter((_, j) => j !== i).join(', ');
  return { street: street || null, postcode, city: city || null };
}

import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, lt, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import { addDays, addMonths, isoDate } from '@ananda/shared';
import { InjectDb, type Db } from '../db/db.module';
import { approvalRequests, auditLog, customerContacts, customers, documents, orders, payments, users } from '../db/schema';
import { AuditService, UNDO_MINUTES, diff } from '../core/audit.service';
import { NotifyService, notifyText } from '../core/notify.service';
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
  /** Admin only: a broker's id, or 'none' for a house customer (no broker, no commission). */
  brokerId?: string;
}

/** Derived state shown in lists: Late while an invoice is overdue; Free to claim after ownership ends. */
function displayStatus(c: CustomerRow, lateCents: number, today: string, freeAtEnd = true) {
  if (c.status !== 'active') return c.status;
  if (lateCents > 0) return 'late';
  if (freeAtEnd && c.brokerId && c.ownedUntil && c.ownedUntil < today) return 'free_to_claim';
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

  async list(auth: AuthContext, q: { filter?: string; q?: string; brokerId?: string }) {
    const today = isoDate();
    const base: SQL[] = [];
    const scope = customerScope(auth);
    if (scope) base.push(scope);
    if (q.brokerId) base.push(eq(customers.brokerId, q.brokerId));
    if (q.q) {
      const like = `%${q.q.trim()}%`;
      base.push(or(ilike(customers.companyName, like), ilike(customers.vatNumber, like), ilike(customers.city, like))!);
    }
    const filters: Record<string, SQL> = {
      needs_approval: eq(customers.status, 'needs_approval'),
      late: and(eq(customers.status, 'active'), sql`${this.lateSql} > 0`)!,
      free: and(eq(customers.status, 'active'), isNotNull(customers.brokerId), lt(customers.ownedUntil, today))!,
      archived: eq(customers.status, 'archived'),
      drafts: eq(customers.status, 'draft'),
    };
    const active = q.filter && filters[q.filter] ? filters[q.filter] : ne(customers.status, 'archived');
    const rows = await this.db
      .select({
        c: customers,
        brokerName: users.name,
        owesCents: this.owesSql,
        lateCents: this.lateSql,
        lastOrderAt: this.lastOrderSql,
      })
      .from(customers)
      .leftJoin(users, eq(users.id, customers.brokerId))
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
    // Rule "what happens at the end": customers either become free to claim or stay with their broker.
    const freeAtEnd = (await this.settings.rules()).ownership.atEnd === 'free_to_claim';
    const visible = freeAtEnd || auth.perms.scope !== 'own' ? rows : rows.filter((r) => r.c.brokerId === auth.user.id);
    return {
      items: visible.map((r) => {
        const mine = auth.perms.scope !== 'own' || r.c.brokerId === auth.user.id;
        const req = requests.find((x) => x.customerId === r.c.id);
        const status = displayStatus(r.c, Number(r.lateCents), today, freeAtEnd);
        return {
          id: r.c.id,
          companyName: r.c.companyName,
          vatNumber: r.c.vatNumber,
          city: r.c.city,
          phone: mine ? r.c.phone : null,
          brokerId: status === 'free_to_claim' ? null : r.c.brokerId,
          brokerName: status === 'free_to_claim' ? null : r.brokerName,
          ownedUntil: r.c.ownedUntil,
          lastOrderAt: r.lastOrderAt,
          // Brokers see the money of their own customers only.
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
    if (auth.perms.scope === 'own' && c.brokerId !== auth.user.id && !freeAtEnd) throw new NotFoundException({ message: 'Customer not found' });
    if (auth.perms.scope === 'own' && c.brokerId !== auth.user.id) {
      // Free to claim: show who it is, not their money or history.
      return { customer: { id: c.id, companyName: c.companyName, vatNumber: c.vatNumber, city: c.city, country: c.country, ownedUntil: c.ownedUntil }, freeToClaim: true, ownershipMonths: rules.ownership.months };
    }
    const [broker] = c.brokerId ? await this.db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, c.brokerId)) : [null];
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
      broker: status === 'free_to_claim' ? null : broker,
      previousBroker: status === 'free_to_claim' ? broker : null,
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
      .select({ id: customers.id, companyName: customers.companyName, vatNumber: customers.vatNumber, status: customers.status, brokerId: customers.brokerId, brokerName: users.name, ownedUntil: customers.ownedUntil, lastOrderAt: this.lastOrderSql })
      .from(customers)
      .leftJoin(users, eq(users.id, customers.brokerId))
      .where(and(or(...conds), excludeId ? ne(customers.id, excludeId) : undefined));
    const today = isoDate();
    return rows.map((r) => ({ ...r, freeToClaim: r.status === 'active' && !!r.brokerId && !!r.ownedUntil && r.ownedUntil < today }));
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
    if (isAdmin && !input.brokerId) throw new BadRequestException({ message: 'Choose a broker, or No broker', fields: { brokerId: 'Required' } });
    const vatNumber = input.vatNumber ? normalizeVat(input.vatNumber) : '';
    // The server asks the register itself; when it doesn't answer, the number is checked again before the first proforma.
    const check = vatNumber ? await this.vies(vatNumber, input.country) : null;
    return this.db.transaction(async (tx) => {
      const dup = await this.duplicates(vatNumber, input.companyName);
      if (vatNumber && dup.some((d) => d.status !== 'declined' && normalizeVat(d.vatNumber) === normalizeVat(check?.vatNumber ?? vatNumber))) {
        throw new BadRequestException({ message: 'A customer with this VAT number is already in ANANDA', fields: { vatNumber: 'Already in ANANDA' } });
      }
      // Customers an Admin creates are approved straight away; brokers send theirs for approval.
      const status = isAdmin ? 'active' : input.submit === false ? 'draft' : 'needs_approval';
      const brokerId = isAdmin ? (input.brokerId === 'none' ? null : (input.brokerId ?? null)) : auth.user.id;
      if (brokerId && isAdmin) {
        const [a] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, brokerId), inArray(users.roleId, sql`(select id from roles where base_role = 'broker')`)));
        if (!a) throw new BadRequestException({ message: 'Choose a broker', fields: { brokerId: 'Choose a broker' } });
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
          brokerId,
          // The broker keeps the customer for N months from each order; an Admin-added one from today.
          ownedUntil: isAdmin && brokerId ? isoDate(addMonths(new Date(), rules.ownership.months)) : null,
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
          meta: { vatChecked: !!check?.checked, vatValid: check?.valid ?? null, brokerId, paymentTerms: c.paymentTerms },
        },
        tx,
      );
      if (isAdmin && brokerId && brokerId !== auth.user.id) await this.notify.send('customer_assigned', { users: [brokerId] }, { customer: c.companyName }, `/customers/${c.id}`, tx);
      return { id: c.id, status, companyName: c.companyName, vatChecked: !!check?.checked };
    });
  }

  private async openApproval(tx: Tx, auth: AuthContext, customerId: string, reason?: string | null) {
    const [req] = await tx.insert(approvalRequests).values({ type: 'new_customer', customerId, requestedById: auth.user.id, reason: reason ?? null }).returning();
    const [c] = await tx.select({ name: customers.companyName, vatValid: customers.vatValid }).from(customers).where(eq(customers.id, customerId));
    await this.notify.send('customer_approval', { roles: ['system_admin', 'admin'] }, { broker: auth.user.name, customer: c.name, vatValid: c.vatValid ? 'yes' : 'no' }, `/home?review=${req.id}`, tx);
    await this.notify.send('sent_for_approval', { users: [auth.user.id] }, { customer: c.name }, `/customers/${customerId}`, tx);
  }

  async update(auth: AuthContext, id: string, input: Partial<CustomerFormInput>) {
    return this.db.transaction(async (tx) => {
      const c = await this.load(auth, id);
      const isAdmin = auth.perms.scope === 'all';
      if (!isAdmin && (c.brokerId !== auth.user.id || !['draft', 'declined'].includes(c.status))) {
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
      if (rules.ownership.atEnd !== 'free_to_claim') throw new ConflictException({ message: 'Customers stay with their broker when ownership ends' });
      const ownedUntil = isoDate(addMonths(new Date(), rules.ownership.months));
      await tx.update(customers).set({ brokerId: auth.user.id, ownedUntil, ownershipWarnedAt: null }).where(eq(customers.id, id));
      await this.audit.log(auth, { category: 'customers', action: 'customer_claimed', recordType: 'customer', recordId: id, recordLabel: c.companyName, changes: { brokerId: { from: c.brokerId, to: auth.user.id }, ownedUntil: { from: c.ownedUntil, to: ownedUntil } } }, tx);
      return { ok: true, ownedUntil };
    });
  }

  /** Admin moves a customer to another broker (or to no broker); open orders stay with the previous broker (FR-CUST-5). */
  async changeBroker(auth: AuthContext, id: string, brokerId: string | null, reason: string, note?: string) {
    return this.db.transaction(async (tx) => {
      const c = await this.load(auth, id);
      const [broker] = brokerId ? await tx.select().from(users).where(eq(users.id, brokerId)) : [null];
      if (brokerId && !broker) throw new BadRequestException({ message: 'Choose a broker' });
      const rules = await this.settings.rules(tx);
      const ownedUntil = brokerId ? isoDate(addMonths(new Date(), rules.ownership.months)) : null;
      await tx.update(customers).set({ brokerId, ownedUntil, ownershipWarnedAt: null }).where(eq(customers.id, id));
      await this.audit.log(auth, { category: 'customers', action: 'broker_changed', recordType: 'customer', recordId: id, recordLabel: c.companyName, changes: { brokerId: { from: c.brokerId, to: brokerId }, ownedUntil: { from: c.ownedUntil, to: ownedUntil } }, meta: { reason, note } }, tx);
      if (brokerId) await this.notify.send('customer_assigned_until', { users: [brokerId] }, { customer: c.companyName, until: ownedUntil! }, `/customers/${id}`, tx);
      if (c.brokerId && c.brokerId !== brokerId) await this.notify.send('customer_moved', { users: [c.brokerId] }, { customer: c.companyName, broker: broker?.name ?? '', hasBroker: broker ? 'yes' : 'no' }, '/customers', tx);
      return { ok: true };
    });
  }

  /**
   * The toast's Undo for Claim and Change broker: the customer goes back to the broker and date it had. Only while
   * that action is the last thing that happened to the customer, it was a moment ago, nobody sold to them since,
   * and (for a claim) the person undoing is the one who claimed.
   */
  async undoOwnerChange(auth: AuthContext, id: string, kind: 'claim' | 'change') {
    const action = kind === 'claim' ? 'customer_claimed' : 'broker_changed';
    return this.db.transaction(async (tx) => {
      const [c] = await tx.select().from(customers).where(eq(customers.id, id)).for('update');
      if (!c || (kind === 'claim' && c.brokerId !== auth.user.id)) throw new NotFoundException({ message: 'Customer not found' });
      const last = await this.audit.latest('customer', id, tx);
      const ch = last?.changes as { brokerId?: { from: string | null; to: string | null }; ownedUntil?: { from: string | null; to: string | null } } | null | undefined;
      if (!last || last.action !== action || !ch?.brokerId || !ch.ownedUntil || c.brokerId !== ch.brokerId.to || (kind === 'claim' && last.actorId !== auth.user.id)) {
        throw new ConflictException({ message: 'This customer changed since, so it cannot be undone' });
      }
      if (Date.now() - last.at.getTime() > UNDO_MINUTES * 60_000) throw new ConflictException({ message: `This can be undone for ${UNDO_MINUTES} minutes` });
      const [sale] = await tx.select({ id: orders.id }).from(orders).where(and(eq(orders.customerId, id), gte(orders.createdAt, last.at))).limit(1);
      if (sale) throw new ConflictException({ message: 'An order was started for this customer since, so it cannot be undone' });
      const { from: brokerId } = ch.brokerId;
      await tx.update(customers).set({ brokerId, ownedUntil: ch.ownedUntil.from }).where(eq(customers.id, id));
      await this.audit.log(auth, { category: 'customers', action: `${action}_undone`, recordType: 'customer', recordId: id, recordLabel: c.companyName, changes: { brokerId: { from: c.brokerId, to: brokerId }, ownedUntil: { from: c.ownedUntil, to: ch.ownedUntil.from } } }, tx);
      if (kind === 'change') {
        await this.notify.send('customer_moved_undone', { users: [c.brokerId] }, { customer: c.companyName }, '/customers', tx);
        await this.notify.send('customer_assigned_undone', { users: [brokerId] }, { customer: c.companyName }, `/customers/${id}`, tx);
      }
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
   * Daily: warn the broker N days (Settings) before ownership ends if no new order came in,
   * in the app and by e-mail. After that day any broker may claim the customer.
   */
  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async warnExpiringOwnership() {
    const rules = await this.settings.rules();
    if (rules.ownership.atEnd !== 'free_to_claim') return 0;
    const today = new Date();
    const limit = isoDate(addDays(today, rules.ownership.warningDays));
    const rows = await this.db
      .select({ c: customers, email: users.email, lastOrderAt: sql<Date | string | null>`(select max(${orders.requestSentAt}) from ${orders} where ${orders.customerId} = ${customers.id} and ${orders.status} not in ('draft','cancelled'))` })
      .from(customers)
      .innerJoin(users, eq(users.id, customers.brokerId))
      .where(and(eq(customers.status, 'active'), isNotNull(customers.brokerId), gte(customers.ownedUntil, isoDate(today)), lte(customers.ownedUntil, limit), sql`${customers.ownershipWarnedAt} is null`));
    for (const { c, email, lastOrderAt } of rows) {
      const days = Math.max(0, Math.round((new Date(c.ownedUntil!).getTime() - new Date(isoDate(today)).getTime()) / 86_400_000));
      // A timestamptz instant, turned into a calendar day the same way formatDate did (server-local day).
      const lastOrderOn = lastOrderAt ? isoDate(new Date(lastOrderAt)) : '';
      const data = { customer: c.companyName, days, until: c.ownedUntil!, lastOrderOn, hasLastOrder: lastOrderOn ? ('yes' as const) : ('no' as const) };
      const { title, body } = notifyText('ownership_expiring', data);
      await this.db.update(customers).set({ ownershipWarnedAt: new Date() }).where(eq(customers.id, c.id));
      await this.notify.send('ownership_expiring', { users: [c.brokerId] }, data, `/customers/${c.id}`);
      await this.mail.send({ kind: 'ownership_expiring', to: [email], subject: title, body, recordType: 'customer', recordId: c.id });
    }
    return rows.length;
  }

  /** Active brokers, for pickers. */
  async brokers() {
    return this.db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(and(inArray(users.roleId, sql`(select id from roles where base_role = 'broker')`), eq(users.status, 'active')))
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

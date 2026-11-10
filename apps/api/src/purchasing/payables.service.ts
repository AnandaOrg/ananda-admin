import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte, lt, lte, sql, type SQL } from 'drizzle-orm';
import { addDays, formatMoney, isoDate } from '@ananda/shared';
import { InjectDb, type Db } from '../db/db.module';
import { documents, payablePayments, payables, purchases, shipments, suppliers, users } from '../db/schema';
import { AuditService } from '../core/audit.service';
import { SettingsService } from '../core/settings.service';
import { FilesService } from '../core/files.service';
import type { AuthContext } from '../common/context';
import type { UploadedFile } from './purchasing.schemas';

const DUE_SOON_DAYS = 14;
const openCond = sql`${payables.amountCents} > ${payables.paidCents}`;

/** FR-PUR-4: supplier invoices, freight and excise in one list by due date. */
@Injectable()
export class PayablesService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly files: FilesService,
  ) {}

  private filterCond(filter: string | undefined, today: string, soon: string): SQL | undefined {
    switch (filter) {
      case 'due_soon':
        return and(openCond, gte(payables.dueOn, today), lte(payables.dueOn, soon));
      case 'overdue':
        return and(openCond, lt(payables.dueOn, today));
      case 'paid':
        return sql`${payables.paidCents} >= ${payables.amountCents}`;
      case 'all':
        return undefined;
      default:
        return openCond;
    }
  }

  async list(q: { filter?: string; kind?: string }) {
    const today = isoDate();
    const soon = isoDate(addDays(new Date(), DUE_SOON_DAYS));
    const base: SQL[] = [];
    if (q.kind && ['supplier_invoice', 'freight', 'excise'].includes(q.kind)) base.push(eq(payables.kind, q.kind as 'supplier_invoice'));
    const rows = await this.db
      .select({ p: payables, purchaseNumber: purchases.number, purchaseStatus: purchases.status })
      .from(payables)
      .leftJoin(purchases, eq(purchases.id, payables.purchaseId))
      .where(and(...base, this.filterCond(q.filter, today, soon)))
      .orderBy(q.filter === 'paid' ? desc(payables.dueOn) : asc(payables.dueOn), asc(payables.createdAt))
      .limit(500);
    const out = (c: SQL | undefined) => sql<number>`coalesce(sum(${payables.amountCents} - ${payables.paidCents}) filter (where ${c ?? sql`true`}), 0)::int`;
    const cnt = (c: SQL | undefined) => sql<number>`count(*) filter (where ${c ?? sql`true`})::int`;
    const [t] = await this.db
      .select({
        toPayCents: out(openCond),
        dueSoonCents: out(this.filterCond('due_soon', today, soon)),
        overdueCents: out(this.filterCond('overdue', today, soon)),
        open: cnt(openCond),
        due_soon: cnt(this.filterCond('due_soon', today, soon)),
        overdue: cnt(this.filterCond('overdue', today, soon)),
        paid: cnt(this.filterCond('paid', today, soon)),
        all: cnt(undefined),
      })
      .from(payables)
      .where(and(...base));
    const bank = await this.settings.get('bank');
    return {
      items: rows.map((r) => ({
        ...r.p,
        vatRate: Number(r.p.vatRate),
        stillToPayCents: Math.max(0, r.p.amountCents - r.p.paidCents),
        overdue: r.p.paidCents < r.p.amountCents && r.p.dueOn < today,
        purchaseNumber: r.purchaseNumber,
      })),
      tiles: { toPayCents: Number(t.toPayCents), dueSoonCents: Number(t.dueSoonCents), overdueCents: Number(t.overdueCents) },
      counts: { open: t.open, due_soon: t.due_soon, overdue: t.overdue, paid: t.paid, all: t.all },
      accounts: bank.accounts,
    };
  }

  async detail(id: string) {
    const [row] = await this.db.select({ p: payables, purchaseNumber: purchases.number }).from(payables).leftJoin(purchases, eq(purchases.id, payables.purchaseId)).where(eq(payables.id, id));
    if (!row) throw new NotFoundException({ message: 'Payable not found' });
    const pays = await this.db
      .select({ pay: payablePayments, by: users.name })
      .from(payablePayments)
      .leftJoin(users, eq(users.id, payablePayments.recordedById))
      .where(eq(payablePayments.payableId, id))
      .orderBy(asc(payablePayments.paidOn));
    return {
      ...row.p,
      vatRate: Number(row.p.vatRate),
      purchaseNumber: row.purchaseNumber,
      stillToPayCents: Math.max(0, row.p.amountCents - row.p.paidCents),
      payments: pays.map((x) => ({ ...x.pay, by: x.by })),
    };
  }

  /** Record payment: a smaller amount than what is left records a part payment. */
  async recordPayment(auth: AuthContext, id: string, input: { paidOn: string; amountCents: number; paidFrom: string; bankReference?: string }, file?: UploadedFile) {
    if (file && !this.files.isAllowed(file.mimetype)) throw new BadRequestException({ message: 'Upload a photo (JPG, PNG, HEIC) or a PDF' });
    if (input.paidOn > isoDate()) throw new BadRequestException({ message: 'Check the highlighted fields', fields: { paidOn: 'The payment date cannot be in the future' } });
    const bank = await this.settings.get('bank');
    if (bank.accounts.length && !bank.accounts.includes(input.paidFrom)) throw new BadRequestException({ message: 'Check the highlighted fields', fields: { paidFrom: 'Choose one of the bank accounts' } });
    const saved = file ? await this.files.save(file) : null;
    return this.db.transaction(async (tx) => {
      const [p] = await tx.select().from(payables).where(eq(payables.id, id)).for('update');
      if (!p) throw new NotFoundException({ message: 'Payable not found' });
      const left = p.amountCents - p.paidCents;
      if (left <= 0) throw new BadRequestException({ message: 'This bill is already paid' });
      if (input.amountCents > left) throw new BadRequestException({ message: 'Check the highlighted fields', fields: { amountCents: `Enter at most ${formatMoney(left)}` } });
      let proofId: string | null = null;
      if (saved) {
        const [d] = await tx.insert(documents).values({ type: 'upload', purchaseId: p.purchaseId, label: 'Payment proof', filePath: saved.path, fileName: saved.name, mimeType: saved.mime, data: { payableId: id }, createdById: auth.user.id }).returning();
        proofId = d.id;
      }
      await tx.insert(payablePayments).values({ payableId: id, paidOn: input.paidOn, amountCents: input.amountCents, paidFrom: input.paidFrom, bankReference: input.bankReference || null, proofDocumentId: proofId, recordedById: auth.user.id });
      const paidCents = p.paidCents + input.amountCents;
      await tx.update(payables).set({ paidCents }).where(eq(payables.id, id));
      const part = paidCents < p.amountCents;
      const [pur] = p.purchaseId ? await tx.select({ number: purchases.number }).from(purchases).where(eq(purchases.id, p.purchaseId)) : [];
      await this.audit.log(
        auth,
        {
          category: 'payments',
          action: part ? 'supplier_part_payment_recorded' : 'supplier_payment_recorded',
          recordType: 'payable',
          recordId: id,
          recordLabel: [pur?.number, p.party, p.invoiceNumber].filter(Boolean).join(' · '),
          money: true,
          changes: { paidCents: { from: p.paidCents, to: paidCents } },
          meta: { kind: p.kind, paidOn: input.paidOn, amountCents: input.amountCents, paidFrom: input.paidFrom, bankReference: input.bankReference ?? null, proofDocumentId: proofId },
        },
        tx,
      );
      return { paidCents, stillToPayCents: p.amountCents - paidCents, part };
    });
  }

  /** FR-PUR-5: purchase, carrier and mode, route, when, status. */
  async shipments(q: { filter?: string }) {
    const cond = q.filter && ['booked', 'in_transit', 'arrived'].includes(q.filter) ? eq(shipments.status, q.filter as 'booked') : undefined;
    const rows = await this.db
      .select({ s: shipments, purchaseNumber: purchases.number, purchaseStatus: purchases.status, expectedOn: purchases.expectedOn, supplierName: suppliers.company })
      .from(shipments)
      .innerJoin(purchases, eq(purchases.id, shipments.purchaseId))
      .innerJoin(suppliers, eq(suppliers.id, purchases.supplierId))
      .where(cond)
      .orderBy(sql`case ${shipments.status} when 'in_transit' then 0 when 'booked' then 1 else 2 end`, desc(sql`coalesce(${shipments.arriveOn}, ${shipments.departOn})`))
      .limit(500);
    const [c] = await this.db
      .select({
        all: sql<number>`count(*)::int`,
        booked: sql<number>`count(*) filter (where ${shipments.status} = 'booked')::int`,
        in_transit: sql<number>`count(*) filter (where ${shipments.status} = 'in_transit')::int`,
        arrived: sql<number>`count(*) filter (where ${shipments.status} = 'arrived')::int`,
      })
      .from(shipments);
    const today = isoDate();
    return {
      items: rows.map((r) => ({ ...r.s, purchaseNumber: r.purchaseNumber, purchaseStatus: r.purchaseStatus, supplierName: r.supplierName, late: r.s.status !== 'arrived' && !!r.s.arriveOn && r.s.arriveOn < today })),
      counts: c,
    };
  }

  /** Bank accounts to pay from (Settings › Bank). */
  async accounts() {
    return (await this.settings.get('bank')).accounts;
  }
}


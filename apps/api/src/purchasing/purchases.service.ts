import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import {
  FLAVOURS,
  UNITS_PER_CARTON,
  VAT_RATE,
  addDays,
  exciseCentsForUnits,
  isoDate,
  landedUnitCostCents,
  type CartonsByFlavour,
  type Flavour,
  type PurchaseInput,
} from '@ananda/shared';
import { InjectDb, type Db, type Tx } from '../db/db.module';
import { documents, payablePayments, payables, purchaseLines, purchases, shipments, supplierMessages, suppliers, users } from '../db/schema';
import { AuditService } from '../core/audit.service';
import { NumberingService } from '../core/numbering.service';
import { SettingsService } from '../core/settings.service';
import { StockService } from '../core/stock.service';
import { MailService } from '../core/mail.service';
import { NotifyService } from '../core/notify.service';
import { FilesService } from '../core/files.service';
import { OrdersService } from '../orders/orders.service';
import type { AuthContext } from '../common/context';
import type { OnTheWayBody, ReceiveBody, SupplierInvoiceBody, UploadedFile } from './purchasing.schemas';

type PurchaseRow = typeof purchases.$inferSelect;
type FreightInput = { carrier: string; amountNetCents: number; vatRate: number; invoiceNumber?: string; payBy: string };

const OPEN = ['ordered', 'on_the_way'] as const;
const CUSTOMS = 'Customs Agency';

/** Suppliers outside Bulgaria invoice without VAT (intra-EU reverse charge). */
export function supplierVatRate(country: string) {
  return country === 'BG' ? VAT_RATE : 0;
}

function withVat(netCents: number, rate: number) {
  return netCents + Math.round(netCents * rate);
}

function daysLate(expectedOn: string, status: string, today: string) {
  if (!(OPEN as readonly string[]).includes(status) || expectedOn >= today) return 0;
  return Math.round((new Date(today).getTime() - new Date(expectedOn).getTime()) / 86_400_000);
}

/** A calendar day (YYYY-MM-DD) as local midnight, so adding days never shifts the date. */
function day(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

const lateCond = (today: string) => and(inArray(purchases.status, [...OPEN]), lt(purchases.expectedOn, today))!;

@Injectable()
export class PurchasesService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly settings: SettingsService,
    private readonly stock: StockService,
    private readonly mail: MailService,
    private readonly notify: NotifyService,
    private readonly files: FilesService,
    private readonly orders: OrdersService,
  ) {}

  // ---------- Reading ----------

  /**
   * What a purchase still costs us: its payables, plus the goods while the supplier invoice has
   * not arrived (FR-PUR-1 "to pay", FR-PUR-6 tiles).
   */
  private owed(p: Pick<PurchaseRow, 'goodsCents' | 'supplierInvoiceReceived' | 'status'>, country: string, payableCents: number, paidCents: number) {
    const expected = p.status === 'cancelled' || p.supplierInvoiceReceived ? 0 : withVat(p.goodsCents, supplierVatRate(country));
    const total = payableCents + expected;
    return { payableCents: total, paidCents, stillToPayCents: Math.max(0, total - paidCents), notInvoicedCents: expected };
  }

  private filterCond(filter: string | undefined, today: string): SQL | undefined {
    switch (filter) {
      case 'open':
        return inArray(purchases.status, [...OPEN]);
      case 'late':
        return lateCond(today);
      case 'received':
        return eq(purchases.status, 'received');
      default:
        return undefined;
    }
  }

  async list(q: { filter?: string; q?: string }) {
    const today = isoDate();
    const base: SQL[] = [];
    if (q.q?.trim()) {
      const like = `%${q.q.trim()}%`;
      base.push(or(ilike(purchases.number, like), ilike(suppliers.company, like))!);
    }
    const rows = await this.db
      .select({
        p: purchases,
        supplierName: suppliers.company,
        supplierCountry: suppliers.country,
        payableCents: sql<number>`coalesce((select sum(${payables.amountCents}) from ${payables} where ${payables.purchaseId} = ${purchases.id}), 0)::int`,
        paidCents: sql<number>`coalesce((select sum(${payables.paidCents}) from ${payables} where ${payables.purchaseId} = ${purchases.id}), 0)::int`,
      })
      .from(purchases)
      .innerJoin(suppliers, eq(suppliers.id, purchases.supplierId))
      .where(and(...base, this.filterCond(q.filter, today)))
      .orderBy(desc(purchases.orderedOn), desc(purchases.number));

    const [counts] = await this.db
      .select({
        all: sql<number>`count(*)::int`,
        open: sql<number>`count(*) filter (where ${inArray(purchases.status, [...OPEN])})::int`,
        late: sql<number>`count(*) filter (where ${lateCond(today)})::int`,
        received: sql<number>`count(*) filter (where ${purchases.status} = 'received')::int`,
      })
      .from(purchases)
      .innerJoin(suppliers, eq(suppliers.id, purchases.supplierId))
      .where(and(...base));

    const items = rows.map((r) => {
      const m = this.owed(r.p, r.supplierCountry, Number(r.payableCents), Number(r.paidCents));
      return {
        id: r.p.id,
        number: r.p.number,
        status: r.p.status,
        supplierName: r.supplierName,
        supplierCountry: r.supplierCountry,
        orderedOn: r.p.orderedOn,
        expectedOn: r.p.expectedOn,
        arrivedOn: r.p.arrivedOn,
        totalCartons: r.p.totalCartons,
        totalUnits: r.p.totalUnits,
        unitsReceived: r.p.unitsReceived,
        supplierInvoiceReceived: r.p.supplierInvoiceReceived,
        stillToPayCents: m.stillToPayCents,
        daysLate: daysLate(r.p.expectedOn, r.p.status, today),
      };
    });
    return { items, counts, tiles: await this.tiles(today) };
  }

  /** FR-PUR-1 tiles. On the way comes from StockService so it matches Inventory and Home. */
  private async tiles(today: string) {
    const [overview, owedRows] = await Promise.all([
      this.stock.overview(),
      this.db
        .select({
          p: purchases,
          country: suppliers.country,
          payableCents: sql<number>`coalesce((select sum(${payables.amountCents}) from ${payables} where ${payables.purchaseId} = ${purchases.id} and ${payables.kind} = 'supplier_invoice'), 0)::int`,
          paidCents: sql<number>`coalesce((select sum(${payables.paidCents}) from ${payables} where ${payables.purchaseId} = ${purchases.id} and ${payables.kind} = 'supplier_invoice'), 0)::int`,
        })
        .from(purchases)
        .innerJoin(suppliers, eq(suppliers.id, purchases.supplierId))
        .where(sql`${purchases.status} <> 'cancelled'`),
    ]);
    const onTheWayUnits = overview.reduce((s, f) => s + f.onTheWay, 0);
    let toPaySuppliersCents = 0;
    let notInvoicedCents = 0;
    for (const r of owedRows) {
      const m = this.owed(r.p, r.country, Number(r.payableCents), Number(r.paidCents));
      toPaySuppliersCents += m.stillToPayCents;
      notInvoicedCents += m.notInvoicedCents;
    }
    const [late] = await this.db.select({ n: sql<number>`count(*)::int`, oldest: sql<string | null>`min(${purchases.expectedOn})::text` }).from(purchases).where(lateCond(today));
    return {
      onTheWayUnits,
      onTheWayCartons: Math.round(onTheWayUnits / UNITS_PER_CARTON),
      toPaySuppliersCents,
      notInvoicedCents,
      late: Number(late.n),
      oldestLateDays: late.oldest ? daysLate(late.oldest, 'ordered', today) : 0,
    };
  }

  private async load(id: string, tx: Db | Tx = this.db, lock = false) {
    const q = tx.select().from(purchases).where(eq(purchases.id, id));
    const [p] = lock ? await q.for('update') : await q;
    if (!p) throw new NotFoundException({ message: 'Purchase not found' });
    const [supplier] = await tx.select().from(suppliers).where(eq(suppliers.id, p.supplierId));
    const lines = await tx.select().from(purchaseLines).where(eq(purchaseLines.purchaseId, id));
    lines.sort((a, b) => FLAVOURS.indexOf(a.flavour) - FLAVOURS.indexOf(b.flavour));
    return { p, supplier, lines };
  }

  async detail(id: string) {
    const today = isoDate();
    const { p, supplier, lines } = await this.load(id);
    const [pays, ships, docs, messages, waiting, rules] = await Promise.all([
      this.db.select().from(payables).where(eq(payables.purchaseId, id)).orderBy(asc(payables.dueOn)),
      this.db.select().from(shipments).where(eq(shipments.purchaseId, id)).orderBy(asc(shipments.createdAt)),
      this.db.select({ d: documents, by: users.name }).from(documents).leftJoin(users, eq(users.id, documents.createdById)).where(eq(documents.purchaseId, id)).orderBy(desc(documents.createdAt)),
      this.db.select({ m: supplierMessages, by: users.name }).from(supplierMessages).leftJoin(users, eq(users.id, supplierMessages.sentById)).where(eq(supplierMessages.purchaseId, id)).orderBy(desc(supplierMessages.createdAt)),
      this.orders.waitingForStock(),
      this.settings.rules(),
    ]);
    const payments = pays.length ? await this.db.select().from(payablePayments).where(inArray(payablePayments.payableId, pays.map((x) => x.id))).orderBy(asc(payablePayments.paidOn)) : [];

    const received = p.status === 'received';
    const units = received ? (p.unitsReceived ?? 0) : p.totalUnits;
    const exciseCents = received ? p.exciseCents : exciseCentsForUnits(p.totalUnits);
    const inventoryCostCents = p.goodsCents + p.freightCents + exciseCents;
    const landed = received && p.landedUnitCostCents != null ? Number(p.landedUnitCostCents) : landedUnitCostCents(p.goodsCents, p.freightCents, exciseCents, units);
    const m = this.owed(p, supplier.country, pays.reduce((s, x) => s + x.amountCents, 0), pays.reduce((s, x) => s + x.paidCents, 0));

    const invoice = pays.find((x) => x.kind === 'supplier_invoice');
    const invoicePaid = !!invoice && invoice.paidCents >= invoice.amountCents;
    const invoicePayments = invoice ? payments.filter((x) => x.payableId === invoice.id) : [];
    const departed = ships.find((s) => s.departOn)?.departOn ?? null;
    const steps = {
      ordered: { done: true, on: p.orderedOn },
      on_the_way: { done: p.status === 'on_the_way' || received, on: departed },
      supplier_invoice: { done: p.supplierInvoiceReceived, on: invoice ? isoDate(invoice.createdAt) : null, number: invoice?.invoiceNumber ?? null },
      paid_supplier: { done: invoicePaid, on: invoicePaid ? (invoicePayments.at(-1)?.paidOn ?? null) : null },
      landed_cost: { done: received && p.landedUnitCostCents != null, on: p.arrivedOn },
    };

    const flavours = lines.map((l) => l.flavour);
    const waitingOn = waiting
      .filter((o) => o.lines.some((l) => flavours.includes(l.flavour)))
      .map((o) => ({ ...o, units: o.lines.filter((l) => flavours.includes(l.flavour)).reduce((s, l) => s + l.units, 0) }));

    const open = (OPEN as readonly string[]).includes(p.status);
    const actions: string[] = [];
    if (p.status === 'ordered') actions.push('on_the_way');
    if (open) actions.push('receive');
    if (p.status !== 'cancelled') actions.push('ask', 'freight', 'upload');
    if (p.status !== 'cancelled' && !p.supplierInvoiceReceived) actions.push('invoice');

    return {
      purchase: {
        ...p,
        landedUnitCostCents: p.landedUnitCostCents == null ? null : Number(p.landedUnitCostCents),
        daysLate: daysLate(p.expectedOn, p.status, today),
      },
      supplier,
      lines: lines.map((l) => ({ ...l, unitPriceCents: Number(l.unitPriceCents), lineCents: Math.round(l.units * Number(l.unitPriceCents)) })),
      figures: {
        goodsCents: p.goodsCents,
        freightCents: p.freightCents,
        exciseCents,
        exciseEstimated: !received,
        inventoryCostCents,
        landedUnitCostCents: landed,
        landedEstimated: !received,
        units,
        supplierVatRate: supplierVatRate(supplier.country),
        ...m,
      },
      payables: pays.map((x) => ({ ...x, vatRate: Number(x.vatRate), stillToPayCents: Math.max(0, x.amountCents - x.paidCents), payments: payments.filter((y) => y.payableId === x.id) })),
      shipments: ships,
      documents: docs.map((r) => ({ id: r.d.id, type: r.d.type, number: r.d.number, label: r.d.label, fileName: r.d.fileName, hasFile: !!r.d.filePath, totalCents: r.d.totalCents, createdAt: r.d.createdAt, by: r.by })),
      messages: messages.map((r) => ({ ...r.m, by: r.by })),
      waiting: waitingOn,
      steps,
      actions,
      followUpDays: rules.supplierFollowUpDays,
    };
  }

  // ---------- Writes ----------

  /** FR-PUR-2: next P-number and a purchase order document, in one transaction. */
  async create(auth: AuthContext, input: PurchaseInput) {
    return this.db.transaction(async (tx) => {
      const [supplier] = await tx.select().from(suppliers).where(eq(suppliers.id, input.supplierId)).for('share');
      if (!supplier || supplier.status !== 'approved') throw new BadRequestException({ message: 'Check the highlighted fields', fields: { supplierId: 'Choose an approved supplier' } });
      const cartons = input.cartons as CartonsByFlavour;
      const lines = FLAVOURS.filter((f) => (cartons[f] ?? 0) > 0).map((flavour) => ({ flavour, cartons: cartons[flavour]!, units: cartons[flavour]! * UNITS_PER_CARTON }));
      if (!lines.length) throw new BadRequestException({ message: 'Check the highlighted fields', fields: { cartons: 'Enter cartons for at least one flavour' } });
      const notApproved = lines.filter((l) => !supplier.approvedFlavours.includes(l.flavour));
      if (notApproved.length) throw new BadRequestException({ message: 'Check the highlighted fields', fields: { cartons: `${supplier.company} is not approved for ${notApproved.map((l) => l.flavour.toUpperCase()).join(', ')}` } });
      const today = isoDate();
      if (input.expectedOn < today) throw new BadRequestException({ message: 'Check the highlighted fields', fields: { expectedOn: 'Choose today or a later date' } });

      const price = Number(supplier.unitPriceCents);
      const totalUnits = lines.reduce((s, l) => s + l.units, 0);
      const totalCartons = lines.reduce((s, l) => s + l.cartons, 0);
      const goodsCents = Math.round(totalUnits * price);
      const number = await this.numbering.next(tx, 'purchase');
      const [p] = await tx
        .insert(purchases)
        .values({ number, supplierId: supplier.id, status: 'ordered', orderedOn: today, expectedOn: input.expectedOn, totalCartons, totalUnits, goodsCents, note: input.note || null, createdById: auth.user.id })
        .returning();
      await tx.insert(purchaseLines).values(lines.map((l) => ({ purchaseId: p.id, ...l, unitPriceCents: price })));
      const company = await this.settings.get('company', tx);
      await tx.insert(documents).values({
        type: 'purchase_order',
        number,
        purchaseId: p.id,
        language: 'en',
        totalCents: goodsCents,
        label: 'Purchase order',
        createdById: auth.user.id,
        data: {
          number,
          orderedOn: today,
          expectedOn: input.expectedOn,
          company: { name: company.legalName || company.name, vatNumber: company.vatNumber, address: [company.address, company.city].filter(Boolean).join(', '), email: company.email, phone: company.phone },
          supplier: { company: supplier.company, country: supplier.country, vatNumber: supplier.vatNumber, contactName: supplier.contactName, ordersEmail: supplier.ordersEmail },
          lines: lines.map((l) => ({ ...l, unitPriceCents: price, lineCents: Math.round(l.units * price) })),
          totalCartons,
          totalUnits,
          goodsCents,
          paymentTermsDays: supplier.paymentTermsDays,
          note: input.note || null,
        },
      });
      await this.audit.log(
        auth,
        { category: 'purchasing', action: 'purchase_created', recordType: 'purchase', recordId: p.id, recordLabel: number, money: true, changes: { goodsCents: { from: null, to: goodsCents } }, meta: { supplier: supplier.company, cartons: Object.fromEntries(lines.map((l) => [l.flavour, l.cartons])), expectedOn: input.expectedOn } },
        tx,
      );
      return { id: p.id, number };
    });
  }

  async markOnTheWay(auth: AuthContext, id: string, input: OnTheWayBody) {
    return this.db.transaction(async (tx) => {
      const { p } = await this.load(id, tx, true);
      if (p.status !== 'ordered') throw new ConflictException({ message: 'Only an ordered purchase can be marked as on the way' });
      const expectedOn = input.expectedOn ?? p.expectedOn;
      await tx.update(purchases).set({ status: 'on_the_way', expectedOn }).where(eq(purchases.id, id));
      if (input.shipment) {
        await tx.insert(shipments).values({ purchaseId: id, ...input.shipment, route: input.shipment.route || null, departOn: input.shipment.departOn ?? isoDate(), arriveOn: input.shipment.arriveOn ?? expectedOn, status: 'in_transit' });
      } else {
        await tx.update(shipments).set({ status: 'in_transit' }).where(and(eq(shipments.purchaseId, id), eq(shipments.status, 'booked')));
      }
      const changes: Record<string, { from: unknown; to: unknown }> = { status: { from: p.status, to: 'on_the_way' } };
      if (expectedOn !== p.expectedOn) changes.expectedOn = { from: p.expectedOn, to: expectedOn };
      await this.audit.log(auth, { category: 'purchasing', action: 'purchase_on_the_way', recordType: 'purchase', recordId: id, recordLabel: p.number, changes }, tx);
      return { status: 'on_the_way' };
    });
  }

  private async saveUpload(file: UploadedFile | undefined) {
    if (!file) return null;
    if (!this.files.isAllowed(file.mimetype)) throw new BadRequestException({ message: 'Upload a photo (JPG, PNG, HEIC) or a PDF' });
    return this.files.save(file);
  }

  private async insertUpload(tx: Tx, auth: AuthContext, purchaseId: string, saved: Awaited<ReturnType<FilesService['save']>> | null, label: string, data: Record<string, unknown> = {}) {
    if (!saved) return null;
    const [d] = await tx.insert(documents).values({ type: 'upload', purchaseId, label, filePath: saved.path, fileName: saved.name, mimeType: saved.mime, data, createdById: auth.user.id }).returning();
    return d.id;
  }

  /** Upserts the freight bill on Payables; paid amounts are never cut below what was paid. */
  private async writeFreight(tx: Tx, p: PurchaseRow, input: FreightInput, documentId: string | null) {
    const amountCents = withVat(input.amountNetCents, input.vatRate);
    const [existing] = await tx.select().from(payables).where(and(eq(payables.purchaseId, p.id), eq(payables.kind, 'freight'))).for('update');
    const values = { party: input.carrier, invoiceNumber: input.invoiceNumber || null, dueOn: input.payBy, netCents: input.amountNetCents, vatRate: input.vatRate, amountCents };
    if (existing) {
      if (existing.paidCents > amountCents) throw new BadRequestException({ message: 'Check the highlighted fields', fields: { amountNetCents: 'This is less than what was already paid to the carrier' } });
      await tx.update(payables).set({ ...values, documentId: documentId ?? existing.documentId }).where(eq(payables.id, existing.id));
    } else {
      await tx.insert(payables).values({ kind: 'freight', purchaseId: p.id, ...values, documentId });
    }
    await tx.update(purchases).set({ freightCents: input.amountNetCents }).where(eq(purchases.id, p.id));
    return { before: existing ? { netCents: existing.netCents, amountCents: existing.amountCents } : null, amountCents };
  }

  private async resolveMessages(tx: Tx, purchaseId: string, topics: string[]) {
    if (!topics.length) return;
    await tx
      .update(supplierMessages)
      .set({ resolvedAt: new Date() })
      .where(and(eq(supplierMessages.purchaseId, purchaseId), isNull(supplierMessages.resolvedAt), inArray(supplierMessages.topic, topics)));
  }

  /**
   * FR-PUR-7: adds stock, calculates excise and landed cost, creates the payables and makes waiting
   * orders allocatable. The supplier invoice may come later.
   */
  async receive(auth: AuthContext, id: string, input: ReceiveBody, uploads: { supplierInvoice?: UploadedFile; carrierInvoice?: UploadedFile }) {
    const [invoiceFile, carrierFile] = await Promise.all([this.saveUpload(uploads.supplierInvoice), this.saveUpload(uploads.carrierInvoice)]);
    if (input.arrivedOn > isoDate()) throw new BadRequestException({ message: 'Check the highlighted fields', fields: { arrivedOn: 'The arrival date cannot be in the future' } });
    const result = await this.db.transaction(async (tx) => {
      const { p, supplier, lines } = await this.load(id, tx, true);
      if (!(OPEN as readonly string[]).includes(p.status)) throw new ConflictException({ message: 'This purchase has already been received' });

      let unitsReceived = 0;
      const counted: Partial<Record<Flavour, number>> = {};
      for (const l of lines) {
        const n = Math.max(0, Math.floor(input.unitsReceived[l.flavour] ?? l.units));
        counted[l.flavour] = n;
        unitsReceived += n;
        await tx.update(purchaseLines).set({ unitsReceived: n }).where(eq(purchaseLines.id, l.id));
        await this.stock.move(tx, { flavour: l.flavour, units: n, kind: 'purchase_receipt', purchaseId: id, byId: auth.user.id });
      }
      if (unitsReceived <= 0) throw new BadRequestException({ message: 'Check the highlighted fields', fields: { unitsReceived: 'Enter the units counted' } });

      const hasInvoice = !!(input.supplierInvoiceNumber || invoiceFile);
      const goodsCents = hasInvoice && input.invoiceNetCents != null ? input.invoiceNetCents : p.goodsCents;
      const exciseCents = exciseCentsForUnits(unitsReceived);

      let freightCents = p.freightCents;
      if (input.freight) {
        const carrierDocId = await this.insertUpload(tx, auth, id, carrierFile, 'Carrier invoice');
        await this.writeFreight(tx, p, input.freight, carrierDocId);
        freightCents = input.freight.amountNetCents;
      } else if (carrierFile) {
        const carrierDocId = await this.insertUpload(tx, auth, id, carrierFile, 'Carrier invoice');
        await tx.update(payables).set({ documentId: carrierDocId }).where(and(eq(payables.purchaseId, id), eq(payables.kind, 'freight')));
      }

      const landed = landedUnitCostCents(goodsCents, freightCents, exciseCents, unitsReceived);
      await tx
        .update(purchases)
        .set({ status: 'received', arrivedOn: input.arrivedOn, unitsReceived, goodsCents, freightCents, exciseCents, landedUnitCostCents: landed, supplierInvoiceReceived: hasInvoice })
        .where(eq(purchases.id, id));

      if (hasInvoice) {
        const invoiceDocId = await this.insertUpload(tx, auth, id, invoiceFile, 'Supplier invoice', { invoiceNumber: input.supplierInvoiceNumber ?? null });
        const rate = supplierVatRate(supplier.country);
        await tx.insert(payables).values({
          kind: 'supplier_invoice',
          party: supplier.company,
          supplierId: supplier.id,
          purchaseId: id,
          invoiceNumber: input.supplierInvoiceNumber || null,
          dueOn: input.supplierInvoiceDueOn ?? isoDate(addDays(day(input.arrivedOn), supplier.paymentTermsDays)),
          netCents: goodsCents,
          vatRate: rate,
          amountCents: withVat(goodsCents, rate),
          documentId: invoiceDocId,
        });
      }
      await tx.insert(payables).values({ kind: 'excise', party: CUSTOMS, purchaseId: id, dueOn: input.arrivedOn, netCents: exciseCents, vatRate: 0, amountCents: exciseCents });
      await tx.update(shipments).set({ status: 'arrived', arriveOn: input.arrivedOn }).where(eq(shipments.purchaseId, id));
      await this.resolveMessages(tx, id, hasInvoice ? ['arrival_date', 'tracking', 'invoice_copy'] : ['arrival_date', 'tracking']);

      await this.audit.log(
        auth,
        {
          category: 'purchasing',
          action: 'purchase_received',
          recordType: 'purchase',
          recordId: id,
          recordLabel: p.number,
          money: true,
          changes: {
            status: { from: p.status, to: 'received' },
            unitsReceived: { from: null, to: unitsReceived },
            goodsCents: { from: p.goodsCents, to: goodsCents },
            freightCents: { from: p.freightCents, to: freightCents },
            exciseCents: { from: p.exciseCents, to: exciseCents },
            landedUnitCostCents: { from: null, to: landed },
          },
          meta: { arrivedOn: input.arrivedOn, counted, supplierInvoice: hasInvoice },
        },
        tx,
      );
      return { number: p.number, flavours: lines.map((l) => l.flavour), landedUnitCostCents: landed, unitsReceived, exciseCents };
    });

    // Waiting orders can now be allocated (FR-PUR-7, FR-INV-3).
    const waiting = (await this.orders.waitingForStock()).filter((o) => o.lines.some((l) => result.flavours.includes(l.flavour)));
    if (waiting.length) {
      await this.notify.toRoles(['system_admin', 'admin'], {
        type: 'stock_arrived',
        title: `${result.number} received · ${waiting.length} ${waiting.length === 1 ? 'order' : 'orders'} can be allocated`,
        body: waiting.map((o) => o.number).join(', '),
        link: '/inventory?allocate=1',
      });
    }
    return { ...result, waitingOrders: waiting.length };
  }

  /** The supplier invoice arrives after receiving (or before it): creates the supplier payable. */
  async recordInvoice(auth: AuthContext, id: string, input: SupplierInvoiceBody, file?: UploadedFile) {
    const saved = await this.saveUpload(file);
    return this.db.transaction(async (tx) => {
      const { p, supplier } = await this.load(id, tx, true);
      if (p.status === 'cancelled') throw new ConflictException({ message: 'This purchase is cancelled' });
      if (p.supplierInvoiceReceived) throw new ConflictException({ message: 'The supplier invoice is already recorded' });
      const goodsCents = input.netCents ?? p.goodsCents;
      const rate = supplierVatRate(supplier.country);
      const docId = await this.insertUpload(tx, auth, id, saved, 'Supplier invoice', { invoiceNumber: input.invoiceNumber });
      await tx.insert(payables).values({ kind: 'supplier_invoice', party: supplier.company, supplierId: supplier.id, purchaseId: id, invoiceNumber: input.invoiceNumber, dueOn: input.dueOn, netCents: goodsCents, vatRate: rate, amountCents: withVat(goodsCents, rate), documentId: docId });
      const landed = p.status === 'received' && p.unitsReceived ? landedUnitCostCents(goodsCents, p.freightCents, p.exciseCents, p.unitsReceived) : null;
      await tx
        .update(purchases)
        .set({ supplierInvoiceReceived: true, goodsCents, ...(landed != null ? { landedUnitCostCents: landed } : {}) })
        .where(eq(purchases.id, id));
      await this.resolveMessages(tx, id, ['invoice_copy']);
      const changes: Record<string, { from: unknown; to: unknown }> = { supplierInvoiceReceived: { from: false, to: true } };
      if (goodsCents !== p.goodsCents) changes.goodsCents = { from: p.goodsCents, to: goodsCents };
      if (landed != null && landed !== Number(p.landedUnitCostCents)) changes.landedUnitCostCents = { from: Number(p.landedUnitCostCents), to: landed };
      await this.audit.log(auth, { category: 'purchasing', action: 'supplier_invoice_recorded', recordType: 'purchase', recordId: id, recordLabel: p.number, money: true, changes, meta: { invoiceNumber: input.invoiceNumber, dueOn: input.dueOn } }, tx);
      return { ok: true };
    });
  }

  /**
   * FR-PUR-8: saving puts the freight bill on Payables and recomputes landed cost. Orders already
   * paid keep the purchase cost they were counted with (orders.purchase_cost_cents is not touched).
   */
  async saveFreight(auth: AuthContext, id: string, input: FreightInput, file?: UploadedFile) {
    const saved = await this.saveUpload(file);
    return this.db.transaction(async (tx) => {
      const { p } = await this.load(id, tx, true);
      if (p.status === 'cancelled') throw new ConflictException({ message: 'This purchase is cancelled' });
      const docId = await this.insertUpload(tx, auth, id, saved, 'Carrier invoice');
      const { before, amountCents } = await this.writeFreight(tx, p, input, docId);
      let landed: number | null = p.landedUnitCostCents == null ? null : Number(p.landedUnitCostCents);
      if (p.status === 'received' && p.unitsReceived) {
        landed = landedUnitCostCents(p.goodsCents, input.amountNetCents, p.exciseCents, p.unitsReceived);
        await tx.update(purchases).set({ landedUnitCostCents: landed }).where(eq(purchases.id, id));
      }
      await this.audit.log(
        auth,
        {
          category: 'purchasing',
          action: 'freight_saved',
          recordType: 'purchase',
          recordId: id,
          recordLabel: p.number,
          money: true,
          changes: {
            freightCents: { from: p.freightCents, to: input.amountNetCents },
            freightPayableCents: { from: before?.amountCents ?? null, to: amountCents },
            ...(p.status === 'received' ? { landedUnitCostCents: { from: Number(p.landedUnitCostCents), to: landed } } : {}),
          },
          meta: { carrier: input.carrier, invoiceNumber: input.invoiceNumber ?? null, payBy: input.payBy },
        },
        tx,
      );
      return { freightCents: input.amountNetCents, landedUnitCostCents: landed };
    });
  }

  /** FR-PUR-9: saved on the purchase with a follow-up date, then e-mailed. */
  async askSupplier(auth: AuthContext, id: string, input: { topic: string; to: string; subject: string; body: string }) {
    const msg = await this.db.transaction(async (tx) => {
      const { p } = await this.load(id, tx, true);
      if (p.status === 'cancelled') throw new ConflictException({ message: 'This purchase is cancelled' });
      const rules = await this.settings.rules(tx);
      const followUpOn = isoDate(addDays(new Date(), rules.supplierFollowUpDays));
      const [m] = await tx.insert(supplierMessages).values({ purchaseId: id, topic: input.topic, to: input.to, subject: input.subject, body: input.body, sentById: auth.user.id, followUpOn }).returning();
      await this.audit.log(auth, { category: 'purchasing', action: 'supplier_asked', recordType: 'purchase', recordId: id, recordLabel: p.number, meta: { topic: input.topic, to: input.to, followUpOn } }, tx);
      return m;
    });
    await this.mail.send({ to: [input.to], cc: [auth.user.email], subject: input.subject, body: input.body, kind: 'supplier_message', recordType: 'purchase', recordId: id });
    return { id: msg.id, followUpOn: msg.followUpOn };
  }

  async resolveMessage(auth: AuthContext, id: string, messageId: string) {
    return this.db.transaction(async (tx) => {
      const [m] = await tx.select().from(supplierMessages).where(and(eq(supplierMessages.id, messageId), eq(supplierMessages.purchaseId, id))).for('update');
      if (!m) throw new NotFoundException({ message: 'Message not found' });
      if (m.resolvedAt) return { ok: true };
      await tx.update(supplierMessages).set({ resolvedAt: new Date() }).where(eq(supplierMessages.id, messageId));
      const [p] = await tx.select({ number: purchases.number }).from(purchases).where(eq(purchases.id, id));
      await this.audit.log(auth, { category: 'purchasing', action: 'supplier_answered', recordType: 'purchase', recordId: id, recordLabel: p?.number, meta: { topic: m.topic } }, tx);
      return { ok: true };
    });
  }

  async upload(auth: AuthContext, id: string, file: UploadedFile | undefined, label?: string) {
    if (!file) throw new BadRequestException({ message: 'Choose a file to upload' });
    const saved = await this.saveUpload(file);
    return this.db.transaction(async (tx) => {
      const { p } = await this.load(id, tx, true);
      const docId = await this.insertUpload(tx, auth, id, saved, label || saved!.name);
      await this.audit.log(auth, { category: 'documents', action: 'uploaded', recordType: 'purchase', recordId: id, recordLabel: p.number, meta: { documentId: docId, label: label || saved!.name } }, tx);
      return { id: docId };
    });
  }

  /** Printable purchase order from its frozen snapshot. */
  async orderHtml(id: string) {
    const [doc] = await this.db.select().from(documents).where(and(eq(documents.purchaseId, id), eq(documents.type, 'purchase_order'))).orderBy(desc(documents.createdAt)).limit(1);
    if (!doc) throw new NotFoundException({ message: 'Purchase order not found' });
    const d = doc.data as {
      number: string;
      orderedOn: string;
      expectedOn: string;
      company?: Record<string, string | null>;
      supplier: { company: string; country?: string; vatNumber?: string | null; contactName?: string | null; ordersEmail?: string } | string;
      lines: { flavour: string; cartons: number; units: number; unitPriceCents?: number; lineCents?: number }[];
      goodsCents?: number;
      note?: string | null;
    };
    const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    const eur = (c: number | undefined) => (c == null ? '' : `€${(c / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`);
    const sup = typeof d.supplier === 'string' ? { company: d.supplier } : d.supplier;
    const rows = d.lines.map((l) => `<tr><td>${esc(l.flavour.toUpperCase())}</td><td class="n">${l.cartons}</td><td class="n">${l.units}</td><td class="a">${eur(l.unitPriceCents)}</td><td class="a">${eur(l.lineCents)}</td></tr>`).join('');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(doc.number)}</title><style>
body{font:14px/1.45 system-ui,sans-serif;color:#1a1a1a;background:#fff;max-width:760px;margin:32px auto;padding:0 16px}
h1{font-weight:400;font-size:24px;margin:0 0 4px}table{width:100%;border-collapse:collapse;margin-top:24px}
th,td{padding:8px;border-bottom:1px solid #ddd;text-align:start}.n{text-align:center}.a{text-align:end}.muted{color:#666}.grid{display:flex;gap:48px;margin-top:24px}
</style></head><body><h1>Purchase order ${esc(d.number)}</h1><div class="muted">Ordered ${esc(d.orderedOn)} · Expected ${esc(d.expectedOn)}</div>
<div class="grid"><div><strong>${esc(d.company?.name ?? '')}</strong><br>${esc(d.company?.address ?? '')}<br>${esc(d.company?.vatNumber ?? '')}</div>
<div><strong>${esc(sup.company)}</strong><br>${esc(sup.contactName ?? '')}<br>${esc(sup.ordersEmail ?? '')}<br>${esc(sup.vatNumber ?? '')}</div></div>
<table><thead><tr><th>Flavour</th><th class="n">Cartons</th><th class="n">Units</th><th class="a">Unit price</th><th class="a">Amount</th></tr></thead><tbody>${rows}</tbody>
<tfoot><tr><td colspan="4"><strong>Total excl. VAT</strong></td><td class="a"><strong>${eur(d.goodsCents)}</strong></td></tr></tfoot></table>
${d.note ? `<p class="muted">${esc(d.note)}</p>` : ''}</body></html>`;
  }
}

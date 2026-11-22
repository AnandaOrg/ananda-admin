import { BadRequestException, ForbiddenException, Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { FLAVOURS, PROFORMA_LANGUAGES, customerPaper, paperPage, type Flavour, type PaperBrand, type PaperDocData, type ProformaLanguage } from '@ananda/shared';
import { InjectDb, type Db, type DbOrTx } from '../db/db.module';
import { customers, documents, orders, users } from '../db/schema';
import { SettingsService } from '../core/settings.service';
import { FilesService } from '../core/files.service';
import { MailService } from '../core/mail.service';
import { NotifyService } from '../core/notify.service';
import { AuditService } from '../core/audit.service';
import { orderScope } from '../core/scope';
import type { AuthContext } from '../common/context';

type DocLine = { flavour: Flavour; cartons: number; units: number; unitPriceCents: number; lineNetCents: number };

export interface CustomerDocData {
  number: string;
  issuedOn: string;
  language: ProformaLanguage;
  company: Record<string, string>;
  bank: { bank: string; iban: string; bic: string };
  customer: { companyName: string; vatNumber: string; registeredAddress: string; deliveryAddress: string | null; contactName: string; invoiceEmail: string };
  orderNumber: string;
  brokerName: string;
  lines: DocLine[];
  netCents: number;
  vatCents: number;
  totalCents: number;
  dueOn?: string | null;
  validUntil?: string | null;
  references?: string | null;
  reason?: string | null;
  note?: string | null;
  units?: number;
  costCents?: number;
  commissionCents?: number;
  replaces?: string | null;
  priceAdjustment?: boolean;
  paymentTerms?: 'before_shipping' | 'half_before_shipping' | 'after_delivery_30' | null;
  depositCents?: number | null;
  paidCents?: number | null;
  paidOn?: string | null;
  paidMethod?: string | null;
  deliveredOn?: string | null;
}

@Injectable()
export class DocumentsService implements OnModuleInit {
  /** Logo (as a data URI, for printed and e-mailed documents) and footer from Settings › Documents. */
  private brandCache: { print: PaperBrand; app: PaperBrand } = { print: {}, app: {} };

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly files: FilesService,
    private readonly mail: MailService,
    private readonly notify: NotifyService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    void this.brand().catch(() => undefined);
  }

  /** Settings › Documents: logo and footer, for print/e-mail (data URI) and for the app (served by GET /documents/logo). */
  async brand(tx?: DbOrTx) {
    const docs = await this.settings.get('documents', tx);
    const footer = docs.footer?.trim() || null;
    let print: string | null = null;
    if (docs.logo) {
      try {
        print = `data:${docs.logo.mime};base64,${(await this.files.read(docs.logo.path)).toString('base64')}`;
      } catch {
        print = null;
      }
    }
    this.brandCache = { print: { logo: print, footer }, app: { logo: print ? `/api/documents/logo?v=${encodeURIComponent(docs.logo!.path.slice(-12))}` : null, footer } };
    return this.brandCache;
  }

  /** The company logo for the document panel: any signed-in user may see it (it is on every customer document). */
  async logo() {
    const docs = await this.settings.get('documents');
    if (!docs.logo) throw new NotFoundException({ message: 'No logo yet' });
    return { mime: docs.logo.mime, buffer: await this.files.read(docs.logo.path) };
  }

  /** The paper of a customer document as the app shows it: exactly what is printed and e-mailed. */
  async paper(auth: AuthContext, id: string) {
    const doc = await this.get(auth, id);
    if (doc.type !== 'proforma' && doc.type !== 'invoice' && doc.type !== 'credit_note') throw new NotFoundException({ message: 'Not printable' });
    const [next] = doc.supersededById ? await this.db.select({ number: documents.number }).from(documents).where(eq(documents.id, doc.supersededById)) : [];
    const brand = (await this.brand()).app;
    return { spec: customerPaper(doc.type, doc.data as unknown as PaperDocData, { replacedBy: next?.number ?? null, ...brand }) };
  }

  /**
   * Document language: Settings › Documents › proforma language. With one language switched on every
   * customer document is in it; otherwise ("Per customer") it follows the customer: English, Bulgarian or Hebrew.
   */
  async languageFor(customerLanguage: string, tx?: DbOrTx): Promise<ProformaLanguage> {
    const langs = (await this.settings.get('documents', tx)).languages ?? [...PROFORMA_LANGUAGES];
    if (langs.length === 1) return langs[0];
    return (PROFORMA_LANGUAGES as readonly string[]).includes(customerLanguage) ? (customerLanguage as ProformaLanguage) : 'en';
  }

  /** Snapshot of everything a customer document prints. Stored once; issued documents never change. */
  async customerDocData(
    tx: DbOrTx,
    orderId: string,
    number: string,
    lines: DocLine[],
    extra: Partial<CustomerDocData> = {},
  ): Promise<CustomerDocData> {
    const [row] = await tx
      .select({ order: orders, customer: customers, broker: users })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .innerJoin(users, eq(users.id, orders.brokerId))
      .where(eq(orders.id, orderId));
    const [company, bank, language] = await Promise.all([this.settings.get('company', tx), this.settings.get('bank', tx), this.languageFor(row.customer.proformaLanguage, tx)]);
    void this.brand().catch(() => undefined);
    const netCents = lines.reduce((s, l) => s + l.lineNetCents, 0);
    const vatCents = Math.round(netCents * 0.2);
    return {
      number,
      issuedOn: new Date().toISOString().slice(0, 10),
      language,
      company: { name: company.legalName || company.name, vatNumber: company.vatNumber, address: [company.address, company.city].filter(Boolean).join(', '), email: company.email, phone: company.phone },
      bank: { bank: bank.bank, iban: bank.iban, bic: bank.bic },
      customer: {
        companyName: row.customer.companyName,
        vatNumber: row.customer.vatNumber,
        registeredAddress: row.customer.registeredAddress,
        deliveryAddress: row.customer.deliveryAddress,
        contactName: row.customer.contactName,
        invoiceEmail: row.customer.invoiceEmail,
      },
      orderNumber: row.order.number,
      brokerName: row.broker.name,
      lines: FLAVOURS.flatMap((f) => lines.filter((l) => l.flavour === f)),
      netCents,
      vatCents,
      totalCents: netCents + vatCents,
      ...extra,
    };
  }

  async get(auth: AuthContext, id: string) {
    const [doc] = await this.db.select().from(documents).where(eq(documents.id, id));
    if (!doc) throw new NotFoundException({ message: 'Document not found' });
    await this.assertCanSee(auth, doc);
    return doc;
  }

  async file(auth: AuthContext, id: string) {
    const doc = await this.get(auth, id);
    if (!doc.filePath) throw new NotFoundException({ message: 'This document has no file' });
    const buffer = await this.files.read(doc.filePath);
    await this.markUploadOpened(auth, doc);
    return { doc, buffer };
  }

  /** "The Admin opened your upload": told once to the broker who uploaded it. */
  private async markUploadOpened(auth: AuthContext, doc: typeof documents.$inferSelect) {
    const data = (doc.data ?? {}) as Record<string, unknown>;
    if (doc.type !== 'upload' || !doc.orderId || !data.uploadKind || data.openedAt || auth.perms.scope !== 'all' || !doc.createdById || doc.createdById === auth.user.id) return;
    const [o] = await this.db.select({ number: orders.number, customer: customers.companyName }).from(orders).leftJoin(customers, eq(customers.id, orders.customerId)).where(eq(orders.id, doc.orderId));
    await this.db.update(documents).set({ data: { ...data, openedAt: new Date().toISOString(), openedById: auth.user.id } }).where(eq(documents.id, doc.id));
    await this.notify.send('upload_opened', { users: [doc.createdById] }, { doc: doc.label ?? 'Document', docKind: String(data.uploadKind), order: o?.number ?? '', customer: o?.customer ?? '' }, `/sales/${doc.orderId}`);
  }

  /** The printable page of a customer document, in the document's own language. */
  async page(auth: AuthContext, id: string, autoPrint = false) {
    const doc = await this.get(auth, id);
    if (doc.type !== 'proforma' && doc.type !== 'invoice' && doc.type !== 'credit_note') throw new NotFoundException({ message: 'Not printable' });
    const [next] = doc.supersededById ? await this.db.select({ number: documents.number }).from(documents).where(eq(documents.id, doc.supersededById)) : [];
    await this.brand();
    return { doc, html: this.renderHtml(doc.type, doc.data as unknown as CustomerDocData, { replacedBy: next?.number ?? null, autoPrint }) };
  }

  /** E-mail a customer document again (Documents › eye › E-mail it). */
  async email(auth: AuthContext, id: string, input: { to: string[]; subject: string; message: string }) {
    if (auth.perms.areas.sales !== 'edit') throw new ForbiddenException({ message: 'You do not have access to this' });
    const { doc, html } = await this.page(auth, id);
    const to = input.to.map((x) => x.trim()).filter(Boolean);
    if (!to.length || to.some((x) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x))) throw new BadRequestException({ message: 'Enter a valid e-mail address', fields: { to: 'Enter a valid e-mail address' } });
    await this.mail.send({ kind: `document_${doc.type}`, to, subject: input.subject, body: input.message, recordType: 'order', recordId: doc.orderId ?? undefined, attachments: [{ filename: `${doc.number ?? 'document'}.html`, content: html, contentType: 'text/html' }] });
    await this.audit.log(auth, { category: 'documents', action: 'document_emailed', recordType: 'order', recordId: doc.orderId ?? doc.id, recordLabel: doc.number ?? undefined, meta: { documentId: doc.id, to } });
    return { ok: true };
  }

  private async assertCanSee(auth: AuthContext, doc: typeof documents.$inferSelect) {
    if (auth.perms.scope === 'all') return;
    // Warehouse never sees customer money documents; only delivery notes of orders it ships.
    if (auth.perms.scope === 'shipping' && doc.type !== 'delivery_note') throw new ForbiddenException({ message: 'You do not have access to this' });
    if (!doc.orderId) throw new ForbiddenException({ message: 'You do not have access to this' });
    const [o] = await this.db.select({ id: orders.id }).from(orders).where(and(eq(orders.id, doc.orderId), orderScope(auth)));
    if (!o) throw new ForbiddenException({ message: 'You do not have access to this' });
  }

  /** Print-ready HTML of a customer document: the same paper as the app's document panel (PRO-0008 style). */
  renderHtml(type: 'proforma' | 'invoice' | 'credit_note', d: CustomerDocData, opts: { replacedBy?: string | null; autoPrint?: boolean } = {}): string {
    return paperPage(customerPaper(type, d as PaperDocData, { replacedBy: opts.replacedBy, ...this.brandCache.print }), { title: d.number, autoPrint: opts.autoPrint });
  }
}

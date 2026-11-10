import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { FLAVOURS, formatDate, formatMoney, formatUnitPrice, type Flavour } from '@ananda/shared';
import { InjectDb, type Db, type DbOrTx } from '../db/db.module';
import { customers, documents, orders, users } from '../db/schema';
import { SettingsService } from '../core/settings.service';
import { FilesService } from '../core/files.service';
import { orderScope } from '../core/scope';
import type { AuthContext } from '../common/context';

type DocLine = { flavour: Flavour; cartons: number; units: number; unitPriceCents: number; lineNetCents: number };

export interface CustomerDocData {
  number: string;
  issuedOn: string;
  language: 'en' | 'bg';
  company: Record<string, string>;
  bank: { bank: string; iban: string; bic: string };
  customer: { companyName: string; vatNumber: string; registeredAddress: string; deliveryAddress: string | null; contactName: string; invoiceEmail: string };
  orderNumber: string;
  agentName: string;
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
}

const LABELS = {
  en: { proforma: 'Proforma invoice', invoice: 'Commercial invoice', credit_note: 'Credit note', billTo: 'Bill to', flavour: 'Flavour', cartons: 'Cartons', units: 'Units', price: 'Unit price', net: 'Total excl. VAT', vat: 'VAT 20%', total: 'Total incl. VAT', due: 'Pay by', valid: 'Valid until', ref: 'For invoice', iban: 'IBAN', bic: 'BIC', order: 'Order', replaces: 'Replaces' },
  bg: { proforma: 'Проформа фактура', invoice: 'Фактура', credit_note: 'Кредитно известие', billTo: 'Получател', flavour: 'Вкус', cartons: 'Кашони', units: 'Бройки', price: 'Ед. цена', net: 'Сума без ДДС', vat: 'ДДС 20%', total: 'Сума с ДДС', due: 'Плащане до', valid: 'Валидна до', ref: 'Към фактура', iban: 'IBAN', bic: 'BIC', order: 'Поръчка', replaces: 'Заменя' },
};

@Injectable()
export class DocumentsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly files: FilesService,
  ) {}

  /** Snapshot of everything a customer document prints. Stored once; issued documents never change. */
  async customerDocData(
    tx: DbOrTx,
    orderId: string,
    number: string,
    lines: DocLine[],
    extra: Partial<CustomerDocData> = {},
  ): Promise<CustomerDocData> {
    const [row] = await tx
      .select({ order: orders, customer: customers, agent: users })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .innerJoin(users, eq(users.id, orders.agentId))
      .where(eq(orders.id, orderId));
    const [company, bank] = await Promise.all([this.settings.get('company', tx), this.settings.get('bank', tx)]);
    const netCents = lines.reduce((s, l) => s + l.lineNetCents, 0);
    const vatCents = Math.round(netCents * 0.2);
    return {
      number,
      issuedOn: new Date().toISOString().slice(0, 10),
      language: row.customer.proformaLanguage,
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
      agentName: row.agent.name,
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
    return { doc, buffer: await this.files.read(doc.filePath) };
  }

  private async assertCanSee(auth: AuthContext, doc: typeof documents.$inferSelect) {
    if (auth.perms.scope === 'all') return;
    // Warehouse never sees customer money documents; only delivery notes of orders it ships.
    if (auth.perms.scope === 'shipping' && doc.type !== 'delivery_note') throw new ForbiddenException({ message: 'You do not have access to this' });
    if (!doc.orderId) throw new ForbiddenException({ message: 'You do not have access to this' });
    const [o] = await this.db.select({ id: orders.id }).from(orders).where(and(eq(orders.id, doc.orderId), orderScope(auth)));
    if (!o) throw new ForbiddenException({ message: 'You do not have access to this' });
  }

  /** Print-ready HTML of a customer document, attached to e-mails (paper colours only). */
  renderHtml(type: 'proforma' | 'invoice' | 'credit_note', d: CustomerDocData): string {
    const L = LABELS[d.language] ?? LABELS.en;
    const lang = d.language;
    const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    const rows = d.lines
      .map((l) => `<tr><td>${l.flavour.toUpperCase()}</td><td>${l.cartons}</td><td>${l.units}</td><td>${formatUnitPrice(l.unitPriceCents, lang)}</td><td>${formatMoney(l.lineNetCents, lang)}</td></tr>`)
      .join('');
    return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${esc(d.number)}</title>
<style>body{font:12px/18px system-ui,sans-serif;background:#F6F5F0;color:#1D1D1B;margin:0;padding:32px}main{max-width:720px;margin:auto}
.h{display:flex;justify-content:space-between}.logo{font-weight:600;letter-spacing:.25em;font-size:14px}.m{color:#6B6A64}
.bill{background:#ECEBE4;border-radius:6px;padding:8px 12px;margin:16px 0}table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
th{color:#6B6A64;font-weight:500;text-align:right;border-bottom:1px solid #D8D6CC;padding:4px 0}td{text-align:right;border-bottom:1px solid #D8D6CC;padding:4px 0}
th:first-child,td:first-child{text-align:left}.sum{margin-top:12px;display:grid;gap:4px}.sum div{display:flex;justify-content:space-between}.big{font-size:16px;font-weight:600}
.note{background:#FBECCB;color:#6B4A00;border-radius:6px;padding:6px 12px;font-weight:500;margin-top:12px}</style></head><body><main>
<div class="h"><div><div class="logo">${esc(d.company.name || 'ANANDA')}</div><span class="m">${esc(d.company.address)}</span><span class="m"> · ${esc(d.company.vatNumber)}</span></div>
<div style="text-align:right"><b>${esc(L[type])}</b><br>${esc(d.number)}<br><span class="m">${formatDate(d.issuedOn, lang)}</span></div></div>
<div class="bill"><span class="m">${L.billTo}</span><br><b>${esc(d.customer.companyName)}</b><br>${esc(d.customer.vatNumber)}<br>${esc(d.customer.registeredAddress)}</div>
<div class="m">${L.order} ${esc(d.orderNumber)}${d.references ? ` · ${L.ref} ${esc(d.references)}` : ''}${d.replaces ? ` · ${L.replaces} ${esc(d.replaces)}` : ''}</div>
<table><thead><tr><th>${L.flavour}</th><th>${L.cartons}</th><th>${L.units}</th><th>${L.price}</th><th>${L.net}</th></tr></thead><tbody>${rows}</tbody></table>
<div class="sum"><div><span>${L.net}</span><span>${formatMoney(d.netCents, lang)}</span></div><div><span>${L.vat}</span><span>${formatMoney(d.vatCents, lang)}</span></div>
<div class="big"><span>${L.total}</span><span>${formatMoney(d.totalCents, lang)}</span></div></div>
${d.dueOn ? `<div class="note">${L.due} ${formatDate(d.dueOn, lang)} · ${L.iban} ${esc(d.bank.iban)} · ${L.bic} ${esc(d.bank.bic)}</div>` : ''}
${d.validUntil ? `<p class="m">${L.valid} ${formatDate(d.validUntil, lang)}</p>` : ''}${d.note ? `<p>${esc(d.note)}</p>` : ''}
</main></body></html>`;
  }
}

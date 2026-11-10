/* Demo data. Orders go through the real services so numbers, documents, stock movements,
 * commission and audit entries are consistent; dates are then moved into the past so the
 * monthly reports have history. Run with `pnpm db:reset`. */
import 'dotenv/config';
import 'reflect-metadata';
process.env.SMTP_HOST ??= 'localhost';
process.env.SEEDING = '1';

import { NestFactory } from '@nestjs/core';
import bcrypt from 'bcryptjs';
import { eq, inArray, sql } from 'drizzle-orm';
import {
  FLAVOURS,
  ROLE_DEFAULTS,
  SYSTEM_ROLES,
  UNITS_PER_CARTON,
  exciseCentsForUnits,
  isoDate,
  landedUnitCostCents,
  type CartonsByFlavour,
  type Flavour,
  type SystemRole,
} from '@ananda/shared';
import { AppModule } from '../app.module';
import { DB, type Db } from './db.module';
import * as s from './schema';
import { OrdersService } from '../orders/orders.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { SettingsService } from '../core/settings.service';
import { NumberingService } from '../core/numbering.service';
import type { AuthContext } from '../common/context';
import { newTotpSecret } from '../core/crypto';

const PASSWORD = 'ananda-demo-2026';
const ROLE_NAMES: Record<SystemRole, [string, string]> = {
  system_admin: ['System admin', 'Everything, including users, roles and settings'],
  admin: ['Admin', 'Approvals, payments, warehouse, invoices, all reports'],
  agent: ['Sales agent', 'Own customers and orders, new sales, own commission'],
  warehouse: ['Warehouse', 'Orders to ship, signed notes, stock counts; never prices'],
  finance: ['Finance', 'Payments, invoices, expenses, reports'],
};

const days = (n: number) => new Date(Date.now() - n * 86_400_000);

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const db = app.get<Db>(DB);
  const orders = app.get(OrdersService);
  const approvals = app.get(ApprovalsService);
  const settings = app.get(SettingsService);
  const numbering = app.get(NumberingService);

  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(s.users);
  if (n > 0) {
    console.log('Database already has data. Run `pnpm db:reset` for a fresh start.');
    await app.close();
    return;
  }

  // ---------- Roles and people ----------
  const roleIds = {} as Record<SystemRole, string>;
  for (const key of SYSTEM_ROLES) {
    const d = ROLE_DEFAULTS[key];
    const [r] = await db
      .insert(s.roles)
      .values({ key, name: ROLE_NAMES[key][0], description: ROLE_NAMES[key][1], baseRole: key, isSystem: true, scope: d.scope, twoStepRequired: d.twoStepRequired, areas: d.areas, sensitive: d.sensitive })
      .returning();
    roleIds[key] = r.id;
  }
  const hash = await bcrypt.hash(PASSWORD, 11);
  const people: Array<{ key: string; name: string; email: string; role: SystemRole; phone?: string; language?: string }> = [
    { key: 'royi', name: 'Royi Levi', email: 'royi@ananda.bg', role: 'system_admin', language: 'en' },
    { key: 'maya', name: 'Maya Petrova', email: 'maya@ananda.bg', role: 'admin', language: 'bg' },
    { key: 'elena', name: 'Elena Dimova', email: 'finance@ananda.bg', role: 'finance', language: 'bg' },
    { key: 'georgi', name: 'Georgi Ivanov', email: 'warehouse@ananda.bg', role: 'warehouse', phone: '+359 88 410 2210', language: 'bg' },
    { key: 'ivan', name: 'Ivan Kolev', email: 'ivan@ananda.bg', role: 'agent', phone: '+359 88 712 3344', language: 'bg' },
    { key: 'petya', name: 'Petya Georgieva', email: 'petya@ananda.bg', role: 'agent', phone: '+359 89 220 1188', language: 'bg' },
    { key: 'dimitar', name: 'Dimitar Stoyanov', email: 'dimitar@ananda.bg', role: 'agent', phone: '+359 87 554 9021', language: 'en' },
  ];
  const secret = newTotpSecret();
  const uid: Record<string, string> = {};
  for (const p of people) {
    const needs = ROLE_DEFAULTS[p.role].twoStepRequired;
    const [u] = await db
      .insert(s.users)
      .values({ name: p.name, email: p.email, phone: p.phone, passwordHash: hash, roleId: roleIds[p.role], language: p.language ?? 'en', status: 'active', totpSecret: needs ? secret : null, totpEnabled: needs })
      .returning();
    uid[p.key] = u.id;
  }
  const ctx = (key: string): AuthContext => {
    const p = people.find((x) => x.key === key)!;
    const d = ROLE_DEFAULTS[p.role];
    return {
      user: { id: uid[key], name: p.name, email: p.email, language: 'en', roleId: roleIds[p.role], totpEnabled: d.twoStepRequired },
      sessionId: '00000000-0000-0000-0000-000000000000',
      device: 'desktop',
      twoStepPassed: true,
      perms: { roleId: roleIds[p.role], roleKey: p.role, roleName: ROLE_NAMES[p.role][0], baseRole: p.role, scope: d.scope, areas: d.areas, sensitive: d.sensitive, previewing: false, twoStepRequired: d.twoStepRequired },
    };
  };
  const admin = ctx('maya');

  // ---------- Settings ----------
  await settings.set('company', { name: 'ANANDA', legalName: 'Ananda Drinks EOOD', vatNumber: 'BG207581144', address: 'ul. Tsar Simeon 81', city: 'Sofia', country: 'BG', email: 'office@ananda.bg', phone: '+359 2 491 7700' }, uid.royi);
  await settings.set('bank', { bank: 'UniCredit Bulbank', iban: 'BG80UNCR70001523456789', bic: 'UNCRBGSF', accounts: ['UniCredit Bulbank · EUR'] }, uid.royi);
  await settings.set('email', { warehouse: 'warehouse@ananda.bg', accounting: 'accounting@ananda.bg', sender: 'ANANDA <office@ananda.bg>', replyTo: 'royi@ananda.bg', copyAgent: true }, uid.royi);

  // ---------- Suppliers and purchases ----------
  const [sup1] = await db
    .insert(s.suppliers)
    .values({ company: 'Lagoon Beverage Packing S.r.l.', country: 'IT', vatNumber: 'IT04917650231', contactName: 'Giulia Bianchi', ordersEmail: 'orders@lagoonpack.it', phone: '+39 045 801 2290', approvedFlavours: [...FLAVOURS], defaultFlavours: ['aloha', 'gaia'], leadTimeDays: 35, paymentTermsDays: 30, unitPriceCents: 270 })
    .returning();
  const [sup2] = await db
    .insert(s.suppliers)
    .values({ company: 'Nordic Pouch Co. ApS', country: 'DK', vatNumber: 'DK39125504', contactName: 'Mads Jensen', ordersEmail: 'sales@nordicpouch.dk', phone: '+45 31 22 18 09', approvedFlavours: ['santorini', 'kyoto', 'gaia'], defaultFlavours: ['santorini', 'kyoto'], leadTimeDays: 28, paymentTermsDays: 21, unitPriceCents: 265 })
    .returning();

  async function purchase(supplier: typeof sup1, cartons: CartonsByFlavour, orderedDaysAgo: number, expectedInDays: number, received: boolean, freightCents: number, paid: boolean) {
    const number = await numbering.next(db, 'purchase');
    const lines = FLAVOURS.filter((f) => cartons[f]).map((f) => ({ flavour: f, cartons: cartons[f]!, units: cartons[f]! * UNITS_PER_CARTON }));
    const totalUnits = lines.reduce((x, l) => x + l.units, 0);
    const goodsCents = Math.round(totalUnits * supplier.unitPriceCents);
    const exciseCents = exciseCentsForUnits(totalUnits);
    const arrived = received ? isoDate(days(orderedDaysAgo - 30)) : null;
    const [p] = await db
      .insert(s.purchases)
      .values({
        number,
        supplierId: supplier.id,
        status: received ? 'received' : orderedDaysAgo > 10 ? 'on_the_way' : 'ordered',
        orderedOn: isoDate(days(orderedDaysAgo)),
        expectedOn: isoDate(new Date(Date.now() + expectedInDays * 86_400_000)),
        arrivedOn: arrived,
        totalCartons: lines.reduce((x, l) => x + l.cartons, 0),
        totalUnits,
        unitsReceived: received ? totalUnits : null,
        goodsCents,
        freightCents: received ? freightCents : 0,
        exciseCents: received ? exciseCents : 0,
        landedUnitCostCents: received ? landedUnitCostCents(goodsCents, freightCents, exciseCents, totalUnits) : null,
        supplierInvoiceReceived: received,
        createdById: uid.maya,
        createdAt: days(orderedDaysAgo),
      })
      .returning();
    await db.insert(s.purchaseLines).values(lines.map((l) => ({ purchaseId: p.id, ...l, unitPriceCents: supplier.unitPriceCents, unitsReceived: received ? l.units : null })));
    await db.insert(s.documents).values({ type: 'purchase_order', number, purchaseId: p.id, language: 'en', data: { lines, supplier: supplier.company }, totalCents: goodsCents, createdById: uid.maya, createdAt: days(orderedDaysAgo) });
    if (received) {
      for (const l of lines) await db.insert(s.stockMovements).values({ flavour: l.flavour, units: l.units, kind: 'purchase_receipt', purchaseId: p.id, byId: uid.maya, createdAt: new Date(arrived!) });
      const due = isoDate(days(orderedDaysAgo - 30 - supplier.paymentTermsDays));
      const [inv] = await db.insert(s.payables).values({ kind: 'supplier_invoice', party: supplier.company, supplierId: supplier.id, purchaseId: p.id, invoiceNumber: `${supplier.country}-${number}`, dueOn: due, netCents: goodsCents, vatRate: 0, amountCents: goodsCents, paidCents: paid ? goodsCents : 0 }).returning();
      await db.insert(s.payables).values({ kind: 'freight', party: 'DSV Road EOOD', purchaseId: p.id, invoiceNumber: `DSV-${number}`, dueOn: due, netCents: freightCents, vatRate: 0.2, amountCents: Math.round(freightCents * 1.2), paidCents: paid ? Math.round(freightCents * 1.2) : 0 });
      await db.insert(s.payables).values({ kind: 'excise', party: 'Customs Agency', purchaseId: p.id, dueOn: arrived!, netCents: exciseCents, vatRate: 0, amountCents: exciseCents, paidCents: exciseCents });
      if (paid) await db.insert(s.payablePayments).values({ payableId: inv.id, paidOn: due, amountCents: goodsCents, paidFrom: 'UniCredit Bulbank · EUR', bankReference: `SEPA ${number}`, recordedById: uid.elena });
      await db.insert(s.shipments).values({ purchaseId: p.id, carrier: 'DSV Road', mode: 'road', route: `${supplier.country} → Sofia`, departOn: isoDate(days(orderedDaysAgo - 20)), arriveOn: arrived, status: 'arrived' });
    } else {
      await db.insert(s.shipments).values({ purchaseId: p.id, carrier: 'DSV Road', mode: 'road', route: `${supplier.country} → Sofia`, departOn: isoDate(days(Math.max(0, orderedDaysAgo - 12))), arriveOn: isoDate(new Date(Date.now() + expectedInDays * 86_400_000)), status: orderedDaysAgo > 10 ? 'in_transit' : 'booked' });
    }
    return p;
  }

  await purchase(sup1, { aloha: 900, gaia: 800 }, 240, -200, true, 410_000, true);
  await purchase(sup2, { santorini: 700, kyoto: 650 }, 220, -185, true, 380_000, true);
  await purchase(sup1, { aloha: 600, gaia: 500, santorini: 200 }, 110, -75, true, 360_000, false);
  await purchase(sup2, { kyoto: 400, santorini: 300 }, 45, -6, false, 0, false); // late
  await purchase(sup1, { aloha: 500, gaia: 400 }, 14, 20, false, 0, false);

  // ---------- Customers ----------
  const custData: Array<[string, string, string, string, string, string, string, number]> = [
    ['Sunset Beach Bar OOD', 'BG204511873', 'Sunny Beach', 'Sunny Beach, Kambanite 4', 'Nikolai Hristov', '+359 88 900 1122', 'ivan', 7],
    ['Varna Sea Garden EOOD', 'BG203877411', 'Varna', 'Varna, bul. Slivnitsa 12', 'Teodora Marinova', '+359 87 551 0193', 'ivan', 14],
    ['Sofia Rooftop Lounge OOD', 'BG206110428', 'Sofia', 'Sofia, ul. Graf Ignatiev 30', 'Kalin Petkov', '+359 89 404 7781', 'petya', 7],
    ['Plovdiv Old Town Wines EOOD', 'BG115623009', 'Plovdiv', 'Plovdiv, ul. Saborna 22', 'Mila Atanasova', '+359 88 213 5566', 'petya', 7],
    ['Bansko Ski Lodge AD', 'BG101447782', 'Bansko', 'Bansko, ul. Pirin 88', 'Stefan Iliev', '+359 87 778 3301', 'dimitar', 21],
    ['Burgas Port Kitchen OOD', 'BG102994510', 'Burgas', 'Burgas, ul. Aleksandrovska 51', 'Raya Koleva', '+359 89 655 2290', 'ivan', 7],
    ['Golden Sands Resort AD', 'BG103558214', 'Varna', 'Golden Sands, Resort Centre', 'Boris Todorov', '+359 88 300 4455', 'dimitar', 14],
    ['Veliko Tarnovo Craft House EOOD', 'BG104882106', 'Veliko Tarnovo', 'Veliko Tarnovo, ul. Gurko 9', 'Yana Nikolova', '+359 87 120 9988', 'petya', 7],
  ];
  const cid: string[] = [];
  for (const [name, vat, city, addr, contact, phone, agent, terms] of custData) {
    const [c] = await db
      .insert(s.customers)
      .values({ companyName: name, vatNumber: vat, vatValid: true, vatCheckedAt: new Date(), country: 'BG', registeredAddress: addr, deliveryAddress: addr, city, contactName: contact, phone, invoiceEmail: `office@${name.toLowerCase().split(' ')[0]}.bg`, proformaLanguage: 'bg', paymentTermsDays: terms, agentId: uid[agent], status: 'active', approvedAt: days(250), approvedById: uid.maya, createdById: uid[agent], createdAt: days(250) })
      .returning();
    await db.insert(s.customerContacts).values({ customerId: c.id, name: contact, phone, email: c.invoiceEmail, role: 'Main contact' });
    cid.push(c.id);
  }

  // ---------- Orders through the real flow ----------
  async function shift(orderId: string, ageDays: number) {
    const iv = sql.raw(`interval '${Math.round(ageDays)} days'`);
    await db.execute(sql`update orders set created_at = created_at - ${iv}, request_sent_at = request_sent_at - ${iv}, paid_at = paid_at - ${iv}, sent_to_warehouse_at = sent_to_warehouse_at - ${iv}, delivered_at = delivered_at - ${iv}, invoiced_at = invoiced_at - ${iv}, reserved_until = reserved_until - ${iv}, proforma_expires_at = proforma_expires_at - ${iv}, payment_due_on = payment_due_on - ${iv} where id = ${orderId}`);
    await db.execute(sql`update payments set received_on = received_on - ${iv}, created_at = created_at - ${iv} where order_id = ${orderId}`);
    await db.execute(sql`update documents set created_at = created_at - ${iv} where order_id = ${orderId}`);
    await db.execute(sql`update stock_movements set created_at = created_at - ${iv} where order_id = ${orderId}`);
    await db.execute(sql`update commission_entries set created_at = created_at - ${iv}, ready_at = ready_at - ${iv} where order_id = ${orderId}`);
  }
  const fakeNote = { buffer: Buffer.from('%PDF-1.4\n% signed delivery note (demo)\n'), originalname: 'signed-note.pdf', mimetype: 'application/pdf' };

  type Stage = 'draft' | 'sent' | 'paid' | 'warehouse' | 'delivered' | 'invoiced';
  async function order(agent: string, customer: number, cartons: CartonsByFlavour, stage: Stage, ageDays: number) {
    const a = ctx(agent);
    const { id } = await orders.createDraft(a, { customerId: cid[customer], cartons });
    if (stage !== 'draft') {
      await orders.sendPaymentRequest(a, id);
      if (stage !== 'sent') {
        const [o] = await db.select().from(s.orders).where(eq(s.orders.id, id));
        await orders.confirmPayment(ctx('elena'), id, { receivedOn: isoDate(), amountCents: o.totalCents, method: 'bank_transfer', bankReference: `BNK${Math.floor(100000 + Math.random() * 899999)}` });
        const [paid] = await db.select().from(s.orders).where(eq(s.orders.id, id));
        if (stage !== 'paid' && paid.status === 'ready_to_send') {
          await orders.sendToWarehouse(admin, id);
          if (stage === 'delivered' || stage === 'invoiced') {
            await orders.deliver(ctx('georgi'), id, fakeNote);
            if (stage === 'invoiced') await orders.issueInvoice(ctx('elena'), id);
          }
        }
      }
    }
    await shift(id, ageDays);
    return id;
  }

  // History across the year for P&L and deal profit.
  const history: Array<[string, number, CartonsByFlavour, number]> = [
    ['ivan', 0, { aloha: 30, gaia: 20, kyoto: 10 }, 200],
    ['petya', 2, { santorini: 40, kyoto: 30 }, 185],
    ['ivan', 1, { aloha: 120, gaia: 100, santorini: 60 }, 170],
    ['dimitar', 4, { aloha: 60, kyoto: 50 }, 150],
    ['petya', 3, { gaia: 30, santorini: 30 }, 132],
    ['ivan', 5, { aloha: 45, gaia: 45, kyoto: 30 }, 118],
    ['dimitar', 6, { aloha: 150, gaia: 120, santorini: 90, kyoto: 90 }, 96],
    ['petya', 2, { aloha: 40, santorini: 40 }, 80],
    ['ivan', 0, { aloha: 60, gaia: 40 }, 64],
    ['petya', 7, { kyoto: 50, gaia: 20 }, 48],
    ['ivan', 1, { aloha: 90, santorini: 60 }, 33],
    ['dimitar', 4, { gaia: 60, kyoto: 40 }, 22],
  ];
  for (const [agent, c, cart, age] of history) await order(agent, c, cart, 'invoiced', age);

  await order('petya', 3, { aloha: 30, gaia: 30 }, 'delivered', 6);
  await order('ivan', 5, { santorini: 25, kyoto: 25 }, 'delivered', 4);
  await order('dimitar', 6, { aloha: 80, gaia: 60 }, 'warehouse', 2);
  await order('ivan', 1, { aloha: 50, gaia: 30, kyoto: 20 }, 'paid', 1);
  // Kyoto runs short: this one waits for the late purchase.
  await order('petya', 7, { kyoto: 400, santorini: 60 }, 'paid', 3);
  await order('ivan', 0, { aloha: 40, kyoto: 20 }, 'sent', 2);
  await order('petya', 2, { gaia: 50, santorini: 30 }, 'sent', 12);
  await order('dimitar', 4, { aloha: 60, gaia: 40, santorini: 20 }, 'sent', 38);
  await order('ivan', 5, { kyoto: 45 }, 'sent', 110);
  await order('dimitar', 6, { aloha: 20, gaia: 15 }, 'draft', 4);
  await order('petya', 3, { santorini: 30 }, 'draft', 1);

  // Pending requests for the "Needs your OK" queue.
  const draftId = await order('ivan', 1, { aloha: 120, gaia: 100 }, 'draft', 0);
  await orders.requestSpecialPrice(ctx('ivan'), draftId, 505, 'Repeat customer, wants the 417+ tier price for 220 cartons.');
  const sentId = await order('petya', 2, { santorini: 30, kyoto: 30 }, 'sent', 1);
  await orders.requestCorrection(ctx('petya'), sentId, { santorini: 30, kyoto: 20, aloha: 10 }, 'Customer swapped 10 Kyoto for Aloha.');
  const [newCust] = await db
    .insert(s.customers)
    .values({ companyName: 'Sozopol Harbour Café EOOD', vatNumber: 'BG205339918', vatValid: true, vatCheckedAt: new Date(), country: 'BG', registeredAddress: 'Sozopol, ul. Kraybrezhna 7', city: 'Sozopol', contactName: 'Vesela Dobreva', phone: '+359 88 640 1203', invoiceEmail: 'hello@sozopolharbour.bg', proformaLanguage: 'bg', agentId: uid.ivan, status: 'needs_approval', createdById: uid.ivan })
    .returning();
  await db.insert(s.approvalRequests).values({ type: 'new_customer', customerId: newCust.id, requestedById: uid.ivan, reason: 'Summer café on the harbour, 3 venues.' });

  // One customer whose ownership has run out: free to claim.
  await db.update(s.customers).set({ ownedUntil: isoDate(days(12)) }).where(eq(s.customers.id, cid[7]));

  // Approve-and-decline examples for the agent view.
  const [declined] = await db
    .insert(s.customers)
    .values({ companyName: 'Rila Trail Hut', vatNumber: 'BG000000001', vatValid: false, country: 'BG', registeredAddress: 'Rila', contactName: 'Unknown', phone: '-', invoiceEmail: 'info@rilahut.bg', agentId: uid.dimitar, status: 'needs_approval', createdById: uid.dimitar })
    .returning();
  const [req] = await db.insert(s.approvalRequests).values({ type: 'new_customer', customerId: declined.id, requestedById: uid.dimitar }).returning();
  await approvals.decline(admin, req.id, 'wrong_details', 'The VAT number is not valid in VIES. Please check it with the customer.');

  // Some commission already paid out.
  await db.update(s.commissionEntries).set({ status: 'paid', sentAt: days(60), paidAt: days(55) }).where(inArray(s.commissionEntries.orderId, sql`(select id from orders where paid_at < now() - interval '90 days')`));

  // ---------- Events, expenses, bank ----------
  const [evt] = await db.insert(s.events).values({ name: 'Spirit of Burgas', startsOn: isoDate(days(95)), endsOn: isoDate(days(92)), place: 'Burgas, North Beach', kind: 'festival', agentIds: [uid.ivan, uid.dimitar], createdById: uid.maya }).returning();
  for (const [f, cartons] of [['aloha', 20], ['gaia', 15]] as Array<[Flavour, number]>) {
    await db.insert(s.stockMovements).values({ flavour: f, units: -cartons * 24, kind: 'event_out', reason: 'to_event', byId: uid.maya, createdAt: days(96) });
    await db.insert(s.stockMovements).values({ flavour: f, units: cartons * 24, kind: 'event_out', eventId: evt.id, reason: 'to_event', byId: uid.maya, createdAt: days(96) });
    const soldUnits = Math.round(cartons * 0.7) * 24;
    await db.insert(s.stockMovements).values({ flavour: f, units: -soldUnits, kind: 'event_sale', eventId: evt.id, byId: uid.ivan, createdAt: days(92) });
    // Agents sell at events with the normal commission (A13); this festival was paid out.
    await db.insert(s.commissionEntries).values({ agentId: uid.ivan, eventId: evt.id, units: soldUnits, amountCents: soldUnits * 50, status: 'paid', readyAt: days(92), sentAt: days(60), paidAt: days(55), createdAt: days(92) });
  }
  const exp: Array<[number, string, string, number, string | null]> = [];
  for (let m = 0; m < 10; m++) {
    exp.push([m * 30 + 3, 'office', 'Office rent, Sofia', 120_000, null]);
    exp.push([m * 30 + 8, 'software', 'Accounting software', 4_900, null]);
    if (m % 2 === 0) exp.push([m * 30 + 15, 'marketing', 'Instagram campaign', 35_000, null]);
    if (m % 3 === 1) exp.push([m * 30 + 20, 'travel', 'Agent travel, Black Sea coast', 18_500, null]);
  }
  exp.push([93, 'events', 'Spirit of Burgas stand and staff', 240_000, evt.id]);
  for (const [age, category, description, net, eventId] of exp) {
    await db.insert(s.expenses).values({ spentOn: isoDate(days(age)), category, description, netCents: net, vatRate: 0.2, totalCents: Math.round(net * 1.2), paid: age > 20, eventId, createdById: uid.elena });
  }
  await db.insert(s.bankBalances).values({ account: 'UniCredit Bulbank · EUR', balanceOn: isoDate(days(9)), balanceCents: 8_642_310, recordedById: uid.elena });

  await app.close();
  console.log('\nSeeded ANANDA demo data.');
  console.log(`Sign in with any of these (password: ${PASSWORD}):`);
  for (const p of people) console.log(`  ${p.email.padEnd(24)} ${ROLE_NAMES[p.role][0]}`);
  console.log(`Two-step code: in development enter ${process.env.DEV_TWO_STEP_CODE ?? '(set DEV_TWO_STEP_CODE)'}, or add this secret to an authenticator app: ${secret}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

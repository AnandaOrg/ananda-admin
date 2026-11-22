/* Delivered in part: progress on the order detail and the unpaid late alert (needs the API started with CRON_SECRET=testsecret,
 * e.g. API_URL=http://localhost:4011/api CRON_SECRET=testsecret pnpm --filter @ananda/api test). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.env.API_URL ?? 'http://localhost:4010/api';
const CODE = process.env.DEV_TWO_STEP_CODE ?? '000000';

class Client {
  cookie = '';
  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const isForm = body instanceof FormData;
    const res = await fetch(API + path, {
      method,
      headers: { ...(body && !isForm ? { 'content-type': 'application/json' } : {}), ...(this.cookie ? { cookie: this.cookie } : {}), ...headers },
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const text = await res.text();
    return { status: res.status, data: text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : null };
  }
  async login(email: string) {
    // Sign-in link (the API returns the token locally), then the two-step code.
    const link = await this.req('POST', '/auth/link', { email });
    assert.ok(link.data?.devToken, `sign-in link for ${email}`);
    const r = await this.req('POST', '/auth/link/verify', { token: link.data.devToken, device: 'desktop' });
    assert.equal(r.status, 200, `login ${email}`);
    if (r.data.twoStep === 'setup') assert.equal((await this.req('POST', '/auth/two-step/setup')).status, 201);
    if (r.data.twoStep !== 'none') assert.equal((await this.req('POST', '/auth/two-step/verify', { code: CODE })).status, 200);
    return this;
  }
}
const as = (email: string) => new Client().login(email);

const CRON = process.env.CRON_SECRET ?? 'testsecret';
const today = () => new Date().toISOString().slice(0, 10);
const pdf = (cartons?: unknown) => {
  const f = new FormData();
  f.append('file', new Blob([Buffer.from('%PDF-1.4 test')], { type: 'application/pdf' }), 'note.pdf');
  if (cartons) f.append('delivered', JSON.stringify(cartons));
  return f;
};

async function setup() {
  const [ivan, admin, finance, warehouse] = await Promise.all(['ivan', 'maya', 'finance', 'warehouse'].map((n) => as(`${n}@ananda.bg`)));
  const list = (await ivan.req('GET', '/customers')).data.items as { id: string; mine: boolean; status: string; paymentTerms?: string; paymentTermsDays?: number }[];
  const customer = list.find((c) => c.mine && c.status === 'active');
  assert.ok(customer, 'broker has an active customer');
  return { ivan, admin, finance, warehouse, customer };
}
const lateJob = async (url = API) => fetch(`${url}/cron/late`, { headers: { authorization: `Bearer ${CRON}` } }).then((r) => r.json());
const alerts = async (c: Client, id: string) => ((await c.req('GET', '/notifications')).data.items as { type: string; link: string }[]).filter((n) => n.type === 'part_delivery_unpaid' && n.link === `/sales/${id}`);

/** An order for 42 cartons that ends up at the warehouse. `paid`: pay it in full first (terms before shipping). */
async function atWarehouse(t: Awaited<ReturnType<typeof setup>>, paid: boolean) {
  const { ivan, admin, finance, customer } = t;
  const made = await ivan.req('POST', '/orders', { customerId: customer.id, cartons: { aloha: 22, gaia: 20 } });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const id = made.data.id as string;
  assert.equal((await ivan.req('POST', `/orders/${id}/send`)).status, 200);
  const o = (await admin.req('GET', `/orders/${id}`)).data;
  if (paid) {
    const pay = { receivedOn: today(), amountCents: o.order.totalCents, method: 'bank_transfer', bankReference: 'PART-TEST' };
    assert.equal((await finance.req('POST', `/orders/${id}/confirm-payment`, pay, { 'x-two-step-code': CODE })).status, 200);
  }
  const sent = await admin.req('POST', `/orders/${id}/send-to-warehouse`);
  assert.equal(sent.status, 200, JSON.stringify(sent.data));
  assert.equal((await admin.req('GET', `/orders/${id}`)).data.order.status, 'at_warehouse');
  return id;
}

test('order detail: nothing delivered, then part delivered, then all delivered', async () => {
  const t = await setup();
  const { ivan, admin, warehouse } = t;
  const id = await atWarehouse(t, true);
  let d = (await admin.req('GET', `/orders/${id}`)).data;
  assert.deepEqual(d.delivery, { deliveredCartons: 0, totalCartons: 42, part: false });

  const part = await warehouse.req('POST', `/warehouse/orders/${id}/part-delivery`, pdf({ aloha: 10, gaia: 5 }));
  assert.equal(part.status, 200, JSON.stringify(part.data));
  for (const who of [admin, ivan]) {
    d = (await who.req('GET', `/orders/${id}`)).data;
    assert.deepEqual(d.delivery, { deliveredCartons: 15, totalCartons: 42, part: true });
    assert.equal(d.order.status, 'at_warehouse', 'no new status');
    assert.equal(d.lines.find((l: { flavour: string }) => l.flavour === 'aloha').deliveredCartons, 10);
    assert.equal(d.lines.find((l: { flavour: string }) => l.flavour === 'gaia').deliveredCartons, 5);
  }
  assert.equal((await (await as('petya@ananda.bg')).req('GET', `/orders/${id}`)).status, 404, 'other brokers cannot see it');
  const w = (await warehouse.req('GET', `/orders/${id}`)).data;
  assert.equal(w.delivery.deliveredCartons, 15, 'warehouse sees the progress, without money');

  // The rest goes out: fully delivered, no longer "part".
  const rest = await warehouse.req('POST', `/warehouse/orders/${id}/part-delivery`, pdf({ aloha: 12, gaia: 15 }));
  assert.equal(rest.status, 200, JSON.stringify(rest.data));
  d = (await admin.req('GET', `/orders/${id}`)).data;
  assert.equal(d.order.status, 'delivered');
  assert.deepEqual(d.delivery, { deliveredCartons: 42, totalCartons: 42, part: false });
});

test('late alert: part delivered and unpaid, once; none when paid, fully delivered, or nothing delivered', async () => {
  const t = await setup();
  const { ivan, admin, warehouse, customer } = t;
  const url = API;
  // A customer that pays 30 days after delivery is the case where an order ships unpaid.
  const before = (await admin.req('GET', `/customers/${customer.id}`)).data;
  const terms = before.customer?.paymentTerms ?? before.paymentTerms ?? 'before_shipping';
  const days = before.customer?.paymentTermsDays ?? before.paymentTermsDays ?? 7;
  assert.equal((await admin.req('PATCH', `/customers/${customer.id}`, { paymentTerms: 'after_delivery_30' })).status, 200);
  try {
    const unpaidNothing = await atWarehouse(t, false);
    const unpaidPart = await atWarehouse(t, false);
    const unpaidAll = await atWarehouse(t, false);
    assert.equal((await warehouse.req('POST', `/warehouse/orders/${unpaidPart}/part-delivery`, pdf({ aloha: 10 }))).status, 200);
    assert.equal((await warehouse.req('POST', `/warehouse/orders/${unpaidAll}/part-delivery`, pdf({ aloha: 22, gaia: 20 }))).status, 200);
    assert.equal((await admin.req('GET', `/orders/${unpaidAll}`)).data.order.status, 'delivered');
    assert.equal((await admin.req('GET', `/orders/${unpaidPart}`)).data.order.outstandingCents > 0, true);

    await customerRestore(admin, customer.id, 'before_shipping', 7);
    const paidPart = await atWarehouse(t, true);
    assert.equal((await warehouse.req('POST', `/warehouse/orders/${paidPart}/part-delivery`, pdf({ aloha: 10 }))).status, 200);

    const r1 = await lateJob(url);
    assert.ok(typeof r1.sent === 'number', JSON.stringify(r1));
    assert.equal((await alerts(ivan, unpaidPart)).length, 1, 'part delivered + unpaid: one alert to the broker');
    const n = (await alerts(ivan, unpaidPart))[0] as unknown as { title: string; data: Record<string, number> };
    assert.match(n.title, /part delivered and not paid/);
    assert.equal(n.data.delivered, 10);
    assert.equal(n.data.total, 42);
    assert.equal((await alerts(ivan, unpaidNothing)).length, 0, 'nothing delivered: no alert');
    assert.equal((await alerts(ivan, unpaidAll)).length, 0, 'fully delivered: no alert');
    assert.equal((await alerts(ivan, paidPart)).length, 0, 'paid in full: no alert');
    assert.equal((await alerts(await as('petya@ananda.bg'), unpaidPart)).length, 0, 'only the order broker is told');

    await lateJob(url);
    assert.equal((await alerts(ivan, unpaidPart)).length, 1, 'no duplicate within the week');

    // Paying the balance ends it for good: clean up so the demo data stays tidy.
  } finally {
    await customerRestore(admin, customer.id, terms, days);
  }
});

async function customerRestore(admin: Client, id: string, paymentTerms: string, paymentTermsDays: number) {
  assert.equal((await admin.req('PATCH', `/customers/${id}`, { paymentTerms, paymentTermsDays })).status, 200);
}

const req = createRequire(import.meta.url);
const { deliveryProgress } = req(join(dirname(fileURLToPath(import.meta.url)), '../dist/orders/delivery-progress.js')) as {
  deliveryProgress: (status: string, total: number, lines: { deliveredCartons: number | null }[], outcome?: string | null) => { deliveredCartons: number; totalCartons: number; part: boolean };
};

test('part delivered rule: closed with a credit note is no longer "part"; re-delivery still is', () => {
  const lines = [{ deliveredCartons: 10 }, { deliveredCartons: null }];
  assert.equal(deliveryProgress('at_warehouse', 42, lines).part, true);
  assert.equal(deliveryProgress('delivered_part', 42, lines).part, true, 'waiting for the Admin decision');
  assert.equal(deliveryProgress('at_warehouse', 42, lines, 'redeliver').part, true, 'the rest will still ship');
  const closed = deliveryProgress('delivered_part', 42, lines, 'credit_note');
  assert.equal(closed.part, false, 'the rest never ships');
  assert.equal(closed.deliveredCartons, 10, 'the figures stay');
  assert.equal(deliveryProgress('delivered', 42, [{ deliveredCartons: 42 }]).part, false);
  assert.equal(deliveryProgress('at_warehouse', 42, [{ deliveredCartons: 0 }]).part, false);
});

// Needs DATABASE_URL (the API's own database): only the Admin's credit-note decision can end a part delivery, and the API cannot reach
// "delivered in part" any more, so the state is set directly.
test('late alert and order page: an order closed with a credit note is not part delivered', { skip: !process.env.DATABASE_URL }, async () => {
  const t = await setup();
  const { ivan, admin, warehouse, customer } = t;
  const before = (await admin.req('GET', `/customers/${customer.id}`)).data;
  const terms = before.customer?.paymentTerms ?? before.paymentTerms ?? 'before_shipping';
  const days = before.customer?.paymentTermsDays ?? before.paymentTermsDays ?? 7;
  assert.equal((await admin.req('PATCH', `/customers/${customer.id}`, { paymentTerms: 'after_delivery_30' })).status, 200);
  const { Pool } = req('pg') as { Pool: new (o: { connectionString?: string }) => { query: (q: string, v?: unknown[]) => Promise<unknown>; end: () => Promise<void> } };
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const id = await atWarehouse(t, false);
    assert.equal((await warehouse.req('POST', `/warehouse/orders/${id}/part-delivery`, pdf({ aloha: 10 }))).status, 200);
    await pool.query(`update orders set status = 'delivered_part', part_delivery_outcome = 'credit_note' where id = $1`, [id]);
    for (const who of [admin, ivan]) assert.deepEqual((await who.req('GET', `/orders/${id}`)).data.delivery, { deliveredCartons: 10, totalCartons: 42, part: false });
    await lateJob();
    assert.equal((await alerts(ivan, id)).length, 0, 'cartons that will never ship do not alert');
    // Same order, decision still open: it is part delivered and alerts.
    await pool.query(`update orders set part_delivery_outcome = null where id = $1`, [id]);
    assert.equal((await admin.req('GET', `/orders/${id}`)).data.delivery.part, true);
    await lateJob();
    assert.equal((await alerts(ivan, id)).length, 1);
  } finally {
    await pool.end();
    await customerRestore(admin, customer.id, terms, days);
  }
});

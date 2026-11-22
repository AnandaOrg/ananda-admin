/* Notifications carry structured data (type + data), so the tray can translate them: real flows through the API.
 * e.g. API_URL=http://localhost:4011/api pnpm --filter @ananda/api test */
import { test } from 'node:test';
import assert from 'node:assert/strict';

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


type N = { type: string; title: string; body: string | null; link: string; data: Record<string, string | number> | null; createdAt: string };
const inbox = async (c: Client) => ((await c.req('GET', '/notifications')).data.items as N[]);

test('every notification created by the flows has a type and structured data', async () => {
  const started = Date.now() - 2000;
  const [ivan, admin, finance, warehouse] = await Promise.all(['ivan', 'maya', 'finance', 'warehouse'].map((n) => as(`${n}@ananda.bg`)));
  const customer = ((await ivan.req('GET', '/customers')).data.items as { id: string; mine: boolean; status: string }[]).find((c) => c.mine && c.status === 'active');
  assert.ok(customer);
  const order = async () => {
    const made = await ivan.req('POST', '/orders', { customerId: customer.id, cartons: { aloha: 22, gaia: 20 } });
    assert.equal(made.status, 201, JSON.stringify(made.data));
    return made.data.id as string;
  };
  const find = async (c: Client, type: string, id: string) => (await inbox(c)).find((n) => n.type === type && n.link.includes(id));

  // Paid, then to the warehouse, part delivered, delivered.
  const id = await order();
  assert.equal((await ivan.req('POST', `/orders/${id}/send`)).status, 200);
  const o = (await admin.req('GET', `/orders/${id}`)).data;
  const pay = { receivedOn: new Date().toISOString().slice(0, 10), amountCents: o.order.totalCents, method: 'bank_transfer', bankReference: 'NOTIFY-TEST' };
  assert.equal((await finance.req('POST', `/orders/${id}/confirm-payment`, pay, { 'x-two-step-code': CODE })).status, 200);
  const paid = await find(ivan, 'payment', id);
  assert.equal(paid?.data?.order, o.order.number);
  assert.match(String(paid?.data?.next), /^(ready|waiting|paid)$/);
  assert.equal((await admin.req('POST', `/orders/${id}/send-to-warehouse`)).status, 200);
  assert.equal((await inbox(warehouse)).find((n) => n.type === 'to_ship' && n.data?.order === o.order.number)?.title, `${o.order.number} to ship`);
  const f = (cartons: unknown) => {
    const form = new FormData();
    form.append('file', new Blob([Buffer.from('%PDF-1.4 test')], { type: 'application/pdf' }), 'note.pdf');
    form.append('delivered', JSON.stringify(cartons));
    return form;
  };
  assert.equal((await warehouse.req('POST', `/warehouse/orders/${id}/part-delivery`, f({ aloha: 10 }))).status, 200);
  for (const who of [admin, ivan]) {
    const n = await find(who, 'part_delivered', id);
    assert.equal(n?.data?.stays, 32);
    assert.equal(n?.title, `${o.order.number} part delivered · 32 cartons still to ship`, 'the stored English is unchanged');
  }
  assert.equal((await warehouse.req('POST', `/warehouse/orders/${id}/part-delivery`, f({ aloha: 12, gaia: 20 }))).status, 200);
  assert.equal((await find(ivan, 'delivered', id))?.data?.order, o.order.number);

  // Special price request (to the Admins), then cancelled by the Admin (the broker is told), then reopened.
  const id2 = await order();
  const sp = await ivan.req('POST', `/orders/${id2}/special-price`, { unitPriceCents: 100, reason: 'Repeat customer' });
  assert.equal(sp.status, 201, JSON.stringify(sp.data));
  const asked = await find(admin, 'special_price_request', sp.data.id);
  assert.equal(asked?.data?.reason, 'Repeat customer');
  const id3 = await order();
  assert.equal((await ivan.req('POST', `/orders/${id3}/send`)).status, 200);
  const c = await admin.req('POST', `/orders/${id3}/cancel`, { reason: 'duplicate' });
  assert.equal(c.status, 200, JSON.stringify(c.data));
  assert.equal((await find(ivan, 'cancelled', id3))?.data?.reason, 'duplicate');
  const un = await admin.req('POST', `/orders/${id3}/uncancel`);
  assert.equal(un.status, 200, JSON.stringify(un.data));
  assert.equal((await find(ivan, 'cancel_undone', id3))?.data?.order != null, true);

  // Nothing created in this test is a bare title: every row has data for the tray to translate.
  for (const who of [admin, ivan, warehouse, finance]) {
    for (const n of (await inbox(who)).filter((x) => new Date(x.createdAt).getTime() >= started)) {
      assert.ok(n.data && typeof n.data === 'object', `${n.type} "${n.title}" has no data`);
    }
  }
});

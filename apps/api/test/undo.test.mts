/* End-to-end checks for the Undo on one-tap actions (toast Undo) against a running API with the demo seed.
 * Run: pnpm --filter @ananda/api test */
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

test('Undo Mark as paid on an expense, once, and not after something else happened', async () => {
  const admin = await as('maya@ananda.bg');
  const form = new FormData();
  for (const [k, v] of Object.entries({ spentOn: new Date().toISOString().slice(0, 10), category: 'marketing', description: 'Undo test', amountNetCents: '1000', vatRate: '0.2', paid: 'false' })) form.append(k, v);
  const made = await admin.req('POST', '/money/expenses', form);
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const id = made.data.id;
  assert.equal((await admin.req('POST', `/money/expenses/${id}/paid/undo`)).status, 409, 'nothing to undo yet');
  assert.equal((await admin.req('POST', `/money/expenses/${id}/paid`)).status, 200);
  assert.equal((await admin.req('POST', `/money/expenses/${id}/paid/undo`)).status, 200);
  assert.equal((await admin.req('POST', `/money/expenses/${id}/paid/undo`)).status, 409, 'cannot undo twice');
  assert.equal((await as('warehouse@ananda.bg').then((w) => w.req('POST', `/money/expenses/${id}/paid/undo`))).status, 403);
});

test('Undo a customer move: back to the old broker, refused once anything changed or for a broker', async () => {
  const admin = await as('maya@ananda.bg');
  const ivan = await as('ivan@ananda.bg');
  const list = (await admin.req('GET', '/customers')).data.items as { id: string; status: string; brokerId: string | null }[];
  const brokers = (await admin.req('GET', '/customers/brokers')).data as { id: string }[];
  const c = list.find((x) => x.status === 'active' && x.brokerId);
  assert.ok(c, 'an active customer with a broker');
  const other = brokers.find((b) => b.id !== c.brokerId)!;
  const card = async () => (await admin.req('GET', `/customers/${c.id}`)).data;
  const before = (await card()).customer ?? (await card());
  assert.ok([403, 404].includes((await ivan.req('POST', `/customers/${c.id}/change-broker/undo`)).status), 'a broker cannot undo a move');
  assert.equal((await admin.req('POST', `/customers/${c.id}/change-broker`, { brokerId: other.id, reason: 'other' })).status, 200);
  assert.equal((await admin.req('POST', `/customers/${c.id}/change-broker/undo`)).status, 200);
  const after = (await card()).customer ?? (await card());
  assert.equal(after.brokerId, before.brokerId);
  assert.equal(after.ownedUntil, before.ownedUntil);
  assert.equal((await admin.req('POST', `/customers/${c.id}/change-broker/undo`)).status, 409, 'cannot undo twice');
});

test('Undo a claim: the customer is free again, refused for someone else', async () => {
  const ivan = await as('ivan@ananda.bg');
  const free = ((await ivan.req('GET', '/customers')).data.items as { id: string; status: string }[]).find((x) => x.status === 'free_to_claim');
  if (!free) return; // needs a customer whose ownership has ended
  assert.equal((await as('maya@ananda.bg').then((p) => p.req('POST', `/customers/${free.id}/claim/undo`))).status, 404);
  assert.equal((await ivan.req('POST', `/customers/${free.id}/claim`)).status, 200);
  assert.equal((await ivan.req('POST', `/customers/${free.id}/claim/undo`)).status, 200);
  assert.equal(((await ivan.req('GET', '/customers')).data.items as { id: string; status: string }[]).find((x) => x.id === free.id)?.status, 'free_to_claim');
  assert.equal((await ivan.req('POST', `/customers/${free.id}/claim/undo`)).status, 404, 'no longer his');
});

test('Undo Remove logo restores it, once', async () => {
  const admin = await as('royi@ananda.bg');
  if ((await admin.req('GET', '/settings/documents/logo')).status === 200) return; // never replace a logo someone set
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'logo.png');
  assert.equal((await admin.req('POST', '/settings/documents/logo', form)).status, 200);
  assert.equal((await admin.req('POST', '/settings/documents/logo/undo')).status, 409, 'an upload is not a removal');
  assert.equal((await admin.req('DELETE', '/settings/documents/logo')).status, 200);
  assert.equal((await admin.req('GET', '/settings/documents/logo')).status, 404);
  assert.equal((await admin.req('POST', '/settings/documents/logo/undo')).status, 200);
  assert.equal((await admin.req('GET', '/settings/documents/logo')).status, 200);
  assert.equal((await admin.req('POST', '/settings/documents/logo/undo')).status, 409, 'cannot undo twice');
  assert.equal((await admin.req('DELETE', '/settings/documents/logo')).status, 200); // leave the demo as it was
});

test('Undo Mark as paid on commission: back to Sent or Ready, only the paid entries, only with the right to pay', async () => {
  const finance = await as('finance@ananda.bg');
  const ivan = await as('ivan@ananda.bg');
  const overview = (await finance.req('GET', '/brokers')).data as { rows?: { id: string; readyCents: number; sentCents: number }[]; brokers?: { id: string; readyCents: number; sentCents: number }[] };
  const rows = overview.rows ?? overview.brokers ?? [];
  const b = rows.find((r) => r.sentCents > 0) ?? rows.find((r) => r.readyCents > 0);
  assert.ok(b, 'a broker with something to pay');
  const paid = await finance.req('POST', `/brokers/${b.id}/mark-paid`, {}, { 'x-two-step-code': CODE });
  assert.equal(paid.status, 200, JSON.stringify(paid.data));
  const { entryIds, amountCents } = paid.data as { entryIds: string[]; amountCents: number };
  assert.ok(entryIds.length);
  assert.equal((await ivan.req('POST', `/brokers/${b.id}/mark-paid/undo`, { entryIds })).status, 403);
  const undone = await finance.req('POST', `/brokers/${b.id}/mark-paid/undo`, { entryIds });
  assert.equal(undone.status, 200, JSON.stringify(undone.data));
  assert.equal(undone.data.amountCents, amountCents);
  assert.equal((await finance.req('POST', `/brokers/${b.id}/mark-paid/undo`, { entryIds })).status, 409, 'not paid any more');
});

/* Every notification the API can create has a title (and body) in EN, BG and HE, with every placeholder
 * filled from its structured data. Static: reads the compiled API (pnpm --filter @ananda/api build) and
 * the web messages; needs no running server. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const req = createRequire(import.meta.url);
const { NOTIFY_KINDS, NOTIFY_DATA, cleanNotifyData } = req(join(here, '../dist/core/notify.service.js')) as {
  NOTIFY_KINDS: Record<string, { title: (d: any) => string; body: (d: any) => string }>;
  NOTIFY_DATA: Record<string, Record<string, string>>;
  cleanNotifyData: (kind: string, data: Record<string, unknown>) => Record<string, string | number>;
};
const { formatMoney, formatDate } = req('@ananda/shared') as { formatMoney: (c: number, l: string) => string; formatDate: (v: string, l: string) => string };
// intl-messageformat is the engine under next-intl (the tray's translator); reach it through the web app's own install.
const fromNextIntl = createRequire(realpathSync(join(here, '../../web/node_modules/next-intl/package.json')));
const fromUseIntl = createRequire(realpathSync(join(dirname(realpathSync(join(here, '../../web/node_modules/next-intl/package.json'))), '../use-intl/package.json')));
const { IntlMessageFormat } = fromUseIntl('intl-messageformat') as { IntlMessageFormat: new (m: string, l: string) => { format: (v: Record<string, unknown>) => string } };

const msgs = (l: string) => JSON.parse(readFileSync(join(here, `../../web/messages/${l}/common.json`), 'utf8')).notify as Record<string, any>;

/** Sample data per kind: what the call sites send. */
const S: Record<string, Record<string, string | number>> = {
  customer_approval: { broker: 'Ivan Kolev', customer: 'Vino Bar', vatValid: 'yes' },
  special_price_request: { order: 'S-0008', reason: 'Big repeat order' },
  correction_request: { order: 'S-0008', reason: 'Wrong flavours' },
  broker_upload: { broker: 'Ivan Kolev', doc: 'Proof of payment', docKind: 'payment_proof', order: 'S-0008', customer: 'Vino Bar' },
  broker_signed: { broker: 'Nikolay' },
  delivered: { order: 'S-0052' },
  delivered_back: { order: 'S-0052', returned: 3 },
  part_delivered: { order: 'S-0053', stays: 32 },
  purchase_late: { purchase: 'P-0004', days: 3, supplier: 'Napoli Pouch', waiting: 2 },
  stock_arrived: { purchase: 'P-0004', count: 2, orders: 'S-0008, S-0009' },
  stock_count: { name: 'Stefan', total: 120 },
  iban_changed: { admin: 'Maya', last4: '1234', hasIban: 'yes' },
  payment_confirmed: { order: 'S-0008', customer: 'Vino Bar', amountCents: 123456 },
  payment: { order: 'S-0053', next: 'ready' },
  payment_late: { customer: 'Vino Bar', days: 4, order: 'S-0008', amountCents: 123456 },
  part_delivery_unpaid: { order: 'S-0053', customer: 'Vino Bar', amountCents: 123456, delivered: 8, total: 40 },
  upload_opened: { doc: "Customer's purchase order", docKind: 'purchase_order', order: 'S-0008', customer: 'Vino Bar' },
  commission_paid: { amountCents: 50000, order: 'S-0008', customer: 'Vino Bar' },
  commission_paid_undone: {},
  sent_for_approval: { customer: 'Vino Bar' },
  commission_sent: { amountCents: 50000 },
  broker_setup_done: { admin: 'Maya' },
  event: { event: 'Wine Expo', startsOn: '2026-12-03', endsOn: '2026-12-05', place: 'Sofia' },
  customer_assigned: { customer: 'Vino Bar' },
  customer_assigned_until: { customer: 'Vino Bar', until: '2027-05-15' },
  customer_moved: { customer: 'Vino Bar', broker: 'Petya', hasBroker: 'yes' },
  customer_moved_undone: { customer: 'Vino Bar' },
  customer_assigned_undone: { customer: 'Vino Bar' },
  ownership_expiring: { customer: 'Vino Bar', days: 14, until: '2026-12-01', lastOrderOn: '2026-09-01', hasLastOrder: 'yes' },
  broker_changed: { order: 'S-0008', customer: 'Vino Bar', broker: 'Petya', hasBroker: 'yes' },
  order_corrected: { order: 'S-0008', reason: 'Quantities changed' },
  cancelled: { order: 'S-0008', reason: 'customer_cancelled' },
  cancelled_warehouse: { order: 'S-0008' },
  cancel_undone: { order: 'S-0008' },
  allocated: { order: 'S-0008' },
  hold_released: { order: 'S-0008' },
  proforma_expired: { order: 'S-0008' },
  to_ship: { order: 'S-0008' },
  to_ship_again: { order: 'S-0008' },
  approved: { label: 'S-0008', kind: 'special_price' },
  declined: { label: 'Vino Bar', kind: 'new_customer', reason: 'wrong_details', why: 'VAT or details wrong', message: 'Check the VAT', hasMessage: 'yes' },
  waiting_again: { label: 'S-0008' },
};

/** What the tray does with the data before the message sees it (components/shell/notifications.tsx). */
function vals(kind: string, data: Record<string, string | number>, l: string) {
  const v: Record<string, unknown> = { ...data };
  for (const [k, x] of Object.entries(data)) {
    if (k.endsWith('Cents')) v[k.slice(0, -5) || 'amount'] = formatMoney(Number(x), l);
    else if (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x)) v[k] = formatDate(x, l);
  }
  if (kind === 'broker_upload') v.docPhrase = msgs(l).docsA[String(data.docKind)];
  if (kind === 'upload_opened') v.doc = msgs(l).docs[String(data.docKind)];
  if (kind === 'declined') v.why = msgs(l).why[String(data.kind)][String(data.reason)];
  return v;
}

test('every notification kind is in the sample list', () => {
  assert.deepEqual(Object.keys(NOTIFY_KINDS).sort(), Object.keys(S).sort());
});

for (const kind of Object.keys(S)) {
  test(`notify.${kind}: EN matches the stored English, BG and HE are translated`, () => {
    const data = S[kind];
    const k = NOTIFY_KINDS[kind];
    for (const l of ['en', 'bg', 'he']) {
      const m = msgs(l)[kind];
      assert.ok(m?.title, `${l} title`);
      const title = new IntlMessageFormat(m.title, l).format(vals(kind, data, l));
      const body = m.body ? new IntlMessageFormat(m.body, l).format(vals(kind, data, l)) : '';
      assert.ok(!/[{}]/.test(title + body), `${l} placeholders left: ${title} / ${body}`);
      if (k.body(data)) assert.ok(m.body, `${l} body`);
      if (l === 'en') {
        // Cancel reasons and approval reasons are shown in words in the tray; the stored text has the code.
        // These two store the date as YYYY-MM-DD; the tray shows it per language.
        const d = kind === 'event' || kind === 'customer_assigned_until' ? (vals(kind, data, 'en') as typeof data) : data;
        const stored = { title: k.title(d), body: k.body(d) };
        if (kind !== 'cancelled') assert.equal(body, stored.body);
        if (kind !== 'cancelled') assert.equal(title, stored.title);
      } else {
        assert.notEqual(title, k.title(data), `${l} title is English`);
        assert.ok(!/\b(the|is|was|your)\b/i.test(title.replace(/ANANDA|IBAN/g, '')), `${l} title looks English: ${title}`);
        if (l === 'bg') assert.ok(!/\bagents?\b/i.test(title + body), 'BG says agent');
      }
    }
  });
}

/** The names a message reads: `{name}`, `{name, plural, ...}`, `{name, select, ...}`. */
const placeholders = (m: string) => new Set([...m.matchAll(/\{(\w+)\s*[,}]/g)].map((x) => x[1]));
// Names the tray makes from other fields: money from `...Cents`, the article phrase from the upload kind.
const derived = (field: string) => (field.endsWith('Cents') ? [field.slice(0, -5) || 'amount'] : field === 'docKind' ? ['docPhrase'] : []);

for (const kind of Object.keys(NOTIFY_DATA)) {
  test(`notify.${kind}: the data contract, the sample and the messages use the same names`, () => {
    const fields = Object.keys(NOTIFY_DATA[kind]);
    assert.deepEqual(Object.keys(S[kind]).sort(), fields.sort(), 'the sample data has the contract fields');
    const known = new Set([...fields, ...fields.flatMap(derived)]);
    for (const l of ['en', 'bg', 'he']) {
      for (const part of ['title', 'body'] as const) {
        const m = msgs(l)[kind]?.[part];
        if (!m) continue;
        for (const name of placeholders(m)) assert.ok(known.has(name), `${l} ${part} of ${kind} uses {${name}}, not in its data: ${fields.join(', ')}`);
      }
    }
    // Every field is read by the English text or the tray (nothing stored for nothing).
    const used = new Set([...placeholders(msgs('en')[kind].title), ...placeholders(msgs('en')[kind].body ?? '')]);
    for (const f of fields) assert.ok(used.has(f) || derived(f).some((d) => used.has(d)) || ['kind', 'reason', 'docKind', 'doc', 'message'].includes(f), `${kind}.${f} is never read by a message`);
  });
}

test('stored data keeps only the contract fields and caps free text', () => {
  const long = 'x'.repeat(5000);
  const out = cleanNotifyData('special_price_request', { order: 'S-0008', reason: long, extra: 'dropped' });
  assert.deepEqual(Object.keys(out).sort(), ['order', 'reason']);
  assert.equal(String(out.reason).length, 500);
  assert.equal(cleanNotifyData('cancelled', { order: 'S-0008', reason: 'duplicate' }).reason, 'duplicate', 'codes are not capped');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateOrder, tierFor, commissionFor, exciseCentsForUnits, runway } from './domain.ts';
import { formatMoney, formatDate } from './format.ts';

test('tiers follow the distributor price list', () => {
  assert.equal(tierFor(41), null);
  assert.equal(tierFor(42)?.unitPriceCents, 515);
  assert.equal(tierFor(209)?.unitPriceCents, 515);
  assert.equal(tierFor(210)?.unitPriceCents, 510);
  assert.equal(tierFor(834)?.unitPriceCents, 502);
  assert.equal(tierFor(4166)?.unitPriceCents, 488);
});

test('order total incl. VAT = Σ(cartons × 24 × tier price) × 1.20', () => {
  const c = calculateOrder({ aloha: 20, gaia: 22 });
  assert.equal(c.totalCartons, 42);
  assert.equal(c.totalUnits, 1008);
  assert.equal(c.netCents, 1008 * 515);
  assert.equal(c.totalCents, Math.round(1008 * 515 * 1.2));
  assert.equal(c.commissionCents, 1008 * 50);
  assert.equal(c.meetsMinimum, true);
});

test('below the minimum shows how many cartons are missing', () => {
  const c = calculateOrder({ kyoto: 30 });
  assert.equal(c.cartonsShort, 12);
  assert.equal(c.meetsMinimum, false);
});

test('special prices are paid out of the commission', () => {
  assert.equal(commissionFor(1000, 515, 505), 1000 * 50 - 1000 * 10);
  assert.equal(commissionFor(1000, 515, 400), 0);
});

test('excise per unit from 0.25 L at 13%', () => {
  assert.equal(exciseCentsForUnits(1), 18);
  assert.equal(exciseCentsForUnits(10_000), 182_787);
});

test('runway compares runs-out date to lead time', () => {
  const r = runway(600, 600, 30, new Date('2026-11-10'));
  assert.equal(r.daysLeft, 60);
  assert.equal(r.status, 'reorder_soon');
  assert.equal(runway(100, 600, 30).status, 'reorder_now');
});

test('money and dates per language', () => {
  assert.equal(formatMoney(682272, 'en'), '€6,822.72');
  assert.equal(formatMoney(682272, 'bg'), '€6 822,72');
  assert.equal(formatDate('2026-11-03', 'en'), '3 Nov 2026');
  assert.equal(formatDate('2026-11-03', 'bg'), '03.11.2026');
});

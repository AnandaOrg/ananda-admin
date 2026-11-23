import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateOrder, tierFor, commissionFor, exciseCentsForUnits, runway } from './domain.ts';
import { formatMoney, formatNumber, formatUnitPrice, parseMoney, formatDate, formatDateShort } from './format.ts';

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
  assert.equal(formatMoney(682272, 'bg'), '6822,72\u00a0€');
  assert.equal(formatDate('2026-11-03', 'en'), '3 Nov 2026');
  assert.equal(formatDate('2026-11-03', 'bg'), '03.11.2026');
  assert.equal(formatDateShort('2026-11-03', 'bg'), '03.11.26');
  assert.equal(formatDateShort('2026-11-03', 'en'), '3 Nov');
});

test('money per language: EN and HE lead with the euro sign, BG puts it after the amount', () => {
  const nb = '\u00a0';
  // EN and HE: unchanged.
  for (const l of ['en', 'he']) {
    assert.equal(formatMoney(1038240, l), '€10,382.40');
    assert.equal(formatMoney(3663500, l, { whole: true }), '€36,635');
    assert.equal(formatMoney(-56807, l), '−€568.07');
    assert.equal(formatMoney(0, l), '€0.00');
    assert.equal(formatUnitPrice(515, l), '€5.15');
    assert.equal(formatUnitPrice(270.25, l, 4), '€2.7025');
    assert.equal(formatNumber(12624, l), '12,624');
  }
  // BG (Bulgarian National Bank): amount, space, euro; comma decimals; groups only from five digits.
  assert.equal(formatMoney(3663500, 'bg', { whole: true }), `36${nb}635${nb}€`);
  assert.equal(formatMoney(3633800, 'bg', { whole: true }), `36${nb}338${nb}€`);
  assert.equal(formatMoney(667440, 'bg'), `6674,40${nb}€`);
  assert.equal(formatMoney(370800, 'bg'), `3708,00${nb}€`);
  assert.equal(formatMoney(1038240, 'bg'), `10${nb}382,40${nb}€`);
  assert.equal(formatMoney(123456789, 'bg'), `1${nb}234${nb}567,89${nb}€`);
  assert.equal(formatMoney(5000, 'bg'), `50,00${nb}€`);
  assert.equal(formatMoney(0, 'bg'), `0,00${nb}€`);
  assert.equal(formatMoney(-552960, 'bg'), `−5529,60${nb}€`);
  assert.equal(formatUnitPrice(50, 'bg'), `0,50${nb}€`);
  assert.equal(formatNumber(2880, 'bg'), '2880');
  assert.equal(formatNumber(12624, 'bg'), `12${nb}624`);
  assert.equal(formatNumber(-0.001, 'bg', 2), '0,00');
});

test('typed amounts read back into cents', () => {
  assert.equal(parseMoney('€10,382.40', 'en'), 1038240);
  assert.equal(parseMoney('10382.4', 'en'), 1038240);
  assert.equal(parseMoney('10,5', 'en'), 1050);
  assert.equal(parseMoney('1,234', 'he'), 123400);
  assert.equal(parseMoney('10\u00a0382,40\u00a0€', 'bg'), 1038240);
  assert.equal(parseMoney('10382.40', 'bg'), 1038240);
  assert.equal(parseMoney('6822,72', 'bg'), 682272);
  assert.equal(parseMoney('−€5.00', 'en'), -500);
  assert.equal(parseMoney('', 'en'), null);
  assert.equal(parseMoney('€', 'bg'), null);
  for (const l of ['en', 'bg', 'he']) for (const c of [0, 5, 682272, 3663500, 123456789]) assert.equal(parseMoney(formatMoney(c, l), l), c);
});

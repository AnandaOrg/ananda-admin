// Numbers, money and dates per language (design system: Numbers, money and dates).
// EN/HE: €6,822.72 · 3 Nov 2026. BG: €6 822,72 · 03.11.2026 (euro sign first, space groups
// thousands even in four-digit numbers), which Intl.NumberFormat('bg-BG') does not produce.

export const LOCALES = ['en', 'bg', 'he'] as const;
export type Locale = (typeof LOCALES)[number];

export function isRtl(locale: string): boolean {
  return locale === 'he';
}

function group(intPart: string, sep: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

export function formatNumber(value: number, locale: Locale | string = 'en', decimals = 0): string {
  const neg = value < 0;
  const fixed = Math.abs(value).toFixed(decimals);
  const [i, d] = fixed.split('.');
  const bg = locale === 'bg';
  const out = group(i, bg ? ' ' : ',') + (d ? (bg ? ',' : '.') + d : '');
  return (neg ? '−' : '') + out;
}

/** Money from cents. `whole` drops the cents (KPI tiles). */
export function formatMoney(cents: number, locale: Locale | string = 'en', opts: { whole?: boolean } = {}): string {
  const euros = cents / 100;
  const neg = euros < 0;
  const body = formatNumber(Math.abs(euros), locale, opts.whole ? 0 : 2);
  return (neg ? '−' : '') + '€' + body;
}

/** Unit prices may carry fractional cents (landed cost); shown with 2–4 decimals. */
export function formatUnitPrice(cents: number, locale: Locale | string = 'en', decimals = 2): string {
  return '€' + formatNumber(cents / 100, locale, decimals);
}

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function toDate(value: Date | string): Date {
  if (value instanceof Date) return value;
  // Plain dates (YYYY-MM-DD) are calendar days, not instants.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(value);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Full date for data (tables, documents, exports). */
export function formatDate(value: Date | string | null | undefined, locale: Locale | string = 'en'): string {
  if (!value) return '';
  const d = toDate(value);
  if (locale === 'bg') return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
  if (locale === 'he') return new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
  return `${d.getDate()} ${MONTHS_EN[d.getMonth()]} ${d.getFullYear()}`;
}

/** Compact controls (date chips, range buttons) use DD.MM.YY in BG. */
export function formatDateShort(value: Date | string | null | undefined, locale: Locale | string = 'en'): string {
  if (!value) return '';
  const d = toDate(value);
  if (locale === 'bg') return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)}`;
  if (locale === 'he') return new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short' }).format(d);
  return `${d.getDate()} ${MONTHS_EN[d.getMonth()]}`;
}

export function formatDateTime(value: Date | string | null | undefined, locale: Locale | string = 'en'): string {
  if (!value) return '';
  const d = toDate(value);
  return `${formatDate(d, locale)}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatMonth(value: Date | string, locale: Locale | string = 'en'): string {
  const d = toDate(value);
  const tag = locale === 'bg' ? 'bg-BG' : locale === 'he' ? 'he-IL' : 'en-GB';
  return new Intl.DateTimeFormat(tag, { month: 'long', year: 'numeric' }).format(d);
}

export function isoDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function docNumber(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(4, '0')}`;
}

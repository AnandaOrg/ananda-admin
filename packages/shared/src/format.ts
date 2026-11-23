// Numbers, money and dates per language (design system: Numbers, money and dates).
// EN/HE: €6,822.72 · 3 Nov 2026. BG: 6822,72 € · 36 635 € · 03.11.2026 — the euro sign goes after the
// amount with a space (Bulgarian National Bank guidance), the decimal mark is a comma, and thousands
// get a (non-breaking) space only from five digits on, as Bulgarian browsers write it.

export const LOCALES = ['en', 'bg', 'he'] as const;
export type Locale = (typeof LOCALES)[number];

export function isRtl(locale: string): boolean {
  return locale === 'he';
}

/** Non-breaking space: BG thousands groups and the space before the euro sign never break across lines. */
const NBSP = '\u00a0';

function group(intPart: string, sep: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

export function formatNumber(value: number, locale: Locale | string = 'en', decimals = 0): string {
  const neg = value < 0;
  const fixed = Math.abs(value).toFixed(decimals);
  const [i, d] = fixed.split('.');
  const bg = locale === 'bg';
  // BG: 3708 but 36 338 (no group separator in four-digit numbers).
  const int = bg ? (i.length > 4 ? group(i, NBSP) : i) : group(i, ',');
  const out = int + (d ? (bg ? ',' : '.') + d : '');
  return (neg && Number(fixed) !== 0 ? '−' : '') + out;
}

/** Puts the euro sign where the language writes it: EN/HE "€6,822.72", BG "6822,72 €". */
function withEuro(body: string, locale: Locale | string): string {
  return locale === 'bg' ? body + NBSP + '€' : '€' + body;
}

/** Money from cents. `whole` drops the cents (KPI tiles). */
export function formatMoney(cents: number, locale: Locale | string = 'en', opts: { whole?: boolean } = {}): string {
  const euros = cents / 100;
  const body = formatNumber(Math.abs(euros), locale, opts.whole ? 0 : 2);
  const neg = euros < 0 && /[1-9]/.test(body);
  return (neg ? '−' : '') + withEuro(body, locale);
}

/** Unit prices may carry fractional cents (landed cost); shown with 2–4 decimals. */
export function formatUnitPrice(cents: number, locale: Locale | string = 'en', decimals = 2): string {
  const body = formatNumber(Math.abs(cents) / 100, locale, decimals);
  return (cents < 0 && /[1-9]/.test(body) ? '−' : '') + withEuro(body, locale);
}

/**
 * Reads a typed amount back into cents (money inputs). Accepts what formatMoney writes in the
 * language ("€10,382.40", "10 382,40 €") and plain typing ("10382.4", "10382,40"). BG: a comma or a
 * dot is the decimal mark. EN/HE: the dot is; a comma groups thousands unless it ends the number
 * with one or two digits ("10,5"). Null when there is no number.
 */
export function parseMoney(input: string, locale: Locale | string = 'en'): number | null {
  const neg = /[−-]/.test(input);
  let s = input.replace(/[^\d.,]/g, '');
  if (!/\d/.test(s)) return null;
  if (locale === 'bg') {
    const at = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
    s = at < 0 ? s : s.slice(0, at).replace(/[.,]/g, '') + '.' + s.slice(at + 1).replace(/[.,]/g, '');
  } else if (!s.includes('.') && /,\d{1,2}$/.test(s)) {
    const at = s.lastIndexOf(',');
    s = s.slice(0, at).replace(/,/g, '') + '.' + s.slice(at + 1);
  } else {
    const at = s.lastIndexOf('.');
    s = at < 0 ? s.replace(/,/g, '') : s.slice(0, at).replace(/[.,]/g, '') + '.' + s.slice(at + 1).replace(/[.,]/g, '');
  }
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  const cents = Math.round(n * 100);
  return neg ? -cents : cents;
}

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];

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

/** Compact dates for controls and sub-lines (date chips, range buttons, "As of"): EN "8 Nov", BG "03.11.26" (DD.MM.YY),
 *  HE "8 בנוב׳". Dates that are the data (tables, invoices, documents, exports) use formatDate. */
export function formatDateShort(value: Date | string | null | undefined, locale: Locale | string = 'en'): string {
  if (!value) return '';
  const d = toDate(value);
  if (locale === 'bg') return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${String(d.getFullYear()).slice(-2)}`;
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

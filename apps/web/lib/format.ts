'use client';

import { useLocale } from 'next-intl';
import {
  formatDate,
  formatDateShort,
  formatDateTime,
  formatMoney,
  formatMonth,
  formatNumber,
  formatUnitPrice,
  type Locale,
} from '@ananda/shared';

/**
 * Locale-aware formatters (design system: Numbers, money and dates).
 * - `date`: every date that is the data (table cells, invoices, documents, exports, detail rows): EN "3 Nov 2026", BG "03.11.2026".
 * - `dateShort`: compact controls and sub-lines (date chips, range buttons, "As of"): EN "3 Nov", BG "03.11.26" (DD.MM.YY).
 * - Money/number: `money`, `unit`, `num` (BG "6822,72 €", "36 635 €"). Wrap amounts, codes and Latin names in <bdi> in the TSX.
 */
export function useFmt() {
  const locale = useLocale() as Locale;
  return {
    locale,
    money: (cents: number | null | undefined, whole = false) => (cents == null ? '—' : formatMoney(cents, locale, { whole })),
    unit: (cents: number | null | undefined, decimals = 2) => (cents == null ? '—' : formatUnitPrice(cents, locale, decimals)),
    num: (n: number | null | undefined, decimals = 0) => (n == null ? '—' : formatNumber(n, locale, decimals)),
    date: (d: Date | string | null | undefined) => formatDate(d, locale),
    dateShort: (d: Date | string | null | undefined) => formatDateShort(d, locale),
    dateTime: (d: Date | string | null | undefined) => formatDateTime(d, locale),
    month: (d: Date | string) => formatMonth(d, locale),
    day: (d: string) => formatDay(d, locale),
  };
}

/** The day as a page's date line: EN "Tuesday, 3 November", BG "вторник, 3 ноември", HE "יום שלישי, 3 בנובמבר". */
export function formatDay(day: string, locale: string): string {
  const parts = new Intl.DateTimeFormat(locale === 'he' ? 'he-IL' : locale === 'bg' ? 'bg-BG' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).formatToParts(new Date(`${day.slice(0, 10)}T12:00:00`));
  const p = (k: string) => parts.find((x) => x.type === k)?.value ?? '';
  // en-GB leaves out the comma.
  return locale === 'en' ? `${p('weekday')}, ${p('day')} ${p('month')}` : parts.map((x) => x.value).join('');
}

/** Keeps a name, code or amount left-to-right inside Hebrew text where a <bdi> can't go (toasts, plain strings). */
export const iso = (s: string | number | null | undefined) => `⁨${s ?? ''}⁩`;

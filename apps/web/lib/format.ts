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

/** Locale-aware formatters (design system: Numbers, money and dates). */
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
  };
}

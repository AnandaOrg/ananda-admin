'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { StatusTone } from '@ananda/shared';
import { Pill } from '@/components/ui';
import type { PayableKind, PurchaseStatus } from '../_lib/types';

/** One word for a purchase: N days late, Ordered, On the way, Received · to pay, Received · paid. */
export function usePurchaseStatus() {
  const t = useTranslations('purchasing');
  const tc = useTranslations('common');
  return (p: { status: PurchaseStatus; daysLate?: number; stillToPayCents: number }): [StatusTone, string] => {
    if (p.daysLate && p.daysLate > 0) return ['bad', tc('daysLate', { n: p.daysLate })];
    if (p.status === 'received') return ['good', p.stillToPayCents > 0 ? t('status.receivedToPay') : t('status.receivedPaid')];
    if (p.status === 'cancelled') return ['mute', t('status.cancelled')];
    return ['info', t(`status.${p.status}`)];
  };
}

export function PurchaseStatusPill({ p }: { p: { status: PurchaseStatus; daysLate?: number; stillToPayCents: number } }) {
  const [tone, label] = usePurchaseStatus()(p);
  return <Pill tone={tone}>{label}</Pill>;
}

/** What a bill is for: Supplier invoice (· balance once part paid), Freight, Excise for <month>. */
export function useKindLabel() {
  const t = useTranslations('purchasing');
  return (k: PayableKind, extra?: { paidCents?: number; month?: string | null }) => {
    if (k === 'supplier_invoice' && extra?.paidCents) return t('payables.kind.supplierBalance');
    if (k === 'excise' && extra?.month) return t('payables.kind.exciseFor', { month: extra.month });
    return t(`payables.kind.${k}`);
  };
}

/** Month name alone ("October", "октомври"), for "Excise for October". */
export function useMonthName() {
  const locale = useLocale();
  const tag = locale === 'bg' ? 'bg-BG' : locale === 'he' ? 'he-IL' : 'en-GB';
  return (iso: string | null | undefined) => {
    if (!iso) return null;
    const [y, m] = iso.split('-').map(Number);
    return new Intl.DateTimeFormat(tag, { month: 'long' }).format(new Date(y, m - 1, 1));
  };
}

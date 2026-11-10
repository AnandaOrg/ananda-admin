'use client';

import { useTranslations } from 'next-intl';
import type { StatusTone } from '@ananda/shared';
import { Pill } from '@/components/ui';
import type { PayableKind, PurchaseStatus } from '../_lib/types';

const TONE: Record<PurchaseStatus, StatusTone> = { ordered: 'mute', on_the_way: 'info', received: 'good', cancelled: 'mute' };

/** Purchase status as a word, with "N days late" and "Invoice missing" when they apply. */
export function PurchaseStatusPill({ status, daysLate, invoiceMissing }: { status: PurchaseStatus; daysLate?: number; invoiceMissing?: boolean }) {
  const t = useTranslations('purchasing');
  const tc = useTranslations('common');
  return (
    <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
      <Pill tone={TONE[status]}>{t(`status.${status}`)}</Pill>
      {!!daysLate && daysLate > 0 && <Pill tone="bad">{tc('daysLate', { n: daysLate })}</Pill>}
      {invoiceMissing && status === 'received' && <Pill tone="warn">{t('status.invoiceMissing')}</Pill>}
    </span>
  );
}

export function PayableStatusPill({ p, today }: { p: { amountCents: number; paidCents: number; dueOn: string }; today: string }) {
  const t = useTranslations('purchasing');
  if (p.paidCents >= p.amountCents) return <Pill tone="good">{t('payables.status.paid')}</Pill>;
  if (p.dueOn < today) return <Pill tone="bad">{t('payables.status.overdue')}</Pill>;
  if (p.paidCents > 0) return <Pill tone="warn">{t('payables.status.part')}</Pill>;
  return <Pill tone="info">{t('payables.status.open')}</Pill>;
}

export function useKindLabel() {
  const t = useTranslations('purchasing');
  return (k: PayableKind) => t(`payables.kind.${k}`);
}

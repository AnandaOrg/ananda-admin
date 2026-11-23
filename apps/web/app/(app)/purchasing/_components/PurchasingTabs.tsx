'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { CaretRight, Chips, Icon } from '@/components/ui';
import type { PurchaseList } from '../_lib/types';
import css from '../purchasing.module.css';

export type PurchasingTab = 'purchases' | 'suppliers' | 'payables' | 'shipments';
const HREF: Record<PurchasingTab, string> = { purchases: '/purchasing', suppliers: '/purchasing/suppliers', payables: '/purchasing/payables', shipments: '/purchasing/shipments' };

/** The unfiltered purchase list: counts for the tabs and the page kickers. Shares its cache with the Purchases tab. */
export function usePurchaseSummary() {
  return useQuery({ queryKey: ['purchases', ''], queryFn: () => api.get<PurchaseList>('/purchases') });
}

/** The four Purchasing pages as a chip row under the page header (the phone has no Shipments). */
export function PurchasingTabs({ current }: { current: PurchasingTab }) {
  const t = useTranslations('purchasing');
  const router = useRouter();
  const sum = usePurchaseSummary();
  const label = (k: PurchasingTab) =>
    k === 'purchases' && sum.data ? t('tabs.withCount', { label: t('tabs.purchases'), n: sum.data.counts.all }) : k === 'suppliers' && sum.data ? t('tabs.withCount', { label: t('tabs.suppliers'), n: sum.data.approvedSuppliers }) : t(`tabs.${k}`);
  const go = (v: PurchasingTab) => v !== current && router.push(HREF[v]);
  const all = Object.keys(HREF) as PurchasingTab[];
  return (
    <>
      <div className="only-wide">
        <Chips fill={false} label={t('tabs.label')} value={current} onChange={go} options={all.map((k) => ({ value: k, label: label(k) }))} />
      </div>
      <div className="only-phone">
        <Chips fill={false} label={t('tabs.label')} value={current} onChange={go} options={all.filter((k) => k !== 'shipments' || current === 'shipments').map((k) => ({ value: k, label: label(k) }))} />
      </div>
    </>
  );
}

/** Note under a table, inside its card. */
export function TableFoot({ children }: { children: React.ReactNode }) {
  return (
    <div className={`body-sm muted ${css.strip}`}>
      {children}
    </div>
  );
}

/** Trailing chevron column for rows that open a page or a panel. */
export const chevronColumn = <T,>() => ({
  key: 'go',
  header: <span className="sr-only" />,
  type: 'amount' as const,
  render: (_: T) => <Icon as={CaretRight} size="sm" className="subtle" />,
});

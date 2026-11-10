'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Segmented } from '@/components/ui';

export type PurchasingTab = 'purchases' | 'suppliers' | 'payables' | 'shipments';
const HREF: Record<PurchasingTab, string> = { purchases: '/purchasing', suppliers: '/purchasing/suppliers', payables: '/purchasing/payables', shipments: '/purchasing/shipments' };

/** The four Purchasing pages, one row under the page header. */
export function PurchasingTabs({ current }: { current: PurchasingTab }) {
  const t = useTranslations('purchasing');
  const router = useRouter();
  return (
    <Segmented
      label={t('tabs.label')}
      value={current}
      onChange={(v) => router.push(HREF[v])}
      options={(Object.keys(HREF) as PurchasingTab[]).map((k) => ({ value: k, label: t(`tabs.${k}`) }))}
    />
  );
}

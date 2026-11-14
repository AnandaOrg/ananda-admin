'use client';

import { useTranslations } from 'next-intl';
import { useSession } from '@/lib/session';
import { PageHeader } from '@/components/ui';
import { Counts } from '../_components/Counts';

/** FR-INV-6: the warehouse's blind counts, checked against the system and corrected with an adjustment. */
export default function StockCountsPage() {
  const t = useTranslations('inventory');
  const tc = useTranslations('common');
  const { canEdit, readOnly } = useSession();
  return (
    <div className="page">
      <PageHeader crumbs={[{ label: tc('nav.inventory'), href: '/inventory' }, { label: t('counts.pageTitle') }]} kicker={t('counts.kicker')} title={t('counts.pageTitle')} />
      <Counts editable={canEdit('inventory') && !readOnly} />
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSession } from '@/lib/session';
import { Button, PageHeader, SlidersHorizontal } from '@/components/ui';
import { Movements } from '../_components/Movements';
import { AdjustSheet } from '../_components/AdjustSheet';

/** FR-INV-5: Stock movements, under Inventory. */
export default function StockMovementsPage() {
  const t = useTranslations('inventory');
  const tc = useTranslations('common');
  const { canEdit, readOnly } = useSession();
  const editable = canEdit('inventory') && !readOnly;
  const [adjusting, setAdjusting] = useState(false);
  return (
    <div className="page">
      <PageHeader
        crumbs={[{ label: tc('nav.inventory'), href: '/inventory' }, { label: t('movements.title') }]}
        kicker={t('movements.kicker')}
        title={t('movements.title')}
        actions={
          editable ? (
            <span className="only-wide">
              <Button size="sm" icon={SlidersHorizontal} onClick={() => setAdjusting(true)}>
                {t('adjust.title')}
              </Button>
            </span>
          ) : undefined
        }
      />
      <Movements />
      {editable && <AdjustSheet open={adjusting} onClose={() => setAdjusting(false)} />}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { FLAVOURS, UNITS_PER_CARTON, type CartonsByFlavour } from '@ananda/shared';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useFmt } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Banner, Button, Card, CartonsEditor, EmptyState, FlavourRows, PageHeader, Sheet } from '@/components/ui';
import type { LastCount } from '../_components/types';

const empty = (): CartonsByFlavour => Object.fromEntries(FLAVOURS.map((f) => [f, 0]));

/** Blind stock count of full cartons (FR-WH-6). Expected figures are never shown here. */
export default function CountPage() {
  const t = useTranslations('warehouse');
  const tc = useTranslations('common');
  const { num, date } = useFmt();
  const { canEdit, readOnly, isWarehouse } = useSession();
  const [cartons, setCartons] = useState<CartonsByFlavour>(empty);
  const [confirm, setConfirm] = useState(false);
  const [done, setDone] = useState(false);
  const last = useQuery({ queryKey: ['warehouse', 'last-count'], queryFn: () => api.get<LastCount | null>('/warehouse/counts/last') });
  const send = useAction(() => api.post('/warehouse/counts', { cartons }), {
    success: t('count.sent'),
    onDone: () => {
      setConfirm(false);
      setDone(true);
    },
  });
  const total = FLAVOURS.reduce((s, f) => s + (cartons[f] ?? 0), 0);
  const canSend = canEdit('warehouse') && !readOnly;

  return (
    <div className="page">
      <PageHeader crumbs={isWarehouse ? undefined : [{ label: tc('nav.warehouse'), href: '/warehouse' }, { label: t('count.title') }]} kicker={t('count.kicker')} title={t('count.title')} />
      {done ? (
        <Card>
          <EmptyState
            done
            title={t('count.doneTitle')}
            text={t('count.doneText')}
            action={
              <Button
                onClick={() => {
                  setCartons(empty());
                  setDone(false);
                }}
              >
                {t('count.again')}
              </Button>
            }
          />
        </Card>
      ) : (
        <Card>
          <span className="body-sm muted">{t('count.help')}</span>
          <CartonsEditor value={cartons} onChange={setCartons} />
          <div className="row between">
            <span className="muted">{t('count.total')}</span>
            <bdi className="strong num">{tc('cartonsUnits', { c: num(total), u: num(total * UNITS_PER_CARTON) })}</bdi>
          </div>
          {canSend && (
            <Button variant="primary" size="lg" block onClick={() => setConfirm(true)}>
              {t('count.send')}
            </Button>
          )}
          <span className="caption muted">{last.data ? t('count.last', { date: date(last.data.at), name: last.data.byName }) : last.isSuccess ? t('count.never') : ''}</span>
        </Card>
      )}
      <Sheet
        open={confirm}
        onClose={() => setConfirm(false)}
        title={t('count.confirmTitle')}
        sub={tc('cartonsUnits', { c: num(total), u: num(total * UNITS_PER_CARTON) })}
        footer={
          <>
            <Button onClick={() => setConfirm(false)}>{tc('back')}</Button>
            <Button variant="primary" busy={send.isPending} onClick={() => send.mutate(undefined)}>
              {t('count.send')}
            </Button>
          </>
        }
      >
        <FlavourRows cartons={cartons} />
        <span className="body-sm muted">{t('count.confirmText')}</span>
        {send.errorText && <Banner tone="bad">{send.errorText}</Banner>}
      </Sheet>
    </div>
  );
}

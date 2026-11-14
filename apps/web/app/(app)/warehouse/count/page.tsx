'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { FLAVOURS, UNITS_PER_CARTON, type CartonsByFlavour } from '@ananda/shared';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useFmt } from '@/lib/format';
import { useSession } from '@/lib/session';
import { ActionError, Button, Card, EmptyState, PageHeader } from '@/components/ui';
import { StepRow } from '../_components/DeliverySheets';

const empty = (): CartonsByFlavour => Object.fromEntries(FLAVOURS.map((f) => [f, 0]));

/** Blind stock count of full cartons (FR-WH-6). Expected figures are never shown here. */
export default function CountPage() {
  const t = useTranslations('warehouse');
  const tc = useTranslations('common');
  const { num, dateShort } = useFmt();
  const { canEdit, readOnly, isWarehouse } = useSession();
  const [cartons, setCartons] = useState<CartonsByFlavour>(empty);
  const [sent, setSent] = useState<{ n: number; at: string } | null>(null);
  const total = FLAVOURS.reduce((s, f) => s + (cartons[f] ?? 0), 0);
  const send = useAction(() => api.post<{ id: string; at: string }>('/warehouse/counts', { cartons }), {
    success: t('count.sent'),
    onDone: (r) => setSent({ n: total, at: r.at }),
  });
  const canSend = canEdit('warehouse') && !readOnly;

  return (
    <div className="page" style={{ maxWidth: 640 }}>
      <PageHeader crumbs={isWarehouse ? undefined : [{ label: tc('nav.warehouse'), href: '/warehouse' }, { label: t('count.title') }]} title={t('count.title')} />
      {sent ? (
        <Card>
          <EmptyState
            done
            title={t('count.doneTitle')}
            text={t('count.doneText', { n: sent.n, date: dateShort(sent.at) })}
            action={
              <Button
                onClick={() => {
                  setCartons(empty());
                  setSent(null);
                }}
              >
                {t('count.again')}
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <span className="body-sm muted">{t('count.help')}</span>
          <div className="stack tight">
            {FLAVOURS.map((f) => (
              <StepRow key={f} flavour={f} value={cartons[f] ?? 0} onChange={(n) => setCartons({ ...cartons, [f]: n })} sub={tc('unitsCount', { n: num((cartons[f] ?? 0) * UNITS_PER_CARTON) })} label={tc('cartonsOf', { flavour: f.toUpperCase() })} />
            ))}
          </div>
          {canSend && (
            <Button variant="primary" size="lg" block busy={send.isPending} disabled={total === 0} onClick={() => send.mutate(undefined)}>
              {t('count.send')}
            </Button>
          )}
          <ActionError action={send} />
        </>
      )}
    </div>
  );
}

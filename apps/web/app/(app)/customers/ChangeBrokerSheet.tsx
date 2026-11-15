'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useUndoOwner } from './useUndoOwner';
import { ActionError, Button, Sheet } from '@/components/ui';
import { DropdownField } from './Dropdown';
import s from './customers.module.css';

export const CHANGE_REASONS = ['broker_left', 'customer_request', 'area_change'] as const;

/** Admin moves a customer to another broker: open orders stay, new ones go to the new broker (FR-CUST-5). */
export function ChangeBrokerSheet({ customer, onClose }: { customer: { id: string; companyName: string; brokerId: string | null; brokerName: string | null; months?: number } | null; onClose: () => void }) {
  const t = useTranslations('customers');
  const [brokerId, setBrokerId] = useState('');
  const [reason, setReason] = useState('');
  const brokers = useQuery({ queryKey: ['brokers-list'], queryFn: () => api.get<{ id: string; name: string }[]>('/customers/brokers'), enabled: !!customer });
  const close = () => {
    setBrokerId('');
    setReason('');
    onClose();
  };
  const tc = useTranslations('common');
  const undoMove = useUndoOwner('change-broker');
  const move = useAction(() => api.post(`/customers/${customer!.id}/change-broker`, { brokerId, reason }).then(() => customer!.id), {
    success: t('brokerChanged'),
    successAction: (id) => ({ label: tc('undo'), onClick: () => undoMove.mutate(id) }),
    onDone: close,
  });
  if (!customer) return null;
  const first = customer.brokerName?.split(' ')[0] ?? '';
  return (
    <Sheet
      open
      onClose={close}
      title={t('changeBroker')}
      dirty={!!brokerId || !!reason}
      footer={
        <Button variant="primary" disabled={!brokerId || !reason} busy={move.busy} onClick={() => move.mutate(undefined)}>
          {t('changeBroker')}
        </Button>
      }
    >
      <p className={s.sub}>{customer.brokerName ? t('change.now', { name: customer.companyName, broker: customer.brokerName }) : t('change.noneYet', { name: customer.companyName })}</p>
      <DropdownField
        label={t('newBroker')}
        value={brokerId}
        placeholder={t('chooseBroker')}
        options={(brokers.data ?? []).filter((a) => a.id !== customer.brokerId).map((a) => ({ value: a.id, label: a.name }))}
        onChange={setBrokerId}
      />
      <DropdownField
        label={t('change.reason')}
        value={reason}
        placeholder={t('change.chooseReason')}
        options={CHANGE_REASONS.map((r) => ({ value: r, label: t(`change.reasons.${r}`), detail: t(`change.reasonsDetail.${r}`) }))}
        onChange={setReason}
      />
      <span className={s.note}>{customer.brokerName ? t('change.openStay', { broker: first }) : t('change.newKeeps', { n: customer.months ?? 6 })}</span>
      <ActionError action={move} />
    </Sheet>
  );
}

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { ActionError, Button, Sheet } from '@/components/ui';
import { DropdownField } from './Dropdown';
import s from './customers.module.css';

export const CHANGE_REASONS = ['agent_left', 'customer_request', 'area_change'] as const;

/** Admin moves a customer to another agent: open orders stay, new ones go to the new agent (FR-CUST-5). */
export function ChangeAgentSheet({ customer, onClose }: { customer: { id: string; companyName: string; agentId: string | null; agentName: string | null; months?: number } | null; onClose: () => void }) {
  const t = useTranslations('customers');
  const [agentId, setAgentId] = useState('');
  const [reason, setReason] = useState('');
  const agents = useQuery({ queryKey: ['agents-list'], queryFn: () => api.get<{ id: string; name: string }[]>('/customers/agents'), enabled: !!customer });
  const close = () => {
    setAgentId('');
    setReason('');
    onClose();
  };
  const move = useAction(() => api.post(`/customers/${customer!.id}/change-agent`, { agentId, reason }), {
    success: t('agentChanged'),
    onDone: close,
  });
  if (!customer) return null;
  const first = customer.agentName?.split(' ')[0] ?? '';
  return (
    <Sheet
      open
      onClose={close}
      title={t('changeAgent')}
      dirty={!!agentId || !!reason}
      footer={
        <Button variant="primary" disabled={!agentId || !reason} busy={move.busy} onClick={() => move.mutate(undefined)}>
          {t('changeAgent')}
        </Button>
      }
    >
      <p className={s.sub}>{customer.agentName ? t('change.now', { name: customer.companyName, agent: customer.agentName }) : t('change.noneYet', { name: customer.companyName })}</p>
      <DropdownField
        label={t('newAgent')}
        value={agentId}
        placeholder={t('chooseAgent')}
        options={(agents.data ?? []).filter((a) => a.id !== customer.agentId).map((a) => ({ value: a.id, label: a.name }))}
        onChange={setAgentId}
      />
      <DropdownField
        label={t('change.reason')}
        value={reason}
        placeholder={t('change.chooseReason')}
        options={CHANGE_REASONS.map((r) => ({ value: r, label: t(`change.reasons.${r}`), detail: t(`change.reasonsDetail.${r}`) }))}
        onChange={setReason}
      />
      <span className={s.note}>{customer.agentName ? t('change.openStay', { agent: first }) : t('change.newKeeps', { n: customer.months ?? 6 })}</span>
      <ActionError action={move} />
    </Sheet>
  );
}

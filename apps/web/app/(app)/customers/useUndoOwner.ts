'use client';

import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';

/** The Undo on the Claim and Change broker toasts: the customer goes back to the broker it had. */
export function useUndoOwner(kind: 'claim' | 'change-broker') {
  const t = useTranslations('customers');
  return useAction((id: string) => api.post(`/customers/${id}/${kind}/undo`), { success: t(kind === 'claim' ? 'claimUndone' : 'brokerChangeUndone'), errorToast: true });
}

'use client';

import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';

/** Approve, decline and undo an approval request; Approve and Decline toasts carry Undo. */
export function useDecision(onDone?: () => void) {
  const t = useTranslations('home');
  const tc = useTranslations('common');
  const undo = useAction((id: string) => api.post<{ label: string }>(`/approvals/${id}/undo`), { success: (r) => t('review.undone', { name: r.label }), errorToast: true });
  const approve = useAction((id: string) => api.post<{ label: string }>(`/approvals/${id}/approve`).then((r) => ({ ...r, id })), {
    success: (r) => t('review.approvedToast', { name: r.label }),
    successAction: (r) => ({ label: tc('undo'), onClick: () => undo.mutate(r.id) }),
    onDone: () => onDone?.(),
  });
  const decline = useAction((v: { id: string; reason: string; message?: string }) => api.post<{ label: string }>(`/approvals/${v.id}/decline`, { reason: v.reason, message: v.message || undefined }).then((r) => ({ ...r, id: v.id })), {
    success: (r) => t('review.declinedToast', { name: r.label }),
    successAction: (r) => ({ label: tc('undo'), onClick: () => undo.mutate(r.id) }),
    onDone: () => onDone?.(),
  });
  return { approve, decline, undo };
}

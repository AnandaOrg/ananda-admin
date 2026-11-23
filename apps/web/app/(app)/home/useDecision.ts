'use client';

import { iso } from '@/lib/format';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';

/** Approve, decline and undo an approval request; Approve and Decline toasts carry Undo. */
/**
 * `toast`: one tap on a page (Overview rows): a failure is the "Not approved" error toast with Try again,
 * a conflict an info toast. In the Review panel errors stay inline under the buttons.
 */
export function useDecision(onDone?: () => void, toast = false) {
  const t = useTranslations('home');
  const tc = useTranslations('common');
  const undo = useAction((id: string) => api.post<{ label: string }>(`/approvals/${id}/undo`), { success: (r) => t('review.undone', { name: iso(r.label) }), errorToast: true });
  const approve = useAction((id: string) => api.post<{ label: string }>(`/approvals/${id}/approve`).then((r) => ({ ...r, id })), {
    success: (r) => t('review.approvedToast', { name: iso(r.label) }),
    successAction: (r) => ({ label: tc('undo'), onClick: () => undo.mutate(r.id) }),
    onDone: () => onDone?.(),
    ...(toast ? { errorToast: t('review.approveFailed'), conflictToast: (e) => (e.data?.by ? t(e.data.outcome === 'declined' ? 'review.alreadyDeclinedBy' : 'review.alreadyApprovedBy', { name: iso(String(e.data.by)) }) : t('review.alreadyDecided')) } : {}),
  });
  const decline = useAction((v: { id: string; reason: string; message?: string }) => api.post<{ label: string }>(`/approvals/${v.id}/decline`, { reason: v.reason, message: v.message || undefined }).then((r) => ({ ...r, id: v.id })), {
    success: (r) => t('review.declinedToast', { name: iso(r.label) }),
    successAction: (r) => ({ label: tc('undo'), onClick: () => undo.mutate(r.id) }),
    onDone: () => onDone?.(),
  });
  return { approve, decline, undo };
}

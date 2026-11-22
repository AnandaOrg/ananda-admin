'use client';

import { use, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { signInDevice, useFinishSignIn, type TwoStep } from '@/lib/sign-in';
import { iso } from '@/lib/format';
import { ActionError, Button, Card, NotFound } from '@/components/ui';

/** The invitation e-mail's link proves the address, so accepting it signs the person in; then the two-step set-up. */
export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const t = useTranslations('auth');
  const finish = useFinishSignIn();
  const info = useQuery({ queryKey: ['invite', token], queryFn: () => api.get<{ name: string; email: string }>(`/auth/invite/${token}`), retry: false });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ twoStep: TwoStep }>('/auth/invite/accept', { token, device: signInDevice() });
      await finish(r.twoStep, { invited: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('failed'));
      setBusy(false);
    }
  }

  if (info.error) return <NotFound back={{ label: t('signIn'), href: '/login' }} />;
  return (
    <Card title={t('inviteTitle', { name: info.data?.name ?? '' })}>
      <div className="stack">
        <p className="muted">{t('inviteText', { email: iso(info.data?.email ?? '') })}</p>
        <ActionError error={error} message={error} />
        <Button variant="primary" busy={busy} disabled={!info.data} block size="lg" onClick={accept}>
          {t('acceptInvite')}
        </Button>
        <p className="caption muted">{t('inviteLater')}</p>
      </div>
    </Card>
  );
}

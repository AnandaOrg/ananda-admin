'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { Banner, Button, Card, TextField } from '@/components/ui';

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const t = useTranslations('auth');
  const router = useRouter();
  const info = useQuery({ queryKey: ['invite', token], queryFn: () => api.get<{ name: string; email: string }>(`/auth/invite/${token}`), retry: false });
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const weak = password.length > 0 && (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== repeat) return setError(t('passwordsDiffer'));
    setBusy(true);
    try {
      await api.post('/auth/invite/accept', { token, password });
      router.replace('/login');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('failed'));
      setBusy(false);
    }
  }

  if (info.error) return <Banner tone="bad">{info.error.message}</Banner>;
  return (
    <Card title={t('inviteTitle', { name: info.data?.name ?? '' })}>
      <form className="stack" onSubmit={submit}>
        <p className="muted">{t('inviteText', { email: info.data?.email ?? '' })}</p>
        {error && <Banner tone="bad">{error}</Banner>}
        <TextField label={t('newPassword')} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} help={t('passwordRule')} error={weak ? t('passwordRule') : undefined} required />
        <TextField label={t('repeatPassword')} type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} required />
        <Button variant="primary" type="submit" busy={busy} disabled={weak || !password} block size="lg">
          {t('setPassword')}
        </Button>
      </form>
    </Card>
  );
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import type { Me } from '@/lib/session';
import { Banner, Button, Card, TextField } from '@/components/ui';
import { setLocaleCookie } from '@/components/shell/AppShell';

export default function LoginPage() {
  const t = useTranslations('auth');
  const router = useRouter();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const device = window.matchMedia('(max-width: 767px)').matches ? 'phone' : 'desktop';
      const r = await api.post<{ twoStep: 'none' | 'verify' | 'setup' }>('/auth/login', { email, password, device });
      qc.clear();
      const me = await api.get<Me>('/auth/me');
      setLocaleCookie(me.user.language);
      if (r.twoStep !== 'none') router.replace('/two-step');
      else router.replace(me.perms.scope === 'shipping' ? '/warehouse' : '/home');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('failed'));
      setBusy(false);
    }
  }

  return (
    <Card title={t('signIn')}>
      <form className="stack" onSubmit={submit}>
        {error && <Banner tone="bad">{error}</Banner>}
        <TextField label={t('email')} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <TextField label={t('password')} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <Button variant="primary" type="submit" busy={busy} block size="lg">
          {t('signIn')}
        </Button>
      </form>
    </Card>
  );
}

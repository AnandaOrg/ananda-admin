'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import type { Me } from '@/lib/session';
import { Banner, Button, Card, TextField } from '@/components/ui';

export default function TwoStepPage() {
  const t = useTranslations('auth');
  const router = useRouter();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/auth/me'), retry: false });
  const setup = me.data?.twoStepState === 'setup';
  const qr = useQuery({ queryKey: ['two-step-setup'], queryFn: () => api.post<{ qr: string; secret: string }>('/auth/two-step/setup'), enabled: setup, staleTime: Infinity });
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (me.error) router.replace('/login');
    if (me.data?.twoStepState === 'done') router.replace('/home');
  }, [me.data, me.error, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/two-step/verify', { code });
      await qc.invalidateQueries({ queryKey: ['me'] });
      router.replace(me.data?.perms.scope === 'shipping' ? '/warehouse' : '/home');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('failed'));
      setBusy(false);
    }
  }

  return (
    <Card title={setup ? t('setupTitle') : t('verifyTitle')}>
      <form className="stack" onSubmit={submit}>
        {setup ? (
          <ol className="stack tight body-sm muted" style={{ margin: 0, paddingInlineStart: 'var(--space-5)' }}>
            <li>{t('setupStep1')}</li>
            <li>{t('setupStep2')}</li>
            <li>{t('setupStep3')}</li>
          </ol>
        ) : (
          <p className="muted">{t('verifyText')}</p>
        )}
        {setup && qr.data && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="qr" src={qr.data.qr} alt={t('qrAlt')} />
            <p className="caption muted" style={{ textAlign: 'center', wordBreak: 'break-all' }}>
              {t('secret')} <bdi>{qr.data.secret}</bdi>
            </p>
          </>
        )}
        {error && <Banner tone="bad">{error}</Banner>}
        <TextField
          label={t('code')}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          className="code"
          autoFocus
          required
        />
        <Button variant="primary" type="submit" busy={busy} disabled={code.length !== 6} block size="lg">
          {setup ? t('confirmCode') : t('continue')}
        </Button>
        <button type="button" className="link body-sm" onClick={() => api.post('/auth/logout').finally(() => router.replace('/login'))}>
          {t('useOtherAccount')}
        </button>
      </form>
    </Card>
  );
}

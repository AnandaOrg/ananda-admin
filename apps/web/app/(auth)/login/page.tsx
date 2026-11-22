'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { signInDevice } from '@/lib/sign-in';
import { iso } from '@/lib/format';
import { ActionError, Banner, Button, Card, EnvelopeSimple, GoogleLogo, TextField } from '@/components/ui';
import css from '../auth.module.css';

const ERRORS = ['no_account', 'google_failed', 'google_cancelled', 'google_off'] as const;

/**
 * Sign-in (client decision, 22 Nov 2026): a link we e-mail, or Google; then the two-step code.
 * There are no passwords.
 */
export default function LoginPage() {
  return (
    <Suspense>
      <SignIn />
    </Suspense>
  );
}

function SignIn() {
  const t = useTranslations('auth');
  const methods = useQuery({ queryKey: ['auth-methods'], queryFn: () => api.get<{ link: boolean; google: boolean }>('/auth/methods'), staleTime: Infinity, retry: false });
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const [devToken, setDevToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const params = useSearchParams();
  const next = params.get('next') ?? undefined;
  const failed = ERRORS.find((e) => e === params.get('error'));

  async function send(again = false) {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ ok: true; devToken?: string }>('/auth/link', { email, next });
      setSentTo(email);
      setResent(again);
      setDevToken(r.devToken ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('failed'));
    } finally {
      setBusy(false);
    }
  }

  function google() {
    const q = new URLSearchParams({ device: signInDevice() });
    if (next) q.set('next', next);
    if (email) q.set('email', email);
    window.location.assign(`/api/auth/google?${q}`);
  }

  if (sentTo) {
    return (
      <Card title={t('checkTitle')}>
        <div className="stack">
          <p className="muted">{t('checkText', { email: iso(sentTo) })}</p>
          {resent && <Banner>{t('resent')}</Banner>}
          {devToken && (
            <a className="an-btn secondary lg block" href={`/login/link?t=${devToken}${next ? `&next=${encodeURIComponent(next)}` : ''}`}>
              {t('devLink')}
            </a>
          )}
          <ActionError error={error} message={error} />
          <Button busy={busy} block size="lg" onClick={() => send(true)}>
            {t('resend')}
          </Button>
          <button type="button" className="link body-sm" onClick={() => (setSentTo(null), setDevToken(null), setResent(false))}>
            {t('otherEmail')}
          </button>
        </div>
      </Card>
    );
  }

  return (
    <Card title={t('signIn')}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <p className="muted body-sm">{t('signInText')}</p>
        {failed && <Banner tone="bad">{t(`errors.${failed}`)}</Banner>}
        <TextField label={t('email')} type="email" autoComplete="username" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        <ActionError error={error} message={error} />
        <Button variant="primary" type="submit" icon={EnvelopeSimple} busy={busy} block size="lg">
          {t('sendLink')}
        </Button>
        {methods.data?.google && (
          <>
            <div className={css.or}>
              <span>{t('or')}</span>
            </div>
            <Button icon={GoogleLogo} block size="lg" onClick={google}>
              {t('google')}
            </Button>
          </>
        )}
      </form>
    </Card>
  );
}

'use client';

import { Suspense, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useFinishSignIn, type TwoStep } from '@/lib/sign-in';
import { Card, Spinner } from '@/components/ui';
import css from '../../auth.module.css';

/** Back from Google: the API has already started the session; go on to the two-step code or the app. */
export default function SignInDonePage() {
  return (
    <Suspense>
      <Done />
    </Suspense>
  );
}

function Done() {
  const t = useTranslations('auth');
  const params = useSearchParams();
  const finish = useFinishSignIn();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const twoStep = (['none', 'verify', 'setup'] as const).find((x) => x === params.get('twoStep')) ?? 'verify';
    finish(twoStep as TwoStep, { invited: params.get('invited') === '1' }).catch(() => window.location.replace('/login?error=google_failed'));
  }, [params, finish]);

  return (
    <Card>
      <p className={`muted row ${css.opening}`} role="status">
        <Spinner /> {t('opening')}
      </p>
    </Card>
  );
}

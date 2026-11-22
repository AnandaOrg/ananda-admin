'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { signInDevice, useFinishSignIn, type TwoStep } from '@/lib/sign-in';
import { Card, EmptyState, LinkBreak, Spinner } from '@/components/ui';
import css from '../../auth.module.css';

/** Where an e-mailed sign-in link lands. Opening the page uses the link up (mail scanners only fetch, they don't run it). */
export default function SignInLinkPage() {
  return (
    <Suspense>
      <OpenLink />
    </Suspense>
  );
}

function OpenLink() {
  const t = useTranslations('auth');
  const params = useSearchParams();
  const finish = useFinishSignIn();
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = params.get('t');
    if (!token) return setFailed(true);
    api
      .post<{ twoStep: TwoStep }>('/auth/link/verify', { token, device: signInDevice() })
      .then((r) => finish(r.twoStep))
      .catch(() => setFailed(true));
  }, [params, finish]);

  if (failed) {
    const next = params.get('next');
    return (
      <Card>
        <EmptyState
          icon={LinkBreak}
          title={t('linkExpiredTitle')}
          text={t('linkExpiredText')}
          action={
            <Link href={next ? `/login?next=${encodeURIComponent(next)}` : '/login'} className="an-btn primary">
              {t('newLink')}
            </Link>
          }
        />
      </Card>
    );
  }
  return (
    <Card>
      <p className={`muted row ${css.opening}`} role="status">
        <Spinner /> {t('opening')}
      </p>
    </Card>
  );
}

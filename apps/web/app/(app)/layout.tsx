'use client';

import { Suspense, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { SessionProvider, useMeQuery } from '@/lib/session';
import { AppShell } from '@/components/shell/AppShell';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const t = useTranslations('common');
  const me = useMeQuery();

  useEffect(() => {
    const onUnauthorized = (e: Event) => {
      const code = (e as CustomEvent).detail;
      router.replace(code === 'two_step_required' ? '/two-step' : '/login');
    };
    window.addEventListener('ananda:unauthorized', onUnauthorized);
    return () => window.removeEventListener('ananda:unauthorized', onUnauthorized);
  }, [router]);

  useEffect(() => {
    if (me.error) router.replace('/login');
    else if (me.data && me.data.twoStepState !== 'done') router.replace('/two-step');
  }, [me.data, me.error, router]);

  if (!me.data || me.data.twoStepState !== 'done') {
    return (
      <div className="auth-wrap" aria-busy>
        <span className="muted">{t('loading')}</span>
      </div>
    );
  }
  return (
    <SessionProvider me={me.data}>
      <AppShell>
        <Suspense>{children}</Suspense>
      </AppShell>
    </SessionProvider>
  );
}

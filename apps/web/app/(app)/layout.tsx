'use client';

import { Suspense, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { SessionProvider, useMeQuery } from '@/lib/session';
import { AppShell } from '@/components/shell/AppShell';
import { ConfirmDialog, Lock } from '@/components/ui';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations('common');
  const me = useMeQuery();
  const [signedOut, setSignedOut] = useState(false);
  const here = () => encodeURIComponent(window.location.pathname + window.location.search);

  useEffect(() => {
    const onUnauthorized = (e: Event) => {
      const code = (e as CustomEvent).detail;
      if (code === 'two_step_required') router.replace(`/two-step?next=${here()}`);
      // The session ended while working: say so over the page; Sign in brings people back here.
      else setSignedOut(true);
    };
    window.addEventListener('ananda:unauthorized', onUnauthorized);
    return () => window.removeEventListener('ananda:unauthorized', onUnauthorized);
  }, [router]);

  useEffect(() => {
    if (me.error && !me.data) router.replace(`/login?next=${here()}`);
    else if (me.data && me.data.twoStepState !== 'done') router.replace(`/two-step?next=${here()}`);
  }, [me.data, me.error, router, pathname]);

  const dialog = (
    <ConfirmDialog
      open={signedOut && !!me.data}
      icon={Lock}
      title={t('errors.signedOutTitle')}
      text={t('errors.signedOutText')}
      confirm={{ label: t('errors.signIn'), onClick: () => router.replace(`/login?next=${here()}`) }}
    />
  );

  if (!me.data || me.data.twoStepState !== 'done') {
    return (
      <div className="auth-wrap" aria-busy>
        <span className="an-spin muted" aria-label={t('loading')} />
      </div>
    );
  }
  return (
    <SessionProvider me={me.data}>
      <AppShell>
        <Suspense>{children}</Suspense>
      </AppShell>
      {dialog}
    </SessionProvider>
  );
}

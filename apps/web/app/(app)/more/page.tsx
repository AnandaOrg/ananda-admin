'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { visibleNav } from '@/components/shell/nav';
import { CaretRight, Icon, PageHeader, SignOut, UserPlus } from '@/components/ui';

/** Phone: every page not on the tab bar, grouped like the sidebar. */
export default function MorePage() {
  const t = useTranslations('common');
  const router = useRouter();
  const { canView, isAgent } = useSession();
  const logout = useMutation({ mutationFn: () => api.post('/auth/logout'), onSuccess: () => router.replace('/login') });
  const onTabs = new Set(['home', 'sales', 'customers', 'collections']);
  const groups = visibleNav(canView)
    .map((g) => ({ ...g, items: g.items.filter((i) => !onTabs.has(i.key)) }))
    .filter((g) => g.items.length);
  return (
    <div className="page">
      <PageHeader title={t('more.title')} />
      {groups.map((g) => (
        <section key={g.key ?? 'root'} className="an-card" style={{ gap: 0 }}>
          {g.key && <div className="overline" style={{ paddingBottom: 'var(--space-2)' }}>{t(`navGroup.${g.key}`)}</div>}
          {g.items.map((i) => (
            <Link key={i.key} href={i.href} className="an-sitem phone">
              <Icon as={i.icon} />
              <span>{t(isAgent && i.key === 'agents' ? 'nav.earnings' : `nav.${i.key}`)}</span>
              <span className="val">
                <Icon as={CaretRight} size="sm" className="subtle" />
              </span>
            </Link>
          ))}
        </section>
      ))}
      <section className="an-card" style={{ gap: 0 }}>
        <Link href="/profile" className="an-sitem phone">
          <Icon as={UserPlus} />
          <span>{t('profile')}</span>
          <span className="val">
            <Icon as={CaretRight} size="sm" className="subtle" />
          </span>
        </Link>
        <button className="an-sitem phone" onClick={() => logout.mutate()}>
          <Icon as={SignOut} />
          <span>{t('signOut')}</span>
        </button>
      </section>
    </div>
  );
}

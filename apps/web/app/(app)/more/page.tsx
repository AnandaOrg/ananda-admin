'use client';

import { useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { visibleNav } from '@/components/shell/nav';
import { MoreList } from '@/components/shell/AppShell';
import { PageHeader } from '@/components/ui';

/** Phone: every page not on the tab bar, grouped like the sidebar (the More tab opens the same list as a sheet). */
export default function MorePage() {
  const t = useTranslations('common');
  const router = useRouter();
  const { canView, isBroker, isWarehouse } = useSession();
  const logout = useMutation({ mutationFn: () => api.post('/auth/logout'), onSuccess: () => router.replace('/login') });
  const onTabs = new Set(isWarehouse ? ['warehouse'] : ['home', 'sales', 'customers', 'collections']);
  const groups = visibleNav(canView)
    .map((g) => ({ ...g, items: g.items.filter((i) => !onTabs.has(i.key)) }))
    .filter((g) => g.items.length);
  return (
    <div className="page">
      <PageHeader title={t('more.title')} />
      <section className="an-card more-card">
        <MoreList groups={groups} label={(k) => t(isBroker && k === 'brokers' ? 'nav.earnings' : `nav.${k}`)} onSignOut={() => logout.mutate()} />
      </section>
    </div>
  );
}

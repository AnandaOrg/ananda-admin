'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useSession } from '@/lib/session';
import { PageHeader, PageSkeleton } from '@/components/ui';
import { ProfileDevices } from './_components/profile-devices';

/**
 * FR-ADM-4: language, theme, password, two-step status and signed-in devices (everyone, for themselves).
 * People who can see Settings get the same content as its "Profile & devices" tab.
 */
export default function ProfilePage() {
  const t = useTranslations('admin');
  const router = useRouter();
  const { me, canView } = useSession();
  const withSettings = canView('settings');
  useEffect(() => {
    if (withSettings) router.replace('/settings?tab=me');
  }, [withSettings, router]);
  if (withSettings) return <PageSkeleton />;
  return (
    <div className="page">
      <PageHeader crumbs={[{ label: t('profile.title') }]} kicker={t('profile.kicker', { name: me.user.name, role: me.user.roleName })} title={t('profile.title')} />
      <ProfileDevices />
    </div>
  );
}

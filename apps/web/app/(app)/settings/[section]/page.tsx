'use client';

import { Suspense } from 'react';
import { useParams } from 'next/navigation';
import { PageSkeleton } from '@/components/ui';
import { SettingsView } from '../_components/settings-view';

/** Deep links such as /settings/company and /settings/bank (Home onboarding) open that panel. */
export default function SettingsSectionPage() {
  const { section } = useParams<{ section: string }>();
  return (
    <Suspense fallback={<PageSkeleton />}>
      <SettingsView initial={section} />
    </Suspense>
  );
}

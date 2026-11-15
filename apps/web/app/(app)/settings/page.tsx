'use client';

import { Suspense } from 'react';
import { PageSkeleton } from '@/components/ui';
import { SettingsView } from './_components/settings-view';

export default function SettingsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <SettingsView />
    </Suspense>
  );
}

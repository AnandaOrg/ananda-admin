'use client';

import { useParams } from 'next/navigation';
import { SettingsView } from '../_components/settings-view';

/** Deep links such as /settings/company and /settings/bank (Home onboarding) open that sheet. */
export default function SettingsSectionPage() {
  const { section } = useParams<{ section: string }>();
  return <SettingsView initial={section} />;
}

'use client';

import { useTranslations } from 'next-intl';
import { useMedia } from '@/lib/hooks';
import { Chips } from '@/components/ui';

export type SettingsTab = 'rules' | 'me';

/** Business & company | Profile & devices. Natural width on wider screens, filling the row on a phone. */
export function SettingsTabs({ value, onChange }: { value: SettingsTab; onChange: (v: SettingsTab) => void }) {
  const t = useTranslations('admin');
  const phone = useMedia('(max-width: 767px)');
  return (
    <Chips
      label={t('settings.tabsLabel')}
      fill={phone}
      value={value}
      onChange={onChange}
      options={[
        { value: 'rules', label: t('settings.tabs.rules') },
        { value: 'me', label: t('settings.tabs.me') },
      ]}
    />
  );
}

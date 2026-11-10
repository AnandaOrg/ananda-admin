'use client';

import type { ReactNode } from 'react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { CaretRight, Icon } from '@/components/ui';

/** Row that opens a setting and shows its current value (DS: SettingsItem). */
export function SettingsItem({ icon, label, value, onClick }: { icon: PhosphorIcon; label: string; value: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="an-sitem" onClick={onClick}>
      <Icon as={icon} />
      <span className="grow">{label}</span>
      <span className="val">
        <bdi>{value}</bdi>
        <Icon as={CaretRight} size="sm" />
      </span>
    </button>
  );
}

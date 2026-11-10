'use client';

import { useTranslations } from 'next-intl';
import type { AreaMatrix, RecordScope, SystemRole } from '@ananda/shared';
import { Pill } from '@/components/ui';

export interface RoleSummary {
  id: string;
  key: string;
  name: string;
  description: string | null;
  baseRole: SystemRole;
  isSystem: boolean;
  scope: RecordScope;
  twoStepRequired: boolean;
  areas: AreaMatrix;
  sensitive: string[];
  members: number;
}

export interface Member {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  language: string;
  status: 'invited' | 'active' | 'deactivated';
  twoStepEnabled: boolean;
  lastSignInAt: string | null;
  inviteExpiresAt: string | null;
  createdAt: string;
  hasPassword: boolean;
  role: { id: string; key: string; name: string; baseRole: SystemRole; isSystem: boolean; twoStepRequired: boolean; areas: AreaMatrix };
}

export function seeCounts(areas: AreaMatrix) {
  const v = Object.values(areas);
  return { edit: v.filter((x) => x === 'edit').length, view: v.filter((x) => x === 'view').length };
}

/** "12 edit · 3 view" */
export function WhatTheySee({ areas }: { areas: AreaMatrix }) {
  const t = useTranslations('admin');
  const c = seeCounts(areas);
  return <span className="nowrap">{t('users.sees', c)}</span>;
}

export function MemberStatusPill({ status }: { status: Member['status'] }) {
  const t = useTranslations('admin');
  return <Pill tone={status === 'active' ? 'good' : status === 'invited' ? 'info' : 'mute'}>{t(`users.status.${status}`)}</Pill>;
}

export function TwoStepPill({ enabled, required }: { enabled: boolean; required: boolean }) {
  const t = useTranslations('admin');
  if (enabled) return <Pill tone="good">{t('users.twoStep.on')}</Pill>;
  if (required) return <Pill tone="warn">{t('users.twoStep.atSignIn')}</Pill>;
  return <Pill tone="mute">{t('users.twoStep.off')}</Pill>;
}

/** Custom roles are tagged in blue (DS: Colour). */
export function RoleName({ name, isSystem }: { name: string; isSystem: boolean }) {
  return isSystem ? <span>{name}</span> : <Pill tone="blue">{name}</Pill>;
}

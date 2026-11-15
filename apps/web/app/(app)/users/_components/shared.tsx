'use client';

import { useTranslations } from 'next-intl';
import { SYSTEM_ROLES, type AreaMatrix, type RecordScope, type SystemRole } from '@ananda/shared';
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
  devices?: { device: 'desktop' | 'phone'; userAgent: string | null; lastSeenAt: string }[];
  role: { id: string; key: string; name: string; baseRole: SystemRole; isSystem: boolean; twoStepRequired: boolean; areas: AreaMatrix };
}

export function seeCounts(areas: AreaMatrix) {
  const v = Object.values(areas);
  return { edit: v.filter((x) => x === 'edit').length, view: v.filter((x) => x === 'view').length, hidden: v.filter((x) => x === 'hidden').length };
}

const isSystemKey = (k: string): k is SystemRole => (SYSTEM_ROLES as readonly string[]).includes(k);

/** Names and descriptions of the five system roles in the person's language; custom roles keep their own. */
export function useRoleText() {
  const t = useTranslations('admin');
  const name = (r: { key: string; name: string; isSystem: boolean }) => (r.isSystem && isSystemKey(r.key) ? t(`roles.names.${r.key}`) : r.name);
  const description = (r: { key: string; description: string | null; isSystem: boolean }) => (r.isSystem && isSystemKey(r.key) ? t(`roles.descriptions.${r.key}`) : (r.description ?? ''));
  /** Users › Sees: one phrase per system role, "Custom" for custom roles. */
  const sees = (r: { key: string; isSystem: boolean }) => (r.isSystem && isSystemKey(r.key) ? t(`users.seesBy.${r.key}`) : t('users.seesBy.custom'));
  const sum = (areas: AreaMatrix) => t('roles.sum', seeCounts(areas));
  return { name, description, sees, sum };
}

/** "12 edit · 3 view" (kept for other screens). */
export function WhatTheySee({ areas }: { areas: AreaMatrix }) {
  const t = useTranslations('admin');
  const c = seeCounts(areas);
  return <span className="nowrap">{t('users.sees', c)}</span>;
}

export function MemberStatusPill({ status }: { status: Member['status'] }) {
  const t = useTranslations('admin');
  return <Pill tone={status === 'active' ? 'good' : status === 'invited' ? 'warn' : 'bad'}>{t(`users.status.${status}`)}</Pill>;
}

export function TwoStepPill({ enabled, required }: { enabled: boolean; required: boolean }) {
  const t = useTranslations('admin');
  if (enabled) return <Pill tone="good">{t('users.twoStep.on')}</Pill>;
  if (required) return <Pill tone="warn">{t('users.twoStep.atSignIn')}</Pill>;
  return <Pill tone="mute">{t('users.twoStep.off')}</Pill>;
}

/** "Chrome on macOS" from a user agent. */
export function deviceName(ua: string | null | undefined, fallback: string) {
  if (!ua) return fallback;
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : null;
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : null;
  return browser && os ? `${browser} · ${os}` : (browser ?? os ?? fallback);
}

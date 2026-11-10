'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { useFmt } from '@/lib/format';

export interface AuditEntry {
  id: string;
  at: string;
  actorId: string | null;
  actorName: string | null;
  category: string;
  action: string;
  recordType: string | null;
  recordId: string | null;
  recordLabel: string | null;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  money: boolean;
  meta: Record<string, unknown> | null;
}

const humanize = (s: string) => {
  const t = s.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** Turns raw audit entries into plain words: action, record and before → after. */
export function useAuditFormat() {
  const t = useTranslations('admin');
  const { money, num } = useFmt();

  const action = (e: AuditEntry) => (t.has(`audit.actions.${e.action}`) ? t(`audit.actions.${e.action}`) : humanize(e.action));
  const category = (c: string) => (t.has(`audit.categories.${c}`) ? t(`audit.categories.${c}`) : humanize(c));
  const field = (k: string) => (t.has(`audit.fields.${k}`) ? t(`audit.fields.${k}`) : humanize(k.replace(/Cents$/, '')));
  const record = (e: AuditEntry) => {
    if (!e.recordLabel) return e.recordType ? humanize(e.recordType) : '—';
    if (e.recordType === 'rule' && t.has(`settings.rules.${e.recordLabel}.title`)) return t(`settings.rules.${e.recordLabel}.title`);
    if (e.recordType === 'setting' && t.has(`settings.sections.${e.recordLabel}.title`)) return t(`settings.sections.${e.recordLabel}.title`);
    return e.recordLabel;
  };

  const value = (k: string, v: unknown): string => {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'number' && /Cents$/.test(k)) return money(v);
    if (typeof v === 'number') return num(v);
    if (typeof v === 'boolean') return v ? t('audit.yes') : t('audit.no');
    if (Array.isArray(v)) return v.length ? v.map((x) => (typeof x === 'string' ? humanize(x) : String(x))).join(', ') : '—';
    if (typeof v === 'object') {
      const entries = Object.entries(v as Record<string, unknown>);
      return entries.map(([kk, vv]) => `${field(kk)}: ${value(kk, vv)}`).join(' · ');
    }
    return String(v);
  };

  /** Area matrices change many keys at once; show only the areas that changed. */
  const pairs = (k: string, c: { from: unknown; to: unknown }): { label: string; from: string; to: string }[] => {
    if (c.from && c.to && typeof c.from === 'object' && typeof c.to === 'object' && !Array.isArray(c.from) && !Array.isArray(c.to)) {
      const f = c.from as Record<string, unknown>;
      const to = c.to as Record<string, unknown>;
      const keys = [...new Set([...Object.keys(f), ...Object.keys(to)])].filter((x) => JSON.stringify(f[x]) !== JSON.stringify(to[x]));
      return keys.map((x) => ({ label: `${field(k)} › ${field(x)}`, from: value(x, f[x]), to: value(x, to[x]) }));
    }
    return [{ label: field(k), from: value(k, c.from), to: value(k, c.to) }];
  };

  const changes = (e: AuditEntry): ReactNode => {
    if (!e.changes || !Object.keys(e.changes).length) return <span className="subtle">—</span>;
    const list = Object.entries(e.changes).flatMap(([k, c]) => pairs(k, c));
    return (
      <span className="stack tight" style={{ gap: 2 }}>
        {list.slice(0, 6).map((p, i) => (
          <span key={i} className="body-sm">
            <span className="muted">{p.label}: </span>
            <span className="diff">
              <bdi className="from">{p.from}</bdi>
              <span aria-hidden>→</span>
              <span className="sr-only">{t('audit.to')}</span>
              <bdi>{p.to}</bdi>
            </span>
          </span>
        ))}
        {list.length > 6 && <span className="muted body-sm">{t('audit.more', { n: list.length - 6 })}</span>}
      </span>
    );
  };

  /** Plain-text version for phone list cards. */
  const changesText = (e: AuditEntry): string =>
    e.changes
      ? Object.entries(e.changes)
          .flatMap(([k, c]) => pairs(k, c))
          .map((p) => `${p.label}: ${p.from} → ${p.to}`)
          .join(' · ')
      : '';

  return { action, category, record, changes, changesText, field };
}

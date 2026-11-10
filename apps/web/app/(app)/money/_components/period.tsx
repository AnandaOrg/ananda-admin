'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { isoDate } from '@ananda/shared';
import { useFmt } from '@/lib/format';
import { Button, CalendarBlank, SelectPill, Sheet, TextField } from '@/components/ui';

export type PeriodKind = 'this_year' | 'this_month' | 'last_month' | 'last_year' | 'last_12_months' | 'custom';

export interface PeriodValue {
  kind: PeriodKind;
  from?: string;
  to?: string;
}

export function periodQuery(p: PeriodValue) {
  return { period: p.kind, from: p.kind === 'custom' ? p.from : undefined, to: p.kind === 'custom' ? p.to : undefined };
}

/** Period choice for Money pages; "Custom range" opens two dates in a sheet. */
export function PeriodPill({ value, onChange, options }: { value: PeriodValue; onChange: (p: PeriodValue) => void; options: PeriodKind[] }) {
  const t = useTranslations('money');
  const tc = useTranslations('common');
  const { dateShort } = useFmt();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(value.from ?? `${new Date().getFullYear()}-01-01`);
  const [to, setTo] = useState(value.to ?? isoDate());
  const label = value.kind === 'custom' && value.from && value.to ? `${dateShort(value.from)} – ${dateShort(value.to)}` : t(`period.${value.kind}`);
  const bad = !from || !to || from > to;
  return (
    <>
      <SelectPill
        icon={CalendarBlank}
        label={t('period.label')}
        value={label}
        items={options.map((k) => ({
          key: k,
          label: t(`period.${k}`),
          selected: value.kind === k,
          onSelect: () => (k === 'custom' ? setOpen(true) : onChange({ kind: k })),
        }))}
      />
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={t('period.customTitle')}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>{tc('cancel')}</Button>
            <Button
              variant="primary"
              disabled={bad}
              onClick={() => {
                onChange({ kind: 'custom', from, to });
                setOpen(false);
              }}
            >
              {t('period.apply')}
            </Button>
          </>
        }
      >
        <div className="form-grid">
          <TextField label={t('period.from')} type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          <TextField label={t('period.to')} type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} error={from > to ? t('period.toAfterFrom') : undefined} />
        </div>
      </Sheet>
    </>
  );
}

/** "1 Jan 2026 – 31 Dec 2026" for the line above a page title. */
export function usePeriodLine() {
  const { date } = useFmt();
  return (p?: { from: string; to: string }) => (p ? `${date(p.from)} – ${date(p.to)}` : '');
}

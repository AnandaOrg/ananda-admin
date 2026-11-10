'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { UNITS_PER_CARTON, type Flavour } from '@ananda/shared';
import { api } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { Banner, Button, Card, EmptyState, ErrorState, FlavourName, Package, Pill, Sheet, Skeleton, Table, TextArea, type Column } from '@/components/ui';

interface CountLine {
  flavour: Flavour;
  counted: number;
  expected: number;
  difference: number;
}
interface StockCount {
  id: string;
  createdAt: string;
  countedBy: string | null;
  reconciledAt: string | null;
  reconciledBy: string | null;
  lines: CountLine[];
}

/** FR-INV-6: blind counts from the warehouse, reconciled with an adjustment for the difference. */
export function Counts({ editable }: { editable: boolean }) {
  const t = useTranslations('inventory');
  const tc = useTranslations('common');
  const { num, dateTime } = useFmt();
  const q = useQuery({ queryKey: ['inventory', 'counts'], queryFn: () => api.get<{ items: StockCount[] }>('/inventory/counts') });
  const [open, setOpen] = useState<StockCount | null>(null);
  const [note, setNote] = useState('');
  const fix = useAction(() => api.post<{ adjusted: Record<string, number> }>(`/inventory/counts/${open!.id}/reconcile`, { note: note.trim() || undefined }), {
    success: (r) => (Object.keys(r.adjusted).length ? t('counts.doneAdjusted', { n: Object.keys(r.adjusted).length }) : t('counts.doneMatched')),
    onDone: () => {
      setOpen(null);
      setNote('');
    },
  });

  const signed = (n: number) => (n > 0 ? `+${num(n)}` : num(n));
  const cols: Column<CountLine>[] = [
    { key: 'f', header: tc('flavour'), render: (l) => <FlavourName flavour={l.flavour} /> },
    { key: 'c', header: t('counts.counted'), type: 'count', render: (l) => num(l.counted) },
    { key: 'e', header: t('counts.expected'), type: 'count', render: (l) => num(l.expected) },
    { key: 'd', header: t('counts.difference'), type: 'count', render: (l) => (l.difference === 0 ? <span className="muted">0</span> : <span className={l.difference < 0 ? 'bad' : 'warn'}>{signed(l.difference)}</span>) },
  ];

  if (q.isLoading) return <Skeleton h={240} />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const items = q.data?.items ?? [];
  if (!items.length)
    return (
      <Card>
        <EmptyState icon={Package} title={t('counts.emptyTitle')} text={t('counts.emptyText')} />
      </Card>
    );

  const diffs = (c: StockCount) => c.lines.filter((l) => l.difference !== 0);

  return (
    <>
      <p className="body-sm muted">{t('counts.help')}</p>
      {items.map((c) => {
        const d = diffs(c);
        return (
          <Card
            key={c.id}
            title={t('counts.title', { date: dateTime(c.createdAt) })}
            action={
              c.reconciledAt ? (
                <Pill tone="good">{t('counts.reconciled')}</Pill>
              ) : editable ? (
                <Button size="sm" variant={d.length ? 'primary' : 'secondary'} onClick={() => setOpen(c)}>
                  {d.length ? t('counts.correct') : t('counts.accept')}
                </Button>
              ) : (
                <Pill tone="warn">{t('counts.open')}</Pill>
              )
            }
          >
            <p className="body-sm muted">
              {t('counts.countedBy', { name: c.countedBy ?? '—' })}
              {c.reconciledAt && ` · ${t('counts.reconciledBy', { name: c.reconciledBy ?? '—', date: dateTime(c.reconciledAt) })}`}
              {!c.reconciledAt && ` · ${d.length ? t('counts.differences', { n: d.length }) : t('counts.matches')}`}
            </p>
            <Table columns={cols} rows={c.lines} rowKey={(l) => l.flavour} />
          </Card>
        );
      })}
      {open && (
        <Sheet
          open
          onClose={() => setOpen(null)}
          title={diffs(open).length ? t('counts.correct') : t('counts.accept')}
          sub={dateTime(open.createdAt)}
          footer={
            <>
              <Button onClick={() => setOpen(null)}>{tc('cancel')}</Button>
              <Button variant="primary" busy={fix.isPending} onClick={() => fix.mutate(undefined)}>
                {diffs(open).length ? t('counts.correctCta') : t('counts.acceptCta')}
              </Button>
            </>
          }
        >
          {diffs(open).length ? (
            <div className="stack tight">
              {diffs(open).map((l) => (
                <div key={l.flavour} className="row between">
                  <FlavourName flavour={l.flavour} />
                  <span className={l.difference < 0 ? 'bad' : 'warn'}>{tc('cartonsUnits', { c: signed(l.difference), u: signed(l.difference * UNITS_PER_CARTON) })}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="body-sm">{t('counts.matchesText')}</p>
          )}
          <TextArea label={tc('noteOptional')} value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          <p className="body-sm muted">{diffs(open).length ? t('counts.correctConsequence') : t('counts.acceptConsequence')}</p>
          {fix.errorText && <Banner tone="bad">{fix.errorText}</Banner>}
        </Sheet>
      )}
    </>
  );
}

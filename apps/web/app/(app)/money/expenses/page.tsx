'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { EXPENSE_CATEGORIES, isoDate } from '@ananda/shared';
import { api, qs } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useFmt } from '@/lib/format';
import { useSession } from '@/lib/session';
import {
  Banner,
  Button,
  CalendarBlank,
  Card,
  Check,
  Chips,
  DownloadSimple,
  EmptyState,
  ErrorState,
  FileText,
  KeyValue,
  KpiTile,
  ListCard,
  MoneyField,
  PageHeader,
  PageSkeleton,
  Pill,
  PiggyBank,
  Plus,
  Search,
  Segmented,
  Select,
  SelectPill,
  Sheet,
  SlidersHorizontal,
  Switch,
  Table,
  TextField,
  Totals,
  UploadSimple,
  type Column,
} from '@/components/ui';
import css from '../money.module.css';
import { shrinkImage } from '@/lib/image';

interface Expense {
  id: string;
  spentOn: string;
  category: string;
  description: string;
  netCents: number;
  vatRate: number;
  totalCents: number;
  paid: boolean;
  receiptDocumentId: string | null;
  createdBy: string | null;
}

interface ExpensesResponse {
  items: Expense[];
  tiles: { yearCents: number; monthCents: number; unpaidCents: number; unpaidCount: number };
}

type Status = 'all' | 'unpaid' | 'paid';
type Period = 'any' | 'this_year' | 'this_month' | 'last_month' | 'last_year';
const VAT_RATES = ['0.2', '0.09', '0'] as const;

/** FR-MON-3: expenses excl. VAT; "this year" equals the expenses on Monthly P&L. */
export default function ExpensesPage() {
  const t = useTranslations('money');
  const tc = useTranslations('common');
  const params = useSearchParams();
  const router = useRouter();
  const { canEdit, readOnly } = useSession();
  const { money, date, month, dateShort } = useFmt();
  const [status, setStatus] = useState<Status>('all');
  const [category, setCategory] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>('any');
  const [term, setTerm] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [selected, setSelected] = useState<Expense | null>(null);
  const editable = canEdit('expenses') && !readOnly;
  useEffect(() => {
    if (params.get('new') === '1' && editable) setNewOpen(true);
  }, [params, editable]);

  const query = qs({ status: status === 'all' ? undefined : status, category, period: period === 'any' ? undefined : period, q: term });
  const q = useQuery({ queryKey: ['money', 'expenses', query], queryFn: () => api.get<ExpensesResponse>(`/money/expenses${query}`) });
  const markPaid = useAction((id: string) => api.post(`/money/expenses/${id}/paid`), { success: t('expenses.markedPaid'), onDone: () => setSelected(null) });

  const catLabel = (c: string) => (t.has(`categories.${c}`) ? t(`categories.${c}`) : c);
  const columns: Column<Expense>[] = [
    { key: 'month', header: t('cols.month'), render: (e) => <span className="nowrap">{month(e.spentOn)}<span className="sb">{date(e.spentOn)}</span></span> },
    {
      key: 'description',
      header: t('cols.description'),
      render: (e) => (
        <>
          <span className="nm">{e.description}</span>
          {e.receiptDocumentId && (
            <span className="sb">
              <a className="link" href={`/api/documents/${e.receiptDocumentId}/file`} target="_blank" rel="noreferrer" onClick={(ev) => ev.stopPropagation()}>
                {t('expenses.viewReceipt')}
              </a>
            </span>
          )}
        </>
      ),
    },
    { key: 'category', header: t('cols.category'), render: (e) => catLabel(e.category) },
    { key: 'amount', header: t('cols.amountExclVat'), type: 'amount', render: (e) => <bdi>{money(e.netCents)}</bdi> },
    {
      key: 'status',
      header: tc('status'),
      render: (e) =>
        e.paid ? (
          <Pill tone="good">{t('expenses.paid')}</Pill>
        ) : (
          <span className="row" style={{ flexWrap: 'nowrap' }}>
            <Pill tone="warn">{t('expenses.unpaid')}</Pill>
            {editable && (
              <Button
                size="sm"
                icon={Check}
                busy={markPaid.isPending && markPaid.variables === e.id}
                onClick={(ev) => {
                  ev.stopPropagation();
                  markPaid.mutate(e.id);
                }}
              >
                {t('expenses.markPaid')}
              </Button>
            )}
          </span>
        ),
    },
  ];

  if (q.isLoading) return <PageSkeleton />;
  const d = q.data;
  const rows = d?.items ?? [];
  const tiles = d?.tiles;

  return (
    <div className="page">
      <PageHeader
        crumbs={[{ label: tc('nav.expenses') }]}
        kicker={t('expenses.kicker', { n: rows.length })}
        title={tc('nav.expenses')}
        actions={
          <>
            <a className="an-btn secondary sm" href={`/api/money/expenses/export.csv${query}`}>
              <DownloadSimple className="an-ic sm" aria-hidden />
              {tc('exportCsv')}
            </a>
            {editable && (
              <Button size="sm" variant="primary" icon={Plus} onClick={() => setNewOpen(true)}>
                {t('expenses.new')}
              </Button>
            )}
          </>
        }
      />
      {tiles && (
        <div className="kpis" style={{ ['--n' as string]: 3 }}>
          <KpiTile label={t('expenses.thisYear')} value={money(tiles.yearCents, true)} sub={t('expenses.thisYearSub')} link={{ href: '/money/pnl', label: tc('nav.pnl') }} />
          <KpiTile label={t('expenses.thisMonth')} value={money(tiles.monthCents, true)} sub={t('expenses.exclVat')} />
          <KpiTile label={t('expenses.unpaidTile')} value={money(tiles.unpaidCents, true)} sub={t('expenses.unpaidSub', { n: tiles.unpaidCount })} onClick={tiles.unpaidCount ? () => setStatus('unpaid') : undefined} />
        </div>
      )}
      <Chips
        label={tc('filters')}
        value={status}
        onChange={setStatus}
        options={[
          { value: 'all', label: t('expenses.filters.all') },
          { value: 'unpaid', label: t('expenses.filters.unpaid'), count: tiles?.unpaidCount },
          { value: 'paid', label: t('expenses.filters.paid') },
        ]}
      />
      <div className="toolbar">
        <Search value={term} onChange={setTerm} placeholder={t('expenses.search')} />
        <SelectPill
          icon={SlidersHorizontal}
          label={t('cols.category')}
          value={category ? catLabel(category) : t('expenses.anyCategory')}
          items={[{ key: 'any', label: t('expenses.anyCategory'), selected: !category, onSelect: () => setCategory(null) }, ...EXPENSE_CATEGORIES.map((c) => ({ key: c, label: catLabel(c), selected: c === category, onSelect: () => setCategory(c) }))]}
        />
        <SelectPill
          icon={CalendarBlank}
          label={t('period.label')}
          value={period === 'any' ? t('period.any') : t(`period.${period}`)}
          items={(['any', 'this_month', 'last_month', 'this_year', 'last_year'] as Period[]).map((p) => ({ key: p, label: p === 'any' ? t('period.any') : t(`period.${p}`), selected: p === period, onSelect: () => setPeriod(p) }))}
        />
      </div>
      {q.error ? (
        <ErrorState error={q.error} retry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={PiggyBank}
            title={t('expenses.emptyTitle')}
            text={t('expenses.emptyText')}
            action={
              editable ? (
                <Button variant="primary" icon={Plus} onClick={() => setNewOpen(true)}>
                  {t('expenses.new')}
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <>
          <Card flush className="only-wide">
            <Table columns={columns} rows={rows} rowKey={(e) => e.id} onRow={setSelected} />
          </Card>
          <div className="list-cards only-phone">
            {rows.map((e) => (
              <ListCard
                key={e.id}
                title={e.description}
                amount={money(e.netCents)}
                sub={`${dateShort(e.spentOn)} · ${catLabel(e.category)}`}
                status={e.paid ? <Pill tone="good">{t('expenses.paid')}</Pill> : <Pill tone="warn">{t('expenses.unpaid')}</Pill>}
                onClick={() => setSelected(e)}
              />
            ))}
          </div>
        </>
      )}
      <Sheet
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.description ?? ''}
        sub={selected ? `${date(selected.spentOn)} · ${catLabel(selected.category)}` : undefined}
        footer={
          selected && (
            <>
              {selected.receiptDocumentId && (
                <a className="an-btn secondary" href={`/api/documents/${selected.receiptDocumentId}/file`} target="_blank" rel="noreferrer">
                  {t('expenses.viewReceipt')}
                </a>
              )}
              {editable && !selected.paid ? (
                <Button variant="primary" icon={Check} busy={markPaid.isPending} onClick={() => markPaid.mutate(selected.id)}>
                  {t('expenses.markPaid')}
                </Button>
              ) : (
                <Button onClick={() => setSelected(null)}>{tc('close')}</Button>
              )}
            </>
          )
        }
      >
        {selected && (
          <>
            {markPaid.errorText && <Banner tone="bad">{markPaid.errorText}</Banner>}
            <Totals
              lines={[
                [t('cols.amountExclVat'), money(selected.netCents)],
                [t('expenses.vatLine', { rate: Math.round(Number(selected.vatRate) * 100) }), money(selected.totalCents - selected.netCents)],
              ]}
              big={[t('expenses.totalInclVat'), money(selected.totalCents)]}
            />
            <KeyValue
              items={[
                [tc('status'), selected.paid ? <Pill tone="good">{t('expenses.paid')}</Pill> : <Pill tone="warn">{t('expenses.unpaid')}</Pill>],
                [t('expenses.receipt'), selected.receiptDocumentId ? t('expenses.receiptAttached') : t('expenses.noReceipt')],
                [t('expenses.addedBy'), selected.createdBy ?? '—'],
              ]}
            />
          </>
        )}
      </Sheet>
      <NewExpenseSheet
        open={newOpen}
        onClose={() => {
          setNewOpen(false);
          if (params.get('new')) router.replace('/money/expenses');
        }}
      />
    </div>
  );
}

function NewExpenseSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('money');
  const tc = useTranslations('common');
  const { money } = useFmt();
  const fileRef = useRef<HTMLInputElement>(null);
  const [spentOn, setSpentOn] = useState(isoDate());
  const [category, setCategory] = useState<string>('');
  const [description, setDescription] = useState('');
  const [net, setNet] = useState<number | null>(null);
  const [vat, setVat] = useState<(typeof VAT_RATES)[number]>('0.2');
  const [paid, setPaid] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [key, setKey] = useState(0);
  useEffect(() => {
    if (!open) return;
    setSpentOn(isoDate());
    setCategory('');
    setDescription('');
    setNet(null);
    setVat('0.2');
    setPaid(true);
    setFile(null);
    setKey((k) => k + 1);
  }, [open]);
  const save = useAction(
    (fd: FormData) => api.post<{ id: string }>('/money/expenses', fd),
    { success: t('expenses.added'), onDone: onClose },
  );
  const vatCents = Math.round((net ?? 0) * Number(vat));
  const submit = () => {
    const fd = new FormData();
    fd.set('spentOn', spentOn);
    fd.set('category', category);
    fd.set('description', description);
    fd.set('amountNetCents', String(net ?? ''));
    fd.set('vatRate', vat);
    fd.set('paid', String(paid));
    if (file) fd.set('file', file);
    save.mutate(fd);
  };
  const f = save.fields;
  const dirty = !!description || net != null || !!file;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      dirty={dirty}
      title={t('expenses.new')}
      footer={
        <>
          <Button onClick={onClose}>{tc('cancel')}</Button>
          <Button variant="primary" busy={save.isPending} disabled={!category || !description.trim() || net == null} onClick={submit}>
            {t('expenses.add')}
          </Button>
        </>
      }
    >
      {save.errorText && !Object.keys(f).length && <Banner tone="bad">{save.errorText}</Banner>}
      <div className="form-grid">
        <TextField label={tc('date')} type="date" value={spentOn} onChange={(e) => setSpentOn(e.target.value)} error={f.spentOn} />
        <Select
          label={t('cols.category')}
          value={category}
          placeholder={t('expenses.pickCategory')}
          onChange={(e) => setCategory(e.target.value)}
          options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: t(`categories.${c}`) }))}
          error={f.category}
        />
      </div>
      <TextField label={t('cols.description')} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('expenses.descriptionPlaceholder')} error={f.description} maxLength={500} />
      <MoneyField key={key} label={t('cols.amountExclVat')} cents={net} onCents={setNet} error={f.amountNetCents} />
      <div className="an-field">
        <label>{t('expenses.vatRate')}</label>
        <Segmented fill label={t('expenses.vatRate')} value={vat} onChange={setVat} options={VAT_RATES.map((r) => ({ value: r, label: `${Math.round(Number(r) * 100)}%` }))} />
      </div>
      <Totals
        lines={[
          [t('cols.amountExclVat'), money(net ?? 0)],
          [t('expenses.vatLine', { rate: Math.round(Number(vat) * 100) }), money(vatCents)],
        ]}
        big={[t('expenses.totalInclVat'), money((net ?? 0) + vatCents)]}
      />
      <Switch checked={paid} onChange={setPaid} label={t('expenses.alreadyPaid')} />
      <div className="an-field">
        <label>{t('expenses.receipt')}</label>
        <div className={css.fileRow}>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,application/pdf" onChange={async (e) => {
            const f = e.target.files?.[0] ?? null;
            setFile(f ? await shrinkImage(f) : null);
          }} aria-label={t('expenses.receipt')} />
          <Button size="sm" icon={file ? FileText : UploadSimple} onClick={() => fileRef.current?.click()}>
            {file ? t('expenses.changeReceipt') : t('expenses.uploadReceipt')}
          </Button>
          {file && <span className={css.fileName}>{file.name}</span>}
          {file && (
            <button type="button" className="link" onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ''; }}>
              {t('expenses.removeReceipt')}
            </button>
          )}
        </div>
        <span className={`an-help ${f.receipt ? 'error' : ''}`}>{f.receipt ?? t('expenses.receiptHelp')}</span>
      </div>
    </Sheet>
  );
}

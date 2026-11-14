'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { EXPENSE_FORM_CATEGORIES, isoDate } from '@ananda/shared';
import { api, qs } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useAsOf } from '@/lib/asof';
import { useFmt } from '@/lib/format';
import { useSession } from '@/lib/session';
import {
  ActionError,
  Button,
  CaretDown,
  Card,
  Check,
  Chips,
  DownloadSimple,
  EmptyState,
  FileText,
  Icon,
  KeyValue,
  KpiTile,
  ListCard,
  LoadError,
  MenuButton,
  MoneyField,
  PageHeader,
  PageState,
  Pill,
  Plus,
  Receipt,
  Select,
  Sheet,
  Table,
  TextField,
  Totals,
  Trunc,
  type Column,
} from '@/components/ui';
import { shrinkImage } from '@/lib/image';
import { MonthRangeCalendar, dayRangeLabel, monthName, monthPreset, monthRangeLabel, rangeQuery, useDayRange, type MonthPreset } from '../_components/range-calendar';
import css from '../money.module.css';

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
  hasAny: boolean;
  tiles: { yearCents: number; monthCents: number; unpaidCents: number; unpaidCount: number };
}

const VAT_RATES = ['0.2', '0.09', '0'] as const;
const VAT_LABEL = { '0.2': 'vat20', '0.09': 'vat9', '0': 'vat0' } as const;
const EMPTY_CHIPS = ['rent', 'transport', 'marketing', 'bank_fees', 'accountant'] as const;

/** FR-MON-3: expenses excl. VAT; "this year" is the same figure as on Monthly P&L. */
export default function ExpensesPage() {
  const t = useTranslations('money');
  const tc = useTranslations('common');
  const params = useSearchParams();
  const router = useRouter();
  const locale = useLocale();
  const { day } = useAsOf();
  const { canEdit, readOnly } = useSession();
  const { money } = useFmt();
  const [range, setRange] = useDayRange<MonthPreset>(monthPreset, 'this_year');
  const [newOpen, setNewOpen] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [selected, setSelected] = useState<Expense | null>(null);
  const editable = canEdit('expenses') && !readOnly;
  useEffect(() => {
    if (params.get('new') === '1' && editable) setNewOpen('marketing');
  }, [params, editable]);

  const query = qs(rangeQuery(range));
  const q = useQuery({ queryKey: ['money', 'expenses', query], queryFn: () => api.get<ExpensesResponse>(`/money/expenses${query}`), placeholderData: keepPreviousData });
  const markPaid = useAction((id: string) => api.post(`/money/expenses/${id}/paid`), { success: t('expenses.detail.markedPaid'), onDone: () => setSelected(null) });

  const catLabel = (c: string) => (t.has(`categories.${c}`) ? t(`categories.${c}`) : c);
  const label = monthRangeLabel(range.from, range.to, locale);
  const monthLong = new Intl.DateTimeFormat(locale === 'bg' ? 'bg-BG' : locale === 'he' ? 'he-IL' : 'en-GB', { month: 'long' }).format(new Date(`${day}T12:00:00`));
  const monthNow = monthLong.charAt(0).toUpperCase() + monthLong.slice(1);
  const csvHref = (r: { from: string; to: string }) => `/api/money/expenses/export.csv${qs(rangeQuery(r))}`;
  const printPdf = usePdfReport();

  const columns: Column<Expense>[] = [
    { key: 'month', header: t('cols.month'), render: (e) => <span className="nowrap">{monthName(e.spentOn, locale)}</span> },
    { key: 'description', header: t('cols.description'), render: (e) => <Trunc max={360}>{e.description}</Trunc> },
    { key: 'category', header: t('cols.category'), render: (e) => catLabel(e.category) },
    { key: 'amount', header: t('cols.amountExclVat'), type: 'amount', render: (e) => <bdi>{money(e.netCents)}</bdi> },
  ];

  const d = q.data;
  if (!d) return <PageState query={q} />;
  const rows = d.items;
  const tiles = d.tiles;
  const total = rows.reduce((a, e) => a + e.netCents, 0);
  const newBtn = editable ? (
    <Button size="sm" variant="primary" icon={Plus} onClick={() => setNewOpen('marketing')}>
      {t('expenses.new')}
    </Button>
  ) : null;
  const sheets = (
    <>
      <NewExpenseSheet category={newOpen} onClose={() => {
        setNewOpen(null);
        if (params.get('new')) router.replace('/money/expenses');
      }} />
      <ExportSheet open={exportOpen} onClose={() => setExportOpen(false)} csvHref={csvHref} onPdf={printPdf} />
      <DetailSheet expense={selected} onClose={() => setSelected(null)} editable={editable} markPaid={markPaid} catLabel={catLabel} />
    </>
  );

  // First use: nothing recorded yet.
  if (!d.hasAny) {
    return (
      <div className="page">
        <PageHeader crumbs={[{ label: tc('nav.expenses') }]} kicker={t('expenses.kickerEmpty')} title={tc('nav.expenses')} actions={newBtn} />
        <Card>
          <EmptyState
            icon={FileText}
            title={t('expenses.empty.title')}
            text={t('expenses.empty.text')}
            action={
              editable ? (
                <div className={css.emptyAction}>
                  <Button variant="primary" icon={Plus} onClick={() => setNewOpen('marketing')}>
                    {t('expenses.empty.first')}
                  </Button>
                  <div className={css.emptyChips}>
                    {EMPTY_CHIPS.map((c) => (
                      <button key={c} type="button" className="an-chip" onClick={() => setNewOpen(c)}>
                        {catLabel(c)}
                      </button>
                    ))}
                  </div>
                </div>
              ) : undefined
            }
          />
        </Card>
        {sheets}
      </div>
    );
  }

  const exportMenu = (
    <MenuButton
      trigger={({ open, toggle, ref }) => (
        <button ref={ref} type="button" className="an-btn secondary sm" aria-expanded={open} aria-haspopup="menu" onClick={toggle}>
          <Icon as={DownloadSimple} size="sm" />
          {t('expenses.export')}
          <Icon as={CaretDown} size="sm" />
        </button>
      )}
      items={[
        { key: 'csv', label: t('expenses.exportCsv'), detail: t('expenses.exportCsvSub'), onSelect: () => (window.location.href = csvHref(range)) },
        { key: 'pdf', label: t('expenses.exportPdf'), detail: t('expenses.exportPdfSub'), onSelect: () => printPdf(range) },
        { key: 'custom', label: t('expenses.exportCustom'), detail: t('expenses.exportCustomSub'), onSelect: () => setExportOpen(true) },
      ]}
    />
  );
  const monthSub = tiles.monthCents ? t('expenses.monthSoFar', { month: monthNow }) : t('expenses.monthNone', { month: locale === 'en' ? monthNow : monthLong });
  const extra = range.preset === 'custom' ? [{ value: range.preset, label: t('period.customChip', { range: label }) }] : [];

  return (
    <div className="page">
      <PageHeader
        crumbs={[{ label: tc('nav.expenses') }]}
        kicker={<span className="only-wide">{t('expenses.kicker', { range: label })}</span>}
        title={tc('nav.expenses')}
        actions={
          <span className="only-wide row">
            <MonthRangeCalendar value={range} onChange={setRange} />
            {exportMenu}
            {newBtn}
          </span>
        }
      />

      {/* Desktop and tablet */}
      <div className="only-wide stack">
        <div className="kpis" style={{ ['--n' as string]: 3 }}>
          <KpiTile label={t('expenses.thisYear')} value={money(tiles.yearCents, true)} sub={t('expenses.thisYearSub')} />
          <KpiTile label={t('expenses.thisMonth')} value={money(tiles.monthCents, true)} sub={monthSub} />
          <KpiTile label={t('expenses.unpaid')} value={money(tiles.unpaidCents, true)} sub={tiles.unpaidCount ? t('expenses.unpaidSub', { n: tiles.unpaidCount }) : undefined} />
        </div>
        <Card flush>
          {q.error ? (
            <LoadError error={q.error} onRetry={() => q.refetch()} />
          ) : (
            <Table columns={columns} rows={rows} rowKey={(e) => e.id} onRow={setSelected} empty={<span className="muted">{t('expenses.none', { range: label })}</span>} picker={{ id: 'expenses', locked: ['description', 'amount'], priority: ['month', 'category'] }} />
          )}
          <div className={css.foot}>{t('expenses.footer', { n: rows.length, amount: money(total), range: label })}</div>
        </Card>
      </div>

      {/* Phone */}
      <div className="only-phone stack">
        <div className={css.pair}>
          <KpiTile label={t('expenses.thisYearPhone')} value={money(tiles.yearCents, true)} sub={t('expenses.thisYearSubPhone')} />
          <KpiTile label={t('expenses.thisMonth')} value={money(tiles.monthCents, true)} sub={tiles.monthCents ? t('expenses.monthSoFar', { month: monthNow }) : t('expenses.monthNonePhone', { month: locale === 'en' ? monthNow : monthLong })} />
        </div>
        <Chips
          fill={false}
          label={t('period.label')}
          value={range.preset}
          onChange={(v) => v !== 'custom' && setRange(monthPreset(v as Exclude<MonthPreset, 'custom'>))}
          options={[...(['this_year', 'this_month', 'last_12_months', 'last_year'] as const).map((p) => ({ value: p as MonthPreset, label: t(`period.${p}`) })), ...extra]}
        />
        {q.error ? (
          <LoadError error={q.error} onRetry={() => q.refetch()} />
        ) : rows.length ? (
          <div className="list-cards">
            {rows.map((e) => (
              <ListCard key={e.id} title={e.description} amount={money(e.netCents)} sub={`${monthName(e.spentOn, locale)} · ${catLabel(e.category)}`} onClick={() => setSelected(e)} />
            ))}
          </div>
        ) : (
          <div className={`${css.box} ${css.center}`}>
            <span className="muted">{t('expenses.none', { range: label })}</span>
          </div>
        )}
        <span className={css.small}>{t('expenses.footerPhone', { n: rows.length, amount: money(total), range: label })}</span>
        <Button block icon={DownloadSimple} keep onClick={() => setExportOpen(true)}>
          {t('expenses.exportPhone')}
        </Button>
        {editable && (
          <Button block variant="primary" icon={Plus} onClick={() => setNewOpen('marketing')}>
            {t('expenses.new')}
          </Button>
        )}
      </div>
      {sheets}
    </div>
  );
}

/* ---------- PDF: a printable report (the browser saves it as PDF) ---------- */

function usePdfReport() {
  const t = useTranslations('money');
  const locale = useLocale();
  const { me } = useSession();
  const { money, date } = useFmt();
  return async (r: { from: string; to: string }) => {
    const w = window.open('', '_blank');
    if (!w) return;
    const data = await api.get<ExpensesResponse>(`/money/expenses${qs(rangeQuery(r))}`);
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    const cat = (c: string) => (t.has(`categories.${c}`) ? t(`categories.${c}`) : c);
    const rows = [...data.items].sort((a, b) => a.spentOn.localeCompare(b.spentOn));
    const total = rows.reduce((a, e) => a + e.netCents, 0);
    const range = dayRangeLabel(r.from, r.to, locale);
    const dir = locale === 'he' ? 'rtl' : 'ltr';
    w.document.write(`<!doctype html><html lang="${locale}" dir="${dir}"><head><meta charset="utf-8"><title>ANANDA · ${esc(t('expenses.report.title'))} · ${esc(range)}</title>
<style>body{font:13px/1.45 system-ui,-apple-system,"Segoe UI",Arial,sans-serif;color:#111;margin:32px}h1{font-size:20px;margin:0 0 2px;letter-spacing:.12em}h2{font-size:15px;font-weight:500;margin:0 0 4px}p{color:#555;margin:0 0 20px;font-size:12px}table{width:100%;border-collapse:collapse}th,td{padding:7px 8px;border-bottom:1px solid #ddd;text-align:start;vertical-align:top}th{font-weight:600;font-size:12px;color:#444}td.r,th.r{text-align:end;white-space:nowrap;font-variant-numeric:tabular-nums}tfoot td{font-weight:700;border-top:2px solid #111;border-bottom:0}@page{margin:16mm}</style></head><body>
<h1>ANANDA</h1><h2>${esc(t('expenses.report.title'))} · ${esc(range)}</h2><p>${esc(t('expenses.report.generated', { date: date(isoDate()), name: me.user.name }))}</p>
<table><thead><tr><th>${esc(t('cols.month'))}</th><th>${esc(t('cols.description'))}</th><th>${esc(t('cols.category'))}</th><th class="r">${esc(t('cols.amountExclVat'))}</th></tr></thead><tbody>
${rows.map((e) => `<tr><td>${esc(date(e.spentOn))}</td><td>${esc(e.description)}</td><td>${esc(cat(e.category))}</td><td class="r">${esc(money(e.netCents))}</td></tr>`).join('')}
</tbody><tfoot><tr><td></td><td></td><td>${esc(t('expenses.report.total'))}</td><td class="r">${esc(money(total))}</td></tr></tfoot></table>
<script>window.onload=function(){window.print()}</script></body></html>`);
    w.document.close();
  };
}

/* ---------- New expense ---------- */

function NewExpenseSheet({ category: initial, onClose }: { category: string | null; onClose: () => void }) {
  const t = useTranslations('money');
  const { money, month } = useFmt();
  const { day } = useAsOf();
  const open = initial != null;
  const fileRef = useRef<HTMLInputElement>(null);
  const [spentOn, setSpentOn] = useState(day);
  const [category, setCategory] = useState<string>('marketing');
  const [description, setDescription] = useState('');
  const [net, setNet] = useState<number | null>(null);
  const [vat, setVat] = useState<(typeof VAT_RATES)[number]>('0.2');
  const [file, setFile] = useState<File | null>(null);
  const [missing, setMissing] = useState(false);
  const [key, setKey] = useState(0);
  useEffect(() => {
    if (!open) return;
    setSpentOn(day);
    setCategory(initial ?? 'marketing');
    setDescription('');
    setNet(null);
    setVat('0.2');
    setFile(null);
    setMissing(false);
    setKey((k) => k + 1);
  }, [open, initial, day]);
  const save = useAction((fd: FormData) => api.post<{ id: string }>('/money/expenses', fd), { success: () => t('expenses.form.saved', { month: month(spentOn) }), onDone: onClose });
  const vatCents = Math.round((net ?? 0) * Number(vat));
  const submit = () => {
    if (!net) {
      setMissing(true);
      return;
    }
    const fd = new FormData();
    fd.set('spentOn', spentOn);
    fd.set('category', category);
    fd.set('description', description.trim() || t(`categories.${category}`));
    fd.set('amountNetCents', String(net));
    fd.set('vatRate', vat);
    fd.set('paid', 'true');
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
      sub={
        <>
          <span className="only-wide">{t('expenses.form.sub')}</span>
          <span className="only-phone">{t('expenses.form.subPhone')}</span>
        </>
      }
      footer={
        <>
          <ActionError action={Object.keys(f).length ? undefined : save} />
          <Button variant="primary" block busy={save.busy} onClick={submit}>
            {t('expenses.form.save')}
          </Button>
        </>
      }
    >
      <div className={css.pair}>
        <TextField label={t('expenses.form.date')} type="date" value={spentOn} max={day} onChange={(e) => setSpentOn(e.target.value)} error={f.spentOn} />
        <Select label={t('expenses.form.category')} value={category} onChange={(e) => setCategory(e.target.value)} options={EXPENSE_FORM_CATEGORIES.map((c) => ({ value: c, label: t(`categories.${c}`) }))} error={f.category} />
      </div>
      <TextField label={t('expenses.form.description')} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('expenses.form.descriptionPlaceholder')} error={f.description} maxLength={500} />
      <div className={css.pair}>
        <MoneyField
          key={key}
          label={t('expenses.form.amount')}
          cents={net}
          placeholder="0.00"
          onCents={(c) => {
            setNet(c);
            if (c) setMissing(false);
          }}
          error={missing ? t('expenses.form.amountError') : f.amountNetCents}
        />
        <Select label={t('expenses.form.vat')} value={vat} onChange={(e) => setVat(e.target.value as (typeof VAT_RATES)[number])} options={VAT_RATES.map((r) => ({ value: r, label: t(`expenses.form.${VAT_LABEL[r]}`) }))} />
      </div>
      <span className={css.small}>{net ? t.rich('expenses.form.totalLine', { net: money(net), vat: money(vatCents), total: money(net + vatCents), b: (c) => <b>{c}</b> }) : missing ? null : t('expenses.form.totalHint')}</span>
      <div className="an-field">
        <label>{t('expenses.form.receipt')}</label>
        <input
          ref={fileRef}
          type="file"
          hidden
          accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
          onChange={async (e) => {
            const x = e.target.files?.[0] ?? null;
            setFile(x ? await shrinkImage(x) : null);
          }}
          aria-label={t('expenses.form.receipt')}
        />
        {file ? (
          <div className="an-lrow">
            <span className="ico accent">
              <Icon as={Receipt} />
            </span>
            <span style={{ minWidth: 0 }}>
              <span className="t">{file.name}</span>
              <span className="sub">{t('expenses.form.attached')}</span>
            </span>
            <span className="acts">
              <Button
                size="sm"
                onClick={() => {
                  setFile(null);
                  if (fileRef.current) fileRef.current.value = '';
                }}
              >
                {t('expenses.form.remove')}
              </Button>
            </span>
          </div>
        ) : (
          <button
            type="button"
            className={`an-input ${css.upload}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={async (e) => {
              e.preventDefault();
              const x = e.dataTransfer.files?.[0];
              if (x) setFile(await shrinkImage(x));
            }}
          >
            <Icon as={DownloadSimple} size="sm" />
            {t('expenses.form.upload')}
          </button>
        )}
        {f.receipt && <span className="an-help error">{f.receipt}</span>}
      </div>
    </Sheet>
  );
}

/* ---------- Export any date range ---------- */

function ExportSheet({ open, onClose, csvHref, onPdf }: { open: boolean; onClose: () => void; csvHref: (r: { from: string; to: string }) => string; onPdf: (r: { from: string; to: string }) => void }) {
  const t = useTranslations('money');
  const locale = useLocale();
  const { money } = useFmt();
  const { day } = useAsOf();
  const now = new Date(`${day}T12:00:00`);
  const y = now.getFullYear();
  const m = now.getMonth();
  const pad = (n: number) => String(n).padStart(2, '0');
  const quick: Record<string, [string, string]> = {
    this_month: [`${y}-${pad(m + 1)}-01`, day],
    last_month: [isoDate(new Date(y, m - 1, 1)), isoDate(new Date(y, m, 0))],
    this_year: [`${y}-01-01`, day],
    last_year: [`${y - 1}-01-01`, `${y - 1}-12-31`],
  };
  const [from, setFrom] = useState(quick.this_year[0]);
  const [to, setTo] = useState(day);
  const [fmt, setFmt] = useState<'csv' | 'pdf'>('csv');
  const bad = !from || !to || from > to;
  const r = { from, to };
  const q = useQuery({ queryKey: ['money', 'expenses', 'export', from, to], queryFn: () => api.get<ExpensesResponse>(`/money/expenses${qs(rangeQuery(r))}`), enabled: open && !bad });
  const items = q.data?.items ?? [];
  const current = Object.entries(quick).find(([, v]) => v[0] === from && v[1] === to)?.[0] ?? '';
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('expenses.exportPanel.title')}
      sub={t('expenses.exportPanel.sub')}
      footer={
        <Button
          variant="primary"
          block
          keep
          icon={DownloadSimple}
          disabled={bad || !items.length}
          onClick={() => {
            if (fmt === 'csv') window.location.href = csvHref(r);
            else onPdf(r);
            onClose();
          }}
        >
          {t('expenses.exportPanel.download', { format: fmt.toUpperCase() })}
        </Button>
      }
    >
      <div className={css.calChips}>
        {Object.keys(quick).map((k) => (
          <button key={k} type="button" className="an-chip" aria-pressed={current === k} onClick={() => ([setFrom, setTo] as const).forEach((s, i) => s(quick[k][i]))}>
            {t(`period.${k}`)}
          </button>
        ))}
      </div>
      <div className={css.pair}>
        <TextField label={t('expenses.exportPanel.from')} type="date" value={from} max={day} onChange={(e) => setFrom(e.target.value)} />
        <TextField label={t('expenses.exportPanel.to')} type="date" value={to} max={day} onChange={(e) => setTo(e.target.value)} error={from > to ? t('expenses.exportPanel.toAfterFrom') : undefined} />
      </div>
      <span className={css.sectionLabel}>{t('expenses.exportPanel.format')}</span>
      <Chips
        label={t('expenses.exportPanel.format')}
        value={fmt}
        onChange={setFmt}
        options={[
          { value: 'csv', label: t('expenses.exportPanel.csv') },
          { value: 'pdf', label: t('expenses.exportPanel.pdf') },
        ]}
      />
      <div className={css.box}>
      <Totals
        lines={[
          [t('expenses.exportPanel.period'), bad ? '—' : dayRangeLabel(from, to, locale)],
          [t('expenses.exportPanel.lines'), String(items.length)],
        ]}
        big={[t('expenses.exportPanel.total'), money(items.reduce((a, e) => a + e.netCents, 0))]}
      />
      </div>
      <span className={css.small}>{t('expenses.exportPanel.note')}</span>
    </Sheet>
  );
}

/* ---------- One expense ---------- */

function DetailSheet({ expense, onClose, editable, markPaid, catLabel }: { expense: Expense | null; onClose: () => void; editable: boolean; markPaid: ReturnType<typeof useAction<string>>; catLabel: (c: string) => string }) {
  const t = useTranslations('money');
  const { money, date } = useFmt();
  const e = expense;
  return (
    <Sheet
      open={!!e}
      onClose={onClose}
      title={e?.description ?? ''}
      sub={e ? `${date(e.spentOn)} · ${catLabel(e.category)}` : undefined}
      footer={
        e && (
          <>
            <ActionError action={markPaid} />
            {e.receiptDocumentId && (
              <a className="an-btn secondary" href={`/api/documents/${e.receiptDocumentId}/file`} target="_blank" rel="noreferrer">
                {t('expenses.detail.viewReceipt')}
              </a>
            )}
            {editable && !e.paid ? (
              <Button variant="primary" icon={Check} busy={markPaid.busy} onClick={() => markPaid.mutate(e.id)}>
                {t('expenses.detail.markPaid')}
              </Button>
            ) : (
              <Button onClick={onClose}>{t('expenses.detail.close')}</Button>
            )}
          </>
        )
      }
    >
      {e && (
        <>
          <Totals
            lines={[
              [t('cols.amountExclVat'), money(e.netCents)],
              [t('expenses.detail.vatLine', { rate: Math.round(Number(e.vatRate) * 100) }), money(e.totalCents - e.netCents)],
            ]}
            big={[t('expenses.detail.totalInclVat'), money(e.totalCents)]}
          />
          <KeyValue
            items={[
              [t('expenses.detail.status'), e.paid ? <Pill tone="good">{t('expenses.detail.paid')}</Pill> : <Pill tone="warn">{t('expenses.detail.unpaid')}</Pill>],
              [t('expenses.detail.receipt'), e.receiptDocumentId ? t('expenses.detail.receiptAttached') : t('expenses.detail.noReceipt')],
              [t('expenses.detail.addedBy'), e.createdBy ?? '—'],
            ]}
          />
        </>
      )}
    </Sheet>
  );
}

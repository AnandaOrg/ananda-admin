'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { isoDate, type BankSettings, type BusinessRules, type CompanyProfile, type DocumentSettings, type EmailSettings, type SecuritySettings } from '@ananda/shared';
import { api, ApiError } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useFmt } from '@/lib/format';
import { useSession } from '@/lib/session';
import {
  Bank,
  Banner,
  Briefcase,
  Button,
  Card,
  Clock,
  EnvelopeOpen,
  ErrorState,
  FileText,
  HourglassMedium,
  IconButton,
  KeyValue,
  Lock,
  Money,
  Package,
  PageHeader,
  PageSkeleton,
  Plus,
  Segmented,
  Sheet,
  ShieldCheck,
  Truck,
  TextField,
  TwoStepField,
  Users,
  X,
  MoneyField,
} from '@/components/ui';
import { SettingsItem } from './settings-item';
import css from '../settings.module.css';

export const RULE_KEYS = ['ownership', 'minOrderCartons', 'stockHoldDays', 'proformaValidityDays', 'commissionPerUnitCents', 'supplierFollowUpDays'] as const;
export const SECTION_KEYS = ['company', 'bank', 'email', 'documents', 'security'] as const;
type RuleKey = (typeof RULE_KEYS)[number];
type SectionKey = (typeof SECTION_KEYS)[number];
type Open = { kind: 'rule'; key: RuleKey } | { kind: 'section'; key: SectionKey } | null;

interface SettingsData {
  rules: BusinessRules;
  company: CompanyProfile;
  bank: BankSettings;
  email: EmailSettings;
  documents: DocumentSettings;
  security: SecuritySettings;
  nextNumbers: Record<string, string>;
  lastChanged: Record<string, { at: string; by: string | null }>;
}

const RULE_ICONS = { ownership: Users, minOrderCartons: Package, stockHoldDays: HourglassMedium, proformaValidityDays: FileText, commissionPerUnitCents: Money, supplierFollowUpDays: Truck } as const;
const SECTION_ICONS = { company: Briefcase, bank: Bank, email: EnvelopeOpen, documents: FileText, security: ShieldCheck } as const;

export function openFromSection(section?: string): Open {
  if (!section) return null;
  if ((RULE_KEYS as readonly string[]).includes(section)) return { kind: 'rule', key: section as RuleKey };
  if ((SECTION_KEYS as readonly string[]).includes(section)) return { kind: 'section', key: section as SectionKey };
  return null;
}

/** FR-ADM-3: business rules in plain words, documents, e-mail, bank, company and security. */
export function SettingsView({ initial }: { initial?: string }) {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const router = useRouter();
  const { canEdit, readOnly, can } = useSession();
  const { money, dateShort } = useFmt();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api.get<SettingsData>('/settings') });
  const [open, setOpen] = useState<Open>(openFromSection(initial));
  useEffect(() => setOpen(openFromSection(initial)), [initial]);
  const editable = canEdit('settings') && !readOnly;
  const rulesEditable = editable && can('change_rules');
  const close = () => {
    setOpen(null);
    if (initial) router.replace('/settings');
  };

  if (q.isLoading) return <PageSkeleton />;
  if (q.error || !q.data) return <div className="page"><ErrorState error={q.error} retry={() => q.refetch()} /></div>;
  const d = q.data;
  const r = d.rules;
  const ruleValue = (k: RuleKey): string => {
    switch (k) {
      case 'ownership':
        return t('settings.rules.ownership.value', { months: r.ownership.months, days: r.ownership.warningDays });
      case 'commissionPerUnitCents':
        return t('settings.rules.commissionPerUnitCents.value', { amount: money(r.commissionPerUnitCents) });
      default:
        return t(`settings.rules.${k}.value`, { n: r[k] });
    }
  };
  const sectionValue = (k: SectionKey): string => {
    switch (k) {
      case 'company':
        return d.company.legalName || d.company.name || t('settings.notSet');
      case 'bank':
        return d.bank.iban ? `${d.bank.bank} · …${d.bank.iban.slice(-4)}` : t('settings.notSet');
      case 'email':
        return d.email.sender || t('settings.notSet');
      case 'documents':
        return d.documents.languages.map((l) => l.toUpperCase()).join(' · ');
      case 'security':
        return t('settings.sections.security.value', { h: d.security.desktopSessionHours, d: d.security.phoneSessionDays });
    }
  };
  const changed = (key: string) => {
    const c = d.lastChanged[key];
    return c ? t('settings.lastChanged', { date: dateShort(c.at), by: c.by ?? t('audit.system') }) : null;
  };

  return (
    <div className="page">
      <PageHeader crumbs={[{ label: tc('nav.settings') }]} kicker={t('settings.kicker')} title={tc('nav.settings')} />
      {!editable && !readOnly && <Banner>{t('settings.viewOnly')}</Banner>}
      <div className="cols even">
        <Card title={t('settings.rulesTitle')}>
          <p className="muted body-sm">{rulesEditable ? t('settings.rulesHelp') : t('settings.rulesHelpView')}</p>
          <div className={css.items}>
            {RULE_KEYS.map((k) => (
              <SettingsItem key={k} icon={RULE_ICONS[k]} label={t(`settings.rules.${k}.title`)} value={ruleValue(k)} onClick={() => setOpen({ kind: 'rule', key: k })} />
            ))}
            <div className="an-sitem" style={{ cursor: 'default' }}>
              <Lock className="an-ic" aria-hidden />
              <span className="grow">{t('settings.rules.paymentBeforeShipping.title')}</span>
              <span className="val">
                <bdi>{t('settings.rules.paymentBeforeShipping.value', { n: r.paymentBeforeShippingPercent })}</bdi>
              </span>
            </div>
          </div>
        </Card>
        <div className="stack loose">
          <Card title={t('settings.companyTitle')}>
            <div className={css.items}>
              {(['company', 'bank', 'email', 'documents'] as SectionKey[]).map((k) => (
                <SettingsItem key={k} icon={SECTION_ICONS[k]} label={t(`settings.sections.${k}.title`)} value={sectionValue(k)} onClick={() => setOpen({ kind: 'section', key: k })} />
              ))}
            </div>
          </Card>
          <Card title={t('settings.securityTitle')}>
            <div className={css.items}>
              <SettingsItem icon={SECTION_ICONS.security} label={t('settings.sections.security.title')} value={sectionValue('security')} onClick={() => setOpen({ kind: 'section', key: 'security' })} />
            </div>
          </Card>
        </div>
      </div>

      {open?.kind === 'rule' && <RuleSheet rule={open.key} rules={r} editable={rulesEditable} lastChanged={changed(`rule:${open.key}`)} onClose={close} />}
      {open?.kind === 'section' && <SectionSheet section={open.key} data={d} editable={editable} lastChanged={changed(`setting:${open.key}`)} onClose={close} onOpenRule={(k) => setOpen({ kind: 'rule', key: k })} />}
    </div>
  );
}

// ---------- Business rules ----------

function NumberField({ label, value, onChange, help, error, disabled, min = 0 }: { label: string; value: number; onChange: (n: number) => void; help?: ReactNode; error?: string; disabled?: boolean; min?: number }) {
  return <TextField label={label} type="number" inputMode="numeric" min={min} value={Number.isFinite(value) ? String(value) : ''} onChange={(e) => onChange(e.target.value === '' ? NaN : Math.floor(Number(e.target.value)))} help={help} error={error} disabled={disabled} />;
}

function RuleSheet({ rule, rules, editable, lastChanged, onClose }: { rule: RuleKey; rules: BusinessRules; editable: boolean; lastChanged: string | null; onClose: () => void }) {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const { money, date } = useFmt();
  const [value, setValue] = useState<BusinessRules[RuleKey]>(rules[rule]);
  const [code, setCode] = useState('');
  const [moneyKey, setMoneyKey] = useState(0);
  useEffect(() => {
    setValue(rules[rule]);
    setCode('');
    setMoneyKey((k) => k + 1);
  }, [rule, rules]);
  const save = useAction((v: { value: unknown; code: string }) => api.patch(`/settings/rules/${rule}`, { value: v.value }, { code: v.code }), { success: t('settings.ruleSaved'), onDone: onClose });
  const before = rules[rule];
  const dirty = JSON.stringify(before) !== JSON.stringify(value);
  const err = save.error instanceof ApiError ? save.error : null;
  const codeError = err?.code?.startsWith('step_up') ? err.message : undefined;
  const f = save.fields;
  const fieldError = (k?: string) => f[k ? `value.${k}` : 'value'];

  const plain = (v: BusinessRules[RuleKey]): string => {
    if (rule === 'ownership') {
      const o = v as BusinessRules['ownership'];
      return t('settings.rules.ownership.preview', {
        months: o.months,
        from: t(`settings.rules.ownership.from.${o.countedFrom}`),
        days: o.warningDays,
        end: t(`settings.rules.ownership.end.${o.atEnd}`),
      });
    }
    if (rule === 'commissionPerUnitCents') return t('settings.rules.commissionPerUnitCents.preview', { amount: money(v as number), carton: money((v as number) * 24) });
    return t(`settings.rules.${rule}.preview`, { n: v as number });
  };
  const short = (v: BusinessRules[RuleKey]): string => {
    if (rule === 'ownership') {
      const o = v as BusinessRules['ownership'];
      return t('settings.rules.ownership.value', { months: o.months, days: o.warningDays });
    }
    if (rule === 'commissionPerUnitCents') return money(v as number);
    return t(`settings.rules.${rule}.value`, { n: v as number });
  };
  const valid = rule === 'ownership' ? Number.isFinite((value as BusinessRules['ownership']).months) && Number.isFinite((value as BusinessRules['ownership']).warningDays) : Number.isFinite(value as number);

  return (
    <Sheet
      open
      onClose={onClose}
      dirty={dirty}
      title={t(`settings.rules.${rule}.title`)}
      sub={t(`settings.rules.${rule}.sub`)}
      footer={
        editable ? (
          <>
            <Button onClick={onClose}>{tc('cancel')}</Button>
            <Button variant="primary" busy={save.isPending} disabled={!dirty || !valid || code.length !== 6} onClick={() => save.mutate({ value, code })}>
              {t('settings.saveRule')}
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>{tc('close')}</Button>
        )
      }
    >
      {save.errorText && !codeError && !Object.keys(f).length && <Banner tone="bad">{save.errorText}</Banner>}
      {rule === 'ownership' ? (
        <OwnershipEditor value={value as BusinessRules['ownership']} onChange={setValue} editable={editable} errors={{ months: fieldError('months'), warningDays: fieldError('warningDays') }} />
      ) : rule === 'commissionPerUnitCents' ? (
        <MoneyField key={moneyKey} label={t('settings.rules.commissionPerUnitCents.field')} cents={value as number} onCents={(c) => setValue(c ?? NaN)} disabled={!editable} help={t('settings.rules.commissionPerUnitCents.help')} error={fieldError()} />
      ) : (
        <NumberField label={t(`settings.rules.${rule}.field`)} value={value as number} onChange={setValue} disabled={!editable} min={1} help={t(`settings.rules.${rule}.help`)} error={fieldError()} />
      )}
      <div className={css.preview} aria-live="polite">
        <span className="overline">{t('settings.inPlainWords')}</span>
        <span>{valid ? plain(value) : t('settings.fillIn')}</span>
      </div>
      {editable && dirty && valid && (
        <KeyValue
          items={[
            [t('settings.now'), short(before)],
            [t('settings.new'), <span key="n" className="strong">{short(value)}</span>],
            [t('settings.appliesFrom'), date(isoDate())],
          ]}
        />
      )}
      <p className="muted body-sm">{t('settings.appliesNote')}</p>
      {lastChanged && <p className="muted body-sm">{lastChanged}</p>}
      {editable && <TwoStepField value={code} onChange={setCode} error={codeError} />}
    </Sheet>
  );
}

/** Customer ownership editor: duration, counted from, warning period, what happens at the end (PRD FR-ADM-3 pattern). */
function OwnershipEditor({ value, onChange, editable, errors }: { value: BusinessRules['ownership']; onChange: (v: BusinessRules['ownership']) => void; editable: boolean; errors: { months?: string; warningDays?: string } }) {
  const t = useTranslations('admin');
  return (
    <>
      <NumberField label={t('settings.rules.ownership.months')} value={value.months} min={1} onChange={(n) => onChange({ ...value, months: n })} disabled={!editable} error={errors.months} help={t('settings.rules.ownership.monthsHelp')} />
      <div className="an-field">
        <label>{t('settings.rules.ownership.countedFrom')}</label>
        <Segmented fill disabled={!editable} label={t('settings.rules.ownership.countedFrom')} value={value.countedFrom} onChange={(v) => onChange({ ...value, countedFrom: v })} options={(['each_order', 'first_order'] as const).map((o) => ({ value: o, label: t(`settings.rules.ownership.fromOption.${o}`) }))} />
      </div>
      <NumberField label={t('settings.rules.ownership.warningDays')} value={value.warningDays} onChange={(n) => onChange({ ...value, warningDays: n })} disabled={!editable} error={errors.warningDays} help={t('settings.rules.ownership.warningHelp')} />
      <div className="an-field">
        <label>{t('settings.rules.ownership.atEnd')}</label>
        <Segmented fill disabled={!editable} label={t('settings.rules.ownership.atEnd')} value={value.atEnd} onChange={(v) => onChange({ ...value, atEnd: v })} options={(['free_to_claim', 'stay_with_agent'] as const).map((o) => ({ value: o, label: t(`settings.rules.ownership.endOption.${o}`) }))} />
      </div>
    </>
  );
}

// ---------- Company, bank, e-mail, documents, security ----------

function SectionSheet({ section, data, editable, lastChanged, onClose, onOpenRule }: { section: SectionKey; data: SettingsData; editable: boolean; lastChanged: string | null; onClose: () => void; onOpenRule: (k: RuleKey) => void }) {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const initial = section === 'documents' ? { languages: data.documents.languages, logoUrl: data.documents.logoUrl ?? '' } : (data[section] as unknown as Record<string, unknown>);
  const [v, setV] = useState<Record<string, unknown>>(initial);
  useEffect(() => setV(initial), [section, data]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useAction((value: Record<string, unknown>) => api.patch(`/settings/${section}`, { value }), { success: t('settings.saved'), onDone: onClose });
  const f = save.fields;
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  const set = (k: string) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  const text = (k: string, extra: Partial<Parameters<typeof TextField>[0]> = {}) => (
    <TextField key={k} label={t(`settings.fields.${k}`)} value={String(v[k] ?? '')} onChange={set(k)} disabled={!editable} error={f[`value.${k}`]} {...extra} />
  );
  const num = (k: string, help?: string) => <NumberField key={k} label={t(`settings.fields.${k}`)} value={Number(v[k])} onChange={(n) => setV((x) => ({ ...x, [k]: n }))} disabled={!editable} help={help} error={f[`value.${k}`]} min={1} />;

  let body: ReactNode = null;
  if (section === 'company') {
    body = (
      <>
        {text('name')}
        {text('legalName')}
        <div className="form-grid">
          {text('vatNumber')}
          {text('country', { maxLength: 2 })}
        </div>
        {text('address')}
        {text('city')}
        <div className="form-grid">
          {text('email', { type: 'email' })}
          {text('phone', { type: 'tel' })}
        </div>
      </>
    );
  } else if (section === 'bank') {
    const accounts = (v.accounts as string[]) ?? [];
    body = (
      <>
        {text('bank')}
        {text('iban', { help: t('settings.fields.ibanHelp') })}
        {text('bic')}
        <div className="an-field">
          <label>{t('settings.fields.accounts')}</label>
          <span className="an-help" style={{ marginTop: 0 }}>
            {t('settings.fields.accountsHelp')}
          </span>
        </div>
        {accounts.map((a, i) => (
          <div key={i} className={css.listRow}>
            <TextField label={t('settings.fields.accountN', { n: i + 1 })} value={a} disabled={!editable} onChange={(e) => setV((x) => ({ ...x, accounts: accounts.map((y, j) => (j === i ? e.target.value : y)) }))} error={f[`value.accounts.${i}`]} />
            {editable && <IconButton icon={X} label={t('settings.fields.removeAccount')} onClick={() => setV((x) => ({ ...x, accounts: accounts.filter((_, j) => j !== i) }))} />}
          </div>
        ))}
        {editable && (
          <Button size="sm" icon={Plus} onClick={() => setV((x) => ({ ...x, accounts: [...accounts, ''] }))}>
            {t('settings.fields.addAccount')}
          </Button>
        )}
      </>
    );
  } else if (section === 'email') {
    body = (
      <>
        {text('warehouse', { type: 'email', help: t('settings.fields.warehouseHelp') })}
        {text('accounting', { type: 'email', help: t('settings.fields.accountingHelp') })}
        {text('sender', { help: t('settings.fields.senderHelp') })}
        {text('replyTo', { type: 'email', help: t('settings.fields.replyToHelp') })}
        <div className="an-field">
          <label>{t('settings.fields.copyAgent')}</label>
          <Segmented fill disabled={!editable} label={t('settings.fields.copyAgent')} value={v.copyAgent ? 'yes' : 'no'} onChange={(x) => setV((y) => ({ ...y, copyAgent: x === 'yes' }))} options={[{ value: 'yes', label: tc('yes') }, { value: 'no', label: tc('no') }]} />
        </div>
      </>
    );
  } else if (section === 'documents') {
    const langs = (v.languages as string[]) ?? [];
    const langValue = langs.length === 2 ? 'both' : langs[0] ?? 'both';
    body = (
      <>
        <div className="an-field">
          <label>{t('settings.fields.languages')}</label>
          <Segmented fill disabled={!editable} label={t('settings.fields.languages')} value={langValue} onChange={(x) => setV((y) => ({ ...y, languages: x === 'both' ? ['en', 'bg'] : [x] }))} options={[{ value: 'both', label: t('settings.fields.bothLanguages') }, { value: 'en', label: t('languages.en') }, { value: 'bg', label: t('languages.bg') }]} />
          <span className="an-help">{t('settings.fields.languagesHelp')}</span>
        </div>
        <KeyValue
          items={[
            [t('settings.fields.validity'), <button key="v" type="button" className="link" onClick={() => onOpenRule('proformaValidityDays')}>{t('settings.rules.proformaValidityDays.value', { n: data.rules.proformaValidityDays })}</button>],
            ...(['order', 'proforma', 'invoice', 'credit_note', 'purchase'] as const).map((k) => [t(`settings.fields.next.${k}`), <bdi key={k}>{data.nextNumbers[k]}</bdi>] as [string, ReactNode]),
          ]}
        />
        <p className="muted body-sm">{t('settings.fields.numbersHelp')}</p>
        {text('logoUrl', { type: 'url', placeholder: 'https://', help: t('settings.fields.logoHelp') })}
      </>
    );
  } else if (section === 'security') {
    body = (
      <>
        <div className="form-grid">
          {num('desktopSessionHours')}
          {num('phoneSessionDays')}
        </div>
        {num('inviteValidityDays', t('settings.fields.inviteHelp'))}
        {num('passwordMinLength', t('settings.fields.passwordHelp'))}
        <KeyValue items={[[t('settings.fields.twoStep'), t('settings.fields.twoStepValue')]]} />
      </>
    );
  }

  return (
    <Sheet
      open
      onClose={onClose}
      dirty={dirty}
      title={t(`settings.sections.${section}.title`)}
      sub={t(`settings.sections.${section}.sub`)}
      footer={
        editable ? (
          <>
            <Button onClick={onClose}>{tc('cancel')}</Button>
            <Button variant="primary" busy={save.isPending} disabled={!dirty} onClick={() => save.mutate(section === 'bank' ? { ...v, accounts: ((v.accounts as string[]) ?? []).map((a) => a.trim()).filter(Boolean) } : v)}>
              {tc('save')}
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>{tc('close')}</Button>
        )
      }
    >
      {save.errorText && <Banner tone="bad">{save.errorText}</Banner>}
      {body}
      {lastChanged && (
        <p className="muted body-sm">
          <Clock className="an-ic sm" aria-hidden /> {lastChanged}
        </p>
      )}
    </Sheet>
  );
}

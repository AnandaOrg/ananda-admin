'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { PRICE_TIERS, type BankSettings, type BusinessRules, type CompanyProfile, type EmailSettings } from '@ananda/shared';
import { api, ApiError } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useFmt } from '@/lib/format';
import { useSession } from '@/lib/session';
import { ActionError, Banner, Button, Chips, FileUpload, Card, Clock, Icon, IconButton, MoneyField, PageHeader, PageState, Plus, Select, Sheet, TextField, TwoStepField, UploadSimple, X } from '@/components/ui';
import { ProfileDevices } from '../../profile/_components/profile-devices';
import { SettingsTabs, type SettingsTab } from './settings-tabs';
import css from '../settings.module.css';

/** The seven business rules, in the order the app explains them. */
export const RULES = ['ownership', 'payment', 'stockHold', 'priceList', 'commission', 'approvals', 'corrections'] as const;
type Rule = (typeof RULES)[number];
/** Rules that are part of how orders work; they're shown, not edited. */
const FIXED: Rule[] = ['payment', 'approvals', 'corrections'];
export const CARDS = ['docs', 'mail', 'bank'] as const;
type CardKey = (typeof CARDS)[number];
type Open = { kind: 'rule'; key: Rule } | { kind: 'card'; key: CardKey } | null;

type ProformaLanguage = 'per_customer' | 'en' | 'bg';
type TwoStepPolicy = 'admins_finance' | 'everyone' | 'optional' | 'custom';
type SignOut = 'short' | 'standard' | 'never' | 'custom';

interface SettingsData {
  rules: BusinessRules;
  company: CompanyProfile;
  bank: BankSettings;
  email: EmailSettings;
  documents: {
    proformaLanguage: ProformaLanguage;
    proformaValidityDays: number;
    logo: { name: string; mime: string } | null;
    footer: string;
    prefixes: { order: string; invoice: string; credit_note: string };
    nextInvoice: number;
  };
  security: { desktopSessionHours: number; phoneSessionDays: number; twoStep: TwoStepPolicy; signOut: SignOut };
  nextNumbers: Record<string, string>;
  lastChanged: Record<string, { at: string; by: string | null }>;
  ownershipExample: { customerName: string; ownedUntil: string; lastOrderAt: string | null } | null;
}

/** Deep links (/settings/company, /settings/bank, /settings/ownership …) open the matching panel. */
export function openFromSection(section?: string): Open {
  switch (section) {
    case 'company':
    case 'documents':
    case 'docs':
    case 'proformaValidityDays':
      return { kind: 'card', key: 'docs' };
    case 'email':
    case 'mail':
      return { kind: 'card', key: 'mail' };
    case 'bank':
    case 'security':
      return { kind: 'card', key: 'bank' };
    case 'minOrderCartons':
      return { kind: 'rule', key: 'priceList' };
    case 'stockHoldDays':
      return { kind: 'rule', key: 'stockHold' };
    case 'commissionPerUnitCents':
      return { kind: 'rule', key: 'commission' };
    default:
      return (RULES as readonly string[]).includes(section ?? '') ? { kind: 'rule', key: section as Rule } : null;
  }
}

/** Plain-words text and short value of each rule, from the live settings. */
function useRuleWords() {
  const t = useTranslations('admin');
  const { money, num } = useFmt();
  return (rule: Rule, r: BusinessRules) => {
    switch (rule) {
      case 'ownership':
        return {
          text: t('settings.rule.ownership.text', { months: r.ownership.months, days: r.ownership.warningDays, from: r.ownership.countedFrom, end: r.ownership.atEnd }),
          value: t('settings.rule.ownership.value', { months: r.ownership.months, days: r.ownership.warningDays, from: r.ownership.countedFrom }),
        };
      case 'payment':
        return { text: t('settings.rule.payment.text', { n: r.paymentBeforeShippingPercent }), value: t('settings.rule.payment.value', { n: r.paymentBeforeShippingPercent }) };
      case 'stockHold':
        return { text: t('settings.rule.stockHold.text', { n: r.stockHoldDays }), value: t('settings.rule.stockHold.value', { n: r.stockHoldDays }) };
      case 'priceList': {
        const tiers = PRICE_TIERS.map((x) => `${num(x.minCartons)}–${num(x.maxCartons)} ${money(x.unitPriceCents)}`).join(' · ');
        const advance = PRICE_TIERS.find((x) => x.requiresAdvanceOrCommitment)?.minCartons ?? 0;
        return {
          text: t('settings.rule.priceList.text', { tiers, min: num(r.minOrderCartons), advance: num(advance) }),
          value: t('settings.rule.priceList.value', { high: money(PRICE_TIERS[0].unitPriceCents), low: money(PRICE_TIERS[PRICE_TIERS.length - 1].unitPriceCents), min: num(r.minOrderCartons) }),
        };
      }
      case 'commission':
        return { text: t('settings.rule.commission.text', { amount: money(r.commissionPerUnitCents) }), value: t('settings.rule.commission.value', { amount: money(r.commissionPerUnitCents) }) };
      default:
        return { text: t(`settings.rule.${rule}.text`), value: t(`settings.rule.${rule}.value`) };
    }
  };
}

/** FR-ADM-3 and FR-ADM-4: Business & company (rules, documents, e-mail, bank and sign-in) and Profile & devices. */
export function SettingsView({ initial }: { initial?: string }) {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const router = useRouter();
  const params = useSearchParams();
  const { me, canEdit, readOnly } = useSession();
  const words = useRuleWords();
  const tab: SettingsTab = params.get('tab') === 'me' ? 'me' : 'rules';
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api.get<SettingsData>('/settings'), enabled: tab === 'rules' });
  const [open, setOpen] = useState<Open>(openFromSection(initial));
  useEffect(() => setOpen(openFromSection(initial)), [initial]);
  const editable = canEdit('settings') && !readOnly;
  const close = () => {
    setOpen(null);
    if (initial) router.replace('/settings');
  };
  const setTab = (v: SettingsTab) => router.replace(v === 'me' ? '/settings?tab=me' : '/settings');

  if (tab === 'me') {
    return (
      <div className="page">
        <PageHeader crumbs={[{ label: tc('nav.settings'), href: '/settings' }, { label: t('profile.title') }]} kicker={t('profile.kicker', { name: me.user.name, role: me.user.roleName })} title={tc('nav.settings')} />
        <SettingsTabs value="me" onChange={setTab} />
        <ProfileDevices />
      </div>
    );
  }

  if (!q.data) return <PageState query={q} />;
  const d = q.data;

  return (
    <div className="page">
      <PageHeader crumbs={[{ label: t('settings.title') }]} kicker={t('settings.kicker', { name: d.company.name || d.company.legalName })} title={t('settings.title')} />
      <SettingsTabs value="rules" onChange={setTab} />
      {!editable && !readOnly && <Banner>{t('settings.viewOnly')}</Banner>}
      <div className={`cols even ${css.grid}`}>
        <Card className={css.rulesCard} title={t('settings.rulesTitle')}>
          <p className={css.cardSub}>{t('settings.rulesSub')}</p>
          <div className={css.rules}>
            {RULES.map((k) => {
              const w = words(k, d.rules);
              const can = editable && !FIXED.includes(k);
              return (
                <div key={k} className={css.rule}>
                  <span className={css.ruleHead}>
                    <span className={css.ruleTitle}>{t(`settings.rule.${k}.title`)}</span>
                    {can && (
                      <button type="button" className={css.edit} onClick={() => setOpen({ kind: 'rule', key: k })}>
                        {t('settings.edit')}
                      </button>
                    )}
                  </span>
                  <span className={css.ruleText}>{w.text}</span>
                </div>
              );
            })}
          </div>
        </Card>
        <div className={css.cards}>
          {CARDS.map((k) => (
            <Card
              key={k}
              className={css.cfgCard}
              title={t(`settings.cards.${k}.title`)}
              action={
                editable ? (
                  <button type="button" className={css.edit} onClick={() => setOpen({ kind: 'card', key: k })}>
                    {t('settings.edit')}
                  </button>
                ) : undefined
              }
            >
              <dl className={css.kv}>
                {cardRows(k, d, t).map(([a, b]) => (
                  <div key={a} className={css.kvRow}>
                    <dt>{a}</dt>
                    <dd>
                      <bdi>{b}</bdi>
                    </dd>
                  </div>
                ))}
              </dl>
            </Card>
          ))}
        </div>
      </div>

      {open?.kind === 'rule' && <RuleSheet rule={open.key} data={d} editable={editable && !FIXED.includes(open.key)} onClose={close} />}
      {open?.kind === 'card' && <CardSheet card={open.key} data={d} editable={editable} onClose={close} />}
    </div>
  );
}

type T = ReturnType<typeof useTranslations<'admin'>>;

function cardRows(k: CardKey, d: SettingsData, t: T): [string, string][] {
  const or = (v: string) => v || t('settings.notSet');
  if (k === 'docs')
    return [
      [t('settings.cards.docs.proformaLanguage'), t(`settings.lang.${d.documents.proformaLanguage}`)],
      [t('settings.cards.docs.validFor'), t('settings.days', { n: d.documents.proformaValidityDays })],
      [t('settings.cards.docs.numbering'), `${d.documents.prefixes.order}…, ${d.documents.prefixes.invoice}…, ${d.documents.prefixes.credit_note}…`],
      [t('settings.cards.docs.nextInvoice'), d.nextNumbers.invoice],
      [t('settings.cards.docs.logo'), d.documents.logo ? t('settings.cards.docs.logoSet') : t('settings.cards.docs.logoNone')],
    ];
  if (k === 'mail')
    return [
      [t('settings.cards.mail.warehouse'), or(d.email.warehouse)],
      [t('settings.cards.mail.accounting'), or(d.email.accounting)],
      [t('settings.cards.mail.sender'), or(d.email.sender)],
      [t('settings.cards.mail.replyTo'), or(d.email.replyTo)],
      [t('settings.cards.mail.brokerCopied'), d.email.copyBroker ? t('settings.yes') : t('settings.no')],
    ];
  return [
    [t('settings.cards.bank.bank'), or(d.bank.bank)],
    [t('settings.cards.bank.iban'), or(d.bank.iban)],
    [t('settings.cards.bank.bic'), or(d.bank.bic)],
    [t('settings.cards.bank.twoStep'), t(`settings.twoStep.${d.security.twoStep}`)],
    [t('settings.cards.bank.signOut'), signOutLabel(d.security, t)],
  ];
}

function signOutLabel(s: SettingsData['security'], t: T) {
  return s.signOut === 'custom' ? t('settings.signOut.custom', { h: s.desktopSessionHours, d: s.phoneSessionDays }) : t(`settings.signOut.${s.signOut}`);
}

// ---------- Business rules ----------

function NumberField({ label, value, onChange, error, disabled, min = 1, help }: { label: string; value: number; onChange: (n: number) => void; error?: string; disabled?: boolean; min?: number; help?: ReactNode }) {
  return <TextField label={label} type="number" inputMode="numeric" min={min} value={Number.isFinite(value) ? String(value) : ''} onChange={(e) => onChange(e.target.value === '' ? NaN : Math.floor(Number(e.target.value)))} error={error} disabled={disabled} help={help} />;
}

const WARN_DAYS = [14, 30, 45, 60];

function RuleSheet({ rule, data, editable, onClose }: { rule: Rule; data: SettingsData; editable: boolean; onClose: () => void }) {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const { dateShort, date, money, num } = useFmt();
  const words = useRuleWords();
  const r = data.rules;
  const [draft, setDraft] = useState<BusinessRules>(r);
  const [code, setCode] = useState('');
  useEffect(() => {
    setDraft(r);
    setCode('');
  }, [rule]); // eslint-disable-line react-hooks/exhaustive-deps
  const key = { ownership: 'ownership', stockHold: 'stockHoldDays', priceList: 'minOrderCartons', commission: 'commissionPerUnitCents' }[rule as 'ownership'] as keyof BusinessRules | undefined;
  const save = useAction((v: { value: unknown; code: string }) => api.patch(`/settings/rules/${key}`, { value: v.value }, { code: v.code }), { success: t('settings.rulePanel.saved'), onDone: onClose });
  const dirty = !!key && JSON.stringify(r[key]) !== JSON.stringify(draft[key]);
  const err = save.error instanceof ApiError ? save.error : null;
  const codeError = err?.code?.startsWith('step_up') ? err.message : undefined;
  const fe = (k?: string) => save.fields[k ? `value.${k}` : 'value'];
  const valid = rule === 'ownership' ? Number.isFinite(draft.ownership.months) : key ? Number.isFinite(draft[key] as number) : true;
  const w = words(rule, valid ? draft : r);
  const ex = data.ownershipExample;
  const set = <K extends keyof BusinessRules>(k: K, v: BusinessRules[K]) => setDraft((x) => ({ ...x, [k]: v }));

  return (
    <Sheet
      open
      onClose={onClose}
      dirty={dirty}
      title={t(`settings.rule.${rule}.title`)}
      sub={w.text}
      footer={
        editable ? (
          <Button variant="primary" block busy={save.isPending} disabled={!dirty || !valid || code.length !== 6} onClick={() => key && save.mutate({ value: draft[key], code })}>
            {t('settings.rulePanel.save')}
          </Button>
        ) : (
          <Button block onClick={onClose}>
            {tc('close')}
          </Button>
        )
      }
    >
      {rule === 'ownership' ? (
        <NumberField label={t('settings.rulePanel.months')} value={draft.ownership.months} onChange={(n) => set('ownership', { ...draft.ownership, months: n })} disabled={!editable} error={fe('months')} />
      ) : rule === 'stockHold' ? (
        <NumberField label={t('settings.rulePanel.holdDays')} value={draft.stockHoldDays} onChange={(n) => set('stockHoldDays', n)} disabled={!editable} error={fe()} />
      ) : rule === 'priceList' ? (
        <>
          <dl className={css.kv}>
            {PRICE_TIERS.map((x) => (
              <div key={x.minCartons} className={css.kvRow}>
                <dt>{t('settings.rulePanel.tier', { from: num(x.minCartons), to: num(x.maxCartons) })}</dt>
                <dd>
                  <bdi>{money(x.unitPriceCents)}</bdi>
                </dd>
              </div>
            ))}
          </dl>
          <NumberField label={t('settings.rulePanel.minOrder')} value={draft.minOrderCartons} onChange={(n) => set('minOrderCartons', n)} disabled={!editable} error={fe()} help={t('settings.rulePanel.tiersFixed')} />
        </>
      ) : rule === 'commission' ? (
        <MoneyField label={t('settings.rulePanel.commission')} cents={draft.commissionPerUnitCents} onCents={(c) => set('commissionPerUnitCents', c ?? NaN)} disabled={!editable} error={fe()} />
      ) : (
        <TextField label={t('settings.rulePanel.value')} value={w.value} readOnly disabled />
      )}
      <p className="muted body-sm">{FIXED.includes(rule) ? t('settings.rulePanel.fixedNote') : t('settings.rulePanel.appliesNote')}</p>

      {rule === 'ownership' && (
        <>
          <span className="overline">{t('settings.rulePanel.warnTitle')}</span>
          <Chips
            label={t('settings.rulePanel.warnTitle')}
            value={String(draft.ownership.warningDays)}
            onChange={(v) => editable && set('ownership', { ...draft.ownership, warningDays: Number(v) })}
            options={[...new Set([...WARN_DAYS, r.ownership.warningDays])].sort((a, b) => a - b).map((n) => ({ value: String(n), label: t('settings.rulePanel.warnChip', { n }) }))}
          />
          <p className="muted body-sm">{t('settings.rulePanel.warnNote')}</p>
          <span className="overline">{t('settings.rulePanel.getsTitle')}</span>
          <div className={css.example}>
            <span className={css.exIco} aria-hidden>
              <Icon as={Clock} />
            </span>
            <span>
              <b className={css.exTitle}>{t('settings.rulePanel.getsLine', { n: draft.ownership.warningDays, customer: ex?.customerName ?? t('settings.rulePanel.aCustomer') })}</b>
              <span className={css.exText}>
                {ex
                  ? `${ex.lastOrderAt ? `${t('settings.rulePanel.noOrderSince', { date: dateShort(ex.lastOrderAt) })} ` : ''}${t('settings.rulePanel.getsText', { customer: ex.customerName, date: date(ex.ownedUntil), end: draft.ownership.atEnd })}`
                  : t('settings.rulePanel.getsTextNone', { end: draft.ownership.atEnd })}
              </span>
            </span>
          </div>
        </>
      )}
      {editable && <TwoStepField value={code} onChange={setCode} error={codeError} />}
      {!codeError && !Object.keys(save.fields).length && <ActionError action={save} />}
    </Sheet>
  );
}

// ---------- Documents, E-mail, Bank and sign-in ----------

type DocsDraft = { proformaLanguage: ProformaLanguage; proformaValidityDays: number; prefixes: SettingsData['documents']['prefixes']; nextInvoice: string; footer: string; company: CompanyProfile };
type BankDraft = { bank: string; iban: string; bic: string; accounts: string[]; twoStep: TwoStepPolicy; signOut: SignOut };

function initialDraft(card: CardKey, d: SettingsData): DocsDraft | EmailSettings | BankDraft {
  if (card === 'docs') return { proformaLanguage: d.documents.proformaLanguage, proformaValidityDays: d.documents.proformaValidityDays, prefixes: d.documents.prefixes, nextInvoice: d.nextNumbers.invoice, footer: d.documents.footer, company: d.company };
  if (card === 'mail') return { ...d.email };
  return { bank: d.bank.bank, iban: d.bank.iban, bic: d.bank.bic, accounts: d.bank.accounts, twoStep: d.security.twoStep, signOut: d.security.signOut };
}

function CardSheet({ card, data, editable, onClose }: { card: CardKey; data: SettingsData; editable: boolean; onClose: () => void }) {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const init = initialDraft(card, data);
  const [v, setV] = useState<Record<string, unknown>>(init as unknown as Record<string, unknown>);
  const [code, setCode] = useState('');
  useEffect(() => {
    setV(initialDraft(card, data) as unknown as Record<string, unknown>);
    setCode('');
  }, [card]); // eslint-disable-line react-hooks/exhaustive-deps -- a refetch (e.g. after a logo upload) keeps what was typed
  const title = t(`settings.cards.${card}.title`);
  const save = useAction((x: { value: unknown; code?: string }) => api.patch(`/settings/cards/${card}`, { value: x.value }, { code: x.code }), { success: t('settings.cardPanel.saved', { card: title }), onDone: onClose });
  const f = save.fields;
  const err = save.error instanceof ApiError ? save.error : null;
  const codeError = err?.code?.startsWith('step_up') ? err.message : undefined;
  const dirty = JSON.stringify(v) !== JSON.stringify(init);
  const needsCode = card === 'docs' ? Number(v.proformaValidityDays) !== data.documents.proformaValidityDays : card === 'bank' ? String(v.iban ?? '').replace(/\s+/g, '').toUpperCase() !== data.bank.iban : false;
  const set = (k: string, val: unknown) => setV((x) => ({ ...x, [k]: val }));
  const text = (k: string, label: string, extra: Partial<Parameters<typeof TextField>[0]> = {}) => (
    <TextField key={k} label={label} value={String(v[k] ?? '')} onChange={(e) => set(k, e.target.value)} disabled={!editable} error={f[`value.${k}`]} {...extra} />
  );

  const submit = () => {
    let value: unknown = v;
    if (card === 'docs') {
      const digits = String(v.nextInvoice ?? '').match(/(\d+)\s*$/);
      value = { ...v, nextInvoice: digits ? Number(digits[1]) : NaN };
    }
    if (card === 'bank') value = { ...v, accounts: ((v.accounts as string[]) ?? []).map((a) => a.trim()).filter(Boolean) };
    save.mutate({ value, code: needsCode ? code : undefined });
  };

  let body: ReactNode = null;
  if (card === 'docs') {
    const p = v.prefixes as DocsDraft['prefixes'];
    const c = v.company as CompanyProfile;
    const setP = (k: keyof DocsDraft['prefixes']) => (e: { target: { value: string } }) => set('prefixes', { ...p, [k]: e.target.value });
    const setC = (k: keyof CompanyProfile) => (e: { target: { value: string } }) => set('company', { ...c, [k]: e.target.value });
    const cf = (k: keyof CompanyProfile, extra: Partial<Parameters<typeof TextField>[0]> = {}) => <TextField key={k} label={t(`settings.fields.${k}`)} value={c[k] ?? ''} onChange={setC(k)} disabled={!editable} error={f[`value.company.${k}`]} {...extra} />;
    body = (
      <>
        <Select label={t('settings.cardPanel.proformaLanguage')} value={String(v.proformaLanguage)} onChange={(e) => set('proformaLanguage', e.target.value)} disabled={!editable} options={(['per_customer', 'en', 'bg'] as const).map((o) => ({ value: o, label: t(`settings.lang.${o}`) }))} />
        <NumberField label={t('settings.cardPanel.validDays')} value={Number(v.proformaValidityDays)} onChange={(n) => set('proformaValidityDays', n)} disabled={!editable} error={f['value.proformaValidityDays']} />
        <TextField label={t('settings.cardPanel.orderPrefix')} value={p.order} onChange={setP('order')} disabled={!editable} error={f['value.prefixes.order']} />
        <TextField label={t('settings.cardPanel.invoicePrefix')} value={p.invoice} onChange={setP('invoice')} disabled={!editable} error={f['value.prefixes.invoice']} />
        <TextField label={t('settings.cardPanel.creditPrefix')} value={p.credit_note} onChange={setP('credit_note')} disabled={!editable} error={f['value.prefixes.credit_note']} />
        {text('nextInvoice', t('settings.cardPanel.nextInvoice'))}
        <LogoField logo={data.documents.logo} editable={editable} />
        {text('footer', t('settings.cardPanel.footer'))}
        <span className="overline">{t('settings.cardPanel.companyTitle')}</span>
        {cf('name')}
        {cf('legalName')}
        <div className="form-grid">
          {cf('vatNumber')}
          {cf('country', { maxLength: 2 })}
        </div>
        {cf('address')}
        {cf('city')}
        <div className="form-grid">
          {cf('email', { type: 'email' })}
          {cf('phone', { type: 'tel' })}
        </div>
      </>
    );
  } else if (card === 'mail') {
    body = (
      <>
        {text('warehouse', t('settings.cards.mail.warehouse'), { type: 'email' })}
        {text('accounting', t('settings.cards.mail.accounting'), { type: 'email' })}
        {text('sender', t('settings.cards.mail.sender'))}
        {text('replyTo', t('settings.cards.mail.replyTo'), { type: 'email' })}
        <Select label={t('settings.cardPanel.copyBroker')} value={v.copyBroker ? 'yes' : 'no'} onChange={(e) => set('copyBroker', e.target.value === 'yes')} disabled={!editable} options={[{ value: 'yes', label: t('settings.yes') }, { value: 'no', label: t('settings.no') }]} />
      </>
    );
  } else {
    const accounts = (v.accounts as string[]) ?? [];
    const sec = data.security;
    body = (
      <>
        {text('bank', t('settings.cards.bank.bank'))}
        {text('iban', t('settings.cards.bank.iban'))}
        {text('bic', t('settings.cardPanel.bic'))}
        <Select
          label={t('settings.cards.bank.twoStep')}
          value={String(v.twoStep)}
          onChange={(e) => set('twoStep', e.target.value)}
          disabled={!editable}
          options={[...(sec.twoStep === 'custom' ? (['custom'] as const) : []), ...(['admins_finance', 'everyone', 'optional'] as const)].map((o) => ({ value: o, label: t(`settings.twoStep.${o}`) }))}
        />
        <Select
          label={t('settings.cards.bank.signOut')}
          value={String(v.signOut)}
          onChange={(e) => set('signOut', e.target.value)}
          disabled={!editable}
          options={[...(sec.signOut === 'custom' ? (['custom'] as const) : []), ...(['short', 'standard', 'never'] as const)].map((o) => ({ value: o, label: o === 'custom' ? signOutLabel(sec, t) : t(`settings.signOut.${o}`) }))}
        />
        <div className="an-field">
          <label>{t('settings.cardPanel.accounts')}</label>
          <span className="an-help" style={{ marginTop: 0 }}>
            {t('settings.cardPanel.accountsHelp')}
          </span>
        </div>
        {accounts.map((a, i) => (
          <div key={i} className={css.listRow}>
            <TextField label={t('settings.cardPanel.accountN', { n: i + 1 })} value={a} disabled={!editable} onChange={(e) => set('accounts', accounts.map((y, j) => (j === i ? e.target.value : y)))} error={f[`value.accounts.${i}`]} />
            {editable && <IconButton icon={X} label={t('settings.cardPanel.removeAccount')} onClick={() => set('accounts', accounts.filter((_, j) => j !== i))} />}
          </div>
        ))}
        {editable && (
          <Button size="sm" icon={Plus} onClick={() => set('accounts', [...accounts, ''])}>
            {t('settings.cardPanel.addAccount')}
          </Button>
        )}
      </>
    );
  }

  return (
    <Sheet
      open
      onClose={onClose}
      dirty={dirty}
      title={title}
      footer={
        editable ? (
          <>
            <Button onClick={onClose}>{tc('cancel')}</Button>
            <Button variant="primary" busy={save.isPending} disabled={!dirty || (needsCode && code.length !== 6)} onClick={submit}>
              {tc('save')}
            </Button>
          </>
        ) : (
          <Button block onClick={onClose}>
            {tc('close')}
          </Button>
        )
      }
    >
      {body}
      <p className="muted body-sm">
        {t(`settings.cardPanel.note.${card}`)} {t('settings.cardPanel.logged')}
      </p>
      {editable && needsCode && <TwoStepField value={code} onChange={setCode} error={codeError} />}
      {!codeError && !Object.keys(f).length && <ActionError action={save} />}
    </Sheet>
  );
}

/** Logo on documents: the shared FileUpload (images only, saved straight away); a stored logo shows as a ready row with Remove. */
function LogoField({ logo, editable }: { logo: SettingsData['documents']['logo']; editable: boolean }) {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const [stamp, setStamp] = useState(0);
  const [sent, setSent] = useState<File | null>(null);
  const upload = useAction(
    (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api.post('/settings/documents/logo', fd);
    },
    { success: t('settings.cardPanel.logoUploaded'), onDone: () => (setStamp(Date.now()), setSent(null)) },
  );
  const restore = useAction(() => api.post('/settings/documents/logo/undo'), { success: t('settings.cardPanel.logoRestored'), onDone: () => setStamp(Date.now()), errorToast: true });
  const remove = useAction(() => api.del('/settings/documents/logo'), { success: t('settings.cardPanel.logoRemoved'), successAction: { label: tc('undo'), onClick: () => restore.mutate(undefined) } });
  const err = upload.fields.file ?? remove.errorText ?? undefined;
  const failed = !!upload.error && !upload.fields.file;
  return (
    <div className="an-field">
      <label>{t('settings.cardPanel.logo')}</label>
      {logo && !sent ? (
        <div className={css.logoRow}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={css.logoImg} src={`/api/settings/documents/logo?v=${stamp}`} alt="" />
          <span className={css.logoName}>
            <bdi>{logo.name}</bdi>
            <span className="sub">{t('settings.cardPanel.logoHelp')}</span>
          </span>
          {editable && (
            <Button size="sm" writes busy={remove.isPending} onClick={() => remove.mutate(undefined)}>
              {t('settings.cardPanel.remove')}
            </Button>
          )}
        </div>
      ) : editable ? (
        <FileUpload
          imageOnly
          file={sent}
          status={upload.isPending ? 'uploading' : failed ? 'error' : sent ? 'ready' : 'idle'}
          error="stopped"
          onPick={(f) => (setSent(f), upload.mutate(f))}
          onRetry={() => sent && upload.mutate(sent)}
          onRemove={() => setSent(null)}
        />
      ) : null}
      {err && <span className="an-help error">{err}</span>}
    </div>
  );
}

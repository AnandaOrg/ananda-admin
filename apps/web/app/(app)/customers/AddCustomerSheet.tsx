'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useUndoOwner } from '@/app/(app)/customers/useUndoOwner';
import { useFmt, iso } from '@/lib/format';
import { useSession } from '@/lib/session';
import { PROFORMA_LANGUAGES, defaultProformaLanguage, type ProformaLanguage } from '@ananda/shared';
import { ActionError, Button, Check, Chips, Clock, Icon, MagnifyingGlass, Pill, Sheet, ShieldCheck, TextField, Warning } from '@/components/ui';
import { DropdownField } from './Dropdown';
import s from './customers.module.css';

/** Countries the form offers; EU members get the VIES check and reverse charge. XX = another country. */
export const COUNTRIES = ['BG', 'GR', 'RO', 'CY', 'DE', 'AT', 'IT', 'NL', 'FR', 'ES', 'IL', 'GB', 'XX'] as const;
export const EU = ['BG', 'GR', 'RO', 'CY', 'DE', 'AT', 'IT', 'NL', 'FR', 'ES'];
const PREFIX: Record<string, string> = { BG: 'BG', EL: 'GR', GR: 'GR', RO: 'RO', CY: 'CY', DE: 'DE', AT: 'AT', IT: 'IT', NL: 'NL', FR: 'FR', ES: 'ES' };
export const PAYMENT_TERMS = ['before_shipping', 'half_before_shipping', 'after_delivery_30'] as const;
/** Message keys (customers.terms.*) for each document language. */
export const LANG_KEY: Record<ProformaLanguage, 'english' | 'bulgarian' | 'hebrew'> = { en: 'english', bg: 'bulgarian', he: 'hebrew' };

interface Duplicate {
  id: string;
  companyName: string;
  vatNumber: string;
  status: string;
  brokerId: string | null;
  brokerName: string | null;
  ownedUntil: string | null;
  lastOrderAt: string | null;
  freeToClaim: boolean;
}
interface VatResult {
  checked: boolean;
  valid: boolean | null;
  vatNumber: string;
  country: string | null;
  companyName: string | null;
  address: string | null;
  street: string | null;
  postcode: string | null;
  city: string | null;
  duplicates: Duplicate[];
}
type St = 'idle' | 'checking' | 'fmt' | 'nf' | 'down' | 'found';
type Key = 'name' | 'country' | 'street' | 'pc' | 'city' | 'dstreet' | 'contact' | 'phone' | 'email' | 'broker';
const EMPTY = { vat: '', name: '', country: 'BG', street: '', pc: '', city: '', dsame: true, dstreet: '', contact: '', phone: '', email: '', terms: 'before_shipping', broker: '', lang: '' as ProformaLanguage | '' };

const normVat = (v: string) => v.toUpperCase().replace(/[\s.\-]/g, '');
const vatFmt = (v: string) => /^[A-Z]{2}[0-9A-Z]{8,12}$/.test(v) && !!PREFIX[v.slice(0, 2)];

/** Country names in the reader's language. */
export function useCountryName() {
  const locale = useLocale();
  const t = useTranslations('customers');
  const names = useMemo(() => {
    try {
      return new Intl.DisplayNames([locale], { type: 'region' });
    } catch {
      return null;
    }
  }, [locale]);
  return (code: string) => (code === 'XX' ? t('add.otherCountry') : (names?.of(code) ?? code));
}

/**
 * Add a customer, one form (10 Nov): VAT number on top, every detail below. Check (or pasting a full
 * number) fills the company, country and address from the EU register. An Admin's customer is active
 * at once; a broker's goes to an Admin for approval.
 */
export function AddCustomerSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('customers');
  const tc = useTranslations('common');
  const router = useRouter();
  const { isBroker } = useSession();
  const { date } = useFmt();
  const country = useCountryName();
  const [f, setF] = useState(EMPTY);
  const [st, setSt] = useState<St>('idle');
  const [from, setFrom] = useState<Partial<Record<Key, boolean>>>({});
  const [err, setErr] = useState<Partial<Record<Key, string>>>({});
  const [existing, setExisting] = useState<Duplicate | null>(null);
  const [checked, setChecked] = useState<VatResult | null>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const brokers = useQuery({ queryKey: ['brokers-list'], queryFn: () => api.get<{ id: string; name: string }[]>('/customers/brokers'), enabled: open && !isBroker });

  const reset = () => {
    setF(EMPTY);
    setSt('idle');
    setFrom({});
    setErr({});
    setExisting(null);
    setChecked(null);
  };
  const close = () => {
    reset();
    onClose();
  };
  const set = (k: keyof typeof EMPTY, v: string | boolean) => {
    setF((x) => ({ ...x, [k]: v }));
    if (k in from) setFrom((x) => ({ ...x, [k]: false }));
    if (typeof v === 'string' && v.trim() && err[k as Key]) setErr((x) => ({ ...x, [k]: undefined }));
  };

  async function check(raw = f.vat) {
    let v = normVat(raw);
    if (!v) return;
    // A number typed without its country code takes the chosen EU country's.
    if (!/^[A-Z]{2}/.test(v) && EU.includes(f.country)) v = (f.country === 'GR' ? 'EL' : f.country) + v;
    if (!vatFmt(v)) {
      setSt('fmt');
      return;
    }
    setF((x) => ({ ...x, vat: v }));
    setSt('checking');
    setExisting(null);
    try {
      const r = await api.post<VatResult>('/customers/vat-check', { vatNumber: v });
      setChecked(r);
      const dup = r.duplicates.find((d) => d.status !== 'declined');
      if (!r.checked) return setSt('down');
      if (!r.valid) return setSt('nf');
      setSt('found');
      if (dup) setExisting(dup);
      setF((x) => ({
        ...x,
        vat: r.vatNumber || v,
        name: r.companyName ?? x.name,
        country: r.country ?? x.country,
        street: r.street ?? x.street,
        pc: r.postcode ?? x.pc,
        city: r.city ?? x.city,
      }));
      setFrom({ name: !!r.companyName, country: !!r.country, street: !!r.street, pc: !!r.postcode, city: !!r.city });
      setErr({});
    } catch {
      setSt('down');
    }
  }
  const useAnother = () => {
    setF((x) => ({ ...x, vat: '', ...(from.name ? { name: '' } : {}), ...(from.street ? { street: '' } : {}), ...(from.pc ? { pc: '' } : {}), ...(from.city ? { city: '' } : {}) }));
    setFrom({});
    setSt('idle');
    setExisting(null);
    setChecked(null);
  };

  const save = useAction(
    () =>
      api.post<{ id: string; status: string; companyName: string }>('/customers', {
        vatNumber: f.vat ? normVat(f.vat) : undefined,
        vatValid: st === 'found' ? true : st === 'nf' ? false : null,
        country: f.country,
        companyName: f.name,
        registeredAddress: f.street,
        postcode: f.pc || undefined,
        city: f.city,
        deliveryAddress: f.dsame ? undefined : f.dstreet,
        contactName: f.contact,
        phone: f.phone || undefined,
        invoiceEmail: f.email,
        paymentTerms: f.terms,
        proformaLanguage: docLang,
        brokerId: isBroker ? undefined : f.broker,
        submit: true,
      }),
    {
      success: (r) => (r.status === 'needs_approval' ? t('add.sent') : t('add.added', { name: iso(r.companyName) })),
      onDone: (r) => {
        close();
        router.push(r.status === 'needs_approval' ? '/home' : '/customers');
      },
    },
  );
  const undoClaim = useUndoOwner('claim');
  const claim = useAction((id: string) => api.post(`/customers/${id}/claim`).then(() => id), {
    success: t('claimed'),
    successAction: (id) => ({ label: tc('undo'), onClick: () => undoClaim.mutate(id) }),
    onDone: () => {
      const id = existing?.id;
      close();
      router.push(`/sales/new?customer=${id}`);
    },
  });

  function submit() {
    const e: Partial<Record<Key, string>> = {};
    const req: Key[] = ['name', 'country', 'street', 'city', 'contact', 'email'];
    if (!isBroker) req.push('broker');
    const val: Record<Key, string> = { name: f.name, country: f.country, street: f.street, pc: f.pc, city: f.city, dstreet: f.dstreet, contact: f.contact, phone: f.phone, email: f.email, broker: f.broker };
    for (const k of req) if (!val[k].trim()) e[k] = t('add.required');
    if (f.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) e.email = t('add.emailIncomplete');
    if (!f.dsame && !f.dstreet.trim()) e.dstreet = t('add.required');
    setErr(e);
    if (Object.keys(e).length) {
      requestAnimationFrame(() => {
        const el = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
        el?.scrollIntoView({ block: 'center' });
        el?.focus();
      });
      return;
    }
    save.mutate(undefined);
  }

  // Server field errors (e.g. "Already in ANANDA") next to their fields.
  const fe = save.fields;
  const fieldErr = (k: Key, server?: string) => err[k] ?? server;
  const nErr = Object.values(err).filter(Boolean).length;
  const eu = EU.includes(f.country);
  // Documents follow the country (BG → Bulgarian, IL → Hebrew, else English) until someone picks a language.
  const docLang: ProformaLanguage = f.lang || defaultProformaLanguage(f.country);
  const vatNote = f.country === 'BG' || f.country === 'XX' ? null : eu && st === 'found' ? t('add.vatNote.reverse') : eu ? t('add.vatNote.eu') : t('add.vatNote.export');
  const busy = st === 'checking';
  const found = st === 'found';
  const fromTag = (k: Key) => (from[k] ? <span className={s.tag}>{t('add.fromRegister')}</span> : null);

  const status = (() => {
    if (st === 'checking')
      return (
        <span className={`${s.help} ${s.status}`}>
          <span className={s.spin} aria-hidden />
          {t('add.checking')}
        </span>
      );
    if (st === 'fmt') return <span className={`${s.help} ${s.err}`}>{t('add.notVat')}</span>;
    if (st === 'nf') return <span className={`${s.help} ${s.err}`}>{t('add.notFound')}</span>;
    if (st === 'down')
      return (
        <div className={`${s.card} ${s.warn}`} role="status">
          <div className={s.ttl}>
            <Icon as={Clock} size="sm" className="warn" />
            {t('add.down')}
          </div>
          <span className={s.help}>{t('add.downText')}</span>
          <button type="button" className={s.link} onClick={() => check()} style={{ justifySelf: 'start' }}>
            {tc('retry')}
          </button>
        </div>
      );
    if (st === 'found')
      return (
        <span className={s.help}>
          {t('add.found')}{' '}
          <button type="button" className={s.link} onClick={useAnother}>
            {t('add.useAnother')}
          </button>
        </span>
      );
    return <span className={s.help}>{t('add.vatHelp')}</span>;
  })();

  const head = (
    <div className="an-field">
      <label htmlFor="ac-vat">
        {t('add.vat')} <span className={s.opt}>· {t('add.optional')}</span>
      </label>
      <span className={s.wrap}>
        <input
          id="ac-vat"
          className={`an-input ${st === 'fmt' || st === 'nf' ? 'error' : ''} ${found ? s.from : ''}`}
          value={f.vat}
          placeholder="BG203145882"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          readOnly={found || busy}
          aria-invalid={st === 'fmt' || st === 'nf' || undefined}
          onChange={(e) => {
            set('vat', e.target.value);
            if (st !== 'idle') setSt('idle');
          }}
          onPaste={(e) => {
            // A full pasted number is checked straight away.
            const v = normVat(e.clipboardData.getData('text'));
            if (vatFmt(v)) {
              e.preventDefault();
              setF((x) => ({ ...x, vat: v }));
              void check(v);
            }
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void check())}
        />
        <span className={s.trail}>
          {found ? (
            <span className={`${s.tag} ${s.good}`}>
              <Icon as={Check} size="sm" />
              {t('add.valid')}
            </span>
          ) : (
            <button type="button" className={s.trig} disabled={!f.vat.trim() || busy} onClick={() => check()}>
              {busy ? <span className={s.spin} aria-hidden /> : <Icon as={MagnifyingGlass} size="sm" />}
              {busy ? t('add.checkingShort') : t('add.check')}
            </button>
          )}
        </span>
      </span>
      {status}
    </div>
  );

  const brokerOptions = [
    ...(brokers.data ?? []).map((a) => ({ value: a.id, label: a.name })),
    { value: 'none', label: t('add.noBroker'), detail: t('add.noBrokerDetail') },
  ];

  return (
    <Sheet
      open={open}
      onClose={close}
      title={t('add.title')}
      dirty={!!(f.vat || f.name || f.street || f.contact || f.email)}
      footer={
        existing ? undefined : (
          <>
            <Button onClick={close}>{tc('cancel')}</Button>
            <Button variant="primary" busy={save.busy} onClick={submit}>
              {isBroker ? t('add.sendForApproval') : t('add.submit')}
            </Button>
          </>
        )
      }
    >
      <div className={s.form} ref={formRef}>
        <p className={s.sub}>{t('add.sub')}</p>
        {head}
        {existing ? (
          <>
            <div className={`${s.card} ${s.good}`}>
              <div className={s.ttl}>
                <Icon as={ShieldCheck} size="sm" className="good" />
                {t('add.viesValid')}
              </div>
              <div className={s.big}>{checked?.companyName ?? existing.companyName}</div>
              {checked?.address && <span className={s.help}>{checked.address}</span>}
            </div>
            <div className={s.card}>
              <div className={s.kv}>
                <span className={`${s.grp} ${s.flush}`}>
                  {t('add.inAnanda')}
                </span>
                <Pill tone={existing.freeToClaim ? 'good' : existing.status === 'archived' ? 'mute' : 'blue'}>
                  {existing.freeToClaim ? tc('customerStatus.free_to_claim') : tc(`customerStatus.${existing.status}`)}
                </Pill>
              </div>
              <div className={s.kv}>
                <span>{tc('broker')}</span>
                <span>{existing.freeToClaim || !existing.brokerName ? t('add.none') : existing.brokerName}</span>
              </div>
              <div className={s.kv}>
                <span>{existing.freeToClaim || !existing.ownedUntil ? t('cols.lastOrder') : t('cols.ownsUntil')}</span>
                <span>{existing.freeToClaim || !existing.ownedUntil ? (existing.lastOrderAt ? date(existing.lastOrderAt) : '—') : date(existing.ownedUntil)}</span>
              </div>
              <span className={s.help}>
                {existing.freeToClaim ? t('add.claimHelp') : existing.brokerName ? t('add.takenHelp', { broker: existing.brokerName }) : t('add.takenHouse')}
              </span>
            </div>
            {isBroker && existing.freeToClaim ? (
              <>
                <Button variant="primary" icon={Check} busy={claim.busy} onClick={() => claim.mutate(existing.id)}>
                  {t('add.claim')}
                </Button>
                <span className={s.help} style={{ textAlign: 'center' }}>
                  {t('add.claimNext')}
                </span>
                <ActionError action={claim} />
              </>
            ) : !isBroker ? (
              <Link href={`/customers/${existing.id}`} className="an-btn primary keep" onClick={close}>
                {t('add.openCustomer')}
              </Link>
            ) : null}
          </>
        ) : (
          <>
            <span className={s.grp}>{t('add.company')}</span>
            <FieldWithTag label={t('add.name')} value={f.name} placeholder={t('add.namePh')} error={fieldErr('name', fe.companyName)} tag={fromTag('name')} onChange={(v) => set('name', v)} />
            <DropdownField
              label={t('fields.country')}
              value={f.country}
              placeholder={t('add.chooseCountry')}
              options={COUNTRIES.map((c) => ({ value: c, label: country(c) }))}
              onChange={(v) => {
                set('country', v);
                if (st === 'found' || st === 'nf') setSt(st);
              }}
              error={err.country}
            />
            {vatNote && <span className={s.help}>{vatNote}</span>}

            <span className={s.grp}>{t('add.billing')}</span>
            <FieldWithTag label={t('add.street')} value={f.street} placeholder={t('add.streetPh')} error={fieldErr('street', fe.registeredAddress)} tag={fromTag('street')} onChange={(v) => set('street', v)} />
            <div className={s.two}>
              <FieldWithTag label={t('add.postcode')} value={f.pc} placeholder="9000" onChange={(v) => set('pc', v)} inputMode="numeric" />
              <FieldWithTag label={t('fields.city')} value={f.city} placeholder={t('add.cityPh')} error={fieldErr('city', fe.city)} tag={fromTag('city')} onChange={(v) => set('city', v)} />
            </div>
            <button type="button" className={s.tog} aria-pressed={f.dsame} onClick={() => set('dsame', !f.dsame)}>
              <span className={s.box}>
                <Icon as={Check} size="sm" />
              </span>
              {t('add.deliverSame')}
            </button>
            {!f.dsame && <TextField label={t('fields.deliveryAddress')} value={f.dstreet} placeholder={t('add.deliveryPh')} error={fieldErr('dstreet', fe.deliveryAddress)} onChange={(e) => set('dstreet', e.target.value)} aria-invalid={!!err.dstreet || undefined} />}

            <span className={s.grp}>{t('add.whoYouTalkTo')}</span>
            <TextField label={t('add.contact')} value={f.contact} placeholder={t('add.contactPh')} error={fieldErr('contact', fe.contactName)} onChange={(e) => set('contact', e.target.value)} />
            <FieldWithTag label={t('fields.phone')} optional={t('add.optional')} value={f.phone} placeholder="+359 …" inputMode="tel" onChange={(v) => set('phone', v)} error={fe.phone} />
            <TextField label={t('add.email')} type="email" inputMode="email" value={f.email} placeholder="name@company.bg" error={fieldErr('email', fe.invoiceEmail)} onChange={(e) => set('email', e.target.value)} />
            <DropdownField
              label={t('add.terms')}
              value={f.terms}
              placeholder={t('add.chooseTerms')}
              options={PAYMENT_TERMS.map((k) => ({ value: k, label: t(`terms.${k}`), detail: t(`termsDetail.${k}`) }))}
              onChange={(v) => set('terms', v)}
            />
            <div className="an-field">
              <label>{t('fields.proformaLanguage')}</label>
              <Chips label={t('fields.proformaLanguage')} value={docLang} onChange={(v) => set('lang', v)} options={PROFORMA_LANGUAGES.map((l) => ({ value: l, label: t(`terms.${LANG_KEY[l]}`) }))} />
              <span className="an-help">{t('add.languageHelp')}</span>
            </div>
            {!isBroker && (
              <DropdownField
                label={tc('broker')}
                value={f.broker}
                placeholder={t('add.chooseBroker')}
                options={brokerOptions}
                onChange={(v) => set('broker', v)}
                error={fieldErr('broker', fe.brokerId)}
                help={f.broker === 'none' ? t('add.houseHelp') : t('add.brokerHelp')}
              />
            )}
            {nErr > 0 && (
              <div className={s.banner} role="alert">
                <Icon as={Warning} />
                <span>{nErr === 1 ? t('add.oneMissing') : t('add.manyMissing', { n: nErr })}</span>
              </div>
            )}
            <div className={s.foot}>
              {isBroker && <span className={s.help}>{found ? t('add.brokerFootFound') : t('add.brokerFoot')}</span>}
              <ActionError action={save} message={save.error instanceof ApiError && save.error.fields ? save.error.message : t('add.notAdded')} />
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}

function FieldWithTag({ label, value, onChange, placeholder, error, tag, optional, inputMode }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; error?: string; tag?: React.ReactNode; optional?: string; inputMode?: 'numeric' | 'tel' }) {
  const id = useRef(`f${Math.random().toString(36).slice(2, 8)}`).current;
  return (
    <div className="an-field">
      <label htmlFor={id}>
        {label}
        {optional && <span className={s.opt}> · {optional}</span>}
      </label>
      <span className={`${s.wrap} ${tag ? '' : s.noTrail}`}>
        <input id={id} className={`an-input ${error ? 'error' : ''}`} value={value} placeholder={placeholder} inputMode={inputMode} autoComplete="off" aria-invalid={!!error || undefined} onChange={(e) => onChange(e.target.value)} />
        {tag && <span className={s.trail}>{tag}</span>}
      </span>
      {error && <span className="an-help error">{error}</span>}
    </div>
  );
}

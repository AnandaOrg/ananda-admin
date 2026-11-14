'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorText } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useFmt } from '@/lib/format';
import { useSession } from '@/lib/session';
import { ActionError, Bank, Button, Card, Check, Clock, ErrorState, FileText, Icon, PageHeader, PageSkeleton, Pill, Select, Signature, TextField, UploadSimple, useToast } from '@/components/ui';
import { bankFromIban, groupIban, validIban } from '../_components/bank';
import type { AgentSetup } from '../_components/types';
import s from '../agents.module.css';

type Step = 0 | 1 | 2 | 3;
const stepOf = (status: AgentSetup['status']): Step => (status === 'company' || status === 'invited' ? 0 : status === 'bank' ? 1 : status === 'sign' ? 2 : 3);
const EU = ['AT', 'BE', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'ES', 'FI', 'FR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK'];

/**
 * Agent set-up after accepting the invitation (10 Nov feedback): 1. Company, 2. Bank, 3. Contract
 * (sign in the app or on paper). Then an Admin countersigns; until then the set-up is not finished.
 */
export default function AgentSetupPage() {
  const t = useTranslations('agents');
  const tc = useTranslations('common');
  const { isAgent, me } = useSession();
  const q = useQuery({ queryKey: ['agents', 'setup', 'me'], queryFn: () => api.get<AgentSetup>('/agents/me/setup'), enabled: isAgent });
  const [step, setStep] = useState<Step | null>(null);
  useEffect(() => {
    if (q.data && step === null) setStep(stepOf(q.data.status));
  }, [q.data, step]);

  if (!isAgent) return <ErrorState error={{ status: 404, message: 'Not found' }} />;
  if (q.isLoading || step === null) return <PageSkeleton />;
  if (!q.data) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  const locked = d.status === 'countersign' || d.status === 'done';
  const current = stepOf(d.status);

  return (
    <div className="page">
      <PageHeader crumbs={[{ label: tc('nav.earnings'), href: '/agents' }, { label: t('setup.kicker') }]} kicker={t('setup.kicker')} title={step === 3 ? (d.status === 'done' ? t('setup.done.finishedTitle') : t('setup.done.title')) : t('setup.title')} />
      <div className={s.setup}>
        {step < 3 && (
          <>
            <div className={s.steps}>
              {(['company', 'bank', 'contract'] as const).map((k, i) => (
                <span key={k} className={`${s.step} ${i === step ? s.on : i < current || locked ? s.done : ''}`}>
                  {t(`setup.steps.${k}`)}
                </span>
              ))}
            </div>
            <span className={s.stepOf}>{t('setup.stepOf', { n: step + 1 })}</span>
          </>
        )}
        {step === 0 && <CompanyStep d={d} email={me.user.email} locked={locked} onNext={() => setStep(1)} />}
        {step === 1 && <BankStep d={d} locked={locked} onBack={() => setStep(0)} onNext={() => setStep(locked ? 3 : 2)} />}
        {step === 2 && <ContractStep d={d} onBack={() => setStep(1)} onDone={() => setStep(3)} />}
        {step === 3 && <DoneStep d={d} onReview={() => setStep(0)} />}
      </div>
    </div>
  );
}

function useSaved() {
  const t = useTranslations('agents');
  const toast = useToast();
  return () => toast(t('setup.saved'));
}

function CompanyStep({ d, email, locked, onNext }: { d: AgentSetup; email: string; locked: boolean; onNext: () => void }) {
  const t = useTranslations('agents');
  const det = d.details;
  const qc = useQueryClient();
  const saved = useSaved();
  const [f, setF] = useState({
    registeredIn: det?.registeredIn ?? 'bg',
    country: det?.country && det.country !== 'BG' ? det.country : 'DE',
    vatNumber: det?.vatNumber ?? '',
    companyRegNumber: det?.companyRegNumber ?? '',
    companyName: det?.companyName ?? '',
    address: det?.address ?? '',
    city: det?.city ?? '',
    vatRegistered: det?.vatRegistered ?? true,
    managerName: det?.managerName ?? d.agent.name,
    managerRole: det?.managerRole ?? '',
    payoutEmail: det?.payoutEmail ?? email,
  });
  const [lookup, setLookup] = useState<'idle' | 'busy' | 'found' | 'nf' | 'down'>(det?.companyName ? 'found' : 'idle');
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const body = () => ({ ...f, country: f.registeredIn === 'bg' ? 'BG' : f.registeredIn === 'eu' ? f.country : f.country.slice(0, 2).toUpperCase() || 'XX', vatNumber: f.vatNumber || null, companyRegNumber: f.companyRegNumber || null, city: f.city || null });
  const save = useAction(() => api.post('/agents/me/setup/company', body()), {
    onDone: () => qc.refetchQueries({ queryKey: ['agents', 'setup', 'me'] }).then(onNext),
  });
  const later = useAction(() => api.post('/agents/me/setup/draft', body()), { onDone: saved });

  async function lookUp() {
    setLookup('busy');
    try {
      const r = await api.post<{ checked: boolean; valid: boolean | null; companyName: string | null; address: string | null; street: string | null; city: string | null }>('/customers/vat-check', { vatNumber: f.vatNumber, country: f.registeredIn === 'bg' ? 'BG' : f.country });
      if (!r.checked) return setLookup('down');
      if (!r.valid) {
        set('vatRegistered', false);
        return setLookup('nf');
      }
      setF((x) => ({ ...x, companyName: r.companyName ?? x.companyName, address: r.street ?? r.address ?? x.address, city: r.city ?? x.city, vatRegistered: true }));
      setLookup('found');
    } catch {
      setLookup('down');
    }
  }

  const fe = save.fields;
  const dis = locked;
  return (
    <Card>
      <div className={s.form}>
        <div>
          <h2 style={{ margin: 0, font: '400 20px/26px var(--font-sans)' }}>
            {t('setup.company.title')}
          </h2>
          <p className={s.muted} style={{ margin: 'var(--space-1) 0 0' }}>
            {t('setup.company.lead')}
          </p>
        </div>
        <Select
          label={t('setup.company.where')}
          value={f.registeredIn}
          disabled={dis}
          onChange={(e) => set('registeredIn', e.target.value as typeof f.registeredIn)}
          options={(['bg', 'eu', 'other'] as const).map((v) => ({ value: v, label: t(`setup.company.whereOpts.${v}`) }))}
        />
        {f.registeredIn !== 'bg' && (
          <Select
            label={t('setup.company.country')}
            value={f.country}
            disabled={dis}
            onChange={(e) => set('country', e.target.value)}
            options={(f.registeredIn === 'eu' ? EU : ['GB', 'IL', 'US', 'CH', 'NO', 'RS', 'MK', 'TR', 'UA']).map((c) => ({ value: c, label: c }))}
          />
        )}
        <div className={s.grp}>{t('setup.company.yourCompany')}</div>
        {f.registeredIn === 'bg' && (
          <div className="an-field">
            <label htmlFor="vat">{t('setup.company.vatOrEik')}</label>
            <div className={s.wrap}>
              <input id="vat" className={`an-input ${fe.vatNumber ? 'error' : ''}`} placeholder={t('setup.company.vatPh')} value={f.vatNumber} disabled={dis} onChange={(e) => (set('vatNumber', e.target.value), setLookup('idle'))} />
              <span className={s.trail}>
                {lookup === 'found' ? (
                  <span className={`${s.tag} ${s.good}`}>
                    <Icon as={Check} size="sm" /> {t('setup.company.found')}
                  </span>
                ) : (
                  <Button size="sm" busy={lookup === 'busy'} disabled={dis || f.vatNumber.replace(/\D/g, '').length < 9} onClick={lookUp}>
                    {lookup === 'busy' ? t('setup.company.lookingUp') : t('setup.company.lookUp')}
                  </Button>
                )}
              </span>
            </div>
            <span className={`${s.help} ${fe.vatNumber ? s.err : lookup === 'found' ? s.good : ''}`}>
              {fe.vatNumber ?? (lookup === 'found' ? t('setup.company.foundText') : lookup === 'nf' ? t('setup.company.notFound') : lookup === 'down' ? t('setup.company.down') : `${t('setup.company.vatHelp')} ${t('setup.company.lookupHint')}`)}
            </span>
          </div>
        )}
        {f.registeredIn === 'eu' && (
          <>
            <TextField label={t('setup.company.regNumber')} placeholder={t('setup.company.regPh')} help={t('setup.company.asInRegister')} value={f.companyRegNumber} disabled={dis} onChange={(e) => set('companyRegNumber', e.target.value)} error={fe.companyRegNumber} />
            <TextField label={t('setup.company.euVat')} placeholder={t('setup.company.euVatPh')} help={t('setup.company.euVatHelp')} value={f.vatNumber} disabled={dis} onChange={(e) => set('vatNumber', e.target.value)} error={fe.vatNumber} />
          </>
        )}
        {f.registeredIn === 'other' && <TextField label={t('setup.company.taxId')} help={`${t('setup.company.taxIdHelp')}. ${t('setup.company.noEuVat')}`} value={f.vatNumber} disabled={dis} onChange={(e) => set('vatNumber', e.target.value)} error={fe.vatNumber} />}
        <TextField label={t('setup.company.companyName')} help={lookup === 'found' ? t('setup.company.fromRegister') : t('setup.company.asInRegister')} value={f.companyName} disabled={dis} onChange={(e) => set('companyName', e.target.value)} error={fe.companyName} />
        <div className={s.two}>
          <TextField label={t('setup.company.address')} value={f.address} disabled={dis} onChange={(e) => set('address', e.target.value)} error={fe.address} />
          <TextField label={t('setup.company.city')} value={f.city} disabled={dis} onChange={(e) => set('city', e.target.value)} error={fe.city} />
        </div>
        {f.registeredIn !== 'other' && (
          <div className="an-field">
            <label>
              {t('setup.company.vatRegistered')}
              {lookup === 'found' && <span className={s.help}> · {t('setup.company.fromVies')}</span>}
            </label>
            <div className={s.choice}>
              {[true, false].map((v) => (
                <label key={String(v)} className={`${s.opt} ${f.vatRegistered === v ? s.on : ''}`}>
                  <input type="radio" name="vatreg" checked={f.vatRegistered === v} disabled={dis} onChange={() => set('vatRegistered', v)} />
                  <span>
                    <span className={s.t}>{v ? t('setup.company.vatYes') : t('setup.company.vatNo')}</span>
                    <span className={s.s}>{v ? t('setup.company.vatYesNote') : t('setup.company.vatNoNote')}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}
        <div className={s.grp}>{t('setup.company.signer')}</div>
        <div className={s.two}>
          <TextField label={t('setup.company.fullName')} help={t('setup.company.fullNameHelp')} value={f.managerName} disabled={dis} onChange={(e) => set('managerName', e.target.value)} error={fe.managerName} autoComplete="name" />
          <TextField label={t('setup.company.role')} placeholder={t('setup.company.rolePh')} value={f.managerRole} disabled={dis} onChange={(e) => set('managerRole', e.target.value)} error={fe.managerRole} />
        </div>
        <div className={s.grp}>{t('setup.company.reach')}</div>
        <TextField label={t('setup.company.payoutEmail')} help={f.payoutEmail === email ? t('setup.company.fromInvite') : undefined} type="email" value={f.payoutEmail} disabled={dis} onChange={(e) => set('payoutEmail', e.target.value)} error={fe.payoutEmail} />
        {!fe.vatNumber && <ActionError action={save} />}
        <div className={s.btns}>
          {locked ? (
            <Button variant="primary" onClick={onNext}>
              {t('setup.company.continue')}
            </Button>
          ) : (
            <>
              <Button busy={later.busy} onClick={() => later.mutate(undefined)}>
                {t('setup.later')}
              </Button>
              <Button variant="primary" busy={save.busy} onClick={() => save.mutate(undefined)}>
                {t('setup.company.continue')}
              </Button>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

function FileDrop({ label, busy, fileName, onFile, error }: { label: string; busy?: boolean; fileName?: string | null; onFile: (f: File) => void; error?: string | null }) {
  const t = useTranslations('agents');
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      className={`${s.drop} ${over ? s.over : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => ref.current?.click()}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && ref.current?.click()}
      onDragOver={(e) => (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
    >
      <Icon as={UploadSimple} />
      {busy ? (
        <span>{t('setup.bank.uploading')}</span>
      ) : fileName ? (
        <span className={`${s.help} ${s.good}`}>{t('setup.bank.uploaded', { name: fileName })}</span>
      ) : (
        <span>
          {label} <b>{t('setup.bank.choose')}</b>
        </span>
      )}
      <span className={s.help}>{t('setup.bank.fileTypes')}</span>
      {error && <span className={`${s.help} ${s.err}`}>{error}</span>}
      <input ref={ref} type="file" hidden accept="application/pdf,image/jpeg,image/png,image/webp,image/heic" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
    </div>
  );
}

function BankStep({ d, locked, onBack, onNext }: { d: AgentSetup; locked: boolean; onBack: () => void; onNext: () => void }) {
  const t = useTranslations('agents');
  const det = d.details;
  const qc = useQueryClient();
  const saved = useSaved();
  const [f, setF] = useState({ accountHolder: det?.accountHolder ?? det?.companyName ?? '', iban: det?.iban ? groupIban(det.iban) : '', bic: det?.bic ?? '', bankName: det?.bankName ?? '', bankAddress: det?.bankAddress ?? '' });
  const [auto, setAuto] = useState(false);
  const [file, setFile] = useState<{ busy: boolean; name: string | null; error: string | null }>({ busy: false, name: det?.bankConfirmation ? '✓' : null, error: null });
  const set = <K extends keyof typeof f>(k: K, v: string) => setF((x) => ({ ...x, [k]: v }));
  const raw = f.iban.replace(/\s+/g, '').toUpperCase();
  const ibanState = raw.length < 15 ? 'typing' : validIban(raw) ? 'ok' : 'bad';
  const onIban = (v: string) => {
    set('iban', v.toUpperCase());
    const hit = validIban(v) ? bankFromIban(v) : null;
    if (hit) {
      setF((x) => ({ ...x, iban: v.toUpperCase(), bic: hit.bic, bankName: x.bankName && !auto ? x.bankName : hit.name }));
      setAuto(true);
    }
  };
  const body = () => ({ ...f, iban: raw, bankAddress: f.bankAddress || null });
  const save = useAction(() => api.post('/agents/me/setup/bank', body()), {
    onDone: () => qc.refetchQueries({ queryKey: ['agents', 'setup', 'me'] }).then(onNext),
  });
  const later = useAction(() => api.post('/agents/me/setup/draft', body()), { onDone: saved });
  async function upload(fl: File) {
    setFile({ busy: true, name: null, error: null });
    try {
      const fd = new FormData();
      fd.append('file', fl);
      const r = await api.post<{ fileName: string }>('/agents/me/setup/bank-confirmation', fd);
      setFile({ busy: false, name: r.fileName, error: null });
    } catch (e) {
      setFile({ busy: false, name: null, error: errorText(e) });
    }
  }
  const fe = save.fields;
  return (
    <Card>
      <div className={s.form}>
        <div>
          <h2 style={{ margin: 0, font: '400 20px/26px var(--font-sans)' }}>
            {t('setup.bank.title')}
          </h2>
          <p className={s.muted} style={{ margin: 'var(--space-1) 0 0' }}>
            {t('setup.bank.lead')}
          </p>
        </div>
        <TextField label={t('setup.bank.holder')} help={t('setup.bank.holderHelp')} value={f.accountHolder} disabled={locked} onChange={(e) => set('accountHolder', e.target.value)} error={fe.accountHolder} />
        <TextField
          label={t('setup.bank.iban')}
          value={f.iban}
          disabled={locked}
          dir="ltr"
          onChange={(e) => onIban(e.target.value)}
          onBlur={() => set('iban', groupIban(f.iban))}
          error={fe.iban ?? (ibanState === 'bad' ? t('setup.bank.ibanBad') : undefined)}
          help={ibanState === 'ok' ? `${t('setup.bank.ibanOk')}${auto ? `; ${t('setup.bank.bicFilled')}` : '.'}` : t('setup.bank.ibanHelp')}
        />
        <div className={s.two}>
          <TextField label={t('setup.bank.bic')} placeholder={t('setup.bank.bicPh')} value={f.bic} disabled={locked} dir="ltr" onChange={(e) => (set('bic', e.target.value.toUpperCase()), setAuto(false))} error={fe.bic} />
          <TextField label={t('setup.bank.bankName')} help={auto ? t('setup.bank.fromIban') : undefined} value={f.bankName} disabled={locked} onChange={(e) => set('bankName', e.target.value)} error={fe.bankName} />
        </div>
        <TextField label={`${t('setup.bank.bankAddress')} ${t('setup.optional')}`} placeholder={t('setup.bank.bankAddressPh')} help={t('setup.bank.bankAddressHelp')} value={f.bankAddress} disabled={locked} onChange={(e) => set('bankAddress', e.target.value)} />
        <TextField label={t('setup.bank.currency')} value={t('setup.bank.eur')} help={t('setup.bank.eurHelp')} readOnly />
        <div className="an-field">
          <label>
            {t('setup.bank.confirmation')} <span className={s.help}>{t('setup.optional')}</span>
          </label>
          <span className={s.help}>{t('setup.bank.confirmationHelp')}</span>
          {!locked && <FileDrop label={t('setup.bank.drop')} busy={file.busy} fileName={file.name === '✓' ? null : file.name} onFile={upload} error={file.error} />}
          {file.name === '✓' && (
            <a className="link body-sm" href={`/api/agents/${d.agent.id}/setup/files/${det?.bankConfirmation}`} target="_blank" rel="noreferrer">
              {t('countersign.openConfirmation')}
            </a>
          )}
        </div>
        <ActionError action={save} />
        <div className={s.btns}>
          <Button onClick={onBack}>{t('setup.bank.back')}</Button>
          {!locked && (
            <Button busy={later.busy} onClick={() => later.mutate(undefined)}>
              {t('setup.later')}
            </Button>
          )}
          <Button variant="primary" busy={save.busy} disabled={!locked && ibanState === 'bad'} onClick={() => (locked ? onNext() : save.mutate(undefined))}>
            {t('setup.bank.continue')}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function ContractStep({ d, onBack, onDone }: { d: AgentSetup; onBack: () => void; onDone: () => void }) {
  const t = useTranslations('agents');
  const { unit } = useFmt();
  const qc = useQueryClient();
  const [method, setMethod] = useState<'app' | 'paper'>('app');
  const [name, setName] = useState('');
  const [agree, setAgree] = useState(false);
  const [scan, setScan] = useState<File | null>(null);
  const company = d.details?.companyName ?? d.agent.name;
  const signer = d.details?.managerName ?? d.agent.name;
  const after = () => qc.refetchQueries({ queryKey: ['agents', 'setup', 'me'] }).then(onDone);
  const signApp = useAction(() => api.post('/agents/me/setup/sign', { name: name.trim(), agree }), { onDone: after });
  const signPaper = useAction(
    () => {
      const fd = new FormData();
      fd.append('agree', 'true');
      if (scan) fd.append('file', scan);
      return api.post('/agents/me/setup/sign-paper', fd);
    },
    { onDone: after },
  );
  const act = method === 'app' ? signApp : signPaper;
  const ready = agree && (method === 'app' ? !!name.trim() : !!scan);
  const href = `/api/agents/${d.agent.id}/agreement`;
  return (
    <Card>
      <div className={s.form}>
        <div>
          <h2 style={{ margin: 0, font: '400 20px/26px var(--font-sans)' }}>
            {t('setup.contract.title')}
          </h2>
          <p className={s.muted} style={{ margin: 'var(--space-1) 0 0' }}>
            {t('setup.contract.lead')}
          </p>
        </div>
        <div className={s.box}>
          <div className={s.doc} style={{ borderTop: 0, paddingTop: 0 }}>
            <span className={s.ico}>
              <Icon as={FileText} />
            </span>
            <span>
              <b>{t('setup.contract.agreement')}</b>
              <span>{t('setup.contract.version', { v: d.agreement.version })}</span>
            </span>
            <a className="an-btn secondary sm" href={href} target="_blank" rel="noreferrer">
              {t('setup.contract.read')}
            </a>
          </div>
          <div className={s.tot}>
            <span>{t('setup.contract.commission')}</span>
            <span>{t('setup.contract.commissionValue', { perUnit: unit(d.terms.commissionPerUnitCents) })}</span>
          </div>
          <div className={s.tot}>
            <span>{t('setup.contract.paidOut')}</span>
            <span>{t('setup.contract.paidOutValue')}</span>
          </div>
          <div className={s.tot}>
            <span>{t('setup.contract.customers')}</span>
            <span>{t('setup.contract.customersValue', { months: d.terms.ownershipMonths })}</span>
          </div>
        </div>
        <div className="an-field">
          <label>{t('setup.contract.how')}</label>
          <div className={s.choice}>
            <label className={`${s.opt} ${method === 'app' ? s.on : ''}`}>
              <input type="radio" name="how" checked={method === 'app'} onChange={() => setMethod('app')} />
              <span>
                <span className={s.t}>
                  {t('setup.contract.digital')} <Pill tone="good">{t('setup.contract.fastest')}</Pill>
                </span>
                <span className={s.s}>{t('setup.contract.digitalText')}</span>
              </span>
            </label>
            <label className={`${s.opt} ${method === 'paper' ? s.on : ''}`}>
              <input type="radio" name="how" checked={method === 'paper'} onChange={() => setMethod('paper')} />
              <span>
                <span className={s.t}>{t('setup.contract.paper')}</span>
                <span className={s.s}>{t('setup.contract.paperText')}</span>
              </span>
            </label>
          </div>
        </div>
        {method === 'app' ? (
          <TextField label={t('setup.contract.typeName')} help={t('setup.contract.typeNameHelp', { name: signer })} value={name} onChange={(e) => setName(e.target.value)} error={signApp.fields.name} autoComplete="name" />
        ) : (
          <>
            <a className="an-btn secondary" href={href} target="_blank" rel="noreferrer">
              <Icon as={FileText} /> {t('setup.contract.download')}
            </a>
            <span className={s.help}>{t('setup.contract.paperHint')}</span>
            <div className="an-field">
              <label>{t('setup.contract.upload')}</label>
              <FileDrop label={t('setup.contract.dropSigned')} fileName={scan?.name ?? null} onFile={setScan} error={signPaper.fields.file ?? null} />
            </div>
          </>
        )}
        <label className={s.agree}>
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>{t('setup.contract.agree', { company })}</span>
        </label>
        {!agree && (name || scan) && <span className={s.help}>{t('setup.contract.tickFirst')}</span>}
        {!signApp.fields.name && <ActionError action={act} />}
        <div className={s.btns}>
          <Button onClick={onBack}>{t('setup.contract.back')}</Button>
          <Button variant="primary" icon={Signature} busy={act.busy} disabled={!ready} onClick={() => act.mutate(undefined)}>
            {t('setup.contract.finish')}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function DoneStep({ d, onReview }: { d: AgentSetup; onReview: () => void }) {
  const t = useTranslations('agents');
  const { date } = useFmt();
  const done = d.status === 'done';
  const iban = d.details?.iban ?? '';
  const row = (ok: boolean, icon: typeof Check, title: string, sub: string) => (
    <div className={`${s.check} ${ok ? s.ok : ''}`}>
      <span className={s.c}>
        <Icon as={ok ? Check : icon} size="sm" />
      </span>
      <span>
        {title}
        <span className={s.s}>{sub}</span>
      </span>
    </div>
  );
  return (
    <Card>
      <div className={s.form}>
        <div>
          <span className="overline">{done ? t('setup.done.finishedKicker') : t('setup.done.kicker')}</span>
          <p className={s.muted} style={{ margin: 'var(--space-1) 0 0' }}>
            {done ? t('setup.done.finishedText') : t('setup.done.text')}
          </p>
        </div>
        <div className={s.checks}>
          {row(true, Bank, t('setup.done.iban', { last4: iban.slice(-4) }), t('setup.done.ibanAdded'))}
          {row(true, Signature, t('setup.done.signed'), d.signMethod === 'paper' ? t('setup.done.signedPaper') : t('setup.done.signedApp'))}
          {row(done, Clock, t('setup.done.counter'), done ? t('setup.done.countersigned', { name: d.agreement.countersignedName ?? '', date: date(d.agreement.countersignedAt ?? '') }) : t('setup.done.waiting'))}
        </div>
        {!done && <span className={s.help}>{t('setup.done.note')}</span>}
        <div className={s.btns}>
          {done ? (
            <a className="an-btn secondary" href={`/api/agents/${d.agent.id}/agreement`} target="_blank" rel="noreferrer">
              {t('setup.done.read')}
            </a>
          ) : (
            <Button onClick={onReview}>{t('setup.done.review')}</Button>
          )}
          <Link className="an-btn primary keep" href="/customers">
            {t('setup.done.customers')}
          </Link>
        </div>
      </div>
    </Card>
  );
}

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { Banner, Button, Pill, Select, Sheet, TextArea, TextField, Segmented } from '@/components/ui';

interface VatResult {
  checked: boolean;
  valid: boolean | null;
  vatNumber: string;
  companyName: string | null;
  address: string | null;
  duplicates: { id: string; companyName: string; vatNumber: string; status: string; agentName: string | null }[];
}

const COUNTRIES = ['BG', 'RO', 'GR', 'DE', 'AT', 'IT', 'FR', 'NL', 'PL', 'CZ', 'HU', 'IL', 'OTHER'];

/** VAT number first with a VIES check that fills the company and address (FR-CUST-2). */
export function NewCustomerSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const t = useTranslations('customers');
  const tc = useTranslations('common');
  const { isAgent } = useSession();
  const [country, setCountry] = useState('BG');
  const [vat, setVat] = useState('');
  const [check, setCheck] = useState<VatResult | null>(null);
  const [f, setF] = useState({ companyName: '', registeredAddress: '', deliveryAddress: '', city: '', contactName: '', phone: '', invoiceEmail: '', note: '', paymentTermsDays: 7, agentId: '' });
  const [lang, setLang] = useState<'bg' | 'en'>('bg');
  const agents = useQuery({ queryKey: ['agents-list'], queryFn: () => api.get<{ id: string; name: string }[]>('/customers/agents'), enabled: !isAgent && open });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: k === 'paymentTermsDays' ? Number(e.target.value) : e.target.value });

  const vies = useAction(() => api.post<VatResult>('/customers/vat-check', { country, vatNumber: vat }), {
    onDone: (r) => {
      setCheck(r);
      setF((x) => ({ ...x, companyName: r.companyName ?? x.companyName, registeredAddress: r.address ?? x.registeredAddress }));
    },
  });
  const create = useAction(
    (submit: boolean) =>
      api.post<{ id: string; status: string }>('/customers', {
        ...f,
        agentId: f.agentId || undefined,
        deliveryAddress: f.deliveryAddress || undefined,
        city: f.city || undefined,
        note: f.note || undefined,
        country,
        vatNumber: check?.vatNumber ?? vat,
        vatValid: check?.checked ? check.valid : null,
        proformaLanguage: lang,
        submit,
      }),
    {
      success: (r) => (r.status === 'needs_approval' ? t('new.sent') : r.status === 'draft' ? t('new.draftSaved') : t('new.created')),
      onDone: (r) => onCreated(r.id),
    },
  );
  const exactDuplicate = check?.duplicates.some((d) => d.status !== 'declined');
  const ready = vat.trim() && f.companyName && f.registeredAddress && f.contactName && f.phone && f.invoiceEmail && !exactDuplicate;
  const fe = create.fields;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('new.title')}
      dirty={!!vat}
      footer={
        <>
          {isAgent ? (
            <Button onClick={() => create.mutate(false)} busy={create.isPending && create.variables === false}>
              {tc('saveDraft')}
            </Button>
          ) : (
            <Button onClick={onClose}>{tc('cancel')}</Button>
          )}
          <Button variant="primary" disabled={!ready} onClick={() => create.mutate(true)} busy={create.isPending && create.variables === true}>
            {isAgent ? t('new.sendForApproval') : t('new.add')}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Select label={t('fields.country')} value={country} onChange={(e) => { setCountry(e.target.value); setCheck(null); }} options={COUNTRIES.map((c) => ({ value: c, label: t.has(`countries.${c}`) ? t(`countries.${c}`) : c }))} />
        <div className="an-field">
          <TextField label={t('fields.vat')} value={vat} onChange={(e) => { setVat(e.target.value); setCheck(null); }} error={fe.vatNumber} placeholder="BG123456789" />
        </div>
      </div>
      <Button size="sm" onClick={() => vies.mutate(undefined)} busy={vies.isPending} disabled={vat.trim().length < 5}>
        {t('new.check')}
      </Button>
      {check && (
        <div className="row wrap">
          {check.checked ? <Pill tone={check.valid ? 'good' : 'bad'}>{check.valid ? t('new.viesValid') : t('new.viesInvalid')}</Pill> : <Pill tone="warn">{t('new.viesDown')}</Pill>}
          {check.duplicates.length === 0 && <span className="body-sm good">{t('new.noDuplicate')}</span>}
        </div>
      )}
      {check && check.duplicates.length > 0 && (
        <Banner tone="bad" sub={check.duplicates.map((d) => `${d.companyName} · ${d.vatNumber}${d.agentName ? ` · ${d.agentName}` : ''}`).join(', ')}>
          {t('new.duplicate')}
        </Banner>
      )}
      <TextField label={t('fields.company')} value={f.companyName} onChange={set('companyName')} error={fe.companyName} />
      <TextArea label={t('fields.registeredAddress')} value={f.registeredAddress} onChange={set('registeredAddress')} rows={2} style={{ minHeight: 64 }} error={fe.registeredAddress} />
      <div className="form-grid">
        <TextField label={t('fields.city')} value={f.city} onChange={set('city')} />
        <TextField label={t('fields.deliveryAddress')} value={f.deliveryAddress} onChange={set('deliveryAddress')} help={t('fields.deliveryHelp')} />
        <TextField label={t('fields.contact')} value={f.contactName} onChange={set('contactName')} error={fe.contactName} />
        <TextField label={t('fields.phone')} type="tel" value={f.phone} onChange={set('phone')} error={fe.phone} />
      </div>
      <TextField label={t('fields.invoiceEmail')} type="email" value={f.invoiceEmail} onChange={set('invoiceEmail')} error={fe.invoiceEmail} />
      <div className="an-field">
        <label>{t('fields.proformaLanguage')}</label>
        <Segmented fill value={lang} onChange={setLang} options={[{ value: 'bg', label: 'Български' }, { value: 'en', label: 'English' }]} label={t('fields.proformaLanguage')} />
      </div>
      {!isAgent && (
        <div className="form-grid">
          <Select label={tc('agent')} value={f.agentId} onChange={set('agentId')} options={[{ value: '', label: tc('none') }, ...(agents.data ?? []).map((a) => ({ value: a.id, label: a.name }))]} />
          <TextField label={t('fields.terms')} type="number" min={0} max={120} value={f.paymentTermsDays} onChange={set('paymentTermsDays')} />
        </div>
      )}
      <TextArea label={tc('noteOptional')} value={f.note} onChange={set('note')} help={isAgent ? t('new.noteHelp') : undefined} />
      {(create.errorText || vies.errorText) && <Banner tone="bad">{create.errorText || vies.errorText}</Banner>}
    </Sheet>
  );
}

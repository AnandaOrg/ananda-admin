'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Flavour } from '@ananda/shared';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { Banner, Button, Segmented, Sheet, TextField } from '@/components/ui';
import { FlavourToggles } from '../_components/FlavourToggles';
import type { Supplier } from '../_lib/types';

type Status = Supplier['status'];

/** FR-PUR-3 New supplier / Edit supplier. Making it the default for a flavour moves the default. */
export function SupplierSheet({ open, supplier, all, onClose }: { open: boolean; supplier: Supplier | null; all: Supplier[]; onClose: () => void }) {
  const t = useTranslations('purchasing');
  const tc = useTranslations('common');
  const [company, setCompany] = useState('');
  const [country, setCountry] = useState('');
  const [vatNumber, setVatNumber] = useState('');
  const [contactName, setContactName] = useState('');
  const [ordersEmail, setOrdersEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [approved, setApproved] = useState<Flavour[]>([]);
  const [defaults, setDefaults] = useState<Flavour[]>([]);
  const [lead, setLead] = useState('30');
  const [terms, setTerms] = useState('30');
  const [price, setPrice] = useState('');
  const [status, setStatus] = useState<Status>('approved');

  useEffect(() => {
    if (!open) return;
    const s = supplier;
    setCompany(s?.company ?? '');
    setCountry(s?.country ?? '');
    setVatNumber(s?.vatNumber ?? '');
    setContactName(s?.contactName ?? '');
    setOrdersEmail(s?.ordersEmail ?? '');
    setPhone(s?.phone ?? '');
    setApproved(s?.approvedFlavours ?? []);
    setDefaults(s?.defaultFlavours ?? []);
    setLead(String(s?.leadTimeDays ?? 30));
    setTerms(String(s?.paymentTermsDays ?? 30));
    setPrice(s ? String(s.unitPriceCents / 100) : '');
    setStatus(s?.status ?? 'approved');
  }, [open, supplier]);

  const priceCents = Math.round(parseFloat(price.replace(',', '.')) * 1_000_000) / 10_000;
  const body = {
    company: company.trim(),
    country: country.trim().toUpperCase(),
    vatNumber: vatNumber.trim() || undefined,
    contactName: contactName.trim() || undefined,
    ordersEmail: ordersEmail.trim(),
    phone: phone.trim() || undefined,
    approvedFlavours: approved,
    defaultFlavours: status === 'approved' ? defaults.filter((f) => approved.includes(f)) : [],
    leadTimeDays: parseInt(lead, 10) || 0,
    paymentTermsDays: parseInt(terms, 10) || 0,
    unitPriceCents: Number.isFinite(priceCents) ? priceCents : 0,
    status,
  };
  const save = useAction(() => (supplier ? api.patch(`/suppliers/${supplier.id}`, body) : api.post('/suppliers', body)), {
    success: supplier ? t('suppliers.saved', { name: body.company }) : t('suppliers.created', { name: body.company }),
    onDone: onClose,
  });

  const moves = body.defaultFlavours
    .map((f) => ({ f, from: all.find((s) => s.id !== supplier?.id && s.defaultFlavours.includes(f)) }))
    .filter((m) => m.from);
  const ready = body.company && body.country.length === 2 && body.ordersEmail && approved.length > 0 && Number.isFinite(priceCents);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={supplier ? t('suppliers.edit') : t('suppliers.new')}
      sub={supplier ? <bdi>{supplier.company}</bdi> : undefined}
      dirty
      footer={
        <>
          <Button onClick={onClose}>{tc('cancel')}</Button>
          <Button variant="primary" disabled={!ready} busy={save.isPending} onClick={() => save.mutate(undefined)}>
            {supplier ? tc('save') : t('suppliers.createCta')}
          </Button>
        </>
      }
    >
      <TextField label={t('suppliers.form.company')} value={company} onChange={(e) => setCompany(e.target.value)} error={save.fields.company} />
      <div className="form-grid">
        <TextField label={t('suppliers.form.country')} value={country} maxLength={2} onChange={(e) => setCountry(e.target.value.toUpperCase())} error={save.fields.country} placeholder={t('suppliers.form.countryHelp')} />
        <TextField label={t('suppliers.form.vat')} value={vatNumber} onChange={(e) => setVatNumber(e.target.value)} error={save.fields.vatNumber} />
      </div>
      <TextField label={t('suppliers.form.contact')} value={contactName} onChange={(e) => setContactName(e.target.value)} />
      <div className="form-grid">
        <TextField label={t('suppliers.form.ordersEmail')} type="email" value={ordersEmail} onChange={(e) => setOrdersEmail(e.target.value)} error={save.fields.ordersEmail} />
        <TextField label={t('suppliers.form.phone')} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      <FlavourToggles label={t('suppliers.form.approved')} value={approved} onChange={(v) => { setApproved(v); setDefaults(defaults.filter((f) => v.includes(f))); }} error={save.fields.approvedFlavours} />
      {status === 'approved' && approved.length > 0 && (
        <FlavourToggles label={t('suppliers.form.defaults')} value={defaults} onChange={setDefaults} only={approved} help={t('suppliers.form.defaultsHelp')} error={save.fields.defaultFlavours} />
      )}
      {moves.length > 0 && (
        <Banner>
          {moves.map((m) => t('suppliers.form.moves', { flavour: m.f.toUpperCase(), from: m.from!.company })).join(' ')}
        </Banner>
      )}
      <div className="form-grid">
        <TextField label={t('suppliers.form.leadTime')} inputMode="numeric" value={lead} onChange={(e) => setLead(e.target.value.replace(/\D/g, ''))} error={save.fields.leadTimeDays} />
        <TextField label={t('suppliers.form.terms')} inputMode="numeric" value={terms} onChange={(e) => setTerms(e.target.value.replace(/\D/g, ''))} error={save.fields.paymentTermsDays} />
      </div>
      <TextField label={t('suppliers.form.price')} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} error={save.fields.unitPriceCents} help={t('suppliers.form.priceHelp')} />
      <div className="an-field">
        <label>{tc('status')}</label>
        <Segmented fill label={tc('status')} value={status} onChange={setStatus} options={(['approved', 'pending', 'inactive'] as Status[]).map((s) => ({ value: s, label: t(`suppliers.status.${s}`) }))} />
        {status !== 'approved' && <span className="an-help">{t('suppliers.form.notApprovedHelp')}</span>}
      </div>
      {save.errorText && !Object.keys(save.fields).length && <Banner tone="bad">{save.errorText}</Banner>}
    </Sheet>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { isoDate } from '@ananda/shared';
import { api } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { Banner, Button, MoneyField, Select, Sheet, TextField, Totals, TwoStepField } from '@/components/ui';
import { FilePick } from './FilePick';
import { useKindLabel } from './PurchaseStatus';
import { formWith, type Payable } from '../_lib/types';

/**
 * FR-PUR-4 Record payment. A smaller amount than what is left records a part payment.
 * Needs a fresh two-step code (record_supplier_payment).
 */
export function RecordPaymentSheet({ payable, accounts, onClose }: { payable: Payable | null; accounts?: string[]; onClose: () => void }) {
  const t = useTranslations('purchasing');
  const tc = useTranslations('common');
  const { money, date } = useFmt();
  const kind = useKindLabel();
  const [paidOn, setPaidOn] = useState(isoDate());
  const [amountCents, setAmountCents] = useState<number | null>(null);
  const [paidFrom, setPaidFrom] = useState('');
  const [bankReference, setBankReference] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [code, setCode] = useState('');
  const list = useQuery({ queryKey: ['payables', 'accounts'], queryFn: () => api.get<{ accounts: string[] }>('/payables/accounts'), enabled: !!payable && !accounts });
  const options = accounts ?? list.data?.accounts ?? [];

  useEffect(() => {
    if (!payable) return;
    setPaidOn(isoDate());
    setAmountCents(payable.stillToPayCents);
    setBankReference('');
    setFile(null);
    setCode('');
  }, [payable]);
  useEffect(() => {
    if (!paidFrom && options.length) setPaidFrom(options[0]);
  }, [options, paidFrom]);

  const pay = useAction(
    () => api.post<{ part: boolean; stillToPayCents: number }>(`/payables/${payable!.id}/payments`, formWith({ paidOn, amountCents, paidFrom, bankReference: bankReference || undefined }, { file }), { code }),
    { success: (r) => (r.part ? t('pay.donePart', { amount: money(r.stillToPayCents) }) : t('pay.done')), onDone: onClose },
  );

  if (!payable) return null;
  const part = amountCents != null && amountCents > 0 && amountCents < payable.stillToPayCents;
  const codeError = pay.error?.code === 'step_up_invalid' || pay.error?.code === 'step_up_required' ? pay.errorText ?? undefined : undefined;

  return (
    <Sheet
      open
      onClose={onClose}
      title={t('pay.title')}
      sub={
        <>
          <bdi>{payable.party}</bdi> · {kind(payable.kind)}
          {payable.invoiceNumber && (
            <>
              {' '}
              · <bdi>{payable.invoiceNumber}</bdi>
            </>
          )}
        </>
      }
      dirty
      footer={
        <>
          <Button onClick={onClose}>{tc('cancel')}</Button>
          <Button variant="primary" disabled={code.length !== 6 || !amountCents || !paidFrom} busy={pay.isPending} onClick={() => pay.mutate(undefined)}>
            {part ? t('pay.ctaPart') : t('pay.cta')}
          </Button>
        </>
      }
    >
      <Totals
        lines={[
          [t('pay.payable'), money(payable.amountCents)],
          [t('pay.paid'), money(payable.paidCents)],
          [t('pay.due'), date(payable.dueOn)],
        ]}
        big={[t('pay.stillToPay'), money(payable.stillToPayCents)]}
      />
      <TextField label={t('pay.paidOn')} type="date" value={paidOn} max={isoDate()} onChange={(e) => setPaidOn(e.target.value)} error={pay.fields.paidOn} />
      <MoneyField key={payable.id} label={tc('amount')} cents={amountCents} onCents={setAmountCents} error={pay.fields.amountCents} help={part ? t('pay.partHelp', { amount: money(payable.stillToPayCents - (amountCents ?? 0)) }) : undefined} />
      {options.length > 0 ? (
        <Select label={t('pay.paidFrom')} value={paidFrom} onChange={(e) => setPaidFrom(e.target.value)} options={options.map((a) => ({ value: a, label: a }))} error={pay.fields.paidFrom} />
      ) : (
        <TextField label={t('pay.paidFrom')} value={paidFrom} onChange={(e) => setPaidFrom(e.target.value)} error={pay.fields.paidFrom} help={t('pay.noAccounts')} />
      )}
      <TextField label={t('pay.reference')} value={bankReference} onChange={(e) => setBankReference(e.target.value)} />
      <FilePick label={t('pay.proof')} file={file} onFile={setFile} />
      <TwoStepField value={code} onChange={setCode} error={codeError} />
      {pay.errorText && !codeError && !Object.keys(pay.fields).length && <Banner tone="bad">{pay.errorText}</Banner>}
    </Sheet>
  );
}

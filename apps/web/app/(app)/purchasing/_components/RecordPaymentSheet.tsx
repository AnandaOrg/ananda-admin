'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { isoDate } from '@ananda/shared';
import { api } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { ActionError, Bank, CodeStep, MoneyField, Select, Sheet, StepUpButtons, TextField, Totals, useStepUp } from '@/components/ui';
import { FilePick } from './FilePick';
import { useKindLabel, useMonthName } from './PurchaseStatus';
import { formWith, type Payable } from '../_lib/types';
import { DateField } from '../../money/_components/date-field';

/**
 * FR-PUR-4 Record payment. A smaller amount than what is left records a part payment.
 * Needs a fresh two-step code (record_supplier_payment).
 */
export function RecordPaymentSheet({ payable, accounts, onClose }: { payable: Payable | null; accounts?: string[]; onClose: () => void }) {
  const t = useTranslations('purchasing');
  const tc = useTranslations('common');
  const { money, date } = useFmt();
  const monthName = useMonthName();
  const kind = useKindLabel();
  const [paidOn, setPaidOn] = useState(isoDate());
  const [amountCents, setAmountCents] = useState<number | null>(null);
  const [paidFrom, setPaidFrom] = useState('');
  const [bankReference, setBankReference] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const list = useQuery({ queryKey: ['payables', 'accounts'], queryFn: () => api.get<{ accounts: string[] }>('/payables/accounts'), enabled: !!payable && !accounts });
  const options = accounts ?? list.data?.accounts ?? [];

  useEffect(() => {
    if (!paidFrom && options.length) setPaidFrom(options[0]);
  }, [options, paidFrom]);

  const pay = useAction(
    (code: string) => api.post<{ part: boolean; stillToPayCents: number }>(`/payables/${payable!.id}/payments`, formWith({ paidOn, amountCents, paidFrom, bankReference: bankReference || undefined }, { file }), { code }),
    { success: (r) => (r.part ? t('pay.donePart', { amount: money(r.stillToPayCents) }) : t('pay.done')), onDone: onClose },
  );
  // Two steps: Record payment, then the two-step code.
  const step = useStepUp(pay);
  const { reset } = step;
  useEffect(() => {
    if (!payable) return;
    setPaidOn(isoDate());
    setAmountCents(payable.stillToPayCents);
    setBankReference('');
    setFile(null);
    reset();
  }, [payable, reset]);

  if (!payable) return null;
  const part = amountCents != null && amountCents > 0 && amountCents < payable.stillToPayCents;

  return (
    <Sheet
      open
      onClose={onClose}
      title={t('pay.title')}
      sub={
        <>
              <bdi>{payable.party}</bdi> · {kind(payable.kind, { month: payable.kind === 'excise' && payable.arrivedOn ? monthName(payable.arrivedOn) : null })}
              {payable.invoiceNumber && (
                <>
                  {' '}
                  · <bdi>{payable.invoiceNumber}</bdi>
                </>
              )}
        </>
      }
      dirty
      footer={<StepUpButtons step={step} block icon={Bank} label={part ? t('pay.ctaPart') : t('pay.cta')} disabled={!amountCents || amountCents <= 0 || !paidFrom.trim()} onSubmit={() => pay.mutate(step.code)} />}
    >
      {step.onCode ? (
        <CodeStep
          step={step}
          summary={
            <Totals
              lines={[
                [t('pay.paidOn'), date(paidOn)],
                [t('pay.paidFrom'), paidFrom],
                ...(bankReference.trim() ? [[t('pay.reference'), bankReference.trim()] as [string, string]] : []),
                ...(part ? [[t('pay.stillToPay'), money(payable.stillToPayCents - (amountCents ?? 0))] as [string, string]] : []),
              ]}
              big={[<bdi key="p">{payable.party}</bdi>, money(amountCents ?? 0)]}
            />
          }
        />
      ) : (
        <>
      <Totals
        lines={[
          [t('pay.payable'), money(payable.amountCents)],
          [t('pay.paid'), money(payable.paidCents)],
          [t('pay.due'), date(payable.dueOn)],
        ]}
        big={[t('pay.stillToPay'), money(payable.stillToPayCents)]}
      />
      <DateField label={t('pay.paidOn')} value={paidOn} max={isoDate()} onChange={setPaidOn} error={pay.fields.paidOn} />
      <MoneyField key={payable.id} label={tc('amount')} cents={amountCents} onCents={setAmountCents} error={pay.fields.amountCents} help={part ? t('pay.partHelp', { amount: money(payable.stillToPayCents - (amountCents ?? 0)) }) : undefined} />
      {options.length > 0 ? (
        <Select label={t('pay.paidFrom')} value={paidFrom} onChange={(e) => setPaidFrom(e.target.value)} options={options.map((a) => ({ value: a, label: a }))} error={pay.fields.paidFrom} />
      ) : (
        <TextField label={t('pay.paidFrom')} value={paidFrom} onChange={(e) => setPaidFrom(e.target.value)} error={pay.fields.paidFrom} help={t('pay.noAccounts')} />
      )}
      <TextField label={t('pay.reference')} value={bankReference} onChange={(e) => setBankReference(e.target.value)} />
      <FilePick label={t('pay.proof')} file={file} onFile={setFile} />
      {step.formError && !Object.keys(pay.fields).length && <ActionError action={pay} />}
        </>
      )}
    </Sheet>
  );
}

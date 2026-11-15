'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { isoDate } from '@ananda/shared';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useFmt } from '@/lib/format';
import { ActionError, Button, MoneyField, Select, Sheet, TextField } from '@/components/ui';
import { DateField } from './date-field';

export interface CashOnHand {
  cents: number;
  asOf: string | null;
  daysOld: number | null;
  accounts: { account: string; balanceOn: string; balanceCents: number }[];
  accountOptions: string[];
}

/** FR-MON-4: record a bank balance (account, date, balance); feeds cash on hand. */
export function BankBalanceSheet({ open, onClose, cash }: { open: boolean; onClose: () => void; cash: CashOnHand | undefined }) {
  const t = useTranslations('money');
  const tc = useTranslations('common');
  const { money, date } = useFmt();
  const options = cash?.accountOptions ?? [];
  const [account, setAccount] = useState('');
  const [balanceOn, setBalanceOn] = useState(isoDate());
  const [cents, setCents] = useState<number | null>(null);
  const [key, setKey] = useState(0);
  useEffect(() => {
    if (open) {
      setAccount(options[0] ?? '');
      setBalanceOn(isoDate());
      setCents(null);
      setKey((k) => k + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const save = useAction((v: { account: string; balanceOn: string; balanceCents: number }) => api.post('/money/bank-balances', v), { success: t('bank.saved'), onDone: onClose });
  const last = cash?.accounts.find((a) => a.account === account);
  const fields = save.fields;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      dirty={cents != null}
      title={t('bank.title')}
      sub={t('bank.sub')}
      footer={
        <>
          <Button onClick={onClose}>{tc('cancel')}</Button>
          <Button variant="primary" busy={save.isPending} disabled={!account || cents == null || !balanceOn} onClick={() => save.mutate({ account: account.trim(), balanceOn, balanceCents: cents ?? 0 })}>
            {t('bank.save')}
          </Button>
        </>
      }
    >
      {!Object.keys(fields).length && <ActionError action={save} />}
      {options.length > 0 ? (
        <Select label={t('bank.account')} value={account} onChange={(e) => setAccount(e.target.value)} options={options.map((a) => ({ value: a, label: a }))} error={fields.account} />
      ) : (
        <TextField label={t('bank.account')} value={account} onChange={(e) => setAccount(e.target.value)} help={t('bank.accountHelp')} error={fields.account} />
      )}
      <DateField label={t('bank.date')} value={balanceOn} max={isoDate()} onChange={setBalanceOn} error={fields.balanceOn} />
      <MoneyField key={key} label={t('bank.balance')} cents={cents} onCents={setCents} help={last ? t('bank.last', { amount: `\u2066${money(last.balanceCents)}\u2069`, date: date(last.balanceOn) }) : t('bank.firstTime')} error={fields.balanceCents} />
    </Sheet>
  );
}

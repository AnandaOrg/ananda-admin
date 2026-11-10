'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { vatOf } from '@ananda/shared';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useFmt } from '@/lib/format';
import { useSession } from '@/lib/session';
import { EmailDraft, type Draft } from '@/components/EmailDraft';
import { MessageDraft } from './MessageDraft';
import { Banner, Button, Select, Sheet, Skeleton, TextField, Totals, TwoStepField } from '@/components/ui';
import type { AgentRow, AgentsOverview, Earnings } from './types';

/** Send to pay (A4) or Mark as paid, both with a two-step code (FR-AGT-3). */
export function PaySheet({ agent, mode, accountingEmail, onClose }: { agent: AgentRow | null; mode: 'send' | 'paid'; accountingEmail: string | null; onClose: () => void }) {
  const t = useTranslations('agents');
  const tc = useTranslations('common');
  const { money, num } = useFmt();
  const [code, setCode] = useState('');
  useEffect(() => setCode(''), [agent?.id, mode]);
  const detail = useQuery({ queryKey: ['agents', 'earnings', agent?.id], queryFn: () => api.get<Earnings>(`/agents/${agent!.id}/earnings`), enabled: !!agent });
  const status = mode === 'send' ? 'ready' : agent && agent.sentCents > 0 ? 'sent' : 'ready';
  const entries = (detail.data?.entries ?? []).filter((e) => e.status === status);
  const sum = entries.reduce((s, e) => s + e.amountCents, 0) || (agent ? (status === 'sent' ? agent.sentCents : agent.readyCents) : 0);
  const act = useAction(() => api.post<{ amountCents: number }>(`/agents/${agent!.id}/${mode === 'send' ? 'send-to-pay' : 'mark-paid'}`, {}, { code }), {
    success: (r) => (mode === 'send' ? t('pay.sent', { amount: money(r.amountCents) }) : t('pay.paid', { name: agent?.name ?? '', amount: money(r.amountCents) })),
    onDone: onClose,
  });
  if (!agent) return null;
  const blocked = mode === 'send' && !accountingEmail;
  return (
    <Sheet
      open
      onClose={onClose}
      title={mode === 'send' ? t('pay.sendTitle') : t('pay.paidTitle')}
      sub={agent.name}
      footer={
        <>
          <Button onClick={onClose}>{tc('cancel')}</Button>
          <Button variant="primary" busy={act.isPending} disabled={code.length !== 6 || blocked || sum <= 0} onClick={() => act.mutate(undefined)}>
            {mode === 'send' ? t('sendToPay') : t('markPaid')}
          </Button>
        </>
      }
    >
      <Totals
        lines={[
          [t('pay.net'), money(sum)],
          [t('pay.vat'), money(vatOf(sum))],
        ]}
        big={[t('pay.total'), money(sum + vatOf(sum))]}
      />
      {detail.isLoading ? (
        <Skeleton h={80} />
      ) : (
        <div className="stack tight">
          <span className="overline">{t('pay.entries', { n: entries.length })}</span>
          <Totals
            lines={entries.map((e) => [
              <span key="k">
                {e.orderId ? <bdi>{e.orderNumber}</bdi> : t('earnings.eventSale')}
                {e.orderId ? e.customerName && ` · ${e.customerName}` : e.eventName && ` · ${e.eventName}`} · {tc('unitsCount', { n: num(e.units) })}
                {e.amountCents < 0 && ` · ${t('pay.offset')}`}
              </span>,
              money(e.amountCents),
            ])}
          />
        </div>
      )}
      <span className="body-sm muted">{mode === 'send' ? (accountingEmail ? t('pay.sendText', { email: accountingEmail }) : t('pay.sendNoEmail')) : t('pay.paidText')}</span>
      <TwoStepField value={code} onChange={setCode} error={act.error?.code?.startsWith('step_up') ? act.errorText ?? undefined : undefined} />
      {act.errorText && !act.error?.code?.startsWith('step_up') && <Banner tone="bad">{act.errorText}</Banner>}
    </Sheet>
  );
}

/** Nudge (FR-AGT-2): a pre-written e-mail with the agent's own figures, editable, tone choices. */
export function NudgeSheet({ agent, onClose }: { agent: AgentRow | null; onClose: () => void }) {
  const t = useTranslations('agents');
  const tc = useTranslations('common');
  const { money, date } = useFmt();
  const { me } = useSession();
  const [draft, setDraft] = useState<Draft>({ subject: '', body: '' });
  useEffect(() => {
    if (!agent) return;
    const first = agent.name.split(' ')[0];
    setDraft({
      subject: t('nudge.subject', { name: first }),
      body: t('nudge.body', {
        name: first,
        lastOrder: agent.lastOrderAt ? t('nudge.bodyLast', { date: date(agent.lastOrderAt) }) : t('nudge.bodyNone'),
        customers: agent.customers,
        ready: money(agent.readyCents),
        coming: money(agent.comingCents),
        sender: me.user.name,
      }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent?.id]);
  const act = useAction(() => api.post(`/agents/${agent!.id}/nudge`, { subject: draft.subject, message: draft.body }), {
    success: () => t('nudge.sent', { name: agent?.name ?? '' }),
    onDone: onClose,
  });
  if (!agent) return null;
  return (
    <Sheet
      open
      onClose={onClose}
      dirty
      title={t('nudge.title', { name: agent.name })}
      footer={
        <>
          <Button onClick={onClose}>{tc('cancel')}</Button>
          <Button variant="primary" busy={act.isPending} disabled={!draft.subject.trim() || !draft.body.trim()} onClick={() => act.mutate(undefined)}>
            {t('nudge.send')}
          </Button>
        </>
      }
    >
      <EmailDraft value={draft} onChange={setDraft} to={agent.email} />
      {(act.fields.subject || act.fields.message) && <span className="an-help error">{act.fields.subject ?? act.fields.message}</span>}
      {act.errorText && <Banner tone="bad">{act.errorText}</Banner>}
    </Sheet>
  );
}

/**
 * Invite new agent (FR-AGT-4): name, e-mail and an editable invitation stating the commission
 * terms and the 7-day link. The user, token and e-mail are created by POST /users/invite.
 */
export function InviteSheet({ open, terms, onClose }: { open: boolean; terms: AgentsOverview['terms'] | undefined; onClose: () => void }) {
  const t = useTranslations('agents');
  const tc = useTranslations('common');
  const { unit } = useFmt();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [language, setLanguage] = useState<'en' | 'bg' | 'he'>('bg');
  const [message, setMessage] = useState('');
  const make = () => t('inviteSheet.body', { perUnit: unit(terms?.commissionPerUnitCents ?? 50), days: terms?.inviteValidityDays ?? 7 });
  useEffect(() => {
    if (!open) return;
    setName('');
    setEmail('');
    setLanguage('bg');
    setMessage(make());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const act = useAction(() => api.post<{ id: string }>('/users/invite', { name: name.trim(), email: email.trim(), language, roleKey: 'agent', message }), {
    success: () => t('inviteSheet.sent', { email: email.trim() }),
    onDone: onClose,
  });
  if (!open) return null;
  return (
    <Sheet
      open
      onClose={onClose}
      dirty={!!(name || email)}
      title={t('inviteSheet.title')}
      footer={
        <>
          <Button onClick={onClose}>{tc('cancel')}</Button>
          <Button variant="primary" busy={act.isPending} disabled={!name.trim() || !email.includes('@') || !message.trim()} onClick={() => act.mutate(undefined)}>
            {t('inviteSheet.send')}
          </Button>
        </>
      }
    >
      <TextField label={t('inviteSheet.name')} value={name} onChange={(e) => setName(e.target.value)} error={act.fields.name} autoComplete="off" />
      <TextField label={t('inviteSheet.email')} type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={act.fields.email} autoComplete="off" />
      <Select
        label={t('inviteSheet.language')}
        help={t('inviteSheet.languageHelp')}
        value={language}
        onChange={(e) => setLanguage(e.target.value as 'en' | 'bg' | 'he')}
        options={(['bg', 'en', 'he'] as const).map((l) => ({ value: l, label: t(`inviteSheet.languages.${l}`) }))}
      />
      <MessageDraft label={t('inviteSheet.draft')} help={t('inviteSheet.draftHelp')} value={message} onChange={setMessage} language={language} />
      {act.fields.message && <span className="an-help error">{act.fields.message}</span>}
      {act.errorText && !act.fields.name && !act.fields.email && <Banner tone="bad">{act.errorText}</Banner>}
    </Sheet>
  );
}

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { vatOf } from '@ananda/shared';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useFmt } from '@/lib/format';
import { useSession } from '@/lib/session';
import { ActionError, Bank, Button, CaretRight, EnvelopeSimple, FileText, Icon, Pill, Sheet, Signature, Skeleton, TextField, TwoStepField, Users } from '@/components/ui';
import { PolishableText } from './MailDraft';
import type { AgentDetail, AgentRow, AgentSetup, AgentsOverview, Earnings } from './types';
import s from '../agents.module.css';

const first = (name: string) => name.trim().split(/\s+/)[0];

/** Send to pay (A4): what the accountant gets, with the agent's bank details (two-step code). */
export function SendToPaySheet({ agent, accountingEmail, perUnitCents, onClose }: { agent: AgentRow | null; accountingEmail: string | null; perUnitCents: number; onClose: () => void }) {
  const t = useTranslations('agents');
  const { money, unit } = useFmt();
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => {
    setCode('');
    setNote('');
  }, [agent?.id]);
  const act = useAction(() => api.post<{ amountCents: number }>(`/agents/${agent!.id}/send-to-pay`, { note: note.trim() || undefined }, { code }), {
    success: () => t('pay.sent', { name: first(agent?.name ?? '') }),
    onDone: onClose,
  });
  if (!agent) return null;
  const sum = agent.readyCents;
  const vat = vatOf(sum);
  return (
    <Sheet
      open
      onClose={onClose}
      title={t('pay.sendTitle', { name: first(agent.name) })}
      sub={t('pay.sendSub', { name: first(agent.name) })}
      footer={
        <Button variant="primary" block icon={EnvelopeSimple} busy={act.busy} disabled={code.length !== 6 || !accountingEmail || sum <= 0} onClick={() => act.mutate(undefined)}>
          {t('pay.send')}
        </Button>
      }
    >
      <TextField label={t('pay.to')} value={accountingEmail ?? t('pay.noEmail')} readOnly />
      <div className={s.box}>
        <div className={s.tot}>
          <span>{t('pay.agent')}</span>
          <span>{agent.name}</span>
        </div>
        <div className={s.tot}>
          <span>{t('pay.commission')}</span>
          <bdi>{money(sum)}</bdi>
        </div>
        <div className={s.tot}>
          <span>{t('pay.vat')}</span>
          <bdi>{money(vat)}</bdi>
        </div>
        <div className={s.rule} />
        <div className={`${s.tot} ${s.big}`}>
          <span>{t('pay.toPay')}</span>
          <bdi>{money(sum + vat)}</bdi>
        </div>
      </div>
      <div>
        <div className={s.sgrp}>{t('pay.attached')}</div>
        <div className={s.doc}>
          <span className={s.ico}>
            <Icon as={FileText} />
          </span>
          <span>
            <b>{t('pay.statement', { name: agent.name })}</b>
            <span>{t('pay.statementSub', { perUnit: unit(perUnitCents) })}</span>
          </span>
        </div>
        <div className={s.doc}>
          <span className={s.ico}>
            <Icon as={Bank} />
          </span>
          <span>
            <b>{t('pay.bank')}</b>
            <span>{agent.bank ? <bdi>{t('pay.bankSub', { holder: agent.bank.accountHolder ?? agent.name, iban: agent.bank.iban })}</bdi> : t('pay.noBank')}</span>
          </span>
        </div>
      </div>
      <TextField label={t('pay.note')} placeholder={t('pay.notePh')} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
      <TwoStepField value={code} onChange={setCode} error={act.error?.code?.startsWith('step_up') ? (act.errorText ?? undefined) : undefined} />
      {!act.error?.code?.startsWith('step_up') && <ActionError action={act} />}
    </Sheet>
  );
}

/** Mark as paid: closes Sent (or Ready) entries once the money has left the bank (two-step code). */
export function MarkPaidSheet({ agent, onClose }: { agent: AgentRow | null; onClose: () => void }) {
  const t = useTranslations('agents');
  const tc = useTranslations('common');
  const { money, num } = useFmt();
  const [code, setCode] = useState('');
  useEffect(() => setCode(''), [agent?.id]);
  const detail = useQuery({ queryKey: ['agents', 'earnings', agent?.id], queryFn: () => api.get<Earnings>(`/agents/${agent!.id}/earnings`), enabled: !!agent });
  const act = useAction(() => api.post<{ amountCents: number }>(`/agents/${agent!.id}/mark-paid`, {}, { code }), {
    success: (r) => t('pay.paid', { name: agent?.name ?? '', amount: money(r.amountCents) }),
    onDone: onClose,
  });
  if (!agent) return null;
  const status = agent.sentCents > 0 ? 'sent' : 'ready';
  const entries = (detail.data?.entries ?? []).filter((e) => e.status === status);
  const sum = status === 'sent' ? agent.sentCents : agent.readyCents;
  return (
    <Sheet
      open
      onClose={onClose}
      title={t('pay.paidTitle', { name: first(agent.name) })}
      sub={t('pay.paidText', { name: first(agent.name) })}
      footer={
        <Button variant="primary" block busy={act.busy} disabled={code.length !== 6 || sum <= 0} onClick={() => act.mutate(undefined)}>
          {t('markPaid')}
        </Button>
      }
    >
      <div className={s.box}>
        <div className={s.tot}>
          <span>{t('pay.commission')}</span>
          <bdi>{money(sum)}</bdi>
        </div>
        <div className={s.tot}>
          <span>{t('pay.vat')}</span>
          <bdi>{money(vatOf(sum))}</bdi>
        </div>
        <div className={s.rule} />
        <div className={`${s.tot} ${s.big}`}>
          <span>{t('pay.toPay')}</span>
          <bdi>{money(sum + vatOf(sum))}</bdi>
        </div>
      </div>
      {detail.isLoading ? (
        <Skeleton h={80} />
      ) : (
        <div>
          <div className={s.sgrp}>{t('pay.entries', { n: entries.length })}</div>
          {entries.map((e) => (
            <div key={e.id} className={s.tot} style={{ paddingBlock: 'var(--space-1)' }}>
              <span>
                {e.orderId ? <bdi>{e.orderNumber}</bdi> : t('pay.eventSale')}
                {e.orderId ? e.customerName && ` · ${e.customerName}` : e.eventName && ` · ${e.eventName}`} · {tc('unitsCount', { n: num(e.units) })}
                {e.amountCents < 0 && ` · ${t('pay.offset')}`}
              </span>
              <bdi>{money(e.amountCents)}</bdi>
            </div>
          ))}
        </div>
      )}
      <TwoStepField value={code} onChange={setCode} error={act.error?.code?.startsWith('step_up') ? (act.errorText ?? undefined) : undefined} />
      {!act.error?.code?.startsWith('step_up') && <ActionError action={act} />}
    </Sheet>
  );
}

/** New e-mail to an agent: the nudge (FR-AGT-2) or a plain e-mail from the agent panel. */
export function MailSheet({ agent, kind, onClose }: { agent: AgentRow | null; kind: 'nudge' | 'email'; onClose: () => void }) {
  const t = useTranslations('agents');
  const { me } = useSession();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  useEffect(() => {
    if (!agent) return;
    const v = { name: first(agent.name), sender: first(me.user.name) };
    setSubject(kind === 'nudge' ? t('mail.nudgeSubject') : t('mail.emailSubject'));
    setBody(kind === 'nudge' ? t('mail.nudgeBody', v) : t('mail.emailBody', v));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent?.id, kind]);
  const act = useAction(() => api.post(`/agents/${agent!.id}/${kind === 'nudge' ? 'nudge' : 'email'}`, { subject, message: body }), {
    success: () => t('mail.sent', { name: agent?.name ?? '' }),
    onDone: onClose,
  });
  if (!agent) return null;
  return (
    <Sheet
      open
      onClose={onClose}
      dirty
      title={t('mail.title')}
      footer={
        <div className={s.btns} style={{ width: '100%' }}>
          <Button onClick={onClose}>{t('mail.discard')}</Button>
          <Button variant="primary" icon={EnvelopeSimple} busy={act.busy} disabled={!subject.trim() || !body.trim()} onClick={() => act.mutate(undefined)}>
            {t('mail.send')}
          </Button>
        </div>
      }
    >
      <TextField label={t('mail.to')} value={`${agent.name} · ${agent.email}`} readOnly />
      <TextField label={t('mail.subject')} value={subject} onChange={(e) => setSubject(e.target.value)} error={act.fields.subject} />
      <PolishableText label={t('mail.message')} value={body} onChange={setBody} rows={6} />
      <span className="caption muted">{t('mail.aiHelp')}</span>
      <span className="caption muted">{t('mail.sentFrom')}</span>
      {act.fields.message && <span className="an-help error">{act.fields.message}</span>}
      <ActionError action={act} />
    </Sheet>
  );
}

/**
 * Invite new agent (FR-AGT-4): name, e-mail and the whole invitation e-mail with AI polish. The
 * set-password link is added at the end; after it the agent fills in the set-up and signs.
 */
export function InviteSheet({ open, terms, onClose }: { open: boolean; terms: AgentsOverview['terms'] | undefined; onClose: () => void }) {
  const t = useTranslations('agents');
  const locale = useLocale();
  const { unit } = useFmt();
  const { me } = useSession();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [letter, setLetter] = useState('');
  const make = () => t('inviteSheet.body', { perUnit: unit(terms?.commissionPerUnitCents ?? 50), days: terms?.inviteValidityDays ?? 7, sender: first(me.user.name) });
  useEffect(() => {
    if (!open) return;
    setName('');
    setEmail('');
    setLetter(make());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const shown = letter.replace(/\[Name\]/g, name.trim() ? first(name) : '[Name]');
  const act = useAction(
    () => api.post<{ id: string }>('/agents/invite', { name: name.trim(), email: email.trim(), language: locale, subject: t('inviteSheet.subject'), letter: letter }),
    { success: () => t('inviteSheet.sent'), onDone: onClose },
  );
  if (!open) return null;
  return (
    <Sheet
      open
      onClose={onClose}
      dirty={!!(name || email)}
      title={t('inviteSheet.title')}
      footer={
        <Button variant="primary" block busy={act.busy} disabled={!name.trim() || !email.includes('@') || !letter.trim()} onClick={() => act.mutate(undefined)}>
          {t('inviteSheet.send')}
        </Button>
      }
    >
      <TextField label={t('inviteSheet.name')} placeholder={t('inviteSheet.namePh')} value={name} onChange={(e) => setName(e.target.value)} error={act.fields.name} autoComplete="off" />
      <TextField label={t('inviteSheet.email')} placeholder={t('inviteSheet.emailPh')} type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={act.fields.email} autoComplete="off" />
      <PolishableText label={t('inviteSheet.letter')} subject={t('inviteSheet.subject')} value={shown} onChange={(v) => setLetter(name.trim() ? v.split(first(name)).join('[Name]') : v)} rows={13} />
      <span className="caption muted">{t('inviteSheet.hint')}</span>
      {act.fields.letter && <span className="an-help error">{act.fields.letter}</span>}
      {!act.fields.name && !act.fields.email && <ActionError action={act} />}
    </Sheet>
  );
}

/** One agent: figures, their customers with what each owes, set-up and an e-mail button. */
export function AgentSheet({ agent, onClose, onEmail, onCountersign }: { agent: AgentRow | null; onClose: () => void; onEmail: (a: AgentRow) => void; onCountersign: (a: AgentRow) => void }) {
  const t = useTranslations('agents');
  const { money, date, dateShort } = useFmt();
  const { canEdit, readOnly } = useSession();
  const q = useQuery({ queryKey: ['agents', 'detail', agent?.id], queryFn: () => api.get<AgentDetail>(`/agents/${agent!.id}`), enabled: !!agent });
  if (!agent) return null;
  const custs = q.data?.customers ?? [];
  return (
    <Sheet open onClose={onClose} title={agent.name} sub={agent.lastOrderAt ? t('panel.sub', { date: date(agent.lastOrderAt) }) : t('panel.subNone')}>
      <div className={s.box}>
        <div className={s.tot}>
          <span>{t('table.ready')}</span>
          {agent.paidTodayCents > 0 && agent.readyCents === 0 ? <Pill tone="good">{t('table.paidToday')}</Pill> : <bdi>{money(agent.readyCents)}</bdi>}
        </div>
        <div className={s.tot}>
          <span>{t('table.coming')}</span>
          <bdi>{money(agent.comingCents)}</bdi>
        </div>
        <div className={s.tot}>
          <span>{t('table.ordersThisMonth')}</span>
          <span className={agent.ordersThisMonth === 0 ? s.zero : ''}>{agent.ordersThisMonth}</span>
        </div>
      </div>
      <div className={s.sgrp}>{t('panel.customers', { n: q.data ? custs.length : agent.customers })}</div>
      {q.isLoading ? (
        <Skeleton h={56} />
      ) : custs.length === 0 ? (
        <span className={s.muted}>{t('panel.noCustomers')}</span>
      ) : (
        <div className="stack tight">
          {custs.map((c) => (
            <Link key={c.id} href={`/customers/${c.id}`} className={s.na}>
              <span className={s.ico}>
                <Icon as={Users} />
              </span>
              <span>
                {c.name}
                <span className={s.sub}>{c.lastOrderAt ? t('panel.customerLast', { date: dateShort(c.lastOrderAt) }) : t('panel.customerNone')}</span>
              </span>
              <span className={s.v}>
                <bdi>{money(c.owedCents)}</bdi>
                <Icon as={CaretRight} size="sm" />
              </span>
            </Link>
          ))}
        </div>
      )}
      {agent.setup === 'countersign' && canEdit('agents') && !readOnly && (
        <Button variant="primary" block icon={Signature} onClick={() => onCountersign(agent)}>
          {t('table.countersign')}
        </Button>
      )}
      {agent.status === 'active' && (
        <Button block icon={EnvelopeSimple} onClick={() => onEmail(agent)}>
          {t('panel.email', { name: first(agent.name) })}
        </Button>
      )}
    </Sheet>
  );
}

/** The Admin countersigns the agent agreement with their e-signature (finishes the agent's set-up). */
export function CountersignSheet({ agentId, onClose }: { agentId: string | null; onClose: () => void }) {
  const t = useTranslations('agents');
  const { date, dateTime } = useFmt();
  const { me } = useSession();
  const [name, setName] = useState('');
  const [agree, setAgree] = useState(false);
  useEffect(() => {
    setName('');
    setAgree(false);
  }, [agentId]);
  const q = useQuery({ queryKey: ['agents', 'setup', agentId], queryFn: () => api.get<AgentSetup>(`/agents/${agentId}/setup`), enabled: !!agentId });
  const act = useAction(() => api.post(`/agents/${agentId}/countersign`, { name: name.trim(), agree }), {
    success: () => t('countersign.done', { name: q.data?.agent.name ?? '' }),
    onDone: onClose,
  });
  if (!agentId) return null;
  const d = q.data;
  const det = d?.details;
  const done = d?.status === 'done';
  return (
    <Sheet
      open
      onClose={onClose}
      dirty={!!name && !done}
      title={t('countersign.title', { name: d?.agent.name ?? '' })}
      sub={done ? t('countersign.doneOn', { name: d?.agreement.countersignedName ?? '', date: date(d?.agreement.countersignedAt ?? '') }) : t('countersign.sub')}
      footer={
        done ? undefined : (
          <Button variant="primary" block icon={Signature} busy={act.busy} disabled={!d || d.status !== 'countersign' || !agree || !name.trim()} onClick={() => act.mutate(undefined)}>
            {t('countersign.confirm')}
          </Button>
        )
      }
    >
      {!d || !det ? (
        <Skeleton h={160} />
      ) : (
        <>
          <div className={s.sgrp}>{t('countersign.company')}</div>
          <div className={s.box}>
            <div className={s.tot}>
              <span>{det.companyName}</span>
              <bdi>{det.vatNumber ?? det.companyRegNumber}</bdi>
            </div>
            <span className={s.muted}>{[det.address, det.city, det.country].filter(Boolean).join(', ')}</span>
            <span className={s.muted}>
              {det.vatRegistered ? t('countersign.vatYes') : t('countersign.vatNo')} · {t('countersign.signer', { name: [det.managerName, det.managerRole].filter(Boolean).join(', ') })}
            </span>
            <span className={s.muted}>{det.payoutEmail}</span>
          </div>
          <div className={s.sgrp}>{t('countersign.bank')}</div>
          <div className={s.box}>
            <div className={s.tot}>
              <span>{det.accountHolder}</span>
              <span>{det.bankName}</span>
            </div>
            <bdi className={s.muted}>
              IBAN {det.iban} · BIC {det.bic}
            </bdi>
            {det.bankConfirmation && (
              <a className="link body-sm" href={`/api/agents/${agentId}/setup/files/${det.bankConfirmation}`} target="_blank" rel="noreferrer">
                {t('countersign.openConfirmation')}
              </a>
            )}
          </div>
          <div className={s.sgrp}>{t('panel.agreement')}</div>
          <div className={s.doc}>
            <span className={s.ico}>
              <Icon as={Signature} />
            </span>
            <span>
              <b>{d.agreement.title}</b>
              <span>
                {d.agreement.signedAt && t('countersign.signed', { name: d.agreement.signedName ?? '', date: dateTime(d.agreement.signedAt) })} · {d.signMethod === 'paper' ? t('countersign.signedPaper') : t('countersign.signedApp')}
              </span>
            </span>
            <a className="an-btn secondary sm" href={`/api/agents/${agentId}/agreement`} target="_blank" rel="noreferrer">
              {t('countersign.read')}
            </a>
          </div>
          {d.signedScan && (
            <a className="link body-sm" href={`/api/agents/${agentId}/setup/files/${d.signedScan}`} target="_blank" rel="noreferrer">
              {t('countersign.openScan')}
            </a>
          )}
          {!done && (
            <>
              <TextField label={t('countersign.name')} help={t('countersign.nameHelp', { name: me.user.name })} value={name} onChange={(e) => setName(e.target.value)} error={act.fields.name} autoComplete="name" />
              <label className={s.agree}>
                <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                <span>{t('countersign.agree', { company: d.principal.name })}</span>
              </label>
              {!act.fields.name && <ActionError action={act} />}
            </>
          )}
        </>
      )}
    </Sheet>
  );
}

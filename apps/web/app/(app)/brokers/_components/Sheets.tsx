'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { vatOf } from '@ananda/shared';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useFmt, iso } from '@/lib/format';
import { useSession } from '@/lib/session';
import { ActionError, Bank, Button, CaretRight, EnvelopeSimple, FileText, Icon, Pill, Sheet, Signature, Skeleton, TextField, TwoStepField, Users } from '@/components/ui';
import { PolishableText } from './MailDraft';
import type { BrokerDetail, BrokerRow, BrokerSetup, BrokersOverview, Earnings } from './types';
import s from '../brokers.module.css';

const first = (name: string) => name.trim().split(/\s+/)[0];

/** Send to pay (A4): what the accountant gets, with the broker's bank details (two-step code). */
export function SendToPaySheet({ broker, accountingEmail, perUnitCents, onClose }: { broker: BrokerRow | null; accountingEmail: string | null; perUnitCents: number; onClose: () => void }) {
  const t = useTranslations('brokers');
  const { money, date, unit } = useFmt();
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => {
    setCode('');
    setNote('');
  }, [broker?.id]);
  const act = useAction(() => api.post<{ amountCents: number }>(`/brokers/${broker!.id}/send-to-pay`, { note: note.trim() || undefined }, { code }), {
    success: () => t('pay.sent', { name: iso(first(broker?.name ?? '')) }),
    onDone: onClose,
  });
  if (!broker) return null;
  const sum = broker.readyCents;
  const vat = vatOf(sum);
  return (
    <Sheet
      open
      onClose={onClose}
      title={t('pay.sendTitle', { name: first(broker.name) })}
      sub={t('pay.sendSub', { name: first(broker.name) })}
      footer={
        <Button variant="primary" block icon={EnvelopeSimple} busy={act.busy} disabled={code.length !== 6 || !accountingEmail || sum <= 0} onClick={() => act.mutate(undefined)}>
          {t('pay.send')}
        </Button>
      }
    >
      <TextField label={t('pay.to')} value={accountingEmail ?? t('pay.noEmail')} readOnly />
      <div className={s.box}>
        <div className={s.tot}>
          <span>{t('pay.broker')}</span>
          <span>{broker.name}</span>
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
            <b>{t('pay.statement', { name: broker.name })}</b>
            <span>{t('pay.statementSub', { perUnit: unit(perUnitCents) })}</span>
          </span>
        </div>
        <div className={s.doc}>
          <span className={s.ico}>
            <Icon as={Bank} />
          </span>
          <span>
            <b>{t('pay.bank')}</b>
            <span>{broker.bank ? <bdi>{t('pay.bankSub', { holder: broker.bank.accountHolder ?? broker.name, iban: broker.bank.iban })}</bdi> : t('pay.noBank')}</span>
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
export function MarkPaidSheet({ broker, onClose }: { broker: BrokerRow | null; onClose: () => void }) {
  const t = useTranslations('brokers');
  const tc = useTranslations('common');
  const { money, date, num } = useFmt();
  const [code, setCode] = useState('');
  useEffect(() => setCode(''), [broker?.id]);
  const detail = useQuery({ queryKey: ['brokers', 'earnings', broker?.id], queryFn: () => api.get<Earnings>(`/brokers/${broker!.id}/earnings`), enabled: !!broker });
  const act = useAction(() => api.post<{ amountCents: number }>(`/brokers/${broker!.id}/mark-paid`, {}, { code }), {
    success: (r) => t('pay.paid', { name: iso(broker?.name ?? ''), amount: iso(money(r.amountCents)) }),
    onDone: onClose,
  });
  if (!broker) return null;
  const status = broker.sentCents > 0 ? 'sent' : 'ready';
  const entries = (detail.data?.entries ?? []).filter((e) => e.status === status);
  const sum = status === 'sent' ? broker.sentCents : broker.readyCents;
  return (
    <Sheet
      open
      onClose={onClose}
      title={t('pay.paidTitle', { name: first(broker.name) })}
      sub={t('pay.paidText', { name: first(broker.name) })}
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

/** New e-mail to a broker: the nudge (FR-AGT-2) or a plain e-mail from the broker panel. */
export function MailSheet({ broker, kind, onClose }: { broker: BrokerRow | null; kind: 'nudge' | 'email'; onClose: () => void }) {
  const t = useTranslations('brokers');
  const { me } = useSession();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  useEffect(() => {
    if (!broker) return;
    const v = { name: first(broker.name), sender: first(me.user.name) };
    setSubject(kind === 'nudge' ? t('mail.nudgeSubject') : t('mail.emailSubject'));
    setBody(kind === 'nudge' ? t('mail.nudgeBody', v) : t('mail.emailBody', v));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [broker?.id, kind]);
  const act = useAction(() => api.post(`/brokers/${broker!.id}/${kind === 'nudge' ? 'nudge' : 'email'}`, { subject, message: body }), {
    success: () => t('mail.sent', { name: iso(broker?.name ?? '') }),
    onDone: onClose,
  });
  if (!broker) return null;
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
      <TextField label={t('mail.to')} value={`${broker.name} · ${broker.email}`} readOnly />
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
 * Invite new broker (FR-AGT-4): name, e-mail and the whole invitation e-mail with AI polish. The
 * set-password link is added at the end; after it the broker fills in the set-up and signs.
 */
export function InviteSheet({ open, terms, onClose }: { open: boolean; terms: BrokersOverview['terms'] | undefined; onClose: () => void }) {
  const t = useTranslations('brokers');
  const locale = useLocale();
  const { unit, date } = useFmt();
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
    () => api.post<{ id: string }>('/brokers/invite', { name: name.trim(), email: email.trim(), language: locale, subject: t('inviteSheet.subject'), letter: letter }),
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

/** One broker: figures, their customers with what each owes, set-up and an e-mail button. */
export function BrokerSheet({ broker, onClose, onEmail, onCountersign }: { broker: BrokerRow | null; onClose: () => void; onEmail: (a: BrokerRow) => void; onCountersign: (a: BrokerRow) => void }) {
  const t = useTranslations('brokers');
  const { money, date } = useFmt();
  const { canEdit, readOnly } = useSession();
  const q = useQuery({ queryKey: ['brokers', 'detail', broker?.id], queryFn: () => api.get<BrokerDetail>(`/brokers/${broker!.id}`), enabled: !!broker });
  if (!broker) return null;
  const custs = q.data?.customers ?? [];
  return (
    <Sheet open onClose={onClose} title={broker.name} sub={broker.lastOrderAt ? t('panel.sub', { date: date(broker.lastOrderAt) }) : t('panel.subNone')}>
      <div className={s.box}>
        <div className={s.tot}>
          <span>{t('table.ready')}</span>
          {broker.paidTodayCents > 0 && broker.readyCents === 0 ? <Pill tone="good">{t('table.paidToday')}</Pill> : <bdi>{money(broker.readyCents)}</bdi>}
        </div>
        <div className={s.tot}>
          <span>{t('table.coming')}</span>
          <bdi>{money(broker.comingCents)}</bdi>
        </div>
        <div className={s.tot}>
          <span>{t('table.ordersThisMonth')}</span>
          <span className={broker.ordersThisMonth === 0 ? s.zero : ''}>{broker.ordersThisMonth}</span>
        </div>
      </div>
      <div className={s.sgrp}>{t('panel.customers', { n: q.data ? custs.length : broker.customers })}</div>
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
                <span className={s.sub}>{c.lastOrderAt ? t('panel.customerLast', { date: date(c.lastOrderAt) }) : t('panel.customerNone')}</span>
              </span>
              <span className={s.v}>
                <bdi>{money(c.owedCents)}</bdi>
                <Icon as={CaretRight} size="sm" />
              </span>
            </Link>
          ))}
        </div>
      )}
      {broker.setup === 'countersign' && canEdit('brokers') && !readOnly && (
        <Button variant="primary" block icon={Signature} onClick={() => onCountersign(broker)}>
          {t('table.countersign')}
        </Button>
      )}
      {broker.status === 'active' && (
        <Button block icon={EnvelopeSimple} onClick={() => onEmail(broker)}>
          {t('panel.email', { name: first(broker.name) })}
        </Button>
      )}
    </Sheet>
  );
}

/** The Admin countersigns the broker agreement with their e-signature (finishes the broker's set-up). */
export function CountersignSheet({ brokerId, onClose }: { brokerId: string | null; onClose: () => void }) {
  const t = useTranslations('brokers');
  const { date, dateTime } = useFmt();
  const { me } = useSession();
  const [name, setName] = useState('');
  const [agree, setAgree] = useState(false);
  useEffect(() => {
    setName('');
    setAgree(false);
  }, [brokerId]);
  const q = useQuery({ queryKey: ['brokers', 'setup', brokerId], queryFn: () => api.get<BrokerSetup>(`/brokers/${brokerId}/setup`), enabled: !!brokerId });
  const act = useAction(() => api.post(`/brokers/${brokerId}/countersign`, { name: name.trim(), agree }), {
    success: () => t('countersign.done', { name: iso(q.data?.broker.name ?? '') }),
    onDone: onClose,
  });
  if (!brokerId) return null;
  const d = q.data;
  const det = d?.details;
  const done = d?.status === 'done';
  return (
    <Sheet
      open
      onClose={onClose}
      dirty={!!name && !done}
      title={t('countersign.title', { name: d?.broker.name ?? '' })}
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
              <a className="link body-sm" href={`/api/brokers/${brokerId}/setup/files/${det.bankConfirmation}`} target="_blank" rel="noreferrer">
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
            <a className="an-btn secondary sm" href={`/api/brokers/${brokerId}/agreement`} target="_blank" rel="noreferrer">
              {t('countersign.read')}
            </a>
          </div>
          {d.signedScan && (
            <a className="link body-sm" href={`/api/brokers/${brokerId}/setup/files/${d.signedScan}`} target="_blank" rel="noreferrer">
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

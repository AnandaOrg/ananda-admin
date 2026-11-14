'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useSession } from '@/lib/session';
import {
  Briefcase,
  Button,
  CaretRight,
  Card,
  EmptyState,
  EnvelopeSimple,
  ErrorState,
  Icon,
  KpiTile,
  Money,
  PageHeader,
  PageSkeleton,
  Pill,
  Signature,
  Table,
  UserPlus,
  type Column,
} from '@/components/ui';
import { BrokerSheet, CountersignSheet, InviteSheet, MailSheet, MarkPaidSheet, SendToPaySheet } from './Sheets';
import type { BrokerRow, BrokersOverview } from './types';
import s from '../brokers.module.css';

/** Admin and Finance view of brokers and commission (FR-AGT-1 … FR-AGT-4), prototype "Brokers & commissions". */
export function BrokersAdmin() {
  const t = useTranslations('brokers');
  const tc = useTranslations('common');
  const router = useRouter();
  const params = useSearchParams();
  const { money, date, dateShort, unit } = useFmt();
  const { canEdit, can, readOnly } = useSession();
  const q = useQuery({ queryKey: ['brokers', 'overview'], queryFn: () => api.get<BrokersOverview>('/brokers') });
  const [invite, setInvite] = useState(false);
  const [mail, setMail] = useState<{ broker: BrokerRow; kind: 'nudge' | 'email' } | null>(null);
  const [send, setSend] = useState<BrokerRow | null>(null);
  const [paid, setPaid] = useState<BrokerRow | null>(null);
  const [detail, setDetail] = useState<BrokerRow | null>(null);
  const [counter, setCounter] = useState<string | null>(null);

  const mayEdit = canEdit('brokers') && !readOnly;
  const mayPay = can('pay_commission') && !readOnly;

  // Deep links: ?invite=1 (Home set-up list) and ?countersign=<broker id> (the notification).
  useEffect(() => {
    if (params.get('invite') === '1' && mayEdit) setInvite(true);
    const c = params.get('countersign');
    if (c && mayEdit) setCounter(c);
  }, [params, mayEdit]);
  const clearParams = () => {
    if (params.get('invite') || params.get('countersign')) router.replace('/brokers');
  };

  if (q.isLoading) return <PageSkeleton />;
  if (q.error || !q.data) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  const perUnit = unit(d.terms.commissionPerUnitCents);
  const didntSell = d.brokers.filter((a) => d.didntSellIds.includes(a.id));
  const kicker = t('range', { from: dateShort(d.range.from), to: date(d.range.to) });
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const lastOrder = (a: BrokerRow) => (a.lastOrderAt ? t('didntSell.lastOrder', { date: date(a.lastOrderAt) }) : t('didntSell.noOrders'));
  const invitePrimary = mayEdit ? (
    <Button size="sm" variant="primary" icon={UserPlus} onClick={() => setInvite(true)}>
      {t('invite')}
    </Button>
  ) : undefined;

  // Pay buttons on the row: Send to pay (or "With the accountant") and Mark as paid.
  const payButtons = (a: BrokerRow, phone = false) => {
    if (!mayPay || a.setup !== 'done') return null;
    const sent = a.sentCents > 0;
    if (!sent && a.readyCents <= 0) return null;
    return (
      <>
        {sent ? (
          <Pill tone="info">{t('table.withAccountant')}</Pill>
        ) : (
          <Button size={phone ? 'md' : 'sm'} icon={EnvelopeSimple} onClick={() => setSend(a)}>
            {t('sendToPay')}
          </Button>
        )}
        <Button size={phone ? 'md' : 'sm'} icon={Money} writes onClick={() => setPaid(a)}>
          {t('markPaid')}
        </Button>
      </>
    );
  };
  const countersignButton = (a: BrokerRow, phone = false) =>
    a.setup === 'countersign' && mayEdit ? (
      <Button size={phone ? 'md' : 'sm'} variant="primary" icon={Signature} onClick={() => setCounter(a.id)}>
        {t('table.countersign')}
      </Button>
    ) : null;
  const ready = (a: BrokerRow) => (a.paidTodayCents > 0 && a.readyCents === 0 && a.sentCents === 0 ? <Pill tone="good">{t('table.paidToday')}</Pill> : <bdi>{money(a.readyCents)}</bdi>);
  const role = (a: BrokerRow) => t('table.role', { status: t(`table.status.${a.status === 'invited' ? 'invited' : a.setup}`) });

  const columns: Column<BrokerRow>[] = [
    {
      key: 'broker',
      header: t('table.broker'),
      render: (a) => (
        <>
          <span className="nm">{a.name}</span>
          <span className="sb">{role(a)}</span>
        </>
      ),
    },
    { key: 'customers', header: t('table.customers'), type: 'count', render: (a) => a.customers },
    { key: 'orders', header: t('table.ordersThisMonth'), type: 'count', render: (a) => <span className={a.ordersThisMonth === 0 ? s.zero : ''}>{a.ordersThisMonth}</span> },
    { key: 'ready', header: t('table.ready'), type: 'amount', render: ready },
    { key: 'coming', header: t('table.coming'), type: 'amount', render: (a) => <bdi>{money(a.comingCents)}</bdi> },
    {
      key: 'act',
      header: <span className="sr-only">{t('table.actions')}</span>,
      render: (a) => (
        <span className={s.acts} onClick={(e) => e.stopPropagation()}>
          {countersignButton(a)}
          {payButtons(a)}
        </span>
      ),
    },
  ];

  if (d.brokers.length === 0) {
    return (
      <div className="page">
        <PageHeader crumbs={[{ label: tc('nav.brokers') }]} kicker={t('empty.kicker')} title={tc('nav.brokers')} actions={invitePrimary} />
        <Card>
          <EmptyState
            icon={Briefcase}
            title={t('empty.title')}
            text={t('empty.text', { perUnit })}
            action={
              mayEdit ? (
                <Button variant="primary" icon={UserPlus} onClick={() => setInvite(true)}>
                  {t('empty.action')}
                </Button>
              ) : undefined
            }
          />
        </Card>
        <InviteSheet
          open={invite}
          terms={d.terms}
          onClose={() => {
            setInvite(false);
            clearParams();
          }}
        />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader crumbs={[{ label: tc('nav.brokers') }]} kicker={kicker} title={tc('nav.brokers')} actions={<span className="only-wide">{invitePrimary}</span>} />

      {/* Desktop: four tiles; phone: Ready to pay and Coming side by side. */}
      <div className={`${s.kpis4} only-wide`}>
        <div className={`${s.tileGo} ${d.tiles.readyCents > 0 ? s.warnV : ''}`}>
          <KpiTile label={t('tiles.ready')} value={money(d.tiles.readyCents)} sub={t('tiles.readySub')} onClick={() => scrollTo('brokers-table')} />
          <span className={s.go}>
            <Icon as={CaretRight} size="sm" />
          </span>
        </div>
        <KpiTile label={t('tiles.coming')} value={money(d.tiles.comingCents)} sub={t('tiles.comingSub')} />
        <div className={`${s.tileGo} ${d.tiles.didntSell > 0 ? s.badV : ''}`}>
          <KpiTile label={t('tiles.didntSell')} value={t('tiles.didntSellValue', { n: d.tiles.didntSell, of: d.tiles.activeBrokers })} onClick={() => scrollTo('didnt-sell')} />
          {d.tiles.didntSell > 0 && (
            <span className={s.go}>
              <Icon as={CaretRight} size="sm" />
            </span>
          )}
        </div>
        <KpiTile label={t('tiles.newCustomers')} value={String(d.tiles.newCustomersThisMonth)} />
      </div>
      <div className={`${s.kpis2} only-phone`}>
        <div className={d.tiles.readyCents > 0 ? s.warnV : ''}>
          <KpiTile label={t('tiles.ready')} value={money(d.tiles.readyCents, true)} sub={t('table.customerPaid')} />
        </div>
        <KpiTile label={t('tiles.coming')} value={money(d.tiles.comingCents, true)} sub={t('tiles.comingSub')} />
      </div>

      {didntSell.length > 0 && (
        <Card className="only-wide" id="didnt-sell">
          <div className={s.cardHead}>
            <h2>{t('didntSell.title')}</h2>
            <span className={s.cnt}>{didntSell.length}</span>
          </div>
          <p className={s.lead}>{t('didntSell.text')}</p>
          <div className={s.nudges}>
            {didntSell.map((a) => (
              <span key={a.id} className={s.nudge}>
                <span style={{ minWidth: 0 }}>
                  {a.name}
                  <span className={s.sub}>{lastOrder(a)}</span>
                </span>
                {a.nudgedToday ? (
                  <Pill tone="good">{t('didntSell.nudged')}</Pill>
                ) : mayEdit ? (
                  <Button size="sm" icon={EnvelopeSimple} onClick={() => setMail({ broker: a, kind: 'nudge' })}>
                    {t('didntSell.nudge')}
                  </Button>
                ) : null}
              </span>
            ))}
          </div>
        </Card>
      )}

      <Card flush className="only-wide" id="brokers-table">
        <Table columns={columns} rows={d.brokers} rowKey={(a) => a.id} onRow={(a) => setDetail(a)} picker={{ id: 'brokers', locked: ['broker', 'coming', 'act'], priority: ['customers', 'orders', 'ready'] }} />
        <div className={s.foot}>{t('table.foot', { perUnit })}</div>
      </Card>

      <div className="list-cards only-phone">
        {d.brokers.map((a) => (
          <div key={a.id} className={s.pcard}>
            <button type="button" className={s.phead} onClick={() => setDetail(a)}>
              <span className="row between">
                <span className={s.pname}>
                  {a.name}
                  {a.nudgedToday && <Pill tone="good">{t('didntSell.nudged')}</Pill>}
                  {a.status === 'invited' && <Pill tone="mute">{t('table.status.invited')}</Pill>}
                  {a.setup === 'countersign' && <Pill tone="warn">{t('table.toCountersign')}</Pill>}
                </span>
                <span className="muted">
                  <Icon as={CaretRight} size="sm" />
                </span>
              </span>
              <span className={s.psub}>{t('table.phoneSub', { n: a.customers, last: lastOrder(a) })}</span>
            </button>
            <div className={s.prow}>
              <span>{t('table.ready')}</span>
              {ready(a)}
            </div>
            <div className={s.prow}>
              <span>{t('table.coming')}</span>
              <bdi>{money(a.comingCents)}</bdi>
            </div>
            <div className={s.prow}>
              <span>{t('table.ordersThisMonth')}</span>
              <span className={a.ordersThisMonth === 0 ? s.zero : ''}>{a.ordersThisMonth}</span>
            </div>
            {(payButtons(a, true) || countersignButton(a, true)) && (
              <div className={s.pbtns}>
                {countersignButton(a, true)}
                {payButtons(a, true)}
              </div>
            )}
            {d.didntSellIds.includes(a.id) && !a.nudgedToday && mayEdit && (
              <Button block icon={EnvelopeSimple} onClick={() => setMail({ broker: a, kind: 'nudge' })}>
                {t('didntSell.nudgeLong')}
              </Button>
            )}
          </div>
        ))}
        <span className={s.pnote}>{t('table.footPhone', { perUnit })}</span>
        {mayEdit && (
          <Button variant="primary" block icon={UserPlus} onClick={() => setInvite(true)}>
            {t('invite')}
          </Button>
        )}
      </div>

      <BrokerSheet
        broker={detail}
        onClose={() => setDetail(null)}
        onEmail={(a) => {
          setDetail(null);
          setMail({ broker: a, kind: 'email' });
        }}
        onCountersign={(a) => {
          setDetail(null);
          setCounter(a.id);
        }}
      />
      <InviteSheet
        open={invite}
        terms={d.terms}
        onClose={() => {
          setInvite(false);
          clearParams();
        }}
      />
      <MailSheet broker={mail?.broker ?? null} kind={mail?.kind ?? 'nudge'} onClose={() => setMail(null)} />
      <SendToPaySheet broker={send} accountingEmail={d.accountingEmail} perUnitCents={d.terms.commissionPerUnitCents} onClose={() => setSend(null)} />
      <MarkPaidSheet broker={paid} onClose={() => setPaid(null)} />
      <CountersignSheet
        brokerId={counter}
        onClose={() => {
          setCounter(null);
          clearParams();
        }}
      />
    </div>
  );
}

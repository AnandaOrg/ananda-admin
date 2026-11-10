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
  CaretDown,
  Card,
  EmptyState,
  EnvelopeOpen,
  ErrorState,
  Icon,
  KeyValue,
  KpiTile,
  ListCard,
  ListRow,
  MenuButton,
  PageHeader,
  PageSkeleton,
  Pill,
  Sheet,
  Table,
  UserPlus,
  type Column,
} from '@/components/ui';
import { InviteSheet, NudgeSheet, PaySheet } from './Sheets';
import { payActions, type AgentRow, type AgentsOverview } from './types';

/** Admin and Finance view of agents and commission (FR-AGT-1 … FR-AGT-4). */
export function AgentsAdmin() {
  const t = useTranslations('agents');
  const tc = useTranslations('common');
  const router = useRouter();
  const params = useSearchParams();
  const { money, date, num } = useFmt();
  const { canEdit, can, readOnly } = useSession();
  const q = useQuery({ queryKey: ['agents', 'overview'], queryFn: () => api.get<AgentsOverview>('/agents') });
  const [invite, setInvite] = useState(false);
  const [nudge, setNudge] = useState<AgentRow | null>(null);
  const [pay, setPay] = useState<{ agent: AgentRow; mode: 'send' | 'paid' } | null>(null);
  const [detail, setDetail] = useState<AgentRow | null>(null);

  const mayEdit = canEdit('agents') && !readOnly;
  const mayPay = can('pay_commission') && !readOnly;

  useEffect(() => {
    if (params.get('invite') === '1' && mayEdit) setInvite(true);
  }, [params, mayEdit]);
  const closeInvite = () => {
    setInvite(false);
    if (params.get('invite')) router.replace('/agents');
  };

  if (q.isLoading) return <PageSkeleton />;
  if (q.error || !q.data) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  const didntSell = d.agents.filter((a) => d.didntSellIds.includes(a.id));

  const openPay = (agent: AgentRow, mode: 'send' | 'paid') => {
    setDetail(null);
    setPay({ agent, mode });
  };
  const payButtons = (a: AgentRow, block = false) => {
    if (!mayPay) return null;
    const acts = payActions(a, block);
    if (acts.length === 0) return null;
    if (acts.length === 1 || block) {
      return acts.map((m) => (
        <Button key={m} size={block ? 'md' : 'sm'} block={block} variant={m === 'send' || acts.length === 1 ? 'primary' : 'secondary'} onClick={() => openPay(a, m)}>
          {m === 'send' ? t('sendToPay') : t('markPaid')}
        </Button>
      ));
    }
    return (
      <MenuButton
        items={acts.map((m) => ({ key: m, label: m === 'send' ? t('sendToPay') : t('markPaid'), onSelect: () => openPay(a, m) }))}
        trigger={({ open, toggle, ref }) => (
          <button ref={ref} type="button" className="an-btn secondary sm" aria-expanded={open} aria-haspopup="menu" onClick={toggle}>
            {t('table.pay')}
            <Icon as={CaretDown} size="sm" />
          </button>
        )}
      />
    );
  };

  const columns: Column<AgentRow>[] = [
    {
      key: 'agent',
      header: t('table.agent'),
      render: (a) => (
        <>
          <span className="nm row">
            {a.name}
            {a.status === 'invited' && <Pill tone="mute">{t('table.invited')}</Pill>}
          </span>
          <span className="sb">{a.email}</span>
        </>
      ),
    },
    { key: 'customers', header: t('table.customers'), type: 'count', render: (a) => num(a.customers) },
    { key: 'orders', header: t('table.ordersThisMonth'), type: 'count', render: (a) => num(a.ordersThisMonth) },
    {
      key: 'ready',
      header: t('table.ready'),
      type: 'amount',
      render: (a) => (
        <>
          <bdi>{money(a.readyCents)}</bdi>
          {a.sentCents > 0 && (
            <span className="sb">
              <bdi>{t('table.sentSub', { amount: money(a.sentCents) })}</bdi>
            </span>
          )}
        </>
      ),
    },
    { key: 'coming', header: t('table.coming'), type: 'amount', render: (a) => <bdi>{money(a.comingCents)}</bdi> },
    ...(mayPay
      ? [
          {
            key: 'act',
            header: <span className="sr-only">{t('table.actions')}</span>,
            type: 'amount' as const,
            render: (a: AgentRow) => (
              <span className="row end" onClick={(e) => e.stopPropagation()}>
                {payButtons(a)}
              </span>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="page">
      <PageHeader
        crumbs={[{ label: tc('nav.agents') }]}
        kicker={t('kicker', { n: d.agents.length })}
        title={tc('nav.agents')}
        actions={
          mayEdit ? (
            <Button size="sm" variant="primary" icon={UserPlus} onClick={() => setInvite(true)}>
              {t('invite')}
            </Button>
          ) : undefined
        }
      />
      <div className="kpis">
        <KpiTile
          label={t('tiles.ready')}
          value={money(d.tiles.readyCents, true)}
          sub={d.tiles.sentCents > 0 ? t('tiles.readySent', { amount: money(d.tiles.sentCents) }) : t('tiles.readySub', { n: d.tiles.readyAgents })}
        />
        <KpiTile label={t('tiles.coming')} value={money(d.tiles.comingCents, true)} sub={t('tiles.comingSub')} />
        <KpiTile
          label={t('tiles.didntSell')}
          value={t('tiles.didntSellValue', { n: d.tiles.didntSell, of: d.tiles.activeAgents })}
          valueTone={d.tiles.didntSell > 0 ? 'bad' : undefined}
          sub={t('tiles.didntSellSub')}
        />
        <KpiTile label={t('tiles.newCustomers')} value={num(d.tiles.newCustomersThisMonth)} sub={t('tiles.newCustomersSub')} link={{ href: '/customers', label: tc('view') }} />
      </div>

      {d.agents.length === 0 ? (
        <Card>
          <EmptyState
            icon={Briefcase}
            title={t('empty.title')}
            text={t('empty.text')}
            action={
              mayEdit ? (
                <Button variant="primary" icon={UserPlus} onClick={() => setInvite(true)}>
                  {t('invite')}
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <>
          {didntSell.length > 0 && (
            <Card title={t('didntSell.title')}>
              <div className="lrows">
                {didntSell.map((a) => (
                  <ListRow
                    key={a.id}
                    icon={Briefcase}
                    iconTone="warn"
                    title={a.name}
                    sub={a.lastOrderAt ? t('didntSell.lastOrder', { date: date(a.lastOrderAt) }) : t('didntSell.noOrders')}
                    wrapActions
                    actions={
                      a.nudgedToday ? (
                        <Pill tone="good">{t('didntSell.nudgedToday')}</Pill>
                      ) : mayEdit ? (
                        <>
                          {a.lastNudgedAt && <span className="caption muted">{t('didntSell.nudgedOn', { date: date(a.lastNudgedAt) })}</span>}
                          <Button size="sm" icon={EnvelopeOpen} onClick={() => setNudge(a)}>
                            {t('didntSell.nudge')}
                          </Button>
                        </>
                      ) : undefined
                    }
                  />
                ))}
              </div>
            </Card>
          )}

          <Card flush title={t('table.title')} className="only-wide">
            <Table columns={columns} rows={d.agents} rowKey={(a) => a.id} onRow={(a) => setDetail(a)} />
          </Card>
          <div className="list-cards only-phone">
            <span className="overline">{t('table.title')}</span>
            {d.agents.map((a) => (
              <ListCard
                key={a.id}
                title={a.name}
                amount={money(a.readyCents)}
                sub={`${t('table.customers')} ${num(a.customers)} · ${t('table.ordersThisMonth')} ${num(a.ordersThisMonth)} · ${t('table.coming')} ${money(a.comingCents)}`}
                status={a.status === 'invited' ? <Pill tone="mute">{t('table.invited')}</Pill> : a.sentCents > 0 ? <Pill tone="info">{t('table.sentSub', { amount: money(a.sentCents) })}</Pill> : undefined}
                onClick={() => setDetail(a)}
              />
            ))}
          </div>
        </>
      )}

      <Sheet
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail?.name ?? ''}
        sub={detail?.email}
        footer={detail && payActions(detail, true).length > 0 && mayPay ? <>{payButtons(detail, true)}</> : undefined}
      >
        {detail && (
          <KeyValue
            items={[
              [t('table.customers'), num(detail.customers)],
              [t('table.ordersThisMonth'), num(detail.ordersThisMonth)],
              [t('table.ready'), <bdi key="r">{money(detail.readyCents)}</bdi>],
              ...(detail.sentCents > 0 ? [[t('earnings.sent'), <bdi key="s">{money(detail.sentCents)}</bdi>] as [string, React.ReactNode]] : []),
              [t('table.coming'), <bdi key="c">{money(detail.comingCents)}</bdi>],
              [t('earnings.paid'), <bdi key="p">{money(detail.paidThisYearCents)}</bdi>],
              [tc('email'), detail.email],
              ...(detail.phone ? [[tc('call'), <a key="ph" className="link" href={`tel:${detail.phone.replace(/[^\d+]/g, '')}`}><bdi>{detail.phone}</bdi></a>] as [string, React.ReactNode]] : []),
            ]}
          />
        )}
      </Sheet>
      <InviteSheet open={invite} terms={d.terms} onClose={closeInvite} />
      <NudgeSheet agent={nudge} onClose={() => setNudge(null)} />
      <PaySheet
        agent={pay?.agent ?? null}
        mode={pay?.mode ?? 'send'}
        accountingEmail={d.accountingEmail}
        onClose={() => setPay(null)}
      />
    </div>
  );
}

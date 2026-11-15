'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Banner, Button, Card, CaretRight, Chips, EmptyState, EnvelopeOpen, Icon, ListCard, ListCards, NoAccess, PageHeader, Pill, Table, UserPlus, Users, type Column } from '@/components/ui';
import { useAuditFormat, type AuditEntry } from '../audit/_components/audit-format';
import { MemberStatusPill, useRoleText, type Member, type RoleSummary } from './_components/shared';
import { RoleDetailView, RolesList } from './_components/roles-tab';
import { AddMemberSheet } from './_components/add-member';
import { MemberSheet } from './_components/member-sheet';
import css from './users.module.css';

type Tab = 'team' | 'roles' | 'invitations' | 'history';

interface Invitation {
  id: string;
  name: string;
  email: string;
  language: string;
  inviteExpiresAt: string | null;
  createdAt: string;
  roleName: string;
  invitedBy: string | null;
  expired: boolean;
}

/** FR-ADM-1: Team, Roles (permissions grid per role), Invitations and Change history. System admin edits; Admin views. */
export default function UsersPage() {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { canView, canEdit, readOnly, me } = useSession();
  const { date, dateShort } = useFmt();
  const audit = useAuditFormat();
  const rt = useRoleText();
  const editable = canEdit('users') && !readOnly;
  const tab = ((params.get('tab') as Tab) || 'team') as Tab;
  const roleOpen = params.get('role');
  const go = (next: { tab?: Tab; role?: string | null }) => {
    const q = new URLSearchParams();
    const tb = next.tab ?? tab;
    if (tb !== 'team') q.set('tab', tb);
    if (next.role) q.set('role', next.role);
    router.replace(q.size ? `${pathname}?${q}` : pathname);
  };
  const [adding, setAdding] = useState(false);
  const [memberId, setMemberId] = useState<string | null>(null);
  useEffect(() => {
    if (params.get('new') === '1' && editable) setAdding(true);
  }, [params, editable]);

  const allowed = canView('users');
  const team = useQuery({ queryKey: ['users', 'team'], queryFn: () => api.get<Member[]>('/users'), enabled: allowed });
  const roles = useQuery({ queryKey: ['users', 'roles'], queryFn: () => api.get<RoleSummary[]>('/roles'), enabled: allowed });
  const invites = useQuery({ queryKey: ['users', 'invitations'], queryFn: () => api.get<{ items: Invitation[]; inviteValidityDays: number }>('/users/invitations'), enabled: allowed });
  const history = useQuery({ queryKey: ['users', 'history'], queryFn: () => api.get<AuditEntry[]>('/users/history'), enabled: allowed && tab === 'history' });

  if (!allowed) return <NoAccess />;

  const members = team.data ?? [];
  // Team: people with an account. Open invitations are under Invitations; cancelled ones never had an account.
  const current = members.filter((m) => m.status !== 'invited' && (m.status !== 'deactivated' || m.hasPassword));
  const activeCount = members.filter((m) => m.status === 'active').length;
  const invitations = invites.data?.items ?? [];
  const roleList = roles.data ?? [];
  const alone = !!team.data && members.filter((m) => m.status !== 'deactivated').length <= 1 && invitations.length === 0;
  const member = members.find((m) => m.id === memberId) ?? null;
  const addButton = editable && (
    <Button variant="primary" icon={UserPlus} onClick={() => setAdding(true)}>
      {t('users.add.button')}
    </Button>
  );
  const chev = { key: 'go', header: '', className: css.chev, render: () => <Icon as={CaretRight} size="sm" className="subtle" /> };

  const twoStep = (m: Member) => (m.twoStepEnabled ? <Pill tone="good">{t('users.twoStep.on')}</Pill> : m.role.twoStepRequired ? <Pill tone="warn">{t('users.twoStep.atSignIn')}</Pill> : <Pill tone="mute">{t('users.twoStep.off')}</Pill>);
  const teamCols: Column<Member>[] = [
    { key: 'name', header: t('users.cols.name'), render: (m) => <span className="nm">{m.name}</span> },
    { key: 'role', header: t('users.cols.role'), render: (m) => rt.name(m.role) },
    { key: 'sees', header: t('users.cols.sees'), render: (m) => rt.sees(m.role) },
    { key: 'twoStep', header: t('users.cols.twoStep'), type: 'status', render: twoStep },
    { key: 'status', header: tc('status'), type: 'status', render: (m) => <MemberStatusPill status={m.status} /> },
    chev,
  ];
  const inviteCols: Column<Invitation>[] = [
    {
      key: 'name',
      header: t('users.cols.invited'),
      render: (i) => (
        <>
          {i.name} · <bdi>{i.email}</bdi>
        </>
      ),
    },
    { key: 'role', header: t('users.cols.role'), render: (i) => rt.name({ key: roleList.find((r) => r.name === i.roleName)?.key ?? '', name: i.roleName, isSystem: !!roleList.find((r) => r.name === i.roleName)?.isSystem }) },
    { key: 'status', header: tc('status'), type: 'status', render: (i) => (i.expired ? <Pill tone="bad">{t('users.invite.expired')}</Pill> : <Pill tone="warn">{t('users.invite.waiting')}</Pill>) },
    chev,
  ];
  const historyCols: Column<AuditEntry>[] = [
    { key: 'when', header: t('users.history.when'), render: (e) => <span className="nowrap">{date(e.at)}</span> },
    { key: 'who', header: t('users.history.who'), render: (e) => e.actorName ?? t('audit.system') },
    {
      key: 'what',
      header: t('users.history.what'),
      render: (e) => (
        <>
          <bdi>{audit.sentence(e)}</bdi>
          {audit.beforeAfter(e) && (
            <span className="sb">
              <bdi>{audit.beforeAfter(e)}</bdi>
            </span>
          )}
        </>
      ),
    },
  ];

  const tabs = (short: boolean) => (
    <Chips
      fill={false}
      label={t('users.tabsLabel')}
      value={tab}
      onChange={(v) => go({ tab: v, role: null })}
      options={[
        { value: 'team', label: t('users.tabLabel.team', { n: activeCount }) },
        { value: 'roles', label: t('users.tabLabel.roles', { n: roleList.length }) },
        { value: 'invitations', label: short ? t('users.tabLabel.invitesShort', { n: invitations.length }) : t('users.tabLabel.invitations', { n: invitations.length }) },
        { value: 'history', label: short ? t('users.tabLabel.historyShort') : t('users.tabLabel.history') },
      ]}
    />
  );

  return (
    <div className="page">
      <PageHeader crumbs={[{ label: tc('nav.users') }]} kicker={alone ? t('users.kickerAlone') : t('users.kickerActive', { n: activeCount })} title={tc('nav.users')} actions={<span className="only-wide">{addButton}</span>} />
      {!editable && !readOnly && <Banner>{t('users.viewOnly')}</Banner>}

      {alone && tab === 'team' ? (
        <Card>
          <EmptyState
            icon={Users}
            title={t('users.alone.title')}
            text={t('users.alone.text')}
            action={
              editable ? (
                <Button variant="primary" icon={UserPlus} onClick={() => setAdding(true)}>
                  {t('users.alone.button')}
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <>
          <div className="only-wide">{tabs(false)}</div>
          <div className="only-phone">{tabs(true)}</div>

          {tab === 'team' ? (
            <>
              <Card flush className="only-wide">
                <Table columns={teamCols} rows={current} rowKey={(m) => m.id} picker={{ id: 'team', locked: ['name', 'status', 'go'], defaults: ['role', 'twoStep'], priority: ['role', 'twoStep', 'sees'] }} onRow={(m) => setMemberId(m.id)} rowClass={(m) => (m.status === 'deactivated' ? 'subtle' : '')} loading={team.isLoading} error={team.error} onRetry={() => team.refetch()} />
              </Card>
              <div className="only-phone">
                <ListCards loading={team.isLoading} error={team.error} onRetry={() => team.refetch()}>
                  {current.map((m) => (
                    <ListCard
                      key={m.id}
                      title={m.name}
                      sub={`${rt.name(m.role)} · ${rt.sees(m.role)}`}
                      status={
                        <span className="status-pills">
                          {m.status !== 'active' && <MemberStatusPill status={m.status} />}
                          <Pill tone={m.twoStepEnabled ? 'good' : 'mute'}>{m.twoStepEnabled ? t('users.twoStep.phoneOn') : t('users.twoStep.phoneOff')}</Pill>
                        </span>
                      }
                      onClick={() => setMemberId(m.id)}
                    />
                  ))}
                </ListCards>
              </div>
            </>
          ) : tab === 'roles' ? (
            roleOpen ? (
              <RoleDetailView id={roleOpen} onBack={() => go({ tab: 'roles', role: null })} onOpenRole={(id) => go({ tab: 'roles', role: id })} onOpenMember={setMemberId} />
            ) : (
              <RolesList roles={roleList} loading={roles.isLoading} error={roles.error} onRetry={() => roles.refetch()} onOpen={(id) => go({ tab: 'roles', role: id })} />
            )
          ) : tab === 'invitations' ? (
            invitations.length === 0 && !invites.isLoading && !invites.error ? (
              <Card>
                <div className={css.empty}>
                  <Icon as={EnvelopeOpen} />
                  <span>{t('users.invite.none')}</span>
                </div>
              </Card>
            ) : (
              <>
                <Card flush className="only-wide">
                  <Table columns={inviteCols} rows={invitations} rowKey={(i) => i.id} onRow={(i) => setMemberId(i.id)} loading={invites.isLoading} error={invites.error} onRetry={() => invites.refetch()} />
                </Card>
                <div className="only-phone">
                  <ListCards loading={invites.isLoading} error={invites.error} onRetry={() => invites.refetch()}>
                    {invitations.map((i) => (
                      <ListCard
                        key={i.id}
                        title={i.name}
                        sub={
                          <>
                            {i.roleName} · <bdi>{i.email}</bdi>
                          </>
                        }
                        status={i.expired ? <Pill tone="bad">{t('users.invite.expired')}</Pill> : <Pill tone="warn">{t('users.invite.waiting')}</Pill>}
                        onClick={() => setMemberId(i.id)}
                      />
                    ))}
                  </ListCards>
                </div>
              </>
            )
          ) : (
            <>
              <Card flush className="only-wide">
                <Table
                  columns={historyCols}
                  rows={history.data ?? []}
                  rowKey={(e) => e.id}
                  loading={history.isLoading}
                  error={history.error}
                  onRetry={() => history.refetch()}
                  empty={<span className="muted">{t('users.history.emptyText')}</span>}
                />
                <div className={css.foot}>{t('users.history.foot')}</div>
              </Card>
              <div className="only-phone">
                <ListCards loading={history.isLoading} error={history.error} onRetry={() => history.refetch()} empty={<p className="muted">{t('users.history.emptyText')}</p>}>
                  {(history.data ?? []).map((e) => (
                    <ListCard key={e.id} title={audit.sentence(e)} sub={`${dateShort(e.at)} · ${e.actorName ?? t('audit.system')}`} />
                  ))}
                </ListCards>
              </div>
            </>
          )}
        </>
      )}

      {editable && (
        <div className="only-phone">
          <Button variant="primary" block icon={UserPlus} onClick={() => setAdding(true)}>
            {t('users.add.button')}
          </Button>
        </div>
      )}

      <AddMemberSheet
        open={adding}
        onClose={() => {
          setAdding(false);
          if (params.get('new')) router.replace(pathname);
        }}
        roles={roleList}
        validityDays={invites.data?.inviteValidityDays ?? 7}
      />
      <MemberSheet member={member} onClose={() => setMemberId(null)} roles={roleList} editable={editable} isSelf={member?.id === me.user.id} />
    </div>
  );
}

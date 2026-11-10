'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useFmt } from '@/lib/format';
import { useSession } from '@/lib/session';
import {
  ArrowCounterClockwise,
  Banner,
  Button,
  Card,
  Chips,
  ClockCounterClockwise,
  EmptyState,
  EnvelopeOpen,
  ErrorState,
  KeyValue,
  ListCard,
  PageHeader,
  PageSkeleton,
  Pill,
  Segmented,
  Select,
  Sheet,
  Table,
  TextArea,
  TextField,
  UserPlus,
  Users,
  X,
  type Column,
} from '@/components/ui';
import { useAuditFormat, type AuditEntry } from '../audit/_components/audit-format';
import { MemberStatusPill, RoleName, TwoStepPill, WhatTheySee, type Member, type RoleSummary } from './_components/shared';

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

/** FR-ADM-1: team, roles, invitations and change history. System admin edits; Admin views. */
export default function UsersPage() {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { canEdit, readOnly, me } = useSession();
  const { date, dateTime, dateShort } = useFmt();
  const audit = useAuditFormat();
  const editable = canEdit('users') && !readOnly;
  const [tab, setTabState] = useState<Tab>((params.get('tab') as Tab) || 'team');
  const setTab = (v: Tab) => {
    setTabState(v);
    router.replace(v === 'team' ? pathname : `${pathname}?tab=${v}`);
  };
  const [adding, setAdding] = useState(false);
  const [member, setMember] = useState<Member | null>(null);
  useEffect(() => {
    if (params.get('new') === '1' && editable) setAdding(true);
  }, [params, editable]);

  const team = useQuery({ queryKey: ['users', 'team'], queryFn: () => api.get<Member[]>('/users') });
  const roles = useQuery({ queryKey: ['users', 'roles'], queryFn: () => api.get<RoleSummary[]>('/roles') });
  const invites = useQuery({ queryKey: ['users', 'invitations'], queryFn: () => api.get<{ items: Invitation[]; inviteValidityDays: number }>('/users/invitations') });
  const history = useQuery({ queryKey: ['users', 'history'], queryFn: () => api.get<AuditEntry[]>('/users/history'), enabled: tab === 'history' });

  const resend = useAction((id: string) => api.post(`/users/${id}/resend`), { success: t('users.invite.resent') });
  const cancel = useAction((id: string) => api.post(`/users/${id}/cancel-invite`), { success: t('users.invite.cancelled') });

  const members = team.data ?? [];
  const activeCount = members.filter((m) => m.status !== 'deactivated').length;

  const teamCols: Column<Member>[] = [
    {
      key: 'name',
      header: t('users.cols.name'),
      render: (m) => (
        <>
          <span className="nm">
            {m.name}
            {m.id === me.user.id && <span className="muted"> · {t('users.you')}</span>}
          </span>
          <span className="sb">
            <bdi>{m.email}</bdi>
          </span>
        </>
      ),
    },
    { key: 'role', header: t('users.cols.role'), render: (m) => <RoleName name={m.role.name} isSystem={m.role.isSystem} /> },
    { key: 'sees', header: t('users.cols.sees'), render: (m) => <WhatTheySee areas={m.role.areas} /> },
    { key: 'twoStep', header: t('users.cols.twoStep'), render: (m) => <TwoStepPill enabled={m.twoStepEnabled} required={m.role.twoStepRequired} /> },
    { key: 'status', header: tc('status'), render: (m) => <MemberStatusPill status={m.status} /> },
  ];
  const roleCols: Column<RoleSummary>[] = [
    {
      key: 'name',
      header: t('roles.cols.role'),
      render: (r) => (
        <>
          <span className="nm">{r.name}</span>
          {r.description && <span className="sb">{r.description}</span>}
        </>
      ),
    },
    { key: 'type', header: t('roles.cols.type'), render: (r) => (r.isSystem ? <Pill tone="mute">{t('roles.system')}</Pill> : <Pill tone="blue">{t('roles.custom')}</Pill>) },
    { key: 'scope', header: t('roles.cols.scope'), render: (r) => t(`roles.scope.${r.scope}`) },
    { key: 'sees', header: t('users.cols.sees'), render: (r) => <WhatTheySee areas={r.areas} /> },
    { key: 'members', header: t('roles.cols.members'), type: 'count', render: (r) => r.members },
  ];
  const inviteCols: Column<Invitation>[] = [
    {
      key: 'name',
      header: t('users.cols.name'),
      render: (i) => (
        <>
          <span className="nm">{i.name}</span>
          <span className="sb">
            <bdi>{i.email}</bdi>
          </span>
        </>
      ),
    },
    { key: 'role', header: t('users.cols.role'), render: (i) => i.roleName },
    { key: 'by', header: t('users.invite.invitedBy'), render: (i) => <>{i.invitedBy ?? '—'}<span className="sb">{date(i.createdAt)}</span></> },
    { key: 'expires', header: t('users.invite.expires'), render: (i) => (i.expired ? <Pill tone="bad">{t('users.invite.expired')}</Pill> : <span className="nowrap">{date(i.inviteExpiresAt)}</span>) },
    {
      key: 'actions',
      header: <span className="sr-only">{t('users.cols.actions')}</span>,
      render: (i) =>
        editable ? (
          <span className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
            <Button size="sm" icon={EnvelopeOpen} busy={resend.isPending && resend.variables === i.id} onClick={() => resend.mutate(i.id)}>
              {t('users.invite.resend')}
            </Button>
            <Button size="sm" icon={X} busy={cancel.isPending && cancel.variables === i.id} onClick={() => cancel.mutate(i.id)}>
              {t('users.invite.cancel')}
            </Button>
          </span>
        ) : null,
    },
  ];
  const historyCols: Column<AuditEntry>[] = [
    { key: 'time', header: t('audit.cols.time'), render: (e) => <span className="nowrap">{dateTime(e.at)}</span> },
    { key: 'person', header: t('audit.cols.person'), render: (e) => e.actorName ?? t('audit.system') },
    { key: 'action', header: t('audit.cols.action'), render: (e) => <span className="nm">{audit.action(e)}</span> },
    { key: 'record', header: t('audit.cols.record'), render: (e) => <bdi>{audit.record(e)}</bdi> },
    { key: 'change', header: t('audit.cols.change'), render: (e) => audit.changes(e) },
  ];

  if (team.isLoading) return <PageSkeleton />;
  const invitations = invites.data?.items ?? [];

  return (
    <div className="page">
      <PageHeader
        crumbs={[{ label: tc('nav.users') }]}
        kicker={t('users.kicker', { members: activeCount, roles: roles.data?.length ?? 0 })}
        title={tc('nav.users')}
        actions={
          editable && (
            <Button size="sm" variant="primary" icon={UserPlus} onClick={() => setAdding(true)}>
              {t('users.add.button')}
            </Button>
          )
        }
      />
      {!editable && !readOnly && <Banner>{t('users.viewOnly')}</Banner>}
      <Chips
        label={t('users.tabsLabel')}
        value={tab}
        onChange={setTab}
        options={[
          { value: 'team', label: t('users.tabs.team'), count: activeCount },
          { value: 'roles', label: t('users.tabs.roles'), count: roles.data?.length },
          { value: 'invitations', label: t('users.tabs.invitations'), count: invitations.length },
          { value: 'history', label: t('users.tabs.history') },
        ]}
      />

      {team.error ? (
        <ErrorState error={team.error} retry={() => team.refetch()} />
      ) : tab === 'team' ? (
        <>
          <Card flush className="only-wide">
            <Table columns={teamCols} rows={members} rowKey={(m) => m.id} onRow={setMember} rowClass={(m) => (m.status === 'deactivated' ? 'subtle' : '')} />
          </Card>
          <div className="list-cards only-phone">
            {members.map((m) => (
              <ListCard key={m.id} title={m.name} sub={`${m.role.name} · ${m.email}`} status={<MemberStatusPill status={m.status} />} onClick={() => setMember(m)} />
            ))}
          </div>
        </>
      ) : tab === 'roles' ? (
        <>
          <Card flush className="only-wide">
            <Table columns={roleCols} rows={roles.data ?? []} rowKey={(r) => r.id} onRow={(r) => router.push(`/users/roles/${r.id}`)} />
          </Card>
          <div className="list-cards only-phone">
            {(roles.data ?? []).map((r) => (
              <ListCard key={r.id} href={`/users/roles/${r.id}`} title={r.name} sub={`${t(`roles.scope.${r.scope}`)} · ${t('roles.membersCount', { n: r.members })}`} status={r.isSystem ? <Pill tone="mute">{t('roles.system')}</Pill> : <Pill tone="blue">{t('roles.custom')}</Pill>} />
            ))}
          </div>
        </>
      ) : tab === 'invitations' ? (
        invitations.length === 0 ? (
          <Card>
            <EmptyState
              icon={EnvelopeOpen}
              title={t('users.invite.emptyTitle')}
              text={t('users.invite.emptyText')}
              action={
                editable ? (
                  <Button variant="primary" icon={UserPlus} onClick={() => setAdding(true)}>
                    {t('users.add.button')}
                  </Button>
                ) : undefined
              }
            />
          </Card>
        ) : (
          <>
            {(resend.errorText || cancel.errorText) && <Banner tone="bad">{resend.errorText ?? cancel.errorText}</Banner>}
            <Card flush className="only-wide">
              <Table columns={inviteCols} rows={invitations} rowKey={(i) => i.id} />
            </Card>
            <div className="list-cards only-phone">
              {invitations.map((i) => (
                <div key={i.id} className="an-card">
                  <div className="row between">
                    <span className="strong">{i.name}</span>
                    {i.expired ? <Pill tone="bad">{t('users.invite.expired')}</Pill> : <span className="muted body-sm">{t('users.invite.until', { date: dateShort(i.inviteExpiresAt) })}</span>}
                  </div>
                  <span className="muted body-sm">
                    {i.roleName} · <bdi>{i.email}</bdi>
                  </span>
                  {editable && (
                    <div className="row">
                      <Button size="sm" block icon={EnvelopeOpen} onClick={() => resend.mutate(i.id)}>
                        {t('users.invite.resend')}
                      </Button>
                      <Button size="sm" block icon={X} onClick={() => cancel.mutate(i.id)}>
                        {t('users.invite.cancel')}
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )
      ) : history.isLoading ? (
        <PageSkeleton />
      ) : (history.data ?? []).length === 0 ? (
        <Card>
          <EmptyState icon={ClockCounterClockwise} title={t('users.history.emptyTitle')} text={t('users.history.emptyText')} />
        </Card>
      ) : (
        <>
          <Card flush className="only-wide">
            <Table columns={historyCols} rows={history.data ?? []} rowKey={(e) => e.id} />
          </Card>
          <div className="list-cards only-phone">
            {(history.data ?? []).map((e) => (
              <ListCard key={e.id} title={audit.action(e)} amount={<span className="body-sm muted">{dateShort(e.at)}</span>} sub={`${e.actorName ?? t('audit.system')} · ${audit.record(e)}${audit.changesText(e) ? ` · ${audit.changesText(e)}` : ''}`} />
            ))}
          </div>
        </>
      )}

      <AddMemberSheet
        open={adding}
        onClose={() => {
          setAdding(false);
          if (params.get('new')) router.replace(pathname);
        }}
        roles={roles.data ?? []}
        validityDays={invites.data?.inviteValidityDays ?? 7}
      />
      <MemberSheet member={member} onClose={() => setMember(null)} roles={roles.data ?? []} editable={editable} isSelf={member?.id === me.user.id} onResend={(id) => resend.mutate(id)} />
    </div>
  );
}

function AddMemberSheet({ open, onClose, roles, validityDays }: { open: boolean; onClose: () => void; roles: RoleSummary[]; validityDays: number }) {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState('');
  const [language, setLanguage] = useState<'en' | 'bg' | 'he'>('bg');
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!open) return;
    setName('');
    setEmail('');
    setRoleId('');
    setLanguage('bg');
    setMessage('');
  }, [open]);
  const save = useAction((v: { name: string; email: string; roleId: string; language: string; message?: string }) => api.post<{ id: string }>('/users/invite', v), {
    success: t('users.add.sent', { email }),
    onDone: onClose,
  });
  const role = roles.find((r) => r.id === roleId);
  const f = save.fields;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      dirty={!!(name || email)}
      title={t('users.add.title')}
      sub={t('users.add.sub', { n: validityDays })}
      footer={
        <>
          <Button onClick={onClose}>{tc('cancel')}</Button>
          <Button variant="primary" icon={EnvelopeOpen} busy={save.isPending} disabled={!name.trim() || !email.trim() || !roleId} onClick={() => save.mutate({ name, email, roleId, language, message: message.trim() || undefined })}>
            {t('users.add.send')}
          </Button>
        </>
      }
    >
      {save.errorText && !Object.keys(f).length && <Banner tone="bad">{save.errorText}</Banner>}
      <TextField label={t('users.add.name')} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" error={f.name} />
      <TextField label={tc('email')} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" error={f.email} />
      <Select
        label={t('users.cols.role')}
        value={roleId}
        placeholder={t('users.add.pickRole')}
        onChange={(e) => setRoleId(e.target.value)}
        options={roles.map((r) => ({ value: r.id, label: r.isSystem ? r.name : `${r.name} · ${t('roles.custom')}` }))}
        help={role ? `${role.description ?? ''}${role.description ? ' · ' : ''}${t(`roles.scope.${role.scope}`)}${role.twoStepRequired ? ` · ${t('roles.twoStepRequired')}` : ''}` : t('users.add.roleHelp')}
        error={f.roleId}
      />
      <div className="an-field">
        <label>{tc('language')}</label>
        <Segmented fill label={tc('language')} value={language} onChange={setLanguage} options={(['en', 'bg', 'he'] as const).map((l) => ({ value: l, label: t(`languages.${l}`) }))} />
      </div>
      <TextArea label={tc('messageOptional')} value={message} onChange={(e) => setMessage(e.target.value)} rows={3} placeholder={t('users.add.messagePlaceholder')} />
    </Sheet>
  );
}

function MemberSheet({ member, onClose, roles, editable, isSelf, onResend }: { member: Member | null; onClose: () => void; roles: RoleSummary[]; editable: boolean; isSelf: boolean; onResend: (id: string) => void }) {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const { date, dateTime } = useFmt();
  const [roleId, setRoleId] = useState('');
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    setRoleId(member?.role.id ?? '');
    setConfirm(false);
  }, [member]);
  const update = useAction((v: { roleId?: string; status?: 'active' | 'deactivated' }) => api.patch(`/users/${member!.id}`, v), {
    success: (_r) => t('users.member.saved'),
    onDone: onClose,
  });
  if (!member) return null;
  const canChange = editable && !isSelf;
  const roleChanged = roleId && roleId !== member.role.id;
  return (
    <Sheet
      open={!!member}
      onClose={onClose}
      title={member.name}
      sub={member.email}
      footer={
        canChange && member.status !== 'invited' ? (
          roleChanged ? (
            <>
              <Button onClick={() => setRoleId(member.role.id)}>{tc('cancel')}</Button>
              <Button variant="primary" busy={update.isPending} onClick={() => update.mutate({ roleId })}>
                {t('users.member.saveRole')}
              </Button>
            </>
          ) : member.status === 'active' ? (
            confirm ? (
              <>
                <Button onClick={() => setConfirm(false)}>{tc('cancel')}</Button>
                <Button variant="primary" busy={update.isPending} onClick={() => update.mutate({ status: 'deactivated' })}>
                  {t('users.member.confirmDeactivate')}
                </Button>
              </>
            ) : (
              <Button onClick={() => setConfirm(true)}>{t('users.member.deactivate')}</Button>
            )
          ) : member.hasPassword ? (
            <Button variant="primary" icon={ArrowCounterClockwise} busy={update.isPending} onClick={() => update.mutate({ status: 'active' })}>
              {t('users.member.reactivate')}
            </Button>
          ) : (
            <Button variant="primary" icon={EnvelopeOpen} onClick={() => { onResend(member.id); onClose(); }}>
              {t('users.invite.resend')}
            </Button>
          )
        ) : canChange && member.status === 'invited' ? (
          <Button variant="primary" icon={EnvelopeOpen} onClick={() => { onResend(member.id); onClose(); }}>
            {t('users.invite.resend')}
          </Button>
        ) : undefined
      }
    >
      {update.errorText && <Banner tone="bad">{update.errorText}</Banner>}
      {confirm && <Banner tone="bad">{t('users.member.deactivateWarning', { name: member.name })}</Banner>}
      {isSelf && <Banner>{t('users.member.selfNote')}</Banner>}
      <KeyValue
        items={[
          [tc('status'), <MemberStatusPill key="s" status={member.status} />],
          [t('users.cols.twoStep'), <TwoStepPill key="t" enabled={member.twoStepEnabled} required={member.role.twoStepRequired} />],
          [t('users.cols.sees'), <WhatTheySee key="w" areas={member.role.areas} />],
          [tc('language'), t.has(`languages.${member.language}`) ? t(`languages.${member.language}`) : member.language],
          [t('users.member.lastSignIn'), member.lastSignInAt ? dateTime(member.lastSignInAt) : t('users.member.never')],
          ...(member.status === 'invited' ? ([[t('users.invite.expires'), date(member.inviteExpiresAt)]] as [string, string][]) : []),
          ...(member.phone ? ([[t('users.member.phone'), <bdi key="p">{member.phone}</bdi>]] as [string, React.ReactNode][]) : []),
        ]}
      />
      {canChange && member.status === 'active' ? (
        <Select label={t('users.cols.role')} value={roleId} onChange={(e) => setRoleId(e.target.value)} options={roles.map((r) => ({ value: r.id, label: r.name }))} help={roles.find((r) => r.id === roleId)?.description ?? undefined} error={update.fields.roleId} />
      ) : (
        <KeyValue items={[[t('users.cols.role'), <RoleName key="r" name={member.role.name} isSystem={member.role.isSystem} />]]} />
      )}
      {member.status === 'deactivated' && <p className="muted body-sm">{t('users.member.deactivatedNote')}</p>}
      <a className="link body-sm" href={`/users/roles/${member.role.id}`}>
        <Users className="an-ic sm" aria-hidden /> {t('users.member.openRole', { role: member.role.name })}
      </a>
    </Sheet>
  );
}

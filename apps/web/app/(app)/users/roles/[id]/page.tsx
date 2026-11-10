'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { AREAS, SENSITIVE_ACTIONS, STEP_UP_ACTIONS, type AccessLevel, type Area, type AreaMatrix, type SensitiveAction } from '@ananda/shared';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useFmt } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Banner, Button, Card, Eye, ListRow, Lock, NotePencil, PageHeader, PageSkeleton, Pill, Segmented, Sheet, Switch, Table, TextArea, TextField, Users, X, type Column } from '@/components/ui';
import { MemberStatusPill, WhatTheySee, type RoleSummary } from '../../_components/shared';

interface RoleDetail extends Omit<RoleSummary, 'members'> {
  members: { id: string; name: string; email: string; status: 'invited' | 'active' | 'deactivated'; twoStepEnabled: boolean; lastSignInAt: string | null }[];
}

const TONES = { hidden: 't-mute', view: 't-info', edit: 't-good' } as const;

/** Role detail: area matrix, record scope, sensitive actions, members, Preview as role, Duplicate. */
export default function RolePage() {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { canEdit, readOnly, me } = useSession();
  const { dateShort } = useFmt();
  const q = useQuery({ queryKey: ['users', 'role', id], queryFn: () => api.get<RoleDetail>(`/roles/${id}`) });
  const [renaming, setRenaming] = useState(false);
  const [removing, setRemoving] = useState(false);

  const editableUsers = canEdit('users') && !readOnly;
  const role = q.data;
  const editable = editableUsers && !!role && !role.isSystem;
  const isSystemAdmin = me.user.baseRole === 'system_admin';

  const save = useAction((v: { name: string; description?: string; areas: AreaMatrix; sensitive: string[] }) => api.patch(`/roles/${id}`, v), { success: t('roles.saved') });
  const duplicate = useAction(() => api.post<{ id: string }>(`/roles/${id}/duplicate`), { success: t('roles.duplicated'), onDone: (r) => router.push(`/users/roles/${r.id}`) });
  const remove = useAction(() => api.del(`/roles/${id}`), { success: t('roles.removed'), onDone: () => router.push('/users?tab=roles') });
  const preview = useAction(() => api.post('/auth/preview', { roleId: id }), {
    onDone: () => {
      window.location.assign('/home');
    },
  });

  if (q.isLoading) return <PageSkeleton />;
  if (q.error || !role) return <div className="page"><Banner tone="bad">{q.error instanceof Error ? q.error.message : tc('notFound')}</Banner></div>;

  const push = (patch: Partial<{ name: string; description: string; areas: AreaMatrix; sensitive: string[] }>) =>
    save.mutate({ name: role.name, description: role.description ?? undefined, areas: role.areas, sensitive: role.sensitive, ...patch });
  const setArea = (a: Area, lvl: AccessLevel) => push({ areas: { ...role.areas, [a]: lvl } });
  const setSensitive = (s: SensitiveAction, on: boolean) => push({ sensitive: on ? [...role.sensitive, s] : role.sensitive.filter((x) => x !== s) });
  const blocked = (s: SensitiveAction) => (role.baseRole === 'warehouse' && s === 'see_prices') || (role.baseRole !== 'system_admin' && s === 'change_rules');

  const matrixCols: Column<Area>[] = [
    { key: 'area', header: t('roles.cols.area'), render: (a) => <span className="nm">{tc(`nav.${a}`)}</span> },
    {
      key: 'level',
      header: t('roles.cols.access'),
      className: 'amt',
      render: (a) => (
        <span className="row end">
          <Segmented<AccessLevel>
            label={tc(`nav.${a}`)}
            value={role.areas[a]}
            onChange={(v) => setArea(a, v)}
            tones={TONES}
            disabled={!editable || save.isPending}
            options={(['hidden', 'view', 'edit'] as AccessLevel[]).map((l) => ({ value: l, label: t(`roles.level.${l}`) }))}
          />
        </span>
      ),
    },
  ];

  return (
    <div className="page">
      <PageHeader
        crumbs={[{ label: tc('nav.users'), href: '/users?tab=roles' }, { label: role.name }]}
        kicker={`${role.isSystem ? t('roles.system') : t('roles.custom')} · ${t('roles.membersCount', { n: role.members.filter((m) => m.status !== 'deactivated').length })}`}
        title={role.name}
        actions={
          <>
            {isSystemAdmin && !readOnly && (
              <Button size="sm" icon={Eye} busy={preview.isPending} onClick={() => preview.mutate(undefined)}>
                {t('roles.preview')}
              </Button>
            )}
            {editable && (
              <Button size="sm" icon={NotePencil} onClick={() => setRenaming(true)}>
                {t('roles.rename')}
              </Button>
            )}
            {editable && role.members.length === 0 && (
              <Button size="sm" icon={X} onClick={() => setRemoving(true)}>
                {t('roles.remove')}
              </Button>
            )}
            {editableUsers && (
              <Button size="sm" variant="primary" icon={Users} busy={duplicate.isPending} onClick={() => duplicate.mutate(undefined)}>
                {t('roles.duplicate')}
              </Button>
            )}
          </>
        }
      />
      {role.isSystem ? <Banner sub={role.description ?? undefined}>{t('roles.systemNote')}</Banner> : role.description ? <p className="muted">{role.description}</p> : null}
      {(save.errorText || duplicate.errorText || preview.errorText) && <Banner tone="bad">{save.errorText ?? duplicate.errorText ?? preview.errorText}</Banner>}

      <div className="cols">
        <Card flush className="matrix" title={<>{t('roles.whatTheySee')} · <WhatTheySee areas={role.areas} /></>}>
          <Table columns={matrixCols} rows={[...AREAS]} rowKey={(a) => a} />
        </Card>
        <div className="stack loose">
          <Card title={t('roles.recordScope')}>
            <ListRow icon={Lock} title={t(`roles.scope.${role.scope}`)} sub={t(`roles.scopeHelp.${role.scope}`)} />
            <ListRow icon={Lock} title={role.twoStepRequired ? t('roles.twoStepRequired') : t('roles.twoStepOptional')} sub={t('roles.twoStepHelp')} />
          </Card>
          <Card title={t('roles.sensitive')}>
            <div className="stack tight">
              {SENSITIVE_ACTIONS.map((s) => (
                <div key={s} className="stack" style={{ gap: 0 }}>
                  <Switch checked={role.sensitive.includes(s)} onChange={(v) => setSensitive(s, v)} label={t(`roles.actions.${s}`)} disabled={!editable || save.isPending || (blocked(s) && !role.sensitive.includes(s))} />
                  {STEP_UP_ACTIONS.includes(s) && <span className="muted caption" style={{ paddingInlineStart: 'calc(40px + var(--space-3))' }}>{t('roles.needsCode')}</span>}
                </div>
              ))}
            </div>
          </Card>
          <Card title={t('roles.members')}>
            {role.members.length === 0 ? (
              <p className="muted">{t('roles.noMembers')}</p>
            ) : (
              <div className="lrows">
                {role.members.map((m) => (
                  <ListRow
                    key={m.id}
                    icon={Users}
                    title={m.name}
                    sub={
                      <>
                        <bdi>{m.email}</bdi>
                        {m.lastSignInAt && ` · ${t('roles.lastSeen', { date: dateShort(m.lastSignInAt) })}`}
                      </>
                    }
                    value={<MemberStatusPill status={m.status} />}
                  />
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      <RenameSheet open={renaming} onClose={() => setRenaming(false)} role={role} onSave={(v) => push(v)} busy={save.isPending} />
      <Sheet
        open={removing}
        onClose={() => setRemoving(false)}
        title={t('roles.removeTitle', { name: role.name })}
        footer={
          <>
            <Button onClick={() => setRemoving(false)}>{tc('cancel')}</Button>
            <Button variant="primary" busy={remove.isPending} onClick={() => remove.mutate(undefined)}>
              {t('roles.remove')}
            </Button>
          </>
        }
      >
        {remove.errorText && <Banner tone="bad">{remove.errorText}</Banner>}
        <p className="muted">{t('roles.removeText')}</p>
        <Pill tone="mute">{t('roles.membersCount', { n: 0 })}</Pill>
      </Sheet>
    </div>
  );
}

function RenameSheet({ open, onClose, role, onSave, busy }: { open: boolean; onClose: () => void; role: RoleDetail; onSave: (v: { name: string; description: string }) => void; busy: boolean }) {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? '');
  useEffect(() => {
    if (open) {
      setName(role.name);
      setDescription(role.description ?? '');
    }
  }, [open, role]);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('roles.rename')}
      footer={
        <>
          <Button onClick={onClose}>{tc('cancel')}</Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={!name.trim()}
            onClick={() => {
              onSave({ name: name.trim(), description: description.trim() });
              onClose();
            }}
          >
            {tc('save')}
          </Button>
        </>
      }
    >
      <TextField label={t('roles.name')} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
      <TextArea label={t('roles.description')} value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={500} help={t('roles.descriptionHelp')} />
    </Sheet>
  );
}

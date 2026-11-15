'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { AREAS, SENSITIVE_ACTIONS, type AccessLevel, type Area, type AreaMatrix, type RecordScope, type SensitiveAction } from '@ananda/shared';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { ActionError, CaretLeft, Button, Card, Chips, CaretRight, Count, Eye, Icon, ListCard, ListCards, ListRow, Lock, PageState, Pill, Plus, Segmented, ShieldCheck, Switch, Table, Users, type Column } from '@/components/ui';
import { useRoleText, type RoleSummary } from './shared';
import css from '../users.module.css';

interface RoleDetail extends Omit<RoleSummary, 'members'> {
  members: { id: string; name: string; email: string; status: 'invited' | 'active' | 'deactivated'; twoStepEnabled: boolean; lastSignInAt: string | null }[];
}

const TONES = { hidden: 't-mute', view: 't-info', edit: 't-good' } as const;
const SCOPES: RecordScope[] = ['all', 'own', 'shipping'];
const MONEY: SensitiveAction[] = ['confirm_payment', 'pay_commission', 'record_supplier_payment'];

/** Roles tab: the five system roles and any custom ones; a row opens the permissions grid in place. */
export function RolesList({ roles, loading, error, onRetry, onOpen }: { roles: RoleSummary[]; loading: boolean; error: unknown; onRetry: () => void; onOpen: (id: string) => void }) {
  const t = useTranslations('admin');
  const rt = useRoleText();
  const cols: Column<RoleSummary>[] = [
    {
      key: 'role',
      header: t('roles.cols.role'),
      render: (r) => (
        <>
          <span className="nm">{rt.name(r)}</span>
          <span className="sb">{r.isSystem ? t('roles.system') : t('roles.custom')}</span>
        </>
      ),
    },
    { key: 'can', header: t('roles.cols.canDo'), trunc: 420, render: (r) => rt.description(r) },
    { key: 'access', header: t('roles.cols.access'), render: (r) => <span className="muted body-sm nowrap">{rt.sum(r.areas)}</span> },
    { key: 'members', header: t('roles.cols.members'), type: 'count', render: (r) => r.members },
    { key: 'go', header: '', className: css.chev, render: () => <Icon as={CaretRight} size="sm" className="subtle" /> },
  ];
  return (
    <>
      <Card flush className="only-wide">
        <Table columns={cols} rows={roles} rowKey={(r) => r.id} onRow={(r) => onOpen(r.id)} loading={loading} error={error} onRetry={onRetry} />
        <div className={css.foot}>{t('roles.listFoot')}</div>
      </Card>
      <div className="only-phone stack">
        <ListCards loading={loading} error={error} onRetry={onRetry}>
          {roles.map((r) => (
            <ListCard
              key={r.id}
              title={rt.name(r)}
              status={<Pill tone={r.isSystem ? 'mute' : 'blue'}>{r.isSystem ? t('roles.phoneSystem') : t('roles.phoneCustom')}</Pill>}
              sub={
                <>
                  {rt.description(r)}
                  <br />
                  {t('roles.phoneSum', { ...countsOf(r.areas), members: r.members })}
                </>
              }
            />
          ))}
        </ListCards>
        <p className="muted body-sm">{t('roles.phoneFoot')}</p>
      </div>
    </>
  );
}

function countsOf(areas: AreaMatrix) {
  const v = Object.values(areas);
  return { edit: v.filter((x) => x === 'edit').length, view: v.filter((x) => x === 'view').length, hidden: v.filter((x) => x === 'hidden').length };
}

/** One role: header with All roles / Preview / Duplicate / Delete, the area grid, which records, sensitive actions, members. */
export function RoleDetailView({ id, onBack, onOpenRole, onOpenMember }: { id: string; onBack: () => void; onOpenRole: (id: string) => void; onOpenMember: (id: string) => void }) {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const rt = useRoleText();
  const { canEdit, readOnly, me } = useSession();
  const q = useQuery({ queryKey: ['users', 'role', id], queryFn: () => api.get<RoleDetail>(`/roles/${id}`) });
  const role = q.data;
  const editableUsers = canEdit('users') && !readOnly;
  const editable = editableUsers && !!role && !role.isSystem;
  const [name, setName] = useState('');
  useEffect(() => {
    if (role) setName(rt.name(role));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role?.id, role?.name]);

  const save = useAction((v: { name: string; description?: string; areas: AreaMatrix; sensitive: string[]; scope: RecordScope }) => api.patch(`/roles/${id}`, v));
  const duplicate = useAction(
    () => {
      const base = rt.name(role!);
      return api.post<{ id: string }>(`/roles/${id}/duplicate`, { name: t('roles.customName', { name: base }), description: t('roles.customDesc', { name: base }) });
    },
    { success: () => t('roles.created', { name: t('roles.customName', { name: rt.name(role!) }) }), onDone: (r) => onOpenRole(r.id) },
  );
  const remove = useAction(() => api.del(`/roles/${id}`), { success: t('roles.deleted'), onDone: onBack, errorToast: true });
  const preview = useAction(() => api.post('/auth/preview', { roleId: id }), { onDone: () => window.location.assign('/home'), errorToast: true });

  if (!role) return <PageState query={q} />;

  const push = (patch: Partial<{ name: string; areas: AreaMatrix; sensitive: string[]; scope: RecordScope }>) =>
    save.mutate({ name: role.name, description: role.description ?? undefined, areas: role.areas, sensitive: role.sensitive, scope: role.scope, ...patch });
  const isBroker = role.baseRole === 'broker';
  const blocked = (s: SensitiveAction) => (role.baseRole === 'warehouse' && s === 'see_prices') || (role.baseRole !== 'system_admin' && s === 'change_rules');
  const movesMoney = MONEY.some((s) => role.sensitive.includes(s));
  const isSystemAdmin = me.user.baseRole === 'system_admin';
  const activeMembers = role.members.filter((m) => m.status !== 'deactivated');

  const matrixCols: Column<Area>[] = [
    { key: 'area', header: t('roles.cols.area'), render: (a) => tc(`nav.${a}`) },
    {
      key: 'level',
      header: t('roles.cols.access'),
      type: 'amount',
      render: (a) => (
        <Segmented<AccessLevel>
          label={tc(`nav.${a}`)}
          value={role.areas[a]}
          onChange={(v) => push({ areas: { ...role.areas, [a]: v } })}
          tones={TONES}
          disabled={!editable || save.isPending}
          options={(['hidden', 'view', 'edit'] as AccessLevel[]).map((l) => ({ value: l, label: t(`roles.level.${l}`) }))}
        />
      ),
    },
  ];

  return (
    <div className="stack loose">
      <div className={css.roleHead}>
        <Button icon={CaretLeft} onClick={onBack}>
          {t('roles.allRoles')}
        </Button>
        {editable ? (
          <input
            className={`an-input ${css.roleName}`}
            aria-label={t('roles.nameLabel')}
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && name.trim() !== role.name && push({ name: name.trim() })}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        ) : (
          <b className={css.roleTitle}>{rt.name(role)}</b>
        )}
        <Pill tone={role.isSystem ? 'mute' : 'blue'}>{role.isSystem ? t('roles.locked') : t('roles.custom')}</Pill>
        <span className={css.roleActs}>
          {isSystemAdmin && !readOnly && role.baseRole !== 'system_admin' && (
            <Button icon={Eye} busy={preview.isPending} onClick={() => preview.mutate(undefined)}>
              {t('roles.previewAs', { name: rt.name(role) })}
            </Button>
          )}
          {editableUsers && !isBroker && (
            <Button icon={Plus} writes busy={duplicate.isPending} onClick={() => duplicate.mutate(undefined)}>
              {t('roles.duplicate')}
            </Button>
          )}
          {editable && role.members.length === 0 && (
            <Button className={css.danger} writes busy={remove.isPending} onClick={() => remove.mutate(undefined)}>
              {t('roles.delete')}
            </Button>
          )}
        </span>
      </div>
      <ActionError action={save.error ? save : duplicate.error ? duplicate : undefined} />
      {save.fields.name && <p className="an-help error">{save.fields.name}</p>}
      {role.isSystem && (
        <div className={css.lockNote}>
          <Icon as={Lock} size="sm" />
          <span>{isBroker ? t('roles.brokerNote') : t('roles.systemNote')}</span>
        </div>
      )}

      <div className={css.roleGrid}>
        <Card flush className={css.matrixCard}>
          <div className={css.cardHead}>
            <h2>{t('roles.matrixTitle')}</h2>
            <span className="muted body-sm">{t('roles.matrixSub')}</span>
          </div>
          <Table columns={matrixCols} rows={[...AREAS]} rowKey={(a) => a} />
        </Card>
        <div className="stack loose">
          <Card title={t('roles.records')}>
            {!editable || isBroker || role.baseRole === 'broker' || save.isPending ? (
              <span><Pill tone="mute">{t(`roles.scope.${role.scope}`)}</Pill></span>
            ) : (
              <Chips label={t('roles.records')} value={role.scope} onChange={(s) => role.scope !== s && push({ scope: s })} options={SCOPES.map((s) => ({ value: s, label: t(`roles.scope.${s}`) }))} />
            )}
            {save.fields.scope && <p className="an-help error">{save.fields.scope}</p>}
          </Card>
          <Card title={t('roles.sensitive')}>
            <div className={css.switches}>
              {SENSITIVE_ACTIONS.map((s) => (
                <div key={s} className={css.swRow}>
                  <span>
                    {t(`roles.actions.${s}`)}
                    {t.has(`roles.hints.${s}`) && <span className="sub">{t(`roles.hints.${s}`)}</span>}
                  </span>
                  <Switch
                    checked={role.sensitive.includes(s)}
                    onChange={(v) => push({ sensitive: v ? [...role.sensitive, s] : role.sensitive.filter((x) => x !== s) })}
                    label={t(`roles.actions.${s}`)}
                    disabled={!editable || save.isPending || (blocked(s) && !role.sensitive.includes(s))}
                  />
                </div>
              ))}
            </div>
            {(movesMoney || role.twoStepRequired) && (
              <span className={`muted ${css.tfa}`}>
                <Icon as={ShieldCheck} size="sm" /> {t('roles.tfaNote')}
              </span>
            )}
          </Card>
          <Card
            title={
              <>
                {t('roles.members')} <Count n={activeMembers.length} />
              </>
            }
          >
            {activeMembers.length === 0 ? (
              <p className="muted">{t('roles.noMembers')}</p>
            ) : (
              <div className="lrows">
                {activeMembers.map((m) => (
                  <ListRow key={m.id} icon={Users} title={m.name} sub={m.twoStepEnabled ? t('roles.memberSub.on') : t('roles.memberSub.off')} onClick={() => onOpenMember(m.id)} />
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

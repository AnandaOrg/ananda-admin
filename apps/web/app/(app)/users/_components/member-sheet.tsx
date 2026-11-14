'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useFmt } from '@/lib/format';
import { ActionError, Banner, Button, Pill, Select, Sheet } from '@/components/ui';
import { MemberStatusPill, deviceName, useRoleText, type Member, type RoleSummary } from './shared';
import css from '../users.module.css';

/** A member: status, two-factor sign-in, last sign-in and devices; change role, suspend or restore access. */
export function MemberSheet({ member, onClose, roles, editable, isSelf }: { member: Member | null; onClose: () => void; roles: RoleSummary[]; editable: boolean; isSelf: boolean }) {
  const t = useTranslations('admin');
  const rt = useRoleText();
  const { dateTime, date } = useFmt();
  const [roleId, setRoleId] = useState('');
  useEffect(() => setRoleId(member?.role.id ?? ''), [member]);

  const saveRole = useAction((v: { roleId: string }) => api.patch(`/users/${member!.id}`, v), {
    success: () => t('users.member.savedRole', { name: member!.name, role: rt.name(roles.find((r) => r.id === roleId) ?? member!.role) }),
    onDone: onClose,
  });
  const suspend = useAction((status: 'active' | 'deactivated') => api.patch(`/users/${member!.id}`, { status }), {
    success: (_r) => (member!.status === 'active' ? t('users.member.suspended', { name: member!.name }) : t('users.member.restored', { name: member!.name })),
    onDone: onClose,
  });
  const resend = useAction(() => api.post(`/users/${member!.id}/resend`), { success: t('users.invite.resent'), onDone: onClose });
  const cancel = useAction(() => api.post(`/users/${member!.id}/cancel-invite`), { success: t('users.invite.cancelled'), onDone: onClose });
  if (!member) return null;

  const canChange = editable && !isSelf;
  const isBroker = member.role.baseRole === 'broker';
  // A broker's account stays a broker; nobody else becomes one. System admin isn't offered here either.
  const options = roles.filter((r) => r.baseRole !== 'broker' && (r.baseRole !== 'system_admin' || r.id === member.role.id));
  const devices = member.devices ?? [];
  const invited = member.status === 'invited';

  return (
    <Sheet open={!!member} onClose={onClose} title={member.name} sub={rt.name(member.role)}>
      {isSelf && <Banner>{t('users.member.selfNote')}</Banner>}
      <div className={css.box}>
        <div>
          <span>{t('users.member.status')}</span>
          <MemberStatusPill status={member.status} />
        </div>
        {invited ? (
          <div>
            <span>{t('users.cols.invited')}</span>
            <span>{t('users.invite.sentOn', { date: date(member.createdAt), until: date(member.inviteExpiresAt) })}</span>
          </div>
        ) : (
          <>
            <div>
              <span>{t('users.cols.twoStep')}</span>
              <span>{member.twoStepEnabled ? t('users.twoStep.on') : member.role.twoStepRequired ? t('users.twoStep.atSignIn') : t('users.twoStep.off')}</span>
            </div>
            <div>
              <span>{t('users.member.lastSignIn')}</span>
              <span>{member.lastSignInAt ? dateTime(member.lastSignInAt) : t('users.member.never')}</span>
            </div>
            <div>
              <span>{t('users.member.signedInOn')}</span>
              <span>{devices.length ? devices.map((d) => deviceName(d.userAgent, d.device === 'phone' ? t('users.member.phoneDevice') : t('users.member.desktopDevice'))).join(', ') : t('users.member.noDevice')}</span>
            </div>
          </>
        )}
      </div>

      <span className={css.sgrp}>{t('users.member.roleGroup')}</span>
      {isBroker ? (
        <div className={css.fixedRole}>
          <span>
            {rt.name(member.role)}
            <span className="sub">{t('users.member.brokerFixed')}</span>
          </span>
          <Pill tone="blue">{t('users.member.fixed')}</Pill>
        </div>
      ) : canChange && !invited && member.status === 'active' ? (
        <Select label={t('users.member.roleGroup')} value={roleId} onChange={(e) => setRoleId(e.target.value)} options={options.map((r) => ({ value: r.id, label: rt.name(r) }))} error={saveRole.fields.roleId} />
      ) : (
        <div className={css.fixedRole}>
          <span>{rt.name(member.role)}</span>
        </div>
      )}

      <ActionError action={saveRole.error && !saveRole.fields.roleId ? saveRole : suspend.error ? suspend : resend.error ? resend : cancel.error ? cancel : undefined} />
      {canChange &&
        (invited ? (
          <div className={css.btns}>
            <Button className={css.danger} writes busy={cancel.isPending} onClick={() => cancel.mutate(undefined)}>
              {t('users.member.cancelInvite')}
            </Button>
            <Button variant="primary" busy={resend.isPending} onClick={() => resend.mutate(undefined)}>
              {t('users.invite.resendFull')}
            </Button>
          </div>
        ) : (
          <div className={css.btns}>
            {member.status === 'active' || member.hasPassword ? (
              <Button className={member.status === 'active' ? css.danger : undefined} writes busy={suspend.isPending} onClick={() => suspend.mutate(member.status === 'active' ? 'deactivated' : 'active')}>
                {member.status === 'active' ? t('users.member.suspend') : t('users.member.restore')}
              </Button>
            ) : (
              <Button writes busy={resend.isPending} onClick={() => resend.mutate(undefined)}>
                {t('users.invite.resendFull')}
              </Button>
            )}
            <Button variant="primary" busy={saveRole.isPending} disabled={isBroker || member.status !== 'active' || roleId === member.role.id} onClick={() => saveRole.mutate({ roleId })}>
              {t('users.member.save')}
            </Button>
          </div>
        ))}
    </Sheet>
  );
}

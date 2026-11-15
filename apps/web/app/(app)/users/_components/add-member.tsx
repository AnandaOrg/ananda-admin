'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { DEFAULT_RULES, SYSTEM_ROLES } from '@ananda/shared';
import { api, errorText } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useFmt } from '@/lib/format';
import { useSession } from '@/lib/session';
import { ActionError, Button, Pill, Select, Sheet, TextField } from '@/components/ui';
import { useRoleText, type RoleSummary } from './shared';
import css from '../users.module.css';

type Tone = 'friendly' | 'short' | 'formal';
const TONES: Tone[] = ['friendly', 'short', 'formal'];
const ORDER = ['broker', 'admin', 'warehouse', 'finance', 'system_admin'];

/**
 * Add member: name, e-mail, role and the invitation e-mail itself, pre-written for the role and
 * editable, with Polish with AI in three tones. The sign-up link is added under it when it's sent.
 */
export function AddMemberSheet({ open, onClose, roles, validityDays }: { open: boolean; onClose: () => void; roles: RoleSummary[]; validityDays: number }) {
  const t = useTranslations('admin');
  const locale = useLocale();
  const rt = useRoleText();
  const { money } = useFmt();
  const { me, canView } = useSession();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState('');
  const [letter, setLetter] = useState('');
  const [edited, setEdited] = useState(false);
  const [original, setOriginal] = useState<string | null>(null);
  const [tone, setTone] = useState<Tone>('friendly');
  const [polishing, setPolishing] = useState(false);
  const [polishError, setPolishError] = useState<string | null>(null);
  const ai = useQuery({ queryKey: ['ai-status'], queryFn: () => api.get<{ enabled: boolean }>('/ai/status'), staleTime: Infinity });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get<{ rules: { commissionPerUnitCents: number } }>('/settings'), enabled: open && canView('settings') });
  const aiOn = !!ai.data?.enabled;
  const commission = settings.data?.rules.commissionPerUnitCents ?? DEFAULT_RULES.commissionPerUnitCents;

  const sorted = useMemo(() => [...roles].sort((a, b) => (a.isSystem === b.isSystem ? ORDER.indexOf(a.baseRole) - ORDER.indexOf(b.baseRole) : a.isSystem ? -1 : 1)), [roles]);
  const role = roles.find((r) => r.id === roleId);
  const first = name.trim().split(/\s+/)[0] ?? '';

  /** The pre-written e-mail for the chosen role (a broker's when none is chosen yet, as an example). */
  const template = useMemo(() => {
    const r = role ?? roles.find((x) => x.key === 'broker');
    const base = r?.baseRole ?? 'broker';
    const as = r && !r.isSystem ? t('users.add.roleAs.custom', { role: r.name }) : t(`users.add.roleAs.${(SYSTEM_ROLES as readonly string[]).includes(base) ? base : 'broker'}`);
    return t('users.add.body', {
      name: first || t('users.add.namePlaceholder'),
      role: as,
      line: t(`users.add.roleLine.${base}`, { commission: money(commission) }),
      tfa: r?.twoStepRequired ? t('users.add.tfa') : '',
      days: validityDays,
      me: me.user.name.split(' ')[0],
    });
  }, [role, roles, first, commission, validityDays, me.user.name, t, money]);

  useEffect(() => {
    if (!open) return;
    setName('');
    setEmail('');
    setRoleId('');
    setEdited(false);
    setOriginal(null);
    setTone('friendly');
    setPolishError(null);
  }, [open]);
  // Until someone edits or polishes it, the e-mail follows the name and role.
  useEffect(() => {
    if (!edited && original === null) setLetter(template);
  }, [template, edited, original]);

  async function polish(nextTone: Tone) {
    setPolishing(true);
    setPolishError(null);
    try {
      const src = original ?? letter;
      const r = await api.post<{ text: string }>('/ai/polish', { text: src, tone: nextTone, language: locale });
      if (original === null) setOriginal(src);
      setLetter(r.text);
    } catch (e) {
      setPolishError(errorText(e));
    } finally {
      setPolishing(false);
    }
  }

  const save = useAction(
    (v: { name: string; email: string; roleId: string; language: string; subject: string; letter: string }) => api.post<{ id: string }>('/users/invite', v),
    { success: t('users.add.sentToast'), onDone: onClose },
  );
  const f = save.fields;
  const polished = original !== null;
  const subject = t('users.add.subject');

  return (
    <Sheet open={open} onClose={onClose} dirty={!!(name || email)} title={t('users.add.title')}>
      <TextField label={t('users.add.name')} placeholder={t('users.add.namePh')} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" error={f.name} />
      <TextField label={t('users.add.email')} placeholder={t('users.add.emailPh')} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" error={f.email} />
      <Select
        label={t('users.cols.role')}
        value={roleId}
        placeholder={t('users.add.pickRole')}
        onChange={(e) => setRoleId(e.target.value)}
        options={sorted.map((r) => ({ value: r.id, label: rt.name(r) }))}
        help={role ? rt.description(role) : undefined}
        error={f.roleId}
      />
      <div className="an-field">
        <div className={css.letterHead}>
          <label htmlFor="invite-letter">{t('users.add.letter')}</label>
          {polished && (
            <>
              <Pill tone="info">{t('users.add.polished')}</Pill>
              <button
                type="button"
                className="an-errlink"
                onClick={() => {
                  setLetter(original!);
                  setOriginal(null);
                }}
              >
                {t('users.add.undo')}
              </button>
            </>
          )}
          <Button size="sm" busy={polishing} disabled={!letter.trim() || !aiOn} title={aiOn ? undefined : t('users.add.aiOff')} onClick={() => polish(tone)}>
            ✦ {polished ? t('users.add.polishAgain') : t('users.add.polish')}
          </Button>
        </div>
        <div className={`${css.draft} ${polished ? css.draftOn : ''}`}>
          <span className="muted caption">{t('users.add.subjectLine', { subject: `\u2066${subject}\u2069` })}</span>
          <textarea
            id="invite-letter"
            className={css.draftText}
            value={letter}
            rows={10}
            onChange={(e) => {
              setLetter(e.target.value);
              setEdited(true);
            }}
          />
        </div>
        {(
          <div className={css.tones} role="group" aria-label={t('users.add.letter')}>
            {TONES.map((k) => (
              <button
                key={k}
                type="button"
                className="an-chip"
                aria-pressed={tone === k}
                disabled={polishing || !aiOn}
                title={aiOn ? undefined : t('users.add.aiOff')}
                onClick={() => {
                  setTone(k);
                  if (polished) polish(k);
                }}
              >
                {t(`users.add.tones.${k}`)}
              </button>
            ))}
          </div>
        )}
        {polishError && <p className="an-help error">{polishError}</p>}
      </div>
      <span className="muted body-sm">{t('users.add.foot')}</span>
      <ActionError action={Object.keys(f).length ? undefined : save} />
      <Button
        variant="primary"
        block
        busy={save.isPending}
        disabled={!name.trim() || !email.trim() || !roleId || !letter.trim()}
        onClick={() => save.mutate({ name: name.trim(), email: email.trim(), roleId, language: ['en', 'bg', 'he'].includes(locale) ? locale : 'en', subject, letter: letter.replace(/\[(Name|Име|שם)\]/g, first) })}
      >
        {t('users.add.send')}
      </Button>
    </Sheet>
  );
}

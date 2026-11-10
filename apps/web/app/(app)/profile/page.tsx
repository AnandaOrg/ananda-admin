'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useFmt } from '@/lib/format';
import { meQueryKey, useSession } from '@/lib/session';
import { setLocaleCookie } from '@/components/shell/AppShell';
import { Banner, Button, Card, Check, Globe, KeyValue, ListRow, Lock, PageHeader, PageSkeleton, Phone, Pill, Segmented, Sheet, ShieldCheck, SignOut, Sun, Switch, TextField, TwoStepField, X } from '@/components/ui';

interface SessionRow {
  id: string;
  device: 'desktop' | 'phone';
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

/** "Chrome on macOS" from a user agent, good enough to recognise a device. */
function deviceName(ua: string | null): { browser: string; os: string } {
  const s = ua ?? '';
  const browser = /Edg\//.test(s) ? 'Edge' : /OPR\//.test(s) ? 'Opera' : /Firefox\//.test(s) ? 'Firefox' : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : /curl/i.test(s) ? 'curl' : '';
  const os = /iPhone|iPad/.test(s) ? 'iOS' : /Android/.test(s) ? 'Android' : /Mac OS X|Macintosh/.test(s) ? 'macOS' : /Windows/.test(s) ? 'Windows' : /Linux/.test(s) ? 'Linux' : '';
  return { browser, os };
}

/** FR-ADM-4: language, theme, password, two-step status and signed-in devices. */
export default function ProfilePage() {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const router = useRouter();
  const qc = useQueryClient();
  const locale = useLocale();
  const { me } = useSession();
  const { dateTime } = useFmt();
  const [pwOpen, setPwOpen] = useState(false);
  const sessions = useQuery({ queryKey: ['profile', 'sessions'], queryFn: () => api.get<SessionRow[]>('/auth/sessions') });
  const signOut = useAction((id: string) => api.del(`/auth/sessions/${id}`), { success: (_r) => t('profile.devices.signedOut') });
  const lang = useAction(
    async (l: 'en' | 'bg' | 'he') => {
      setLocaleCookie(l);
      await api.patch('/auth/profile', { language: l });
    },
    {
      onDone: () => {
        qc.invalidateQueries({ queryKey: meQueryKey });
        router.refresh();
      },
    },
  );

  const others = (sessions.data ?? []).filter((s) => !s.current);
  const u = me.user;

  return (
    <div className="page">
      <PageHeader crumbs={[{ label: tc('profile') }]} kicker={u.email} title={tc('profile')} />
      <div className="cols even">
        <div className="stack loose">
          <Card title={t('profile.you')}>
            <KeyValue
              items={[
                [t('users.cols.name'), u.name],
                [tc('email'), <bdi key="e">{u.email}</bdi>],
                [t('users.cols.role'), u.roleName],
              ]}
            />
          </Card>
          <Card title={t('profile.preferences')}>
            <div className="an-field">
              <label>{tc('language')}</label>
              <Segmented fill label={tc('language')} value={(['en', 'bg', 'he'].includes(locale) ? locale : 'en') as 'en' | 'bg' | 'he'} onChange={(l) => lang.mutate(l)} disabled={lang.isPending} options={(['en', 'bg', 'he'] as const).map((l) => ({ value: l, label: t(`languages.${l}`) }))} />
              <span className="an-help">{t('profile.languageHelp')}</span>
            </div>
            {lang.errorText && <Banner tone="bad">{lang.errorText}</Banner>}
            <ListRow icon={Sun} title={t('profile.theme')} sub={t('profile.themeHelp')} value={t('profile.dark')} />
          </Card>
        </div>
        <div className="stack loose">
          <Card title={t('profile.security')}>
            <ListRow
              icon={ShieldCheck}
              title={t('profile.twoStep')}
              sub={u.twoStepEnabled ? t('profile.twoStepOn') : me.perms.twoStepRequired ? t('profile.twoStepRequired') : t('profile.twoStepOff')}
              value={u.twoStepEnabled ? <Pill tone="good">{t('users.twoStep.on')}</Pill> : <Pill tone="mute">{t('users.twoStep.off')}</Pill>}
            />
            <ListRow icon={Lock} title={t('profile.password')} sub={t('profile.passwordHelp')} actions={<Button size="sm" onClick={() => setPwOpen(true)}>{t('profile.changePassword')}</Button>} />
          </Card>
          <Card
            title={t('profile.devices.title')}
            action={
              others.length > 0 ? (
                <Button size="sm" icon={SignOut} busy={signOut.isPending && signOut.variables === 'others'} onClick={() => signOut.mutate('others')}>
                  {t('profile.devices.signOutOthers')}
                </Button>
              ) : undefined
            }
          >
            {signOut.errorText && <Banner tone="bad">{signOut.errorText}</Banner>}
            {sessions.isLoading ? (
              <PageSkeleton />
            ) : (
              <div className="lrows">
                {(sessions.data ?? []).map((s) => {
                  const d = deviceName(s.userAgent);
                  const name = d.browser && d.os ? t('profile.devices.name', { browser: d.browser, os: d.os }) : d.browser || d.os || t(`profile.devices.kind.${s.device}`);
                  return (
                    <ListRow
                      key={s.id}
                      icon={s.device === 'phone' ? Phone : Globe}
                      title={name}
                      sub={s.current ? t('profile.devices.thisDevice') : t('profile.devices.lastActive', { date: dateTime(s.lastSeenAt), ip: s.ip ?? '—' })}
                      actions={
                        s.current ? (
                          <Pill tone="good">{t('profile.devices.current')}</Pill>
                        ) : (
                          <Button size="sm" icon={X} busy={signOut.isPending && signOut.variables === s.id} onClick={() => signOut.mutate(s.id)}>
                            {t('profile.devices.signOut')}
                          </Button>
                        )
                      }
                    />
                  );
                })}
              </div>
            )}
            {others.length === 0 && !sessions.isLoading && <p className="muted body-sm">{t('profile.devices.onlyThis')}</p>}
          </Card>
        </div>
      </div>
      <PasswordSheet open={pwOpen} onClose={() => setPwOpen(false)} needsCode={u.twoStepEnabled} />
    </div>
  );
}

function PasswordSheet({ open, onClose, needsCode }: { open: boolean; onClose: () => void; needsCode: boolean }) {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [code, setCode] = useState('');
  const [others, setOthers] = useState(true);
  useEffect(() => {
    if (!open) return;
    setCurrent('');
    setNext('');
    setRepeat('');
    setCode('');
    setOthers(true);
  }, [open]);
  const save = useAction((v: { current: string; next: string; signOutOthers: boolean; code?: string }) => api.post('/auth/password', { current: v.current, next: v.next, signOutOthers: v.signOutOthers }, { code: v.code }), {
    success: t('profile.passwordChanged'),
    onDone: onClose,
  });
  const MIN = 10;
  const rules = [
    { key: 'length', ok: next.length >= MIN, label: t('profile.rules.length', { n: MIN }) },
    { key: 'letters', ok: /[A-Za-z]/.test(next), label: t('profile.rules.letters') },
    { key: 'numbers', ok: /\d/.test(next), label: t('profile.rules.numbers') },
    { key: 'different', ok: !!next && next !== current, label: t('profile.rules.different') },
  ];
  const strong = rules.every((r) => r.ok);
  const mismatch = repeat.length > 0 && repeat !== next;
  const err = save.error instanceof ApiError ? save.error : null;
  const codeError = err?.code?.startsWith('step_up') ? err.message : undefined;
  const f = save.fields;
  const ready = current && strong && repeat === next && (!needsCode || code.length === 6);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      dirty={!!(current || next)}
      title={t('profile.changePassword')}
      footer={
        <>
          <Button onClick={onClose}>{tc('cancel')}</Button>
          <Button variant="primary" busy={save.isPending} disabled={!ready} onClick={() => save.mutate({ current, next, signOutOthers: others, code: needsCode ? code : undefined })}>
            {t('profile.savePassword')}
          </Button>
        </>
      }
    >
      {save.errorText && !codeError && !Object.keys(f).length && <Banner tone="bad">{save.errorText}</Banner>}
      <TextField label={t('profile.current')} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} error={f.current} />
      <TextField label={t('profile.new')} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} error={f.next} />
      <ul className="stack tight" style={{ listStyle: 'none', margin: 0, padding: 0 }} aria-label={t('profile.rules.title')}>
        {rules.map((r) => (
          <li key={r.key} className={`row body-sm ${r.ok ? 'good' : 'muted'}`}>
            {r.ok ? <Check className="an-ic sm" aria-hidden /> : <X className="an-ic sm" aria-hidden />}
            <span>{r.label}</span>
            <span className="sr-only">{r.ok ? t('profile.rules.met') : t('profile.rules.notMet')}</span>
          </li>
        ))}
      </ul>
      <TextField label={t('profile.repeat')} type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} error={mismatch ? t('profile.mismatch') : undefined} />
      {needsCode && <TwoStepField value={code} onChange={setCode} error={codeError} />}
      <Switch checked={others} onChange={setOthers} label={t('profile.signOutOthers')} />
    </Sheet>
  );
}

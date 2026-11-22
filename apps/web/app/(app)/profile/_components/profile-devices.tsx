'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAction, useMedia } from '@/lib/hooks';
import { useFmt } from '@/lib/format';
import { meQueryKey, useSession } from '@/lib/session';
import { setLocaleCookie } from '@/components/shell/AppShell';
import { applyThemePref, readThemePref, type ThemePref } from '@/lib/theme';
import { Button, Card, Count, Globe, LoadError, Icon, Pill, Chips, Skeleton, SquaresFour } from '@/components/ui';
import css from './profile.module.css';

interface SessionRow {
  id: string;
  device: 'desktop' | 'phone';
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

interface ProfileInfo {
  googleLinked: boolean;
  twoStepRequired: boolean;
}

type DeviceKind = 'mac' | 'windows' | 'iphone' | 'ipad' | 'android' | 'linux' | 'desktop' | 'phone';

/** "Mac · Chrome" from a user agent, enough to recognise a device. */
function deviceOf(ua: string | null, fallback: 'desktop' | 'phone'): { kind: DeviceKind; browser: string } {
  const s = ua ?? '';
  const browser = /Edg\//.test(s) ? 'Edge' : /OPR\//.test(s) ? 'Opera' : /Firefox\//.test(s) ? 'Firefox' : /CriOS|Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : '';
  const kind: DeviceKind = /iPhone/.test(s) ? 'iphone' : /iPad/.test(s) ? 'ipad' : /Android/.test(s) ? 'android' : /Mac OS X|Macintosh/.test(s) ? 'mac' : /Windows/.test(s) ? 'windows' : /Linux/.test(s) ? 'linux' : fallback;
  return { kind, browser };
}

/** Profile and Signed-in devices, side by side (Settings › Profile & devices, and /profile). */
export function ProfileDevices() {
  const t = useTranslations('admin');
  const router = useRouter();
  const qc = useQueryClient();
  const locale = useLocale();
  const { me } = useSession();
  const { dateShort } = useFmt();
  const phone = useMedia('(max-width: 767px)');
  const info = useQuery({ queryKey: ['profile', 'info'], queryFn: () => api.get<ProfileInfo>('/profile') });
  const sessions = useQuery({ queryKey: ['profile', 'sessions'], queryFn: () => api.get<SessionRow[]>('/auth/sessions') });
  const signOut = useAction((id: string) => api.del(`/auth/sessions/${id}`), { success: (_r) => t('profile.devices.signedOut'), errorToast: true });
  const signOutAll = useAction(() => api.del('/auth/sessions/others'), { success: t('profile.devices.signedOutAll'), errorToast: true });
  const lang = useAction(
    async (l: 'en' | 'bg' | 'he') => {
      setLocaleCookie(l);
      await api.patch('/auth/profile', { language: l });
    },
    {
      errorToast: true,
      onDone: () => {
        qc.invalidateQueries({ queryKey: meQueryKey });
        router.refresh();
      },
    },
  );
  // Same preference as the profile menu's theme switch (cookie for the first paint, saved on the account).
  const tt = useTranslations('common');
  const [theme, setTheme] = useState<ThemePref>('dark');
  useEffect(() => {
    setTheme(readThemePref());
  }, []);
  const chooseTheme = (v: ThemePref) => {
    setTheme(v);
    applyThemePref(v);
    api.patch('/auth/profile', { theme: v }).then(() => qc.invalidateQueries({ queryKey: meQueryKey })).catch(() => {});
  };

  const u = me.user;
  // This device first, then the most recently used.
  const rows = [...(sessions.data ?? [])].sort((a, b) => Number(b.current) - Number(a.current));
  const others = rows.filter((s) => !s.current);
  const ago = (iso: string) => {
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    if (mins < 2) return t('profile.devices.justNow');
    if (mins < 60) return rtf.format(-mins, 'minute');
    if (mins < 24 * 60) return rtf.format(-Math.round(mins / 60), 'hour');
    return dateShort(iso);
  };
  const required = info.data?.twoStepRequired ?? !!me.perms.twoStepRequired;

  return (
    <div className={`cols even ${css.eq}`}>
      <Card className={css.profileCard} title={t('profile.profileTitle')}>
        <div className={css.rows}>
          <div className={`${css.row} ${css.langRow}`}>
            <span className={css.lbl}>
              {t('profile.language')}
              <span className={css.sub}>{t('profile.languageSub')}</span>
            </span>
            <span className={css.seg}>
              <Chips label={t('profile.language')} fill={phone} value={(['en', 'bg', 'he'].includes(locale) ? locale : 'en') as 'en' | 'bg' | 'he'} onChange={(l) => !lang.isPending && lang.mutate(l)} options={(['en', 'bg', 'he'] as const).map((l) => ({ value: l, label: t(`languages.${l}`) }))} />
            </span>
          </div>
          <div className={`${css.row} only-wide`}>
            <span className={css.lbl}>
              {t('profile.theme')}
              <span className={css.sub}>{t('profile.themeSub')}</span>
            </span>
            <span className={css.seg}>
              <Chips label={t('profile.theme')} fill={false} value={theme} onChange={chooseTheme} options={(['system', 'light', 'dark'] as const).map((v) => ({ value: v, label: tt(`theme.${v}`) }))} />
            </span>
          </div>
          <div className={css.group}>
          <div className={css.row}>
            <span className={css.lbl}>
              {t('profile.signIn')}
              <span className={css.sub}>{info.data?.googleLinked ? t('profile.signInGoogle') : t('profile.signInLink')}</span>
            </span>
          </div>
          <div className={css.row}>
            <span className={css.lbl}>
              {t('profile.twoStep')}
              <span className={css.sub}>{required ? t('profile.twoStepRequired') : t('profile.twoStepOptional')}</span>
            </span>
            {u.twoStepEnabled ? <Pill tone="good">{t('profile.on')}</Pill> : <Pill tone="mute">{t('profile.off')}</Pill>}
          </div>
          </div>
        </div>
      </Card>

      <Card
        title={
          <>
            {t('profile.devices.title')} {rows.length > 0 && <Count n={rows.length} />}
          </>
        }
      >
        {sessions.error ? (
          <LoadError error={sessions.error} onRetry={() => sessions.refetch()} />
        ) : sessions.isLoading ? (
          <div className={css.rows}>
            <Skeleton h={56} />
            <Skeleton h={56} />
          </div>
        ) : (
          <div className={css.rows}>
            {rows.map((s) => {
              const d = deviceOf(s.userAgent, s.device);
              const name = d.browser ? t('profile.devices.name', { device: t(`profile.devices.kind.${d.kind}`), browser: d.browser }) : t(`profile.devices.kind.${d.kind}`);
              return (
                <div key={s.id} className={`${css.row} ${css.dev}`}>
                  <span className={css.ico} aria-hidden>
                    <Icon as={s.current ? SquaresFour : Globe} />
                  </span>
                  <span className={css.lbl}>
                    <bdi>{name}</bdi>
                    <span className={css.sub}>{s.current ? t('profile.devices.activeNow') : ago(s.lastSeenAt)}</span>
                  </span>
                  {s.current ? (
                    <Pill tone="good">{t('profile.devices.thisDevice')}</Pill>
                  ) : (
                    <Button size="sm" writes busy={signOut.isPending && signOut.variables === s.id} onClick={() => signOut.mutate(s.id)}>
                      {t('profile.devices.signOut')}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {others.length > 0 && (
          <Button block writes className={css.danger} busy={signOutAll.isPending} onClick={() => signOutAll.mutate(undefined)}>
            {t('profile.devices.signOutAll')}
          </Button>
        )}
      </Card>
    </div>
  );
}

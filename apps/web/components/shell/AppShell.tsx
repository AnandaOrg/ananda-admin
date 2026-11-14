'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDate, type Locale } from '@ananda/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useRealtime } from '@/lib/realtime';
import { useAsOf } from '@/lib/asof';
import { useMedia } from '@/lib/hooks';
import { applyThemePref, readThemePref, type ThemePref } from '@/lib/theme';
import { LOCALE_COOKIE } from '@/i18n/config';
import {
  ArrowLeft,
  Banner,
  Bell,
  CalendarBlank,
  CaretRight,
  Check,
  Clock,
  DotsThreeOutline,
  Eye,
  Globe,
  House,
  Icon,
  List,
  Money,
  Moon,
  NoAccess,
  Package,
  Plus,
  ShieldCheck,
  SidebarSimple,
  SignOut,
  StatusBar,
  Sun,
  Tray,
  Truck,
  Users,
  useToast,
  X as XIcon,
} from '../ui';
import { isActive, navItemFor, visibleNav } from './nav';
import { PageInfoProvider, usePageInfo } from './page-context';
import { CalendarBody } from './calendar';
import { NotificationsBody, type Notification } from './notifications';

export function setLocaleCookie(locale: string) {
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
}

const LANGS = [
  { key: 'en', short: 'EN', name: 'English' },
  { key: 'bg', short: 'BG', name: 'Български' },
  { key: 'he', short: 'HE', name: 'עברית' },
] as const;

/** Pages on the phone tab bar: they get the bell and the profile picture; every other page gets a back button. */
const TAB_ROOTS = ['/home', '/sales', '/customers', '/collections', '/warehouse', '/warehouse/delivered', '/warehouse/count', '/more'];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <PageInfoProvider>
      <Shell>{children}</Shell>
    </PageInfoProvider>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const t = useTranslations('common');
  const { me, canView, isBroker, isWarehouse, canEdit, readOnly } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const locale = useLocale() as Locale;
  const toast = useToast();
  const asOf = useAsOf();
  const page = usePageInfo();
  const phone = useMedia('(max-width: 767px)');
  const [railOpen, setRailOpen] = useState(false);
  const [railHover, setRailHover] = useState(false);
  const [layer, setLayer] = useState<null | 'nt' | 'cal' | 'me' | 'more'>(null);
  const [theme, setTheme] = useState<ThemePref>('dark');
  const sideRef = useRef<HTMLElement>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [navMask, setNavMask] = useState({ top: false, more: false });
  useRealtime(true);

  const badges = useQuery({ queryKey: ['badges'], queryFn: () => api.get<{ home: number; unread: number }>('/badges'), refetchInterval: 60_000 });
  const notes = useQuery({ queryKey: ['notifications'], queryFn: () => api.get<{ items: Notification[]; unread: number }>('/notifications'), enabled: layer === 'nt' });
  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['badges'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
  const logout = useMutation({
    mutationFn: () => api.post('/auth/logout'),
    onSuccess: () => {
      qc.clear();
      router.replace('/login');
    },
  });
  const stopPreview = useMutation({ mutationFn: () => api.post('/auth/preview', { roleId: null }), onSuccess: () => qc.invalidateQueries() });

  const groups = visibleNav(canView);
  const current = navItemFor(pathname);
  const label = (key: string) => t(isBroker && key === 'brokers' ? 'nav.earnings' : `nav.${key}`);
  const firstName = me.user.name.split(' ')[0];
  const isAdmin = me.perms.baseRole === 'system_admin' || me.perms.baseRole === 'admin';
  const adminItems = groups.find((g) => g.key === 'admin')?.items ?? [];

  /* ---------- theme ---------- */
  useEffect(() => {
    const cookie = readThemePref();
    const hasCookie = /(?:^|;\s*)ananda_theme=/.test(document.cookie);
    const pref = hasCookie ? cookie : ((me.user.theme as ThemePref) ?? 'dark');
    setTheme(pref);
    if (!hasCookie) applyThemePref(pref);
    const m = window.matchMedia('(prefers-color-scheme: light)');
    const on = () => readThemePref() === 'system' && applyThemePref('system');
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [me.user.theme]);
  function chooseTheme(p: ThemePref) {
    setTheme(p);
    applyThemePref(p);
    api.patch('/auth/profile', { theme: p }).catch(() => {});
  }
  const dark = typeof document !== 'undefined' ? document.documentElement.getAttribute('data-theme') !== 'light' : theme !== 'light';

  async function changeLanguage(l: string) {
    setLocaleCookie(l);
    try {
      await api.patch('/auth/profile', { language: l });
    } catch {
      /* the cookie alone is enough to switch */
    }
    router.refresh();
  }

  /* ---------- rail (768–1279): opens over the page; hover opens it in the laptop range ---------- */
  useEffect(() => {
    setRailOpen(false);
    setLayer(null);
  }, [pathname]);
  useEffect(() => {
    if (!railOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setRailOpen(false);
        menuBtn.current?.focus();
      }
    };
    const onDoc = (e: MouseEvent) => !sideRef.current?.contains(e.target as Node) && setRailOpen(false);
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDoc);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDoc);
    };
  }, [railOpen]);
  const laptopHover = () => window.matchMedia('(min-width: 1024px) and (max-width: 1279px) and (hover: hover)').matches;

  /* ---------- sidebar: keep the scroll position; bring the current page into view; fade the cut edges ---------- */
  useEffect(() => {
    const n = navRef.current;
    if (!n) return;
    const on = n.querySelector<HTMLElement>('[aria-current="page"]');
    if (on) {
      const a = on.getBoundingClientRect();
      const r = n.getBoundingClientRect();
      if (a.top < r.top || a.bottom > r.bottom - 44) n.scrollTop += a.bottom - (r.bottom - 48);
    }
    const f = () => setNavMask({ top: n.scrollTop > 2, more: n.scrollHeight - n.scrollTop - n.clientHeight > 2 });
    f();
    n.addEventListener('scroll', f, { passive: true });
    window.addEventListener('resize', f);
    return () => {
      n.removeEventListener('scroll', f);
      window.removeEventListener('resize', f);
    };
  }, [pathname, railOpen]);

  useEffect(() => {
    try {
      if (sessionStorage.getItem('ananda:again')) {
        sessionStorage.removeItem('ananda:again');
        toast.show(t('errors.signedInAgain'), { kind: 'ok' });
      }
    } catch {
      /* storage blocked */
    }
  }, [t, toast]);

  /* ---------- connection: offline bar, back online toast, new version bar ---------- */
  const [offline, setOffline] = useState(false);
  const [updated, setUpdated] = useState(false);
  useEffect(() => {
    let off = !navigator.onLine;
    setOffline(off);
    const set = (v: boolean) => {
      if (v === off) return;
      off = v;
      setOffline(v);
      if (!v) {
        toast.show(t('errors.backOnline'), { kind: 'ok' });
        qc.invalidateQueries();
      }
    };
    const goOff = () => set(true);
    const goOn = () => set(false);
    // A request that got no answer: check the connection itself before saying "You're offline".
    const net = (e: Event) => {
      if ((e as CustomEvent<boolean>).detail) return off && set(false);
      if (off) return;
      fetch('/version', { cache: 'no-store' }).then(
        () => undefined,
        () => set(true),
      );
    };
    window.addEventListener('offline', goOff);
    window.addEventListener('online', goOn);
    window.addEventListener('ananda:network', net);
    return () => {
      window.removeEventListener('offline', goOff);
      window.removeEventListener('online', goOn);
      window.removeEventListener('ananda:network', net);
    };
  }, [qc, t, toast]);
  useEffect(() => {
    let first: string | null = null;
    const check = async () => {
      try {
        const r = await fetch('/version', { cache: 'no-store' });
        const v = (await r.json()) as { id: string };
        if (!first) first = v.id;
        else if (v.id !== first) setUpdated(true);
      } catch {
        /* offline: the offline bar says so */
      }
    };
    check();
    const id = setInterval(check, 5 * 60_000);
    const vis = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', vis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', vis);
    };
  }, []);

  /* ---------- layers ---------- */
  const tray = useRef<HTMLButtonElement>(null);
  const calChip = useRef<HTMLButtonElement>(null);
  const meCard = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!layer) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setLayer(null);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [layer]);

  function openNotification(n: Notification) {
    if (!n.readAt) markRead.mutate(n.id);
    setLayer(null);
    if (n.link) router.push(n.link);
  }

  const tabs = isWarehouse
    ? [
        { href: '/warehouse', label: t('tabs.toShip'), icon: Truck },
        { href: '/warehouse/delivered', label: t('tabs.delivered'), icon: Check },
        { href: '/warehouse/count', label: t('tabs.count'), icon: Package },
      ]
    : [
        { href: '/home', label: t('tabs.home'), icon: House },
        { href: '/sales', label: t('tabs.orders'), icon: List },
        { href: '/customers', label: t('tabs.customers'), icon: Users },
        { href: '/collections', label: t('tabs.collections'), icon: Money },
      ].filter((x) => x.href === '/home' || canView(x.href === '/sales' ? 'sales' : (x.href.slice(1) as 'customers' | 'collections')));
  const onTabs = new Set(isWarehouse ? ['warehouse'] : ['home', 'sales', 'customers', 'collections']);
  const moreGroups = groups.map((g) => ({ ...g, items: g.items.filter((i) => !onTabs.has(i.key)) })).filter((g) => g.items.length);

  /* ---------- header row: breadcrumb (desktop), title (phone) ---------- */
  const crumbs = page?.crumbs ?? (current && current.key !== 'home' ? [{ label: label(current.key) }] : []);
  // On a page of the sidebar itself the phone top bar shows its short name (tab label or nav label), like the prototype ("Orders", "Settings").
  const navRoot = !!current && pathname === current.href;
  const tabLabel = tabs.find((x) => x.href === pathname)?.label;
  const phoneTitle = navRoot && !isWarehouse ? (tabLabel ?? label(current!.key)) : (page?.title ?? tabLabel ?? (current ? label(current.key) : ''));
  const isRoot = TAB_ROOTS.includes(pathname);
  const backHref = [...(page?.crumbs ?? [])].reverse().find((c) => c.href)?.href ?? (current && !onTabs.has(current.key) ? '/more' : '/home');
  // BG header chip: DD.MM.YY (prototype "Към 03.11.26").
  const chipDate = locale === 'bg' ? formatDate(asOf.day, locale).replace(/\.20(\d\d)$/, '.$1') : formatDate(asOf.day, locale);
  const unread = badges.data?.unread ?? 0;
  const lang = LANGS.find((l) => l.key === locale) ?? LANGS[0];

  // Areas this role can't see: say so, with one way back (FR-AUTH-1).
  const blocked = current && !canView(current.area);

  // System roles keep their name per language; custom roles show the name they were given.
  const SYS: Record<string, string> = { system_admin: 'System admin', admin: 'Admin', broker: 'Broker', warehouse: 'Warehouse', finance: 'Finance' };
  const roleName = SYS[me.perms.baseRole] === me.user.roleName ? t(`systemRole.${me.perms.baseRole}`) : me.user.roleName;
  const avatar = <span className="an-av">{me.user.name.trim().charAt(0).toUpperCase()}</span>;

  return (
    <div className="app">
      <div className="app-side-spacer" />
      <aside
        ref={sideRef}
        className={`app-side ${railOpen ? 'open' : ''}`}
        onMouseEnter={() => {
          if (!laptopHover() || railOpen) return;
          hoverTimer.current = setTimeout(() => {
            setRailHover(true);
            setRailOpen(true);
          }, 300);
        }}
        onMouseLeave={() => {
          clearTimeout(hoverTimer.current);
          if (railHover) {
            setRailHover(false);
            setRailOpen(false);
          }
        }}
      >
        <div className="an-side">
          <Link href="/home" className="an-brand">
            <span className="mk">A</span>
            <span>
              <b>ANANDA</b>
              <span>{t('brandLine')}</span>
            </span>
          </Link>
          <button
            ref={menuBtn}
            type="button"
            className="rail-btn"
            aria-label={t('menu')}
            aria-expanded={railOpen}
            onClick={() => {
              setRailHover(false);
              setRailOpen((o) => !(o && !railHover));
            }}
          >
            <Icon as={SidebarSimple} />
          </button>
          <div className="an-welcome">
            {t('welcomeBack')}
            <br />
            {firstName}
          </div>
          <div className="an-asof">{t('asOf', { date: formatDate(asOf.today, locale) })}</div>
          {isBroker && canEdit('sales') && (
            <div className="new-sale-wrap">
              <Link href="/sales/new" className="an-btn primary block sm new-sale" aria-label={t('newSale')}>
                <Icon as={Plus} size="sm" />
                <span>{t('newSale')}</span>
              </Link>
            </div>
          )}
          <div className={`side-scroll ${navMask.top ? 'm-top' : ''} ${navMask.more ? 'm-more' : ''}`} ref={navRef}>
            <nav className="an-nav" aria-label={t('mainNav')}>
              {groups.map((g) => (
                <div key={g.key ?? 'root'} style={{ display: 'contents' }}>
                  {g.key && <div className="g">{t(`navGroup.${g.key}`)}</div>}
                  {g.items.map((i) => (
                    <Link
                      key={i.key}
                      href={i.href}
                      className="an-ni"
                      aria-current={isActive(pathname, i.href) ? 'page' : undefined}
                      aria-label={railOpen ? undefined : label(i.key)}
                      onMouseEnter={(e) => {
                        const s = e.currentTarget.querySelector<HTMLElement>('.nlbl');
                        e.currentTarget.title = s && s.scrollWidth > s.clientWidth + 1 ? label(i.key) : '';
                      }}
                    >
                      <Icon as={i.icon} />
                      <span className="nlbl">{label(i.key)}</span>
                      {i.key === 'home' && !!badges.data?.home ? (
                        <span className="an-count">{badges.data.home}</span>
                      ) : (
                        isActive(pathname, i.href) && <span className="dt" aria-hidden="true" />
                      )}
                    </Link>
                  ))}
                </div>
              ))}
            </nav>
          </div>
          <button ref={meCard} type="button" className={`an-me ${layer === 'me' ? 'on' : ''}`} aria-haspopup="menu" aria-expanded={layer === 'me'} onClick={() => setLayer(layer === 'me' ? null : 'me')}>
            {avatar}
            <span className="who">
              <b>{me.user.name}</b>
              <small>{roleName}</small>
            </span>
            <Icon as={SignOut} />
          </button>
        </div>
      </aside>

      <main className={`app-main ${navRoot ? 'is-root' : ''}`} id="main">
        <div className="topbar">
          {/* desktop: breadcrumb + chips */}
          <nav className="crumb only-wide" aria-label={t('breadcrumb')}>
            <Icon as={House} size="sm" />
            {crumbs.length ? <Link href="/home">{t('nav.home')}</Link> : <span>{t('nav.home')}</span>}
            {crumbs.map((c, i) => (
              <span key={i} className="crumb-i">
                <span aria-hidden>/</span>
                {i === crumbs.length - 1 ? <b aria-current="page">{c.label}</b> : c.href ? <Link href={c.href}>{c.label}</Link> : <span>{c.label}</span>}
              </span>
            ))}
          </nav>
          {/* phone: back + title, or title + bell + profile picture */}
          <div className="ptop only-phone">
            {!isRoot && (
              <Link href={backHref} className="an-iconbtn back" aria-label={t('back')}>
                <Icon as={ArrowLeft} />
              </Link>
            )}
            <span className="t">{phoneTitle}</span>
            {isRoot && (
              <>
                <button type="button" className="an-bell" aria-label={unread ? `${t('notifications.title')}, ${unread}` : t('notifications.title')} onClick={() => setLayer('nt')}>
                  <Icon as={Bell} />
                  {unread > 0 && <span className="bd">{unread > 99 ? '99+' : unread}</span>}
                </button>
                <button type="button" className="an-av-btn" aria-label={t('profile')} onClick={() => setLayer('me')}>
                  {avatar}
                </button>
              </>
            )}
          </div>
          <button ref={calChip} type="button" className={`an-hchip only-wide ${asOf.lookingBack ? 'past' : ''}`} aria-expanded={layer === 'cal'} aria-haspopup="dialog" onClick={() => setLayer(layer === 'cal' ? null : 'cal')}>
            <Icon as={CalendarBlank} size="sm" />
            <span className="nowrap">{t('asOf', { date: chipDate })}</span>
          </button>
          <button ref={tray} type="button" className="an-hchip ic only-wide" aria-label={unread ? `${t('inbox')}, ${unread}` : t('inbox')} aria-expanded={layer === 'nt'} aria-haspopup="dialog" onClick={() => setLayer(layer === 'nt' ? null : 'nt')}>
            <Icon as={Tray} size="sm" />
            {unread > 0 && <span className="bd">{unread > 99 ? '99+' : unread}</span>}
          </button>
          <LangChip lang={lang} onPick={changeLanguage} label={t('language')} />
          <button type="button" className="an-hchip ic only-wide" aria-label={dark ? t('theme.toLight') : t('theme.toDark')} title={dark ? t('theme.light') : t('theme.dark')} aria-pressed={!dark} onClick={() => chooseTheme(dark ? 'light' : 'dark')}>
            <Icon as={dark ? Sun : Moon} size="sm" />
          </button>
        </div>
        {offline && <StatusBar kind="offline" onAction={() => qc.invalidateQueries()} />}
        {updated && !offline && <StatusBar kind="update" onAction={() => window.location.reload()} />}
        {asOf.lookingBack && (
          <div className="an-pastbar" role="status">
            <Icon as={Clock} />
            <span>
              <b>{t('lookBack.bar', { date: formatDate(asOf.day, locale) })}</b> {t('lookBack.barSub')}
            </span>
            <button type="button" className="an-btn secondary keep" onClick={() => asOf.setDay(null)}>
              {t('lookBack.today')}
            </button>
          </div>
        )}
        {readOnly && (
          <div className="preview-bar">
            <Banner action={{ label: t('preview.stop'), onClick: () => stopPreview.mutate() }} sub={t('preview.sub')}>
              <span className="row">
                <Icon as={Eye} size="sm" /> {t('preview.title', { role: me.perms.roleName })}
              </span>
            </Banner>
          </div>
        )}
        {blocked ? <NoAccess text={t.has(`errors.accessArea.${current.area}`) ? t(`errors.accessArea.${current.area}`) : undefined} /> : children}
      </main>

      <nav className="app-tabbar" aria-label={t('mainNav')}>
        <div className="an-tabbar" style={{ ['--n' as string]: tabs.length + (isWarehouse ? 0 : 1) }}>
          {tabs.map((tb) => (
            <Link key={tb.href} href={tb.href} className="an-tab" aria-current={layer !== 'more' && isActive(pathname, tb.href) && (tb.href !== '/warehouse' || pathname === '/warehouse') ? 'page' : undefined}>
              <span className="ic">
                <Icon as={tb.icon} />
              </span>
              {tb.label}
            </Link>
          ))}
          {!isWarehouse && (
          <button type="button" className="an-tab" aria-current={layer === 'more' || pathname === '/more' || (!!current && !onTabs.has(current.key)) ? 'page' : undefined} onClick={() => setLayer(layer === 'more' ? null : 'more')}>
            <span className="ic">
              <Icon as={DotsThreeOutline} />
            </span>
            {t('tabs.more')}
          </button>
          )}
        </div>
      </nav>

      {/* ---------- layers ---------- */}
      {layer === 'nt' && (
        <Layer phone={phone} anchor={tray.current} className="pop-nt" label={t('notifications.title')} onClose={() => setLayer(null)}>
          <NotificationsBody
            items={notes.data?.items ?? []}
            loading={notes.isLoading}
            locale={locale}
            phone={phone}
            isAdmin={isAdmin}
            onOpen={openNotification}
            onMarkAll={() => markRead.mutate('all')}
            onClose={() => setLayer(null)}
          />
        </Layer>
      )}
      {layer === 'cal' && (
        <Layer phone={phone} anchor={calChip.current} className="pop-cal" label={t('lookBack.calendar')} onClose={() => setLayer(null)}>
          <CalendarBody
            day={asOf.day}
            today={asOf.today}
            locale={locale}
            phone={phone}
            onClose={() => setLayer(null)}
            onPick={(d) => {
              asOf.setDay(d === asOf.today ? null : d);
              setLayer(null);
            }}
          />
        </Layer>
      )}
      {layer === 'me' && !phone && (
        <AvatarMenu anchor={meCard.current} rail={!!sideRef.current && sideRef.current.getBoundingClientRect().width < 120} onClose={() => setLayer(null)}>
          {adminItems.length > 0 && <div className="hd">{t('me.admin')}</div>}
          {adminItems.map((i) => (
            <Link key={i.key} href={i.href} className="it" role="menuitem" onClick={() => setLayer(null)}>
              <Icon as={i.icon} />
              <span>{label(i.key)}</span>
            </Link>
          ))}
          {adminItems.length > 0 && <hr />}
          <LangRow lang={lang} onPick={changeLanguage} />
          <ThemeRow value={theme} onChange={chooseTheme} />
          <hr />
          <button type="button" className="it" role="menuitem" onClick={() => logout.mutate()}>
            <Icon as={SignOut} />
            <span>{t('signOut')}</span>
          </button>
        </AvatarMenu>
      )}
      {layer === 'me' && phone && (
        <PhoneSheet label={t('profile')} onClose={() => setLayer(null)}>
          <span className="an-grab" />
          <div className="ps-head">
            {avatar}
            <span>
              <b>{firstName}</b>
              <span className="muted">
                {roleName} · {me.user.email}
              </span>
            </span>
            <button type="button" className="cal-ib big" aria-label={t('close')} onClick={() => setLayer(null)}>
              <Icon as={XIcon} />
            </button>
          </div>
          <LangRow lang={lang} onPick={changeLanguage} sheet />
          <ThemeRow value={theme} onChange={chooseTheme} sheet />
          <Link href="/profile" className="an-sitem phone" onClick={() => setLayer(null)}>
            <Icon as={ShieldCheck} />
            <span>
              {t('me.twoStep')} · {t(me.user.twoStepEnabled ? 'me.on' : 'me.off')}
            </span>
          </Link>
          {canView('users') && (
            <Link href="/users" className="an-sitem phone" onClick={() => setLayer(null)}>
              <Icon as={Users} />
              <span>{t('nav.users')}</span>
            </Link>
          )}
          <button type="button" className="an-sitem phone" onClick={() => logout.mutate()}>
            <Icon as={SignOut} />
            <span>{t('signOut')}</span>
          </button>
        </PhoneSheet>
      )}
      {layer === 'more' && (
        <PhoneSheet label={t('tabs.more')} onClose={() => setLayer(null)}>
          <span className="an-grab" />
          <button type="button" className="cal-ib big ps-x" aria-label={t('close')} onClick={() => setLayer(null)}>
            <Icon as={XIcon} />
          </button>
          <MoreList groups={moreGroups} label={label} onPick={() => setLayer(null)} onSignOut={() => logout.mutate()} />
        </PhoneSheet>
      )}
    </div>
  );
}


/** Phone "More": every page that isn't on the tab bar, grouped like the desktop sidebar. */
export function MoreList({ groups, label, onPick, onSignOut }: { groups: ReturnType<typeof visibleNav>; label: (k: string) => string; onPick?: () => void; onSignOut: () => void }) {
  const t = useTranslations('common');
  return (
    <div className="more-list">
      <span className="more-sub">{t('moreSub')}</span>
      {groups.map((g) => (
        <div key={g.key ?? 'root'} role="group" aria-label={g.key ? t(`navGroup.${g.key}`) : undefined}>
          {g.key && <span className="sgrp">{t(`navGroup.${g.key}`)}</span>}
          {g.items.map((i) => (
            <Link key={i.key} href={i.href} className="an-sitem phone" onClick={onPick}>
              <Icon as={i.icon} />
              <span>{label(i.key)}</span>
            </Link>
          ))}
        </div>
      ))}
      <button type="button" className="an-sitem phone" onClick={onSignOut}>
        <Icon as={SignOut} />
        <span>{t('signOut')}</span>
      </button>
    </div>
  );
}

/** Next language in the prototype's order: EN → BG → HE → EN. */
const nextLang = (k: string) => LANGS[(LANGS.findIndex((l) => l.key === k) + 1) % LANGS.length].key;

/** Header chip: each click switches to the next language (prototype). */
function LangChip({ lang, onPick, label }: { lang: (typeof LANGS)[number]; onPick: (l: string) => void; label: string }) {
  return (
    <button type="button" className="an-hchip only-wide" aria-label={`${label}: ${lang.name}`} onClick={() => onPick(nextLang(lang.key))}>
      <Icon as={Globe} size="sm" />
      {lang.short}
    </button>
  );
}

/** Menu row "Language · English": each click switches to the next language (prototype). */
function LangRow({ lang, onPick, sheet }: { lang: (typeof LANGS)[number]; onPick: (l: string) => void; sheet?: boolean }) {
  const t = useTranslations('common');
  return (
    <button type="button" className={sheet ? 'an-sitem phone' : 'it'} onClick={() => onPick(nextLang(lang.key))}>
      <Icon as={Globe} />
      <span>
        {t('language')} · {lang.name}
      </span>
    </button>
  );
}

function ThemeRow({ value, onChange, sheet }: { value: ThemePref; onChange: (p: ThemePref) => void; sheet?: boolean }) {
  const t = useTranslations('common');
  return (
    <div className={sheet ? 'an-sitem phone theme-row' : 'it theme-row'} role="group" aria-label={t('theme.label')}>
      <Icon as={Moon} />
      <span>{t('theme.label')}</span>
      <span className="an-segx">
        {(['system', 'light', 'dark'] as const).map((k) => (
          <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)}>
            {t(`theme.${k}`)}
          </button>
        ))}
      </span>
    </div>
  );
}

/** Desktop popover under its header chip (transparent click-away layer), or a bottom sheet on the phone. */
function Layer({ phone, anchor, className, label, onClose, children }: { phone: boolean; anchor: HTMLElement | null; className: string; label: string; onClose: () => void; children: ReactNode }) {
  if (phone)
    return (
      <PhoneSheet label={label} onClose={onClose} className={className}>
        {children}
      </PhoneSheet>
    );
  const r = anchor?.getBoundingClientRect();
  const rtl = typeof document !== 'undefined' && document.dir === 'rtl';
  const style: React.CSSProperties = r ? { top: r.bottom + 8, ...(rtl ? { left: Math.max(12, r.left) } : { right: Math.max(12, window.innerWidth - r.right) }) } : { top: 72 };
  return createPortal(
    <>
      <button type="button" className="pop-scrim" aria-label={label} tabIndex={-1} onClick={onClose} />
      <div className={`an-xpop ${className}`} role="dialog" aria-label={label} style={style}>
        {children}
      </div>
    </>,
    document.body,
  );
}

function PhoneSheet({ label, onClose, className = '', children }: { label: string; onClose: () => void; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    setTimeout(() => ref.current?.querySelector<HTMLElement>('button, a')?.focus(), 0);
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  return createPortal(
    <div className="an-stage-fixed" role="dialog" aria-modal="true" aria-label={label}>
      <div className="an-scrim" onClick={onClose} />
      <div className={`an-psheet ${className}`} ref={ref}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** Avatar menu: above the profile card, or beside it when the sidebar is a rail. */
function AvatarMenu({ anchor, rail, onClose, children }: { anchor: HTMLElement | null; rail: boolean; onClose: () => void; children: ReactNode }) {
  const r = anchor?.getBoundingClientRect();
  const rtl = typeof document !== 'undefined' && document.dir === 'rtl';
  const style: React.CSSProperties = !r
    ? {}
    : rail
      ? { bottom: window.innerHeight - r.bottom, ...(rtl ? { right: window.innerWidth - r.left + 12 } : { left: r.right + 12 }) }
      : { bottom: window.innerHeight - r.top + 8, ...(rtl ? { right: window.innerWidth - r.right } : { left: r.left }), minWidth: r.width };
  useEffect(() => {
    const on = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (!el.closest('.an-am') && !anchor?.contains(el)) onClose();
    };
    document.addEventListener('mousedown', on);
    return () => document.removeEventListener('mousedown', on);
  }, [anchor, onClose]);
  return createPortal(
    <div className="an-am" role="menu" style={style}>
      {children}
    </div>,
    document.body,
  );
}

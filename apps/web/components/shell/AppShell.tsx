'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useFmt } from '@/lib/format';
import { useRealtime } from '@/lib/realtime';
import { LOCALE_COOKIE } from '@/i18n/config';
import {
  Avatar,
  Banner,
  Camera,
  CheckCircle,
  ClockCounterClockwise,
  DotsThreeOutline,
  Eye,
  Globe,
  House,
  Icon,
  IconButton,
  List,
  MenuButton,
  Money,
  Package,
  Plus,
  ShoppingCart,
  Sheet,
  SignOut,
  Tray,
  Users,
} from '../ui';
import { isActive, visibleNav } from './nav';

interface Notification {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export function setLocaleCookie(locale: string) {
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
}

export function AppShell({ children }: { children: ReactNode }) {
  const t = useTranslations('common');
  const { me, canView, isAgent, isWarehouse, canEdit, readOnly } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const locale = useLocale();
  const { date } = useFmt();
  const [railOpen, setRailOpen] = useState(false);
  const [inbox, setInbox] = useState(false);
  const sideRef = useRef<HTMLElement>(null);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const openedByHover = useRef(false);
  useRealtime(true);

  const badges = useQuery({ queryKey: ['badges'], queryFn: () => api.get<{ home: number; unread: number }>('/badges'), refetchInterval: 60_000 });
  const notes = useQuery({ queryKey: ['notifications'], queryFn: () => api.get<{ items: Notification[]; unread: number }>('/notifications'), enabled: inbox });
  const markRead = useMutation({ mutationFn: (id: string) => api.post(`/notifications/${id}/read`), onSuccess: () => qc.invalidateQueries({ queryKey: ['badges'] }) });
  const logout = useMutation({
    mutationFn: () => api.post('/auth/logout'),
    onSuccess: () => {
      qc.clear();
      router.replace('/login');
    },
  });
  const stopPreview = useMutation({ mutationFn: () => api.post('/auth/preview', { roleId: null }), onSuccess: () => qc.invalidateQueries() });

  const groups = visibleNav(canView);
  const asOf = date(new Date());

  // Close the expanded rail on Escape, outside click or navigation; focus returns to the menu button.
  useEffect(() => setRailOpen(false), [pathname]);
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

  async function changeLanguage(l: string) {
    setLocaleCookie(l);
    try {
      await api.patch('/auth/profile', { language: l });
    } catch {
      /* the cookie alone is enough to switch */
    }
    router.refresh();
  }

  const laptopHover = () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px) and (max-width: 1279px) and (hover: hover)').matches;

  const tabs = isWarehouse
    ? [
        { href: '/warehouse', label: t('tabs.toShip'), icon: Package },
        { href: '/warehouse/delivered', label: t('tabs.delivered'), icon: CheckCircle },
        { href: '/warehouse/count', label: t('tabs.count'), icon: Camera },
        { href: '/more', label: t('tabs.more'), icon: DotsThreeOutline },
      ]
    : [
        { href: '/home', label: t('tabs.home'), icon: House },
        { href: '/sales', label: t('tabs.orders'), icon: ShoppingCart },
        { href: '/customers', label: t('tabs.customers'), icon: Users },
        { href: '/collections', label: t('tabs.collections'), icon: Money },
        { href: '/more', label: t('tabs.more'), icon: DotsThreeOutline },
      ].filter((x) => x.href === '/more' || x.href === '/home' || canView(x.href === '/sales' ? 'sales' : (x.href.slice(1) as 'customers' | 'collections')));

  const items = notes.data?.items ?? [];

  return (
    <div className="app">
      <div className="app-side-spacer" />
      <aside
        ref={sideRef}
        className={`app-side ${railOpen ? 'open' : ''}`}
        onMouseEnter={() => {
          if (!laptopHover() || railOpen) return;
          hoverTimer.current = setTimeout(() => {
            openedByHover.current = true;
            setRailOpen(true);
          }, 300);
        }}
        onMouseLeave={() => {
          clearTimeout(hoverTimer.current);
          if (openedByHover.current) {
            openedByHover.current = false;
            setRailOpen(false);
          }
        }}
      >
        <div className="an-side">
          <IconButton ref={menuBtn} className="rail-btn" icon={List} label={t('menu')} aria-expanded={railOpen} onClick={() => setRailOpen((o) => !o)} />
          <Link href="/home" className="an-brand">
            <span className="mk">A</span>
            <span>
              <b>ANANDA</b>
              <span>{t('brandLine')}</span>
            </span>
          </Link>
          <div className="an-welcome">{t('welcome', { name: me.user.name.split(' ')[0] })}</div>
          <div className="an-asof">{t('asOf', { date: asOf })}</div>
          {isAgent && canEdit('sales') && (
            <div style={{ padding: '0 var(--space-3) var(--space-2)' }}>
              <Link href="/sales/new" className="an-btn primary block sm new-sale" aria-label={t('newSale')}>
                <Icon as={Plus} size="sm" />
                <span>{t('newSale')}</span>
              </Link>
            </div>
          )}
          <div className="side-scroll">
            <nav className="an-nav" aria-label={t('mainNav')}>
              {groups.map((g) => (
                <div key={g.key ?? 'root'} style={{ display: 'contents' }}>
                  {g.key && <div className="g">{t(`navGroup.${g.key}`)}</div>}
                  {g.items.map((i) => (
                    <Link key={i.key} href={i.href} className="an-ni" aria-current={isActive(pathname, i.href) ? 'page' : undefined} aria-label={railOpen ? undefined : t(`nav.${i.key}`)}>
                      <Icon as={i.icon} />
                      <span>{t(isAgent && i.key === 'agents' ? 'nav.earnings' : `nav.${i.key}`)}</span>
                      {i.key === 'home' && !!badges.data?.home && <span className="an-count">{badges.data.home}</span>}
                    </Link>
                  ))}
                </div>
              ))}
            </nav>
          </div>
          <div className="an-me">
            <Link href="/profile" aria-label={t('profile')}>
              <Avatar name={me.user.name} />
            </Link>
            <Link href="/profile" className="who">
              {me.user.name}
              <small>{me.user.roleName}</small>
            </Link>
            <IconButton icon={SignOut} label={t('signOut')} style={{ border: 0, background: 'none' }} onClick={() => logout.mutate()} />
          </div>
        </div>
      </aside>

      <main className="app-main" id="main">
        <div className="topbar">
          <Link href="/home" className="brand-phone row" aria-label="ANANDA">
            <span className="an-brand" style={{ padding: 0 }}>
              <span className="mk">A</span>
            </span>
          </Link>
          <span className="caption muted only-wide">{t('asOf', { date: asOf })}</span>
          <IconButton icon={Tray} label={t('inbox')} badge={badges.data?.unread} onClick={() => setInbox(true)} />
          <MenuButton
            items={[
              { key: 'en', label: 'English', selected: locale === 'en', onSelect: () => changeLanguage('en') },
              { key: 'bg', label: 'Български', selected: locale === 'bg', onSelect: () => changeLanguage('bg') },
              { key: 'he', label: 'עברית', selected: locale === 'he', onSelect: () => changeLanguage('he') },
            ]}
            trigger={({ open, toggle, ref }) => (
              <button ref={ref} type="button" className="an-iconbtn" aria-label={t('language')} aria-expanded={open} onClick={toggle}>
                <Icon as={Globe} />
              </button>
            )}
          />
        </div>
        {readOnly && (
          <div className="preview-bar">
            <Banner action={{ label: t('preview.stop'), onClick: () => stopPreview.mutate() }} sub={t('preview.sub')}>
              <span className="row">
                <Icon as={Eye} size="sm" /> {t('preview.title', { role: me.perms.roleName })}
              </span>
            </Banner>
          </div>
        )}
        {children}
      </main>

      <nav className="app-tabbar" aria-label={t('mainNav')}>
        <div className="an-tabbar" style={{ ['--n' as string]: tabs.length }}>
          {tabs.map((tb) => (
            <Link key={tb.href} href={tb.href} className="an-tab" aria-current={isActive(pathname, tb.href) && (tb.href !== '/warehouse' || pathname === '/warehouse') ? 'page' : undefined}>
              <span className="ic">
                <Icon as={tb.icon} />
              </span>
              {tb.label}
            </Link>
          ))}
        </div>
      </nav>

      <Sheet open={inbox} onClose={() => setInbox(false)} title={t('inbox')}>
        {items.length === 0 ? (
          <p className="muted">{notes.isLoading ? t('loading') : t('inboxEmpty')}</p>
        ) : (
          <>
            <div className="row end">
              <button className="link body-sm" onClick={() => markRead.mutate('all', { onSuccess: () => notes.refetch() })}>
                {t('markAllRead')}
              </button>
            </div>
            <div className="lrows">
              {items.map((n) => (
                <div
                  key={n.id}
                  className="an-lrow clk"
                  onClick={() => {
                    if (!n.readAt) markRead.mutate(n.id);
                    setInbox(false);
                    if (n.link) router.push(n.link);
                  }}
                >
                  <span className={`ico ${n.readAt ? '' : 'accent'}`}>
                    <Icon as={n.readAt ? ClockCounterClockwise : Tray} />
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span className="t" style={{ fontWeight: n.readAt ? 400 : 500 }}>
                      {n.title}
                    </span>
                    <span className="sub">
                      {n.body ? `${n.body} · ` : ''}
                      {date(n.createdAt)}
                    </span>
                  </span>
                  <span />
                </div>
              ))}
            </div>
          </>
        )}
      </Sheet>
    </div>
  );
}

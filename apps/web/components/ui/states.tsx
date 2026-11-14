'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { ApiError } from '@/lib/api';
import { messageOf, useDelayed } from '@/lib/hooks';
import { ArrowClockwise, Icon, Lock, MagnifyingGlass, WarningCircle, WifiSlash } from './icon';

/* Loading and error states from the design system (prototype "Loading" and "Errors" menus).
   Every message says what happened and what to do, in plain words; nothing typed is lost. */

const SKW = [0.9, 0.7, 0.82, 0.6, 0.86, 0.74, 0.66, 0.8];

/** One skeleton bar (surface-3 with a soft shimmer every 1.4 s; none with reduced motion). */
export function Sk({ w, h = 12, pill, style }: { w: number | string; h?: number; pill?: boolean; style?: React.CSSProperties }) {
  return <span className={`an-sk ${pill ? 'pill' : ''}`} style={{ width: w, height: h, ...style }} aria-hidden />;
}

/** Screen readers hear "Loading…" once. */
export function LoadingLive() {
  const t = useTranslations('common');
  return (
    <span className="sr-only" role="status">
      {t('loading')}
    </span>
  );
}

export type SkeletonCell = 'text' | 'count' | 'amount' | 'status' | 'empty';

/** Six skeleton rows shaped like the data: two lines in the first column, short bars aligned like the values, a pill for status. */
export function SkeletonRows({ cells, rows = 6 }: { cells: SkeletonCell[]; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => {
        const k = SKW[r % SKW.length];
        return (
          <tr key={r} className="sk-row" aria-hidden>
            {cells.map((c, i) => (
              <td key={i} className={c === 'count' ? 'num' : c === 'amount' ? 'amt' : ''}>
                {c === 'empty' ? null : c === 'status' ? (
                  <Sk w={Math.round(76 + 24 * k)} h={22} pill />
                ) : i === 0 ? (
                  <>
                    <Sk w={Math.round(110 + 80 * k)} />
                    <br />
                    <Sk w={Math.round(56 + 24 * k)} h={10} style={{ marginTop: 8 }} />
                  </>
                ) : (
                  <Sk w={c === 'amount' ? Math.round(64 + 30 * k) : c === 'count' ? 32 : Math.round(70 + 50 * k)} />
                )}
              </td>
            ))}
          </tr>
        );
      })}
    </>
  );
}

/** Phone list skeleton: cards with a title, an amount, a line and a pill. */
export function SkeletonCards({ count = 6 }: { count?: number }) {
  return (
    <>
      <LoadingLive />
      {Array.from({ length: count }, (_, i) => {
        const k = SKW[i % SKW.length];
        return (
          <div key={i} className="an-lcard sk-card" aria-hidden>
            <span className="t">
              <Sk w={`${Math.round(45 + 30 * k)}%`} h={14} />
            </span>
            <span className="amt">
              <Sk w={64} h={14} />
            </span>
            <span className="sub">
              <Sk w={`${Math.round(30 + 25 * k)}%`} h={10} />
            </span>
            <span style={{ justifySelf: 'end' }}>
              <Sk w={72} h={22} pill />
            </span>
          </div>
        );
      })}
    </>
  );
}

/**
 * A list that couldn't load: in place of the rows, with Try again. Nothing else on the page changes.
 * Network: "Check your connection…"; server: "Something went wrong on our side…".
 */
export function LoadError({ title, sub, error, onRetry }: { title?: ReactNode; sub?: ReactNode; error?: unknown; onRetry?: () => void }) {
  const t = useTranslations('common');
  const server = error instanceof ApiError && error.isServer;
  return (
    <div className="an-loaderr" role="alert">
      <Icon as={WarningCircle} size="lg" />
      <b>{title ?? t('errors.loadList')}</b>
      <span>{sub ?? (server ? t('errors.loadServer') : t('errors.loadSub'))}</span>
      {onRetry && (
        <button type="button" className="an-btn secondary" onClick={onRetry}>
          <Icon as={ArrowClockwise} size="sm" />
          {t('retry')}
        </button>
      )}
    </div>
  );
}

/**
 * Why an action failed, right under its button (or button row), with Try again — or Reload when
 * someone else changed the record. Pass the `useAction` result.
 */
export function ActionError({ action, error, onRetry, message }: { action?: { error: ApiError | null; retry: () => void }; error?: unknown; onRetry?: () => void; message?: ReactNode }) {
  const t = useTranslations('common');
  const err = action?.error ?? error;
  if (!err) return null;
  const conflict = err instanceof ApiError && err.isConflict;
  const blocked = err instanceof ApiError && err.isLookingBack;
  const retry = onRetry ?? action?.retry;
  return (
    <div className="an-inlerr" role="alert">
      <Icon as={WarningCircle} size="sm" />
      <span>{message ?? (conflict ? t('errors.conflict') : messageOf(err, t))}</span>
      {!blocked &&
        (conflict ? (
          <button type="button" className="an-errlink" onClick={() => window.location.reload()}>
            {t('reload')}
          </button>
        ) : retry ? (
          <button type="button" className="an-errlink" onClick={retry}>
            {t('retry')}
          </button>
        ) : null)}
    </div>
  );
}

/** "You don't have access to this page" with one way back. */
export function NoAccess({ text, back }: { text?: ReactNode; back?: { label: string; href: string } }) {
  const t = useTranslations('common');
  return (
    <div className="an-noaccess">
      <span className="an-erric">
        <Icon as={Lock} size="lg" />
      </span>
      <h3>{t('errors.accessTitle')}</h3>
      <p>{text ?? t('errors.accessText')}</p>
      <Link href={back?.href ?? '/home'} className="an-btn secondary">
        {back?.label ?? t('errors.backHome')}
      </Link>
    </div>
  );
}

/** "We can't find this order" — deleted, or the link is out of date. */
export function NotFound({ title, text, back }: { title?: ReactNode; text?: ReactNode; back?: { label: string; href: string } }) {
  const t = useTranslations('common');
  return (
    <div className="an-noaccess">
      <span className="an-erric">
        <Icon as={MagnifyingGlass} size="lg" />
      </span>
      <h3>{title ?? t('errors.notFoundTitle')}</h3>
      <p>{text ?? t('errors.notFoundText')}</p>
      <Link href={back?.href ?? '/home'} className="an-btn secondary">
        {back?.label ?? t('errors.backHome')}
      </Link>
    </div>
  );
}

/** One bar at the top of the page; the page stays readable. */
export function StatusBar({ kind, onAction }: { kind: 'offline' | 'update'; onAction: () => void }) {
  const t = useTranslations('common');
  return (
    <div className="an-offline" role="status">
      <Icon as={kind === 'offline' ? WifiSlash : ArrowClockwise} />
      <span>
        <b>{t(kind === 'offline' ? 'errors.offlineTitle' : 'errors.updateTitle')}</b> {t(kind === 'offline' ? 'errors.offlineText' : 'errors.updateText')}
      </span>
      <button type="button" className="an-errlink" onClick={onAction}>
        {t(kind === 'offline' ? 'retry' : 'reload')}
      </button>
    </div>
  );
}

/**
 * Page-level loading/error for a detail page: nothing for the first ~300 ms, then the page skeleton;
 * 404 → Not found, 403 → No access, other errors → "Couldn't load this page" with Try again.
 * Usage: `if (!q.data) return <PageState query={q} notFound={{ title: t('notFound'), back: {...} }} />`.
 */
export function PageState({ query, notFound, skeleton }: { query: { isLoading: boolean; error: unknown; refetch: () => unknown }; notFound?: { title?: ReactNode; text?: ReactNode; back?: { label: string; href: string } }; skeleton?: ReactNode }) {
  const late = useDelayed(query.isLoading);
  if (query.isLoading) return late ? <>{skeleton ?? <DefaultPageSkeleton />}</> : null;
  const e = query.error;
  if (e instanceof ApiError && e.isNotFound) return <NotFound {...notFound} />;
  if (e instanceof ApiError && e.isForbidden) return <NoAccess />;
  return <PageLoadError error={e} onRetry={() => query.refetch()} />;
}

export function PageLoadError({ error, onRetry }: { error?: unknown; onRetry?: () => void }) {
  const t = useTranslations('common');
  return (
    <div className="page">
      <section className="an-card">
        <LoadError title={t('errors.loadPage')} error={error} onRetry={onRetry} />
      </section>
    </div>
  );
}

function DefaultPageSkeleton() {
  return (
    <div className="page" aria-busy>
      <LoadingLive />
      <div className="stack tight">
        <Sk w={120} h={12} />
        <Sk w={280} h={32} />
      </div>
      <div className="kpis">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="an-kpi" aria-hidden>
            <Sk w="50%" />
            <Sk w="70%" h={28} style={{ marginTop: 8 }} />
            <Sk w="40%" h={10} style={{ marginTop: 8 }} />
          </div>
        ))}
      </div>
      <section className="an-card flush">
        <table className="an-tbl">
          <tbody>
            <SkeletonRows cells={['text', 'text', 'count', 'status', 'amount']} />
          </tbody>
        </table>
      </section>
    </div>
  );
}

export { DefaultPageSkeleton };

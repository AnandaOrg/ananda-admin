'use client';

import Link from 'next/link';
import type { ReactNode, KeyboardEvent } from 'react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { useTranslations } from 'next-intl';
import { ArrowUpRight, CaretRight, Check, CheckCircle, House, Icon, Info, WarningCircle } from './icon';
import { Button } from './controls';

export function PageHeader({ crumbs, kicker, title, actions }: { crumbs?: { label: string; href?: string }[]; kicker?: ReactNode; title: ReactNode; actions?: ReactNode }) {
  const t = useTranslations('common');
  return (
    <header className="stack tight">
      {crumbs && crumbs.length > 0 && (
        <nav className="an-crumb" aria-label={t('breadcrumb')}>
          <Link href="/home" aria-label={t('nav.home')}>
            <Icon as={House} size="sm" />
          </Link>
          {crumbs.map((c, i) => (
            <span key={i} className="row" style={{ gap: 'var(--space-2)' }}>
              <Icon as={CaretRight} size="sm" className="subtle" />
              {c.href ? <Link href={c.href}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}
            </span>
          ))}
        </nav>
      )}
      <div className="an-phead">
        <div className="grow">
          {kicker && <div className="kick">{kicker}</div>}
          <h1>{title}</h1>
        </div>
        {actions && <div className="pa">{actions}</div>}
      </div>
    </header>
  );
}

export function Card({ title, action, children, className = '', flush, id }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; flush?: boolean; id?: string }) {
  return (
    <section className={`an-card ${flush ? 'flush' : ''} ${className}`} id={id}>
      {(title || action) && (
        <div className="an-card-h">
          {title && <h2>{title}</h2>}
          {action && <div className="ms-auto row">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function KpiTile({ label, value, sub, subTone, valueTone, link, linkAccent, tip, onClick }: { label: string; value: ReactNode; sub?: ReactNode; subTone?: 'good' | 'bad'; valueTone?: 'good' | 'bad'; link?: { href: string; label: string }; linkAccent?: boolean; tip?: string; onClick?: () => void }) {
  return (
    <div className={`an-kpi ${onClick ? 'clk' : ''}`} onClick={onClick}>
      <div className="top">
        <span>{label}</span>
        {link && (
          <Link href={link.href} className={linkAccent ? 'y' : ''} aria-label={link.label}>
            <span className="lbl">{link.label}</span> <Icon as={ArrowUpRight} size="sm" />
          </Link>
        )}
      </div>
      <div className={`v ${valueTone ?? ''}`}>
        <bdi>{value}</bdi>
      </div>
      {(sub || tip) && (
        <div className="row between">
          {sub && <div className={`s ${subTone ?? ''}`}>{sub}</div>}
          {tip && <Tip text={tip} />}
        </div>
      )}
    </div>
  );
}

export function Tip({ text }: { text: string }) {
  return (
    <span className="an-tip" tabIndex={0} title={text} aria-label={text} role="img">
      <Icon as={Info} size="sm" />
    </span>
  );
}

export function ListRow({ icon, iconTone, title, sub, value, actions, onClick, href, wrapActions }: { icon: PhosphorIcon; iconTone?: 'bad' | 'warn' | 'accent'; title: ReactNode; sub?: ReactNode; value?: ReactNode; actions?: ReactNode; onClick?: () => void; href?: string; wrapActions?: boolean }) {
  const inner = (
    <>
      <span className={`ico ${iconTone ?? ''}`}>
        <Icon as={icon} />
      </span>
      <span style={{ minWidth: 0 }}>
        <span className="t">{title}</span>
        {sub && <span className="sub">{sub}</span>}
      </span>
      {actions ? (
        <span className="acts" onClick={(e) => e.stopPropagation()}>
          {actions}
        </span>
      ) : (
        <span className="v">
          {value != null && <bdi>{value}</bdi>}
          {(onClick || href) && <Icon as={CaretRight} size="sm" className="subtle" />}
        </span>
      )}
    </>
  );
  const cls = `an-lrow ${onClick || href ? 'clk' : ''} ${wrapActions ? 'wrap-acts' : ''}`;
  if (href)
    return (
      <Link href={href} className={cls}>
        {inner}
      </Link>
    );
  return (
    <div className={cls} onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined} onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}>
      {inner}
    </div>
  );
}

export function ListCard({ title, amount, sub, status, href, onClick }: { title: ReactNode; amount?: ReactNode; sub?: ReactNode; status?: ReactNode; href?: string; onClick?: () => void }) {
  const inner = (
    <>
      <span className="t">{title}</span>
      <span className="amt">
        <bdi>{amount}</bdi>
      </span>
      <span className="sub">{sub}</span>
      {status}
    </>
  );
  return href ? (
    <Link href={href} className="an-lcard">
      {inner}
    </Link>
  ) : (
    <button type="button" className="an-lcard" onClick={onClick}>
      {inner}
    </button>
  );
}

export interface Column<T> {
  key: string;
  header: ReactNode;
  type?: 'text' | 'count' | 'amount';
  render: (row: T) => ReactNode;
  className?: string;
}

/** Data table inside a card: counts centred, amounts end-aligned, tabular figures. */
export function Table<T>({ columns, rows, rowKey, onRow, empty, rowClass }: { columns: Column<T>[]; rows: T[]; rowKey: (r: T) => string; onRow?: (r: T) => void; empty?: ReactNode; rowClass?: (r: T) => string }) {
  const cls = (c: Column<T>) => `${c.type === 'count' ? 'num' : c.type === 'amount' ? 'amt' : ''} ${c.className ?? ''}`;
  return (
    <div className="tbl-wrap">
      <table className="an-tbl">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={cls(c)} scope="col">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && empty ? (
            <tr className="empty">
              <td colSpan={columns.length}>{empty}</td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr
                key={rowKey(r)}
                className={`${onRow ? 'clk' : ''} ${rowClass?.(r) ?? ''}`}
                onClick={onRow ? () => onRow(r) : undefined}
                tabIndex={onRow ? 0 : undefined}
                onKeyDown={onRow ? (e: KeyboardEvent) => e.key === 'Enter' && onRow(r) : undefined}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cls(c)}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export function EmptyState({ icon, title, text, action, done }: { icon?: PhosphorIcon; title: string; text?: string; action?: ReactNode; done?: boolean }) {
  return (
    <div className="an-empty">
      {done ? (
        <span className="an-done">
          <Icon as={Check} size="lg" />
        </span>
      ) : (
        icon && (
          <span className="eic">
            <Icon as={icon} size="lg" />
          </span>
        )
      )}
      <h2>{title}</h2>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

export function Banner({ tone = 'info', children, sub, action }: { tone?: 'info' | 'bad'; children: ReactNode; sub?: ReactNode; action?: { label: string; onClick?: () => void; href?: string } }) {
  return (
    <div className={`an-banner ${tone === 'bad' ? 'bad' : ''}`} role={tone === 'bad' ? 'alert' : undefined}>
      <Icon as={tone === 'bad' ? WarningCircle : Info} />
      <span className="grow">
        {children}
        {sub && <span className="sub">{sub}</span>}
      </span>
      {action &&
        (action.href ? (
          <Link href={action.href} className="an-btn secondary sm">
            {action.label}
          </Link>
        ) : (
          <Button size="sm" onClick={action.onClick}>
            {action.label}
          </Button>
        ))}
    </div>
  );
}

export function KeyValue({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="an-kv">
      {items.map(([k, v], i) => (
        <div key={i} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Totals({ lines, big }: { lines: [ReactNode, ReactNode][]; big?: [ReactNode, ReactNode] }) {
  return (
    <div className="an-tot">
      {lines.map(([k, v], i) => (
        <div key={i}>
          <span>{k}</span>
          <bdi>{v}</bdi>
        </div>
      ))}
      {big && (
        <div className="big">
          <span>{big[0]}</span>
          <bdi>{big[1]}</bdi>
        </div>
      )}
    </div>
  );
}

export interface Step {
  label: string;
  detail?: ReactNode;
  action?: ReactNode;
  /** Overrides the done state when a later step can finish before an earlier one. */
  done?: boolean;
}

/** Done / current / later steps; vertical on the order page. */
export function ProgressSteps({ steps, current, horizontal }: { steps: Step[]; current: number; horizontal?: boolean }) {
  if (horizontal) {
    return (
      <div className="an-hsteps" style={{ ['--n' as string]: steps.length }}>
        {steps.map((s, i) => (
          <div key={i} className={`an-hs ${(s.done ?? i < current) ? 'done' : i === current ? 'now' : ''}`}>
            <span className="c">{(s.done ?? i < current) ? <Icon as={Check} size="sm" /> : i + 1}</span>
            <span className="t">{s.label}</span>
            {s.detail && <span className="d">{s.detail}</span>}
          </div>
        ))}
      </div>
    );
  }
  return (
    <ol className="an-steps" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {steps.map((s, i) => (
        <li key={i} className={`an-ps ${(s.done ?? i < current) ? 'done' : i === current ? 'now' : ''}`} aria-current={i === current ? 'step' : undefined}>
          <span className="c">{(s.done ?? i < current) ? <Icon as={Check} size="sm" /> : i + 1}</span>
          <span className="t">{s.label}</span>
          {s.detail && <span className="d">{s.detail}</span>}
          {s.action && i === current && <span className="d" style={{ marginTop: 'var(--space-2)' }}>{s.action}</span>}
        </li>
      ))}
    </ol>
  );
}

export function DocRow({ icon, title, sub, actions }: { icon: PhosphorIcon; title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="an-doc">
      <span className="ico">
        <Icon as={icon} />
      </span>
      <span style={{ minWidth: 0 }}>
        <span className="t">{title}</span>
        {sub && <span className="sub">{sub}</span>}
      </span>
      <span className="row">{actions}</span>
    </div>
  );
}

export function Skeleton({ h = 20, w }: { h?: number; w?: number | string }) {
  return <div className="skeleton" style={{ height: h, width: w ?? '100%' }} />;
}

export function PageSkeleton() {
  return (
    <div className="page" aria-busy>
      <Skeleton h={40} w={280} />
      <div className="kpis">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} h={110} />
        ))}
      </div>
      <Skeleton h={320} />
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const t = useTranslations('common');
  return (
    <Banner tone="bad" action={retry ? { label: t('retry'), onClick: retry } : undefined}>
      {error instanceof Error ? error.message : t('error')}
    </Banner>
  );
}

export { CheckCircle };

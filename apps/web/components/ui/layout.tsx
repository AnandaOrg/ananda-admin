'use client';

import Link from 'next/link';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { useLocale, useTranslations } from 'next-intl';
import { useDelayed } from '@/lib/hooks';
import { useAsOf } from '@/lib/asof';
import { formatDay } from '@/lib/format';
import { useMedia } from '@/lib/media';
import { CaretRight, Check, CheckCircle, Columns, Icon, Info, Lock, WarningCircle } from './icon';
import { Button, MenuButton, Tooltip, Trunc } from './controls';
import { useRegisterPage } from '../shell/page-context';
import { DefaultPageSkeleton, LoadError, LoadingLive, PageState, SkeletonCards, SkeletonRows, type SkeletonCell } from './states';

/**
 * Page title row. `crumbs` go to the header row of the shell (desktop: "⌂ Overview / Sales & orders / S-0008");
 * on the phone, pages below the tabs show back + title in the top bar and the kicker here; tab pages show
 * the logo bar on top and the title, the day and the actions here, the same on every tab.
 */
export function PageHeader({ crumbs, kicker, title, actions }: { crumbs?: { label: string; href?: string }[]; kicker?: ReactNode; title: ReactNode; actions?: ReactNode }) {
  useRegisterPage({ crumbs, title });
  const locale = useLocale();
  const { day } = useAsOf();
  return (
    <header className="stack tight page-head">
      <div className="an-phead">
        <div className="grow">
          {kicker && <div className="kick">{kicker}</div>}
          <h1>{title}</h1>
          {/* Phone, tab pages: the logo bar is on top, so the title and the day sit here (client, 22 Nov). */}
          <div className="pday">{formatDay(day, locale)}</div>
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

/** `chevron`: the tile opens something (prototype: a small › in the top corner). */
export function KpiTile({ label, value, sub, subTone, valueTone, link, linkAccent, tip, onClick, chevron }: { label: string; value: ReactNode; sub?: ReactNode; subTone?: 'good' | 'bad'; valueTone?: 'good' | 'bad'; link?: { href: string; label: string }; linkAccent?: boolean; tip?: string; onClick?: () => void; chevron?: boolean }) {
  return (
    <div className={`an-kpi ${onClick ? 'clk' : ''} ${chevron ? 'has-go' : ''}`} onClick={onClick}>
      {chevron && (
        <span className="kgo" aria-hidden>
          <Icon as={CaretRight} size="sm" />
        </span>
      )}
      <div className="top">
        <span>{label}</span>
        {link && (
          <Link href={link.href} className={linkAccent ? 'y' : ''} aria-label={link.label}>
            <span className="lbl">{link.label}</span>
            <Icon as={CaretRight} size="sm" />
          </Link>
        )}
      </div>
      {/* the info icon sits at the end of the figure row: its bottom edge lines up with the number's baseline */}
      <div className={`v ${valueTone ?? ''} ${tip ? 'has-tip' : ''}`}>
        <bdi>{value}</bdi>
        {tip && <Tip text={tip} />}
      </div>
      {sub && <div className={`s ${subTone ?? ''}`}>{sub}</div>}
    </div>
  );
}

/** Info icon with the design system's tooltip box (see `Tooltip`). */
export function Tip({ text }: { text: string }) {
  return <Tooltip text={text} />;
}

export function ListRow({ icon, iconTone, title, sub, value, actions, onClick, href, wrapActions }: { icon: PhosphorIcon; iconTone?: 'bad' | 'warn' | 'accent'; title: ReactNode; sub?: ReactNode; value?: ReactNode; actions?: ReactNode; onClick?: () => void; href?: string; wrapActions?: boolean }) {
  const inner = (
    <>
      <span className={`ico ${iconTone ?? ''}`}>
        <Icon as={icon} />
      </span>
      <span className="tx">
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
  /** count: centred · amount: end-aligned, never wraps · status: a pill (skeleton shape) · text (default). */
  type?: 'text' | 'count' | 'amount' | 'status' | 'date';
  render: (row: T) => ReactNode;
  className?: string;
  /** Column width (px or CSS length) on desktop. */
  width?: number | string;
  /** Cut long text with … and show the full text in a tooltip (true, or the max width). */
  trunc?: boolean | number | string;
  /**
   * The main text column (name, description): takes the leftover width and wraps to 2 lines. Defaults
   * to the first text column. Every other column fits its content and never wraps, unless `wrap` is set.
   */
  main?: boolean;
  /** Let this (non-main) text column wrap, e.g. a long description next to the name. */
  wrap?: boolean;
}

/**
 * Column picker at 768–1023 px (design system): when the table doesn't fit, optional columns are
 * hidden from the end of `priority` and a "Columns · N hidden" button lets people choose. `locked`
 * columns are always shown. The choice is kept per table (`id`) in this browser.
 */
export interface ColumnPickerOptions {
  id: string;
  /** Column keys that are always shown (usually the first and the amount/status). */
  locked: string[];
  /** Optional column keys, most important first. Defaults to the table order. */
  priority?: string[];
  /** Shown by default at 768 (besides `locked`); every other optional column starts hidden. See `TABLE_PICKERS`. */
  defaults?: string[];
}

const colStore = {
  get(k: string): string[] | null {
    try {
      return JSON.parse(localStorage.getItem('ananda-cols:' + k) ?? 'null');
    } catch {
      return null;
    }
  },
  set(k: string, v: string[]) {
    try {
      localStorage.setItem('ananda-cols:' + k, JSON.stringify(v));
    } catch {
      /* storage blocked */
    }
  },
};

function useColumnPicker<T>(columns: Column<T>[], opts: ColumnPickerOptions | undefined, wrap: React.RefObject<HTMLDivElement | null>, table: React.RefObject<HTMLTableElement | null>, deps: unknown) {
  const tablet = useMedia('(min-width: 768px) and (max-width: 1023px)');
  const [state, setState] = useState<{ shown: string[] | null; full: boolean; all?: boolean }>({ shown: null, full: false });
  const [tick, setTick] = useState(0);
  const keys = columns.map((c) => c.key);
  const active = !!opts && tablet;
  // Measure with every column rendered (state.shown = null), then decide what to hide.
  useLayoutEffect(() => {
    if (!active || state.shown !== null) return;
    const w = wrap.current;
    const tb = table.current;
    if (!w || !tb) return;
    const avail = w.clientWidth;
    const locked = opts!.locked.filter((k) => keys.includes(k));
    const optional = (opts!.priority ?? keys).filter((k) => keys.includes(k) && !locked.includes(k));
    // As the prototype: try a set of columns on the real table at its narrowest (min-content), cells of
    // the other columns hidden, and keep it if it fits the space.
    const rows = [...tb.rows];
    const prevW = tb.style.width;
    const fits = (ks: string[]) => {
      const show = new Set(ks.map((k) => keys.indexOf(k)));
      rows.forEach((r) => [...r.cells].forEach((c, i) => (c.style.display = r.cells.length === keys.length && !show.has(i) ? 'none' : '')));
      tb.style.width = 'min-content';
      tb.classList.add('measuring');
      const ok = tb.getBoundingClientRect().width <= avail + 1;
      return ok;
    };
    const restore = () => {
      rows.forEach((r) => [...r.cells].forEach((c) => (c.style.display = '')));
      tb.style.width = prevW;
      tb.classList.remove('measuring');
    };
    if (fits(keys)) {
      restore();
      setState({ shown: keys, full: false, all: true });
      return;
    }
    const saved = colStore.get(opts!.id);
    let shown: string[];
    if (Array.isArray(saved)) shown = [...new Set([...locked, ...saved.filter((k) => keys.includes(k))])];
    else {
      shown = [...locked];
      if (opts!.defaults) shown = [...locked, ...opts!.defaults.filter((k) => keys.includes(k) && !locked.includes(k))];
      else for (const k of optional) if (fits([...shown, k])) shown.push(k);
    }
    while (!fits(shown) && shown.length > locked.length) {
      const drop = [...(opts!.defaults ?? optional)].reverse().find((k) => shown.includes(k) && !locked.includes(k));
      if (!drop) break;
      shown = shown.filter((k) => k !== drop);
    }
    const full = optional.filter((k) => !shown.includes(k)).every((k) => !fits([...shown, k]));
    restore();
    setState({ shown, full });
  });
  // Re-measure when the width, the columns or the rows change.
  useEffect(() => {
    if (!active) return;
    setState({ shown: null, full: false });
  }, [active, keys.join('|'), deps, tick]);
  useEffect(() => {
    if (!active || !wrap.current) return;
    let last = wrap.current.clientWidth;
    const ro = new ResizeObserver(() => {
      const w = wrap.current?.clientWidth ?? 0;
      if (Math.abs(w - last) > 1) {
        last = w;
        setTick((x) => x + 1);
      }
    });
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [active]);
  // Everything fits: no picker (prototype).
  if (!active || !state.shown || state.all) return { visible: columns, picker: null as null | { shown: string[]; full: boolean; toggle: (k: string) => void } };
  const shown = state.shown;
  return {
    visible: columns.filter((c) => shown.includes(c.key)),
    picker: {
      shown,
      full: state.full,
      toggle: (k: string) => {
        const next = shown.includes(k) ? shown.filter((x) => x !== k) : [...shown, k];
        colStore.set(opts!.id, next);
        setTick((x) => x + 1);
      },
    },
  };
}

/**
 * Data table inside a card: counts centred, amounts end-aligned, tabular figures, sticky header.
 * `loading` shows six skeleton rows (after ~300 ms); `error` shows "Couldn't load this list" with
 * Try again (`onRetry`) in place of the rows. `picker` adds the 768–1023 column picker.
 */
export function Table<T>({
  columns,
  rows,
  rowKey,
  onRow,
  empty,
  rowClass,
  loading,
  error,
  onRetry,
  errorTitle,
  picker,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (r: T) => string;
  onRow?: (r: T) => void;
  empty?: ReactNode;
  rowClass?: (r: T) => string;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  errorTitle?: ReactNode;
  picker?: ColumnPickerOptions;
}) {
  const t = useTranslations('common');
  const wrap = useRef<HTMLDivElement>(null);
  const tbl = useRef<HTMLTableElement>(null);
  const late = useDelayed(!!loading);
  const { visible, picker: pk } = useColumnPicker(columns, picker, wrap, tbl, rows.length);
  const mainKey = (columns.find((c) => c.main) ?? columns.find((c) => (c.type ?? 'text') === 'text' && c.header !== '' && c.header != null))?.key;
  const cls = (c: Column<T>) => `${c.type === 'count' ? 'num' : c.type === 'amount' ? 'amt' : c.type === 'date' ? 'dt' : c.type === 'status' ? 'st' : ''} ${c.key === mainKey ? 'c-main' : c.wrap ? 'c-wrap' : ''} ${c.className ?? ''}`;
  const cell = (c: Column<T>, r: T) => {
    const raw = c.render(r);
    // dates, counts and amounts stay left-to-right inside Hebrew text (minus signs, '14 Nov 2026')
    const v = c.type === 'date' || c.type === 'count' || c.type === 'amount' ? <bdi>{raw}</bdi> : raw;
    if (c.trunc) return <Trunc max={typeof c.trunc === 'boolean' ? undefined : c.trunc}>{v}</Trunc>;
    return c.key === mainKey ? <span className="clamp2">{v}</span> : v;
  };
  const hidden = pk ? columns.length - pk.shown.length : 0;
  // Where the "Columns" button goes (prototype): next to the page's tab chips when the page has a
  // <ColumnsSlot/>, otherwise in its own row just above the table's card, aligned to the end.
  const [host, setHost] = useState<HTMLElement | null>(null);
  const on = !!pk;
  useLayoutEffect(() => {
    if (!on) {
      setHost(null);
      return;
    }
    const w = wrap.current;
    if (!w) return;
    const slot = w.closest('.page')?.querySelector<HTMLElement>('[data-cols-slot]');
    if (slot) {
      setHost(slot);
      return;
    }
    let box: HTMLElement = w;
    while (box.parentElement && !box.parentElement.classList.contains('page') && box.parentElement !== document.body) box = box.parentElement;
    if (!box.parentElement || box.parentElement === document.body) box = (w.closest('.an-card') as HTMLElement | null) ?? w;
    const row = document.createElement('div');
    row.className = 'cp-row solo';
    box.before(row);
    setHost(row);
    return () => row.remove();
  }, [on]);
  const pickerButton = pk && (
          <MenuButton
            items={[]}
            trigger={({ open, toggle, ref }) => (
              <button ref={ref} type="button" className={`cp-btn ${open ? 'on' : ''}`} aria-expanded={open} aria-haspopup="dialog" onClick={toggle}>
                <Icon as={Columns} size="sm" />
                <span>{t('columns.label')}</span>
                {hidden > 0 && <span className="cp-n">· {t('columns.hidden', { n: hidden })}</span>}
              </button>
            )}
            panel={() => (
              <div className="cp-pop" role="dialog" aria-label={t('columns.title')}>
                <div className="cp-h">{t('columns.title')}</div>
                {columns.map((c) => {
                  const locked = picker!.locked.includes(c.key);
                  const on = pk.shown.includes(c.key);
                  const dis = !on && pk.full;
                  if (c.header === '' || c.header == null) return null;
                  return (
                    <button key={c.key} type="button" className={`cp-i ${on ? 'on' : ''} ${locked ? 'lock' : ''} ${dis ? 'dis' : ''}`} role="menuitemcheckbox" aria-checked={on} disabled={locked || dis} onClick={() => pk.toggle(c.key)}>
                      <span className="cp-x">
                        <Icon as={Check} size="sm" />
                      </span>
                      <span className="cp-l">{c.header}</span>
                      {locked && (
                        <span className="cp-s">
                          <Icon as={Lock} size="sm" />
                          {t('columns.always')}
                        </span>
                      )}
                    </button>
                  );
                })}
                {pk.full && <div className="cp-f">{t('columns.full')}</div>}
              </div>
            )}
          />
  );
  return (
    <>
      {pickerButton && host && createPortal(pickerButton, host)}
      <div className="tbl-wrap" ref={wrap}>
        <table className="an-tbl" ref={tbl} aria-busy={loading || undefined}>
          <thead>
            <tr>
              {visible.map((c) => (
                <th key={c.key} className={cls(c)} scope="col" style={c.width != null && c.key !== mainKey ? { width: c.width } : undefined}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              late ? (
                <SkeletonRows cells={visible.map((c): SkeletonCell => (c.header === '' || c.header == null ? 'empty' : (c.type ?? 'text')))} />
              ) : null
            ) : error ? (
              <tr className="err-row">
                <td colSpan={visible.length}>
                  <LoadError title={errorTitle} error={error} onRetry={onRetry} />
                </td>
              </tr>
            ) : rows.length === 0 && empty ? (
              <tr className="empty">
                <td colSpan={visible.length}>{empty}</td>
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
                  {visible.map((c) => (
                    <td key={c.key} className={cls(c)}>
                      {cell(c, r)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
        {loading && late && <LoadingLive />}
      </div>
    </>
  );
}

/**
 * Place for the column picker's "Columns" button in a page's tab chip row (prototype: the button sits
 * at the end of that row). Put it in a `<div className="cp-row">` with the `Chips`; without it the
 * button gets its own row above the table's card.
 */
export function ColumnsSlot() {
  return <span className="cols-slot" data-cols-slot="" />;
}

/**
 * Phone list of `ListCard`s with the same states as `Table`: skeleton cards while loading (after
 * ~300 ms), "Couldn't load this list" with Try again in place of the cards on error.
 */
export function ListCards({ loading, error, onRetry, errorTitle, children, empty }: { loading?: boolean; error?: unknown; onRetry?: () => void; errorTitle?: ReactNode; children?: ReactNode; empty?: ReactNode }) {
  const late = useDelayed(!!loading);
  const has = Array.isArray(children) ? children.some(Boolean) : !!children;
  return (
    <div className="list-cards" aria-busy={loading || undefined}>
      {loading ? late ? <SkeletonCards /> : null : error ? <LoadError title={errorTitle} error={error} onRetry={onRetry} /> : has ? children : empty}
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
        <div key={i} className="contents">
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
  /** The step is late: bad border and number (light: pale red circle). */
  late?: boolean;
}

/** Done / current / later steps; vertical on the order page. */
export function ProgressSteps({ steps, current, horizontal }: { steps: Step[]; current: number; horizontal?: boolean }) {
  if (horizontal) {
    return (
      <div className="an-hsteps" style={{ ['--n' as string]: steps.length }}>
        {steps.map((s, i) => (
          <div key={i} className={`an-hs ${s.late ? 'late' : (s.done ?? i < current) ? 'done' : i === current ? 'now' : ''}`}>
            <span className="c">{(s.done ?? i < current) ? <Icon as={Check} size="sm" /> : i + 1}</span>
            <span className="t">{s.label}</span>
            {s.detail && <span className="d">{s.detail}</span>}
          </div>
        ))}
      </div>
    );
  }
  return (
    <ol className="an-steps">
      {steps.map((s, i) => (
        <li key={i} className={`an-ps ${s.late ? 'late' : (s.done ?? i < current) ? 'done' : i === current ? 'now' : ''}`} aria-current={i === current ? 'step' : undefined}>
          <span className="c">{(s.done ?? i < current) ? <Icon as={Check} size="sm" /> : i + 1}</span>
          <span className="t">{s.label}</span>
          {s.detail && <span className="d">{s.detail}</span>}
          {s.action && i === current && <span className="d act">{s.action}</span>}
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
      <span className="tx">
        <span className="t">{title}</span>
        {sub && <span className="sub">{sub}</span>}
      </span>
      <span className="row">{actions}</span>
    </div>
  );
}

/** Design system name for `DocRow`: icon box, title, detail line, IconButton actions (aria-label naming the document). */
export const DocumentRow = DocRow;

/** Row that opens a setting or shows its value (label, value at the end, caret that flips in Hebrew). */
export function SettingsItem({ icon, label, value, href, onClick, phone, pill }: { icon: PhosphorIcon; label: ReactNode; value?: ReactNode; href?: string; onClick?: () => void; phone?: boolean; pill?: ReactNode }) {
  const inner = (
    <>
      <Icon as={icon} />
      <span>{label}</span>
      <span className="val">
        {pill}
        {value != null && <bdi>{value}</bdi>}
        {(href || onClick) && <Icon as={CaretRight} size="sm" className="subtle" />}
      </span>
    </>
  );
  const cls = `an-sitem ${phone ? 'phone' : ''}`;
  return href ? (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  ) : (
    <button type="button" className={cls} onClick={onClick}>
      {inner}
    </button>
  );
}

export function Skeleton({ h = 20, w }: { h?: number; w?: number | string }) {
  return <div className="skeleton" style={{ height: h, width: w ?? '100%' }} aria-hidden />;
}

/** Page skeleton, shown only when loading takes longer than ~300 ms (so fast pages don't flash). */
export function PageSkeleton() {
  const late = useDelayed(true);
  return late ? <DefaultPageSkeleton /> : null;
}

/**
 * A page whose data couldn't load. 404 → "We can't find this…", 403 → no access, otherwise
 * "Couldn't load this page" with Try again. (Prefer `PageState` for new code.)
 */
export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  return <PageState query={{ isLoading: false, error, refetch: () => retry?.() }} />;
}

export { CheckCircle };

import { formatDate, formatDateShort } from '@ananda/shared';

const pad = (n: number) => String(n).padStart(2, '0');
const day = (iso: string) => new Date(`${iso}T00:00:00`);

/**
 * An event's dates as one range: "12–14 Dec 2026" (EN), "12–14.12.2026" (BG), Intl range in HE.
 * `short` drops the year ("12–14 Dec"), as on the phone list.
 */
export function eventDates(startsOn: string, endsOn: string, locale: string, short = false): string {
  const a = day(startsOn);
  const b = day(endsOn);
  if (locale === 'he') {
    const f = new Intl.DateTimeFormat('he-IL', short ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
    return startsOn === endsOn ? f.format(a) : f.formatRange(a, b);
  }
  const end = (d: Date) => (short ? (formatDateShort(d, locale)) : formatDate(d, locale));
  if (startsOn === endsOn) return end(b);
  const sameYear = a.getFullYear() === b.getFullYear();
  const sameMonth = sameYear && a.getMonth() === b.getMonth();
  if (sameMonth) return `${locale === 'bg' ? pad(a.getDate()) : a.getDate()}–${end(b)}`;
  if (sameYear || short) return `${formatDateShort(a, locale)} – ${end(b)}`;
  return `${formatDate(a, locale)} – ${formatDate(b, locale)}`;
}

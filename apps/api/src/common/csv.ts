import type { Response } from 'express';

function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = v instanceof Date ? v.toISOString() : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV export with a UTF-8 BOM so Excel shows Bulgarian and Hebrew correctly. */
export function sendCsv(res: Response, filename: string, header: string[], rows: unknown[][]) {
  const body = '﻿' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(body);
}

export const euros = (cents: number | null | undefined) => (cents == null ? '' : (cents / 100).toFixed(2));

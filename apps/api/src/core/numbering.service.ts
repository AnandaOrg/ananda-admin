import { Injectable, Optional } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { docNumber } from '@ananda/shared';
import type { DbOrTx } from '../db/db.module';
import { SettingsService } from './settings.service';

export const SEQUENCES = { order: 'S', purchase: 'P', proforma: 'PRO', invoice: 'INV', credit_note: 'CN' } as const;
export type SequenceKey = keyof typeof SEQUENCES;
/** Series whose prefix the System admin can change in Settings › Documents. */
export const PREFIXED = ['order', 'invoice', 'credit_note'] as const;

/**
 * Next number for a series. The counter row is locked by the upsert and rolls back with the
 * transaction, so invoice numbers stay sequential without gaps (PRD §8.1).
 */
@Injectable()
export class NumberingService {
  constructor(@Optional() private readonly settings?: SettingsService) {}

  /** Prefix for new numbers, e.g. "S-"; a changed prefix applies to the next document only. */
  async prefix(tx: DbOrTx, key: SequenceKey): Promise<string | null> {
    if (!this.settings || !(PREFIXED as readonly string[]).includes(key)) return null;
    const p = (await this.settings.get('documents', tx)).prefixes?.[key as (typeof PREFIXED)[number]];
    return p ? p : null;
  }

  private async format(tx: DbOrTx, key: SequenceKey, n: number): Promise<string> {
    const p = await this.prefix(tx, key);
    return p ? `${p}${String(n).padStart(4, '0')}` : docNumber(SEQUENCES[key], n);
  }

  async next(tx: DbOrTx, key: SequenceKey): Promise<string> {
    const res = await tx.execute<{ n: number }>(sql`
      INSERT INTO number_sequences (key, next) VALUES (${key}, 2)
      ON CONFLICT (key) DO UPDATE SET next = number_sequences.next + 1
      RETURNING next - 1 AS n`);
    return this.format(tx, key, Number(res.rows[0].n));
  }

  async peek(tx: DbOrTx, key: SequenceKey): Promise<string> {
    return this.format(tx, key, await this.peekNumber(tx, key));
  }

  /** The counter the next document will get. */
  async peekNumber(tx: DbOrTx, key: SequenceKey): Promise<number> {
    const res = await tx.execute<{ next: number }>(sql`SELECT next FROM number_sequences WHERE key = ${key}`);
    return Number(res.rows[0]?.next ?? 1);
  }

  /** Moves a series forward (never back, so a number is never issued twice). Call inside a transaction. */
  async setNext(tx: DbOrTx, key: SequenceKey, next: number): Promise<void> {
    await tx.execute(sql`
      INSERT INTO number_sequences (key, next) VALUES (${key}, ${next})
      ON CONFLICT (key) DO UPDATE SET next = GREATEST(number_sequences.next, ${next})`);
  }
}

import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { docNumber } from '@ananda/shared';
import type { DbOrTx } from '../db/db.module';

export const SEQUENCES = { order: 'S', purchase: 'P', proforma: 'PRO', invoice: 'INV', credit_note: 'CN' } as const;
export type SequenceKey = keyof typeof SEQUENCES;

/**
 * Next number for a series. The counter row is locked by the upsert and rolls back with the
 * transaction, so invoice numbers stay sequential without gaps (PRD §8.1).
 */
@Injectable()
export class NumberingService {
  async next(tx: DbOrTx, key: SequenceKey): Promise<string> {
    const res = await tx.execute<{ n: number }>(sql`
      INSERT INTO number_sequences (key, next) VALUES (${key}, 2)
      ON CONFLICT (key) DO UPDATE SET next = number_sequences.next + 1
      RETURNING next - 1 AS n`);
    return docNumber(SEQUENCES[key], Number(res.rows[0].n));
  }

  async peek(tx: DbOrTx, key: SequenceKey): Promise<string> {
    const res = await tx.execute<{ next: number }>(sql`SELECT next FROM number_sequences WHERE key = ${key}`);
    return docNumber(SEQUENCES[key], Number(res.rows[0]?.next ?? 1));
  }
}

import { z } from 'zod';
import { cartonsSchema } from '@ananda/shared';

/** Cartons per flavour sold at an event by one invited agent, and what was taken excl. VAT (FR-EVT-3). */
export const eventSaleSchema = z.object({
  agentId: z.string().uuid(),
  cartons: cartonsSchema,
  amountNetCents: z.number({ message: 'Enter what was taken, excl. VAT' }).int().min(0).max(100_000_000),
});
export type EventSaleInput = z.infer<typeof eventSaleSchema>;

import { z } from 'zod';
import { cartonsSchema } from '@ananda/shared';

/** Cartons per flavour sold at an event by one invited agent (FR-EVT-3). */
export const eventSaleSchema = z.object({ agentId: z.string().uuid(), cartons: cartonsSchema });
export type EventSaleInput = z.infer<typeof eventSaleSchema>;

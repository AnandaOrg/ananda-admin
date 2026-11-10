// Request bodies, validated on the server and reused by the forms on the client.
import { z } from 'zod';
import { FLAVOURS } from './domain';
import { AREAS, SENSITIVE_ACTIONS } from './access';
import { EXPENSE_CATEGORIES, PAYMENT_METHODS } from './status';

const id = z.string().uuid();
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const cents = z.number().int();
const money = cents.min(0);
const flavour = z.enum(FLAVOURS);
const text = (max = 2000) => z.string().trim().max(max);
const required = (max = 200) => z.string().trim().min(1).max(max);

export const cartonsSchema = z
  .object(Object.fromEntries(FLAVOURS.map((f) => [f, z.number().int().min(0).max(100_000).optional()])) as Record<(typeof FLAVOURS)[number], z.ZodOptional<z.ZodNumber>>)
  .strict();
export const signedCartonsSchema = z.object(Object.fromEntries(FLAVOURS.map((f) => [f, z.number().int().optional()])) as Record<(typeof FLAVOURS)[number], z.ZodOptional<z.ZodNumber>>);

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
  device: z.enum(['desktop', 'phone']).default('desktop'),
});
export const twoStepSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code') });
export const acceptInviteSchema = z.object({ token: z.string().min(10), password: z.string().min(8).max(200) });
export const changePasswordSchema = z.object({
  current: z.string().min(1),
  next: z.string().min(8).max(200),
  signOutOthers: z.boolean().default(false),
});
export const profileSchema = z.object({ language: z.enum(['en', 'bg', 'he']).optional(), theme: z.enum(['dark', 'light']).optional(), name: required().optional() });

export const orderDraftSchema = z.object({
  customerId: id.nullable().optional(),
  cartons: cartonsSchema,
  note: text().optional(),
  eventId: id.nullable().optional(),
});
export const specialPriceSchema = z.object({ unitPriceCents: z.number().int().min(1).max(10_000), reason: required(1000) });
export const confirmPaymentSchema = z.object({
  receivedOn: isoDay,
  amountCents: money.min(1),
  method: z.enum(PAYMENT_METHODS).default('bank_transfer'),
  bankReference: text(120).optional(),
});
export const correctionSchema = z.object({ cartons: cartonsSchema, reason: required(1000) });
export const creditNoteSchema = z.object({ reason: required(60), cartons: cartonsSchema, note: text().optional() });
export const cancelOrderSchema = z.object({ reason: required(60), note: text().optional() });
export const decisionSchema = z.object({ reason: required(60), message: text().optional() });
export const partDeliverySchema = z.object({ kept: cartonsSchema, reason: required(60), note: text().optional() });
export const partDeliveryOutcomeSchema = z.object({ outcome: z.enum(['credit_note', 'redeliver']), note: text().optional() });

export const customerSchema = z.object({
  vatNumber: required(20),
  country: z.string().trim().length(2).toUpperCase(),
  vatValid: z.boolean().nullable().optional(),
  companyName: required(),
  registeredAddress: required(500),
  deliveryAddress: text(500).optional(),
  city: text(120).optional(),
  contactName: required(),
  phone: required(40),
  invoiceEmail: z.string().trim().email(),
  proformaLanguage: z.enum(['en', 'bg']).default('bg'),
  paymentTermsDays: z.number().int().min(0).max(120).default(7),
  note: text().optional(),
  submit: z.boolean().default(true),
});
export const changeAgentSchema = z.object({ agentId: id, reason: required(60), note: text().optional() });
export const vatCheckSchema = z.object({ country: z.string().length(2), vatNumber: required(20) });

export const reminderSchema = z.object({ subject: required(300), message: required(5000) });

export const supplierSchema = z.object({
  company: required(),
  country: z.string().trim().length(2).toUpperCase(),
  vatNumber: text(20).optional(),
  contactName: text(200).optional(),
  ordersEmail: z.string().trim().email(),
  phone: text(40).optional(),
  approvedFlavours: z.array(flavour).min(1),
  defaultFlavours: z.array(flavour).default([]),
  leadTimeDays: z.number().int().min(0).max(365),
  paymentTermsDays: z.number().int().min(0).max(365).default(30),
  unitPriceCents: z.number().min(0).max(10_000),
});
export const purchaseSchema = z.object({ supplierId: id, expectedOn: isoDay, cartons: cartonsSchema, note: text().optional() });
export const receivePurchaseSchema = z.object({
  arrivedOn: isoDay,
  unitsReceived: z.object(Object.fromEntries(FLAVOURS.map((f) => [f, z.number().int().min(0).optional()])) as Record<(typeof FLAVOURS)[number], z.ZodOptional<z.ZodNumber>>),
  supplierInvoiceNumber: text(80).optional(),
  supplierInvoiceDueOn: isoDay.optional(),
});
export const freightSchema = z.object({
  carrier: required(),
  amountNetCents: money,
  vatRate: z.number().min(0).max(1).default(0.2),
  invoiceNumber: text(80).optional(),
  payBy: isoDay,
});
export const shipmentSchema = z.object({ carrier: required(), mode: z.enum(['road', 'sea', 'air', 'rail']), route: text(200).optional(), departOn: isoDay.optional(), arriveOn: isoDay.optional() });
export const payablePaymentSchema = z.object({
  paidOn: isoDay,
  amountCents: money.min(1),
  paidFrom: required(120),
  bankReference: text(120).optional(),
});
export const supplierMessageSchema = z.object({
  topic: z.enum(['arrival_date', 'tracking', 'invoice_copy', 'other']),
  to: z.string().trim().email(),
  subject: required(300),
  body: required(10_000),
});
export const polishSchema = z.object({ text: required(10_000), tone: z.enum(['friendly', 'neutral', 'firm']).default('neutral'), language: z.enum(['en', 'bg', 'he']).default('en') });

export const allocateSchema = z.object({ orderIds: z.array(id).min(1) });
export const stockAdjustmentSchema = z.object({ flavour, cartons: z.number().int().refine((n) => n !== 0, 'Enter a change'), reason: required(60), note: text().optional() });
export const stockCountSchema = z.object({ cartons: cartonsSchema });

export const nudgeSchema = z.object({ subject: required(300), message: required(5000) });
export const inviteSchema = z
  .object({
    name: required(),
    email: z.string().trim().toLowerCase().email(),
    roleId: id.optional(),
    roleKey: z.string().trim().min(1).max(60).optional(),
    language: z.enum(['en', 'bg', 'he']).default('en'),
    message: text(5000).optional(),
  })
  .refine((v) => !!v.roleId !== !!v.roleKey, { message: 'Choose a role', path: ['roleId'] });
export const commissionPaySchema = z.object({ entryIds: z.array(id).optional() });

export const eventSchema = z.object({
  name: required(),
  startsOn: isoDay,
  endsOn: isoDay,
  place: required(),
  kind: z.enum(['event', 'festival']),
  agentIds: z.array(id).default([]),
});
export const eventStockSchema = z.object({ direction: z.enum(['to_event', 'back']), cartons: cartonsSchema });

export const expenseSchema = z.object({
  spentOn: isoDay,
  category: z.enum(EXPENSE_CATEGORIES),
  description: required(500),
  amountNetCents: money,
  vatRate: z.number().min(0).max(1).default(0.2),
  paid: z.boolean().default(true),
  eventId: id.nullable().optional(),
});
export const bankBalanceSchema = z.object({ account: required(120), balanceOn: isoDay, balanceCents: cents });

export const roleSchema = z.object({
  name: required(80),
  description: text(500).optional(),
  areas: z.record(z.enum(AREAS), z.enum(['hidden', 'view', 'edit'])),
  sensitive: z.array(z.enum(SENSITIVE_ACTIONS)),
});
export const updateMemberSchema = z.object({ roleId: id.optional(), status: z.enum(['active', 'deactivated']).optional() });
export const settingSchema = z.object({ value: z.unknown() });

export type LoginInput = z.infer<typeof loginSchema>;
export type OrderDraftInput = z.infer<typeof orderDraftSchema>;
export type ConfirmPaymentInput = z.infer<typeof confirmPaymentSchema>;
export type CustomerInput = z.infer<typeof customerSchema>;
export type SupplierInput = z.infer<typeof supplierSchema>;
export type PurchaseInput = z.infer<typeof purchaseSchema>;
export type ExpenseInput = z.infer<typeof expenseSchema>;
export type EventInput = z.infer<typeof eventSchema>;
export type InviteInput = z.infer<typeof inviteSchema>;

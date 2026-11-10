// Request bodies owned by the Admin module (FR-ADM-1, FR-ADM-3).
import { z } from 'zod';

const text = (max = 200) => z.string().trim().max(max);
const email = z.string().trim().toLowerCase().email('Enter a valid e-mail');
const emailOrEmpty = z.union([email, z.literal('')]);

/** Invite a member. Exactly one of roleId / roleKey (the "Invite new agent" panel sends roleKey 'agent'). */
export const inviteMemberSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter a name').max(200),
    email,
    language: z.enum(['en', 'bg', 'he']).default('en'),
    message: text(5000).optional(),
    roleId: z.string().uuid().optional(),
    roleKey: z.string().trim().min(1).max(80).optional(),
  })
  .refine((v) => !!v.roleId !== !!v.roleKey, { message: 'Pick a role', path: ['roleId'] });
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const ruleSchemas = {
  ownership: z.object({
    months: z.number().int().min(1, 'At least 1 month').max(60, 'At most 60 months'),
    countedFrom: z.enum(['each_order', 'first_order']),
    warningDays: z.number().int().min(0).max(180, 'At most 180 days'),
    atEnd: z.enum(['free_to_claim', 'stay_with_agent']),
  }),
  minOrderCartons: z.number().int().min(1, 'At least 1 carton').max(10_000),
  stockHoldDays: z.number().int().min(1, 'At least 1 day').max(60, 'At most 60 days'),
  proformaValidityDays: z.number().int().min(1, 'At least 1 day').max(60, 'At most 60 days'),
  commissionPerUnitCents: z.number().int().min(0).max(1000, 'At most €10.00 per unit'),
  supplierFollowUpDays: z.number().int().min(1, 'At least 1 day').max(60, 'At most 60 days'),
} as const;
export type RuleKey = keyof typeof ruleSchemas;
export const RULE_KEYS = Object.keys(ruleSchemas) as RuleKey[];

export const settingSchemas = {
  company: z.object({
    name: z.string().trim().min(1, 'Enter the trading name').max(200),
    legalName: text(),
    vatNumber: text(20),
    address: text(500),
    city: text(120),
    country: z.string().trim().length(2, 'Use the 2-letter country code').toUpperCase(),
    email: emailOrEmpty,
    phone: text(40),
  }),
  bank: z.object({
    bank: text(),
    iban: z
      .string()
      .trim()
      .toUpperCase()
      .transform((s) => s.replace(/\s+/g, ''))
      .refine((s) => s === '' || /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s), 'Check the IBAN'),
    bic: z
      .string()
      .trim()
      .toUpperCase()
      .refine((s) => s === '' || /^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(s), 'Use 8 or 11 letters and numbers'),
    accounts: z.array(z.string().trim().min(1).max(120)).max(20),
  }),
  email: z.object({
    warehouse: emailOrEmpty,
    accounting: emailOrEmpty,
    sender: text(200),
    replyTo: emailOrEmpty,
    copyAgent: z.boolean(),
  }),
  documents: z.object({
    languages: z.array(z.enum(['en', 'bg'])).min(1, 'Pick at least one language'),
    logoUrl: z
      .string()
      .trim()
      .max(2000)
      .refine((s) => s === '' || /^https?:\/\//.test(s), 'Start with https://')
      .transform((s) => (s === '' ? null : s))
      .nullable(),
  }),
  security: z.object({
    desktopSessionHours: z.number().int().min(1, 'At least 1 hour').max(72, 'At most 72 hours'),
    phoneSessionDays: z.number().int().min(1, 'At least 1 day').max(90, 'At most 90 days'),
    inviteValidityDays: z.number().int().min(1, 'At least 1 day').max(30, 'At most 30 days'),
    passwordMinLength: z.number().int().min(8, 'At least 8 characters').max(64),
  }),
} as const;
export type EditableSettingKey = keyof typeof settingSchemas;
export const EDITABLE_SETTINGS = Object.keys(settingSchemas) as EditableSettingKey[];

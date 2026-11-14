import { z } from 'zod';

const required = (max = 200) => z.string().trim().min(1, { message: 'Fill this in' }).max(max);
const optional = (max = 200) => z.string().trim().max(max).optional().nullable();

/** IBAN check digits (ISO 13616, mod 97). */
export function validIban(raw: string): boolean {
  const iban = raw.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const moved = iban.slice(4) + iban.slice(0, 4);
  let rest = 0;
  for (const ch of moved) {
    const n = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of n) rest = (rest * 10 + Number(d)) % 97;
  }
  return rest === 1;
}

const upper = (s: string) => s.replace(/\s+/g, '').toUpperCase();

/** Step 1 · Company: which company ANANDA pays the commission to, and who signs. */
export const setupCompanySchema = z
  .object({
    registeredIn: z.enum(['bg', 'eu', 'other']).default('bg'),
    country: z.string().trim().length(2).toUpperCase().default('BG'),
    vatNumber: optional(40),
    companyRegNumber: optional(60),
    companyName: required(),
    address: required(300),
    city: optional(100),
    vatRegistered: z.boolean(),
    managerName: required(),
    managerRole: required(80),
    payoutEmail: z.string().trim().toLowerCase().email({ message: 'Enter a valid e-mail' }),
  })
  .superRefine((v, ctx) => {
    if (v.registeredIn === 'bg') {
      const n = upper(v.vatNumber ?? '');
      if (!/^(BG)?\d{9,10}$/.test(n)) ctx.addIssue({ code: 'custom', path: ['vatNumber'], message: 'A Bulgarian EIK has 9 digits; a VAT number is BG and the EIK.' });
    } else if (v.registeredIn === 'eu') {
      if (!v.companyRegNumber?.trim()) ctx.addIssue({ code: 'custom', path: ['companyRegNumber'], message: 'Fill this in' });
      if (v.vatRegistered && !/^[A-Z]{2}[A-Z0-9]{2,13}$/.test(upper(v.vatNumber ?? ''))) ctx.addIssue({ code: 'custom', path: ['vatNumber'], message: 'Enter the EU VAT number, e.g. EL123456789' });
    } else if (!v.vatNumber?.trim()) ctx.addIssue({ code: 'custom', path: ['vatNumber'], message: 'Fill this in' });
  });
export type SetupCompanyInput = z.infer<typeof setupCompanySchema>;

/** Step 2 · Bank: where the commission is paid, in euros by SEPA transfer. */
export const setupBankSchema = z.object({
  accountHolder: required(),
  iban: z
    .string()
    .trim()
    .transform(upper)
    .refine(validIban, { message: "This IBAN doesn't add up. Check for a missing or swapped character." }),
  bic: z
    .string()
    .trim()
    .transform(upper)
    .refine((s) => /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(s), { message: 'Check the BIC: 8 or 11 letters and digits, e.g. UNCRBGSF' }),
  bankName: required(),
  bankAddress: optional(300),
});
export type SetupBankInput = z.infer<typeof setupBankSchema>;

/** "Save and finish later": whatever is filled in, unchecked, for either step. */
export const setupDraftSchema = z.object({
  registeredIn: z.enum(['bg', 'eu', 'other']).optional(),
  country: z.string().trim().max(2).optional(),
  vatNumber: optional(40),
  companyRegNumber: optional(60),
  companyName: optional(),
  address: optional(300),
  city: optional(100),
  vatRegistered: z.boolean().optional().nullable(),
  managerName: optional(),
  managerRole: optional(80),
  payoutEmail: optional(200),
  accountHolder: optional(),
  iban: optional(40),
  bic: optional(20),
  bankName: optional(),
  bankAddress: optional(300),
});
export type SetupDraftInput = z.infer<typeof setupDraftSchema>;

/** E-signature in the app: the signer types their full name and confirms they can sign. */
export const signSchema = z.object({
  name: required(),
  agree: z.literal(true, { message: 'Tick the box first' }),
});
export type SignInput = z.infer<typeof signSchema>;

/** Signed on paper: the scan comes as a multipart file; the form fields arrive as strings. */
export const paperSignSchema = z.object({ agree: z.union([z.literal(true), z.literal('true')], { message: 'Tick the box first' }) });

/** Invite new agent with the full invitation e-mail as written (and polished) in the panel. */
export const agentInviteSchema = z.object({
  name: required(),
  email: z.string().trim().toLowerCase().email({ message: 'Enter a valid e-mail' }),
  language: z.enum(['en', 'bg', 'he']).default('en'),
  subject: required(300),
  letter: required(5000),
});
export type AgentInviteInput = z.infer<typeof agentInviteSchema>;

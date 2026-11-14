import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { isoDate, type BusinessRules, type DocumentSettings, type SystemRole } from '@ananda/shared';
import { InjectDb, type Db, type Tx } from '../db/db.module';
import { auditLog, customers, orders, roles, settings as settingsTable, users } from '../db/schema';
import { AuditService, diff } from '../core/audit.service';
import { NumberingService, PREFIXED, SEQUENCES, type SequenceKey } from '../core/numbering.service';
import { SETTING_DEFAULTS, SettingsService, type SettingKey, type SettingsShape } from '../core/settings.service';
import { FilesService } from '../core/files.service';
import { NotifyService } from '../core/notify.service';
import { verifyTotp } from '../core/crypto';
import type { AuthContext } from '../common/context';
import { ruleSchemas, settingSchemas, type EditableSettingKey, type RuleKey } from './admin.schemas';

function parse<T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } }, value: unknown, prefix?: string): T {
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  const fields: Record<string, string> = {};
  for (const i of r.error.issues) {
    const k = [prefix, ...i.path.map(String)].filter(Boolean).join('.') || 'value';
    fields[k] ??= i.message;
  }
  throw new BadRequestException({ message: 'Check the highlighted fields', fields });
}

// ---------- Settings cards: Documents, E-mail, Bank and sign-in (each saved from its own side panel) ----------

/** Two-step sign-in policy, applied to the roles' "two-step required" switch. */
export const TWO_STEP_POLICIES = ['admins_finance', 'everyone', 'optional'] as const;
type TwoStepPolicy = (typeof TWO_STEP_POLICIES)[number] | 'custom';
const ADMINS_FINANCE: SystemRole[] = ['system_admin', 'admin', 'finance'];

/** "Sign out after" presets (desktop hours, phone days). "Never" keeps a session for ten years. */
export const SIGN_OUT_PRESETS = { short: { desktopSessionHours: 1, phoneSessionDays: 7 }, standard: { desktopSessionHours: 8, phoneSessionDays: 30 }, never: { desktopSessionHours: 87_600, phoneSessionDays: 3_650 } } as const;
type SignOutPreset = keyof typeof SIGN_OUT_PRESETS | 'custom';

const text = (max = 200) => z.string().trim().max(max);
const prefix = z
  .string()
  .trim()
  .min(1, 'Enter a prefix')
  .max(8, 'At most 8 characters')
  .regex(/^[A-Za-z0-9][A-Za-z0-9\-/.]*$/, 'Use letters, numbers and - / .');

export const cardSchemas = {
  docs: z.object({
    proformaLanguage: z.enum(['per_customer', 'en', 'bg']),
    proformaValidityDays: ruleSchemas.proformaValidityDays,
    prefixes: z.object({ order: prefix, invoice: prefix, credit_note: prefix }),
    nextInvoice: z.number().int().min(1, 'Enter a number').max(99_999_999),
    footer: text(300),
    company: settingSchemas.company,
  }),
  mail: settingSchemas.email,
  bank: z.object({
    bank: settingSchemas.bank.shape.bank,
    iban: settingSchemas.bank.shape.iban,
    bic: settingSchemas.bank.shape.bic,
    accounts: settingSchemas.bank.shape.accounts,
    twoStep: z.enum([...TWO_STEP_POLICIES, 'custom']),
    signOut: z.enum(['short', 'standard', 'never', 'custom']),
  }),
} as const;
export type CardKey = keyof typeof cardSchemas;

const LOGO_TYPES = new Set(['image/png', 'image/svg+xml', 'image/jpeg', 'image/webp']);
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

const languagesFor = (v: 'per_customer' | 'en' | 'bg'): Array<'en' | 'bg'> => (v === 'per_customer' ? ['en', 'bg'] : [v]);
const proformaLanguageOf = (langs: Array<'en' | 'bg'>): 'per_customer' | 'en' | 'bg' => (langs.length === 1 ? langs[0] : 'per_customer');
const signOutOf = (s: { desktopSessionHours: number; phoneSessionDays: number }): SignOutPreset =>
  (Object.entries(SIGN_OUT_PRESETS).find(([, p]) => p.desktopSessionHours === s.desktopSessionHours && p.phoneSessionDays === s.phoneSessionDays)?.[0] as SignOutPreset | undefined) ?? 'custom';

/** Settings & rules (FR-ADM-3). Rules apply from the save date: they are read when used, never back-dated. */
@Injectable()
export class AdminSettingsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
    private readonly notify: NotifyService,
  ) {}

  async get() {
    const all = await this.settings.all();
    const nextNumbers = Object.fromEntries(await Promise.all((Object.keys(SEQUENCES) as SequenceKey[]).map(async (k) => [k, await this.numbering.peek(this.db, k)] as const)));
    const changes = await this.db
      .select({ recordType: auditLog.recordType, recordId: auditLog.recordId, at: auditLog.at, actorName: auditLog.actorName, changes: auditLog.changes })
      .from(auditLog)
      .where(and(inArray(auditLog.recordType, ['rule', 'setting'])))
      .orderBy(desc(auditLog.at))
      .limit(200);
    const lastChanged: Record<string, { at: Date; by: string | null }> = {};
    for (const c of changes) {
      const key = `${c.recordType}:${c.recordId}`;
      lastChanged[key] ??= { at: c.at, by: c.actorName };
    }
    const docs = all.documents;
    const prefixes = Object.fromEntries(PREFIXED.map((k) => [k, docs.prefixes?.[k] || `${SEQUENCES[k]}-`])) as Record<(typeof PREFIXED)[number], string>;
    return {
      rules: all.rules,
      company: all.company,
      bank: all.bank,
      email: all.email,
      documents: {
        languages: docs.languages,
        proformaLanguage: proformaLanguageOf(docs.languages),
        proformaValidityDays: all.rules.proformaValidityDays,
        logoUrl: docs.logoUrl,
        logo: docs.logo ? { name: docs.logo.name, mime: docs.logo.mime } : null,
        footer: docs.footer ?? this.defaultFooter(all.company),
        prefixes,
        nextInvoice: await this.numbering.peekNumber(this.db, 'invoice'),
      },
      security: { ...all.security, signOut: signOutOf(all.security), twoStep: await this.twoStepPolicy() },
      nextNumbers,
      lastChanged,
      ownershipExample: await this.ownershipExample(),
    };
  }

  private defaultFooter(c: SettingsShape['company']) {
    return [c.legalName || c.name, [c.address, c.city].filter(Boolean).join(', '), c.vatNumber ? `VAT ${c.vatNumber}` : ''].filter(Boolean).join(' · ');
  }

  /** Which preset the roles' two-step switches match today. */
  private async twoStepPolicy(tx: Db | Tx = this.db): Promise<TwoStepPolicy> {
    const rs = await tx.select({ baseRole: roles.baseRole, required: roles.twoStepRequired }).from(roles);
    if (rs.every((r) => r.required)) return 'everyone';
    if (rs.every((r) => !r.required)) return 'optional';
    if (rs.every((r) => r.required === ADMINS_FINANCE.includes(r.baseRole))) return 'admins_finance';
    return 'custom';
  }

  /**
   * A real customer to show what an agent is told before ownership ends: the agent's customer whose
   * ownership ends next.
   */
  private async ownershipExample() {
    const [c] = await this.db
      .select({ id: customers.id, name: customers.companyName, ownedUntil: customers.ownedUntil })
      .from(customers)
      .where(and(isNotNull(customers.agentId), isNotNull(customers.ownedUntil), gte(customers.ownedUntil, isoDate()), ne(customers.status, 'archived')))
      .orderBy(asc(customers.ownedUntil))
      .limit(1);
    if (!c) return null;
    const [last] = await this.db
      .select({ at: sql<Date | null>`max(${orders.createdAt})`.mapWith(orders.createdAt) })
      .from(orders)
      .where(and(eq(orders.customerId, c.id), ne(orders.status, 'draft')));
    return { customerName: c.name, ownedUntil: c.ownedUntil, lastOrderAt: last?.at ?? null };
  }

  /** Locks the settings row so two saves never overwrite each other. */
  private async lock<K extends SettingKey>(tx: Tx, key: K): Promise<SettingsShape[K]> {
    await tx.insert(settingsTable).values({ key, value: SETTING_DEFAULTS[key] }).onConflictDoNothing();
    await tx.select({ key: settingsTable.key }).from(settingsTable).where(eq(settingsTable.key, key)).for('update');
    return this.settings.get(key, tx);
  }

  async setRule(auth: AuthContext, rule: string, value: unknown) {
    if (!(rule in ruleSchemas)) throw new BadRequestException({ message: 'Unknown rule' });
    const key = rule as RuleKey;
    const parsed = parse(ruleSchemas[key] as never, value, 'value') as BusinessRules[RuleKey];
    return this.db.transaction(async (tx) => {
      const changed = await this.writeRule(auth, tx, key, parsed);
      return { ok: true, changed };
    });
  }

  private async writeRule(auth: AuthContext, tx: Tx, key: RuleKey, parsed: BusinessRules[RuleKey]) {
    const before = await this.lock(tx, 'rules');
    const after: BusinessRules = { ...before, [key]: parsed };
    const changes = diff(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, [key]);
    if (!Object.keys(changes).length) return false;
    await this.settings.set('rules', after, auth.user.id, tx);
    if (key === 'proformaValidityDays') {
      const docs = await this.lock(tx, 'documents');
      await this.settings.set('documents', { ...docs, proformaValidityDays: parsed as number }, auth.user.id, tx);
    }
    await this.audit.log(
      auth,
      { category: 'settings', action: 'rule_changed', recordType: 'rule', recordId: key, recordLabel: key, changes, money: key === 'commissionPerUnitCents', meta: { appliesFrom: isoDate() } },
      tx,
    );
    return true;
  }

  async setSetting(auth: AuthContext, key: string, value: unknown) {
    if (!(key in settingSchemas)) throw new BadRequestException({ message: 'Unknown setting' });
    const k = key as EditableSettingKey;
    const parsed = parse(settingSchemas[k] as never, value, 'value') as Record<string, unknown>;
    return this.db.transaction(async (tx) => {
      const changed = await this.writeSetting(auth, tx, k, parsed);
      return { ok: true, changed };
    });
  }

  private async writeSetting(auth: AuthContext, tx: Tx, k: SettingKey, parsed: Record<string, unknown>) {
    const before = (await this.lock(tx, k)) as unknown as Record<string, unknown>;
    const after = { ...before, ...parsed };
    const changes = diff(before, after, Object.keys(parsed));
    if (!Object.keys(changes).length) return false;
    await this.settings.set(k, after as never, auth.user.id, tx);
    await this.audit.log(auth, { category: k === 'security' ? 'security' : 'settings', action: 'setting_changed', recordType: 'setting', recordId: k, recordLabel: k, changes }, tx);
    return true;
  }

  private async checkCode(auth: AuthContext, code: string | undefined) {
    if (!code) throw new ForbiddenException({ code: 'step_up_required', message: 'Enter your two-step code' });
    const [row] = await this.db.select({ secret: users.totpSecret }).from(users).where(eq(users.id, auth.user.id));
    if (!verifyTotp(row?.secret ?? null, code)) throw new ForbiddenException({ code: 'step_up_invalid', message: 'That code did not work. Enter the current code from your app.' });
  }

  /**
   * Saves one Settings card from its side panel in one transaction. Changing the proforma validity
   * (a business rule) or the IBAN needs a fresh two-step code; an IBAN change also tells the other Admins.
   */
  async saveCard(auth: AuthContext, card: string, value: unknown, code: string | undefined) {
    if (!(card in cardSchemas)) throw new NotFoundException({ message: 'Unknown settings card' });
    const all = await this.settings.all();

    if (card === 'docs') {
      const v = parse(cardSchemas.docs, value, 'value');
      const validityChanged = v.proformaValidityDays !== all.rules.proformaValidityDays;
      if (validityChanged) {
        if (!auth.perms.sensitive.includes('change_rules')) throw new ForbiddenException({ code: 'no_access', message: 'You do not have access to this' });
        await this.checkCode(auth, code);
      }
      const currentNext = await this.numbering.peekNumber(this.db, 'invoice');
      if (v.nextInvoice < currentNext) throw new BadRequestException({ message: 'Check the highlighted fields', fields: { 'value.nextInvoice': `Invoices up to ${currentNext - 1} are issued. Use ${currentNext} or more.` } });
      return this.db.transaction(async (tx) => {
        let changed = false;
        if (validityChanged) changed = (await this.writeRule(auth, tx, 'proformaValidityDays', v.proformaValidityDays)) || changed;
        const docs = await this.lock(tx, 'documents');
        const nextDocs: Partial<DocumentSettings> = { languages: languagesFor(v.proformaLanguage), prefixes: v.prefixes, footer: v.footer };
        changed = (await this.writeSetting(auth, tx, 'documents', { ...nextDocs, proformaValidityDays: docs.proformaValidityDays } as Record<string, unknown>)) || changed;
        changed = (await this.writeSetting(auth, tx, 'company', v.company as Record<string, unknown>)) || changed;
        const lockedNext = await this.numbering.peekNumber(tx, 'invoice');
        if (v.nextInvoice > lockedNext) {
          await this.numbering.setNext(tx, 'invoice', v.nextInvoice);
          await this.audit.log(auth, { category: 'documents', action: 'numbering_changed', recordType: 'setting', recordId: 'documents', recordLabel: 'invoice', changes: { nextInvoice: { from: lockedNext, to: v.nextInvoice } } }, tx);
          changed = true;
        }
        return { ok: true, changed };
      });
    }

    if (card === 'mail') {
      const v = parse(cardSchemas.mail, value, 'value');
      return this.db.transaction(async (tx) => ({ ok: true, changed: await this.writeSetting(auth, tx, 'email', v as Record<string, unknown>) }));
    }

    const v = parse(cardSchemas.bank, value, 'value');
    const ibanChanged = v.iban !== all.bank.iban;
    if (ibanChanged) await this.checkCode(auth, code);
    const result = await this.db.transaction(async (tx) => {
      let changed = await this.writeSetting(auth, tx, 'bank', { bank: v.bank, iban: v.iban, bic: v.bic, accounts: v.accounts });
      if (v.signOut !== 'custom') changed = (await this.writeSetting(auth, tx, 'security', { ...SIGN_OUT_PRESETS[v.signOut] })) || changed;
      if (v.twoStep !== 'custom') {
        const before = await this.twoStepPolicy(tx);
        if (before !== v.twoStep) {
          const rs = await tx.select({ id: roles.id, baseRole: roles.baseRole }).from(roles).for('update');
          for (const r of rs) {
            const required = v.twoStep === 'everyone' || (v.twoStep === 'admins_finance' && ADMINS_FINANCE.includes(r.baseRole));
            await tx.update(roles).set({ twoStepRequired: required }).where(eq(roles.id, r.id));
          }
          await this.audit.log(auth, { category: 'security', action: 'two_step_policy_changed', recordType: 'setting', recordId: 'security', recordLabel: 'two_step', changes: { twoStep: { from: before, to: v.twoStep } } }, tx);
          changed = true;
        }
      }
      if (ibanChanged) {
        const admins = (await this.notify.userIdsWithRoles(['system_admin', 'admin'], tx)).filter((id) => id !== auth.user.id);
        await this.notify.toUsers(admins, { type: 'iban_changed', title: `${auth.user.name} changed the IBAN on proformas`, body: v.iban ? `New IBAN …${v.iban.slice(-4)}` : 'The IBAN was removed', link: '/settings' }, tx);
      }
      return { ok: true, changed };
    });
    return result;
  }

  // ---------- Logo on documents ----------

  async uploadLogo(auth: AuthContext, file: { buffer: Buffer; originalname: string; mimetype: string; size: number } | undefined) {
    if (!file) throw new BadRequestException({ message: 'Choose a logo file', fields: { file: 'Choose an SVG or PNG file' } });
    if (!LOGO_TYPES.has(file.mimetype)) throw new BadRequestException({ message: 'Use an SVG or PNG file', fields: { file: 'Use an SVG or PNG file' } });
    if (file.size > MAX_LOGO_BYTES) throw new BadRequestException({ message: 'The logo is too large', fields: { file: 'Use a file under 2 MB' } });
    const saved = await this.files.save(file);
    return this.db.transaction(async (tx) => {
      await this.writeSetting(auth, tx, 'documents', { logo: { path: saved.path, name: saved.name, mime: saved.mime } });
      return { ok: true, logo: { name: saved.name, mime: saved.mime } };
    });
  }

  async removeLogo(auth: AuthContext) {
    return this.db.transaction(async (tx) => ({ ok: true, changed: await this.writeSetting(auth, tx, 'documents', { logo: null, logoUrl: null }) }));
  }

  async logo() {
    const docs = await this.settings.get('documents');
    if (!docs.logo) throw new NotFoundException({ message: 'No logo yet' });
    return { mime: docs.logo.mime, name: docs.logo.name, buffer: await this.files.read(docs.logo.path) };
  }

  // ---------- Profile & devices (everyone, for themselves) ----------

  /** When the password was last set, and whether the person's role requires two-step sign-in. */
  async profile(auth: AuthContext) {
    const [row] = await this.db
      .select({ at: auditLog.at })
      .from(auditLog)
      .where(and(eq(auditLog.recordType, 'user'), eq(auditLog.recordId, auth.user.id), inArray(auditLog.action, ['password_changed', 'invitation_accepted'])))
      .orderBy(desc(auditLog.at))
      .limit(1);
    const [u] = await this.db.select({ createdAt: users.createdAt, required: roles.twoStepRequired }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(eq(users.id, auth.user.id));
    const security = await this.settings.get('security');
    return { passwordChangedAt: row?.at ?? u?.createdAt ?? null, twoStepRequired: !!u?.required, passwordMinLength: security.passwordMinLength };
  }
}

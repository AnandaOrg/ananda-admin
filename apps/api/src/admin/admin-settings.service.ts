import { BadRequestException, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { isoDate, type BusinessRules } from '@ananda/shared';
import { InjectDb, type Db, type Tx } from '../db/db.module';
import { auditLog, settings as settingsTable } from '../db/schema';
import { AuditService, diff } from '../core/audit.service';
import { NumberingService, SEQUENCES, type SequenceKey } from '../core/numbering.service';
import { SETTING_DEFAULTS, SettingsService, type SettingKey, type SettingsShape } from '../core/settings.service';
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

/** Settings & rules (FR-ADM-3). Rules apply from the save date: they are read when used, never back-dated. */
@Injectable()
export class AdminSettingsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
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
    return {
      rules: all.rules,
      company: all.company,
      bank: all.bank,
      email: all.email,
      documents: { ...all.documents, proformaValidityDays: all.rules.proformaValidityDays },
      security: all.security,
      nextNumbers,
      lastChanged,
    };
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
      const before = await this.lock(tx, 'rules');
      const after: BusinessRules = { ...before, [key]: parsed };
      const changes = diff(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, [key]);
      if (!Object.keys(changes).length) return { ok: true, changed: false };
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
      return { ok: true, changed: true };
    });
  }

  async setSetting(auth: AuthContext, key: string, value: unknown) {
    if (!(key in settingSchemas)) throw new BadRequestException({ message: 'Unknown setting' });
    const k = key as EditableSettingKey;
    const parsed = parse(settingSchemas[k] as never, value, 'value') as Record<string, unknown>;
    return this.db.transaction(async (tx) => {
      const before = (await this.lock(tx, k)) as unknown as Record<string, unknown>;
      const after = { ...before, ...parsed };
      const changes = diff(before, after, Object.keys(parsed));
      if (!Object.keys(changes).length) return { ok: true, changed: false };
      await this.settings.set(k, after as never, auth.user.id, tx);
      await this.audit.log(auth, { category: k === 'security' ? 'security' : 'settings', action: 'setting_changed', recordType: 'setting', recordId: k, recordLabel: k, changes }, tx);
      return { ok: true, changed: true };
    });
  }
}

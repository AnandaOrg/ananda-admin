import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  DEFAULT_RULES,
  DEFAULT_SECURITY,
  type BankSettings,
  type BusinessRules,
  type CompanyProfile,
  type DocumentSettings,
  type EmailSettings,
  type SecuritySettings,
} from '@ananda/shared';
import { InjectDb, type Db, type DbOrTx } from '../db/db.module';
import { settings } from '../db/schema';

export interface SettingsShape {
  rules: BusinessRules;
  company: CompanyProfile;
  bank: BankSettings;
  email: EmailSettings;
  documents: DocumentSettings;
  security: SecuritySettings;
  onboarding: { dismissed: boolean };
}

export const SETTING_DEFAULTS: SettingsShape = {
  rules: DEFAULT_RULES,
  company: { name: 'ANANDA', legalName: '', vatNumber: '', address: '', city: '', country: 'BG', email: '', phone: '' },
  bank: { bank: '', iban: '', bic: '', accounts: [] },
  email: { warehouse: '', accounting: '', sender: '', replyTo: '', copyAgent: true },
  documents: { languages: ['en', 'bg'], proformaValidityDays: 7, logoUrl: null },
  security: DEFAULT_SECURITY,
  onboarding: { dismissed: false },
};

export type SettingKey = keyof SettingsShape;

@Injectable()
export class SettingsService {
  constructor(@InjectDb() private readonly db: Db) {}

  async get<K extends SettingKey>(key: K, tx: DbOrTx = this.db): Promise<SettingsShape[K]> {
    const [row] = await tx.select().from(settings).where(eq(settings.key, key));
    const fallback = SETTING_DEFAULTS[key];
    if (!row) return fallback;
    return (typeof fallback === 'object' && !Array.isArray(fallback) ? { ...fallback, ...(row.value as object) } : row.value) as SettingsShape[K];
  }

  async all(): Promise<SettingsShape> {
    const rows = await this.db.select().from(settings);
    const out = { ...SETTING_DEFAULTS } as Record<string, unknown>;
    for (const r of rows) out[r.key] = { ...(SETTING_DEFAULTS as unknown as Record<string, object>)[r.key], ...(r.value as object) };
    return out as unknown as SettingsShape;
  }

  async set<K extends SettingKey>(key: K, value: SettingsShape[K], userId: string | null, tx: DbOrTx = this.db) {
    await tx
      .insert(settings)
      .values({ key, value, updatedById: userId })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date(), updatedById: userId } });
  }

  rules(tx?: DbOrTx) {
    return this.get('rules', tx);
  }
}

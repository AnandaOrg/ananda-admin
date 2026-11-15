import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { InjectDb, type Db, type Tx } from '../db/db.module';
import { brokerProfiles, documents, roles, users } from '../db/schema';
import { AuditService } from '../core/audit.service';
import { MailService } from '../core/mail.service';
import { NotifyService } from '../core/notify.service';
import { SettingsService } from '../core/settings.service';
import { brokerFilter } from '../core/scope';
import type { AuthContext } from '../common/context';
import { AGREEMENT_VERSION, agreementHtml, agreementText, type AgreementLang, type AgreementSnapshot } from './agreement';
import type { SetupBankInput, SetupCompanyInput, SetupDraftInput, SignInput } from './brokers.schemas';
import { FilesService } from '../core/files.service';

export type SetupStatus = 'invited' | 'company' | 'bank' | 'sign' | 'countersign' | 'done';
type Profile = typeof brokerProfiles.$inferSelect;

/** Where a broker is in the set-up: details → sign → countersigned by an Admin. */
export function setupStatus(userStatus: string, p: Pick<Profile, 'companyAt' | 'detailsAt' | 'signedAt' | 'countersignedAt'> | null | undefined): SetupStatus {
  if (userStatus === 'invited') return 'invited';
  if (p?.countersignedAt) return 'done';
  if (p?.signedAt) return 'countersign';
  if (p?.detailsAt) return 'sign';
  if (p?.companyAt) return 'bank';
  return 'company';
}

const maskIban = (iban: string | null) => (iban ? `${iban.slice(0, 4)} •••• ${iban.slice(-4)}` : null);
const lang = (l: string): AgreementLang => (l === 'bg' || l === 'he' ? l : 'en');

/**
 * Broker onboarding (10 Nov feedback): after accepting the invitation the broker fills in company and
 * bank details and signs the broker agreement with an e-signature; an Admin is notified and
 * countersigns in the app. The signed agreement is a documents row (type broker_agreement); the
 * countersigned version supersedes it, so each signed state stays a frozen snapshot.
 */
@Injectable()
export class BrokerSetupService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly notify: NotifyService,
    private readonly mail: MailService,
    private readonly settings: SettingsService,
    private readonly files: FilesService,
  ) {}

  private async broker(id: string, tx: Db | Tx = this.db) {
    const [a] = await tx
      .select({ id: users.id, name: users.name, email: users.email, status: users.status, language: users.language })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(and(eq(users.id, id), eq(roles.baseRole, 'broker')));
    if (!a) throw new NotFoundException({ message: 'Broker not found' });
    return a;
  }

  private async profile(id: string, tx: Db | Tx = this.db, lock = false) {
    const q = tx.select().from(brokerProfiles).where(eq(brokerProfiles.userId, id));
    const [p] = lock ? await q.for('update') : await q;
    return p ?? null;
  }

  /** A broker reaches only their own set-up; Admins and Finance reach any broker's. */
  private assertReach(auth: AuthContext, brokerId: string) {
    const own = brokerFilter(auth);
    if (own && own !== brokerId) throw new NotFoundException({ message: 'Broker not found' });
  }

  async get(auth: AuthContext, brokerId: string) {
    this.assertReach(auth, brokerId);
    const a = await this.broker(brokerId);
    const p = await this.profile(brokerId);
    const [company, rules] = await Promise.all([this.settings.get('company'), this.settings.rules()]);
    const doc = p?.agreementDocumentId ? (await this.db.select({ id: documents.id, data: documents.data, createdAt: documents.createdAt }).from(documents).where(eq(documents.id, p.agreementDocumentId)))[0] : null;
    const snapshot = doc?.data as AgreementSnapshot | undefined;
    // Before signing, the broker reads the current version in their language; afterwards, the signed text.
    const text = snapshot ? { title: snapshot.title, clauses: snapshot.clauses } : agreementText(lang(a.language), company, rules);
    return {
      broker: { id: a.id, name: a.name, email: a.email },
      status: setupStatus(a.status, p),
      details: p
        ? {
            registeredIn: p.registeredIn,
            country: p.country,
            companyName: p.companyName,
            vatNumber: p.vatNumber,
            companyRegNumber: p.companyRegNumber,
            vatRegistered: p.vatRegistered,
            address: p.address,
            city: p.city,
            managerName: p.managerName,
            managerRole: p.managerRole,
            payoutEmail: p.payoutEmail,
            accountHolder: p.accountHolder,
            bankName: p.bankName,
            iban: p.iban,
            bic: p.bic,
            bankAddress: p.bankAddress,
            currency: p.currency,
            companyAt: p.companyAt,
            bankAt: p.detailsAt,
            bankConfirmation: p.bankConfirmationDocumentId,
          }
        : null,
      signMethod: p?.signMethod ?? null,
      signedScan: p?.signedScanDocumentId ?? null,
      agreement: {
        ...text,
        version: snapshot?.version ?? AGREEMENT_VERSION,
        documentId: doc?.id ?? null,
        signedAt: p?.signedAt ?? null,
        signedName: p?.signedName ?? null,
        countersignedAt: p?.countersignedAt ?? null,
        countersignedName: p?.countersignedName ?? null,
      },
      principal: { name: company.legalName || company.name },
      terms: { commissionPerUnitCents: rules.commissionPerUnitCents, ownershipMonths: rules.ownership.months },
    };
  }

  private async ownProfile(auth: AuthContext, tx: Tx) {
    const brokerId = auth.user.id;
    if (brokerFilter(auth) !== brokerId) throw new ForbiddenException({ message: 'Only the broker fills in their own set-up' });
    const a = await this.broker(brokerId, tx);
    const before = await this.profile(brokerId, tx, true);
    if (before?.signedAt) throw new ConflictException({ message: 'The agreement is already signed. Ask an Admin to change your details.' });
    if (!before) await tx.insert(brokerProfiles).values({ userId: brokerId });
    return { a, before };
  }

  private changes(before: Profile | null, after: Record<string, unknown>) {
    if (!before) return undefined;
    const out: Record<string, { from: unknown; to: unknown }> = {};
    for (const [k, v] of Object.entries(after)) {
      const was = (before as Record<string, unknown>)[k];
      if (k.endsWith('At') || was === v || (was == null && v == null)) continue;
      out[k] = k === 'iban' ? { from: maskIban(was as string | null), to: maskIban(v as string | null) } : { from: was ?? null, to: v ?? null };
    }
    return Object.keys(out).length ? out : undefined;
  }

  /** Step 1 · Company. */
  async saveCompany(auth: AuthContext, input: SetupCompanyInput) {
    return this.db.transaction(async (tx) => {
      const { a, before } = await this.ownProfile(auth, tx);
      const vat = input.vatNumber ? input.vatNumber.replace(/\s+/g, '').toUpperCase() : null;
      const values = { ...input, vatNumber: vat, country: input.registeredIn === 'bg' ? 'BG' : input.country, companyAt: new Date(), updatedAt: new Date() };
      await tx.update(brokerProfiles).set(values).where(eq(brokerProfiles.userId, a.id));
      await this.audit.log(auth, { category: 'users_access', action: before?.companyAt ? 'broker_company_changed' : 'broker_company_added', recordType: 'user', recordId: a.id, recordLabel: a.name, changes: before?.companyAt ? this.changes(before, values) : undefined, meta: { companyName: input.companyName, vatNumber: vat } }, tx);
      return { ok: true };
    });
  }

  /** Step 2 · Bank. */
  async saveBank(auth: AuthContext, input: SetupBankInput) {
    return this.db.transaction(async (tx) => {
      const { a, before } = await this.ownProfile(auth, tx);
      if (!before?.companyAt) throw new ConflictException({ message: 'Fill in your company details first' });
      const values = { ...input, bankAddress: input.bankAddress || null, currency: 'EUR', detailsAt: new Date(), updatedAt: new Date() };
      await tx.update(brokerProfiles).set(values).where(eq(brokerProfiles.userId, a.id));
      await this.audit.log(auth, { category: 'users_access', action: before?.detailsAt ? 'broker_bank_changed' : 'broker_bank_added', recordType: 'user', recordId: a.id, recordLabel: a.name, changes: before?.detailsAt ? this.changes(before, values) : undefined, meta: { iban: maskIban(input.iban), bankName: input.bankName } }, tx);
      return { ok: true };
    });
  }

  /** "Save and finish later": keeps what was typed without checking it; the step stays open. */
  async saveDraft(auth: AuthContext, input: SetupDraftInput) {
    return this.db.transaction(async (tx) => {
      const { a } = await this.ownProfile(auth, tx);
      const values = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
      if (typeof values.iban === 'string') values.iban = values.iban.replace(/\s+/g, '').toUpperCase();
      await tx.update(brokerProfiles).set({ ...values, updatedAt: new Date() }).where(eq(brokerProfiles.userId, a.id));
      return { ok: true };
    });
  }

  /** Optional bank letter or statement header (speeds up the first payout). */
  async uploadBankConfirmation(auth: AuthContext, file: { buffer: Buffer; originalname: string; mimetype: string } | undefined) {
    if (!file) throw new BadRequestException({ message: 'Choose a file', fields: { file: 'Choose a file' } });
    if (!this.files.isAllowed(file.mimetype)) throw new BadRequestException({ message: 'Use a PDF, JPG or PNG', fields: { file: 'Use a PDF, JPG or PNG' } });
    const saved = await this.files.save(file);
    return this.db.transaction(async (tx) => {
      const { a } = await this.ownProfile(auth, tx);
      const [doc] = await tx.insert(documents).values({ type: 'upload', label: `Bank confirmation · ${a.name}`, filePath: saved.path, fileName: saved.name, mimeType: saved.mime, createdById: a.id }).returning({ id: documents.id });
      await tx.update(brokerProfiles).set({ bankConfirmationDocumentId: doc.id, updatedAt: new Date() }).where(eq(brokerProfiles.userId, a.id));
      await this.audit.log(auth, { category: 'documents', action: 'broker_bank_confirmation_uploaded', recordType: 'user', recordId: a.id, recordLabel: a.name, meta: { documentId: doc.id, fileName: saved.name } }, tx);
      return { ok: true, documentId: doc.id, fileName: saved.name };
    });
  }

  /** A file from a broker's set-up (bank confirmation or signed scan), for the broker or an Admin. */
  async file(auth: AuthContext, brokerId: string, documentId: string) {
    this.assertReach(auth, brokerId);
    const p = await this.profile(brokerId);
    if (!p || (p.bankConfirmationDocumentId !== documentId && p.signedScanDocumentId !== documentId)) throw new NotFoundException({ message: 'File not found' });
    const [doc] = await this.db.select().from(documents).where(eq(documents.id, documentId));
    if (!doc?.filePath) throw new NotFoundException({ message: 'File not found' });
    return { doc, buffer: await this.files.read(doc.filePath) };
  }

  /**
   * The broker signs, in the app (typed e-signature of the person who signs for the company) or on
   * paper (scan uploaded). The agreement is frozen into a document and the Admins are asked to countersign.
   */
  async sign(auth: AuthContext, input: { method: 'app'; name: string } | { method: 'paper'; file?: { buffer: Buffer; originalname: string; mimetype: string } }, ip: string | null) {
    const brokerId = auth.user.id;
    if (brokerFilter(auth) !== brokerId) throw new ForbiddenException({ message: 'Only the broker signs their own agreement' });
    let scan: { path: string; name: string; mime: string } | null = null;
    if (input.method === 'paper') {
      if (!input.file) throw new BadRequestException({ message: 'Upload a scan or clear photos of all pages', fields: { file: 'Upload a scan or clear photos of all pages' } });
      if (!this.files.isAllowed(input.file.mimetype)) throw new BadRequestException({ message: 'Use a PDF, JPG or PNG', fields: { file: 'Use a PDF, JPG or PNG' } });
    }
    const pre = await this.profile(brokerId);
    if (!pre?.detailsAt) throw new ConflictException({ message: 'Fill in your company and bank details first' });
    if (input.method === 'app') {
      const signer = (pre.managerName ?? auth.user.name).trim();
      if (input.name.trim().toLowerCase() !== signer.toLowerCase()) {
        throw new BadRequestException({ message: 'Check the highlighted fields', fields: { name: `Type the full name of the person who signs: ${signer}` } });
      }
    } else scan = await this.files.save(input.file!);
    const result = await this.db.transaction(async (tx) => {
      const a = await this.broker(brokerId, tx);
      const p = await this.profile(brokerId, tx, true);
      if (!p?.detailsAt) throw new ConflictException({ message: 'Fill in your company and bank details first' });
      if (p.signedAt) throw new ConflictException({ message: 'You have already signed the agreement' });
      const [company, rules] = await Promise.all([this.settings.get('company', tx), this.settings.rules(tx)]);
      const l = lang(a.language);
      const text = agreementText(l, company, rules);
      const now = new Date();
      const signer = p.managerName || a.name;
      let scanId: string | null = null;
      if (scan) {
        const [d] = await tx.insert(documents).values({ type: 'upload', label: `${text.title} · ${p.companyName ?? a.name} · signed scan`, filePath: scan.path, fileName: scan.name, mimeType: scan.mime, createdById: brokerId }).returning({ id: documents.id });
        scanId = d.id;
      }
      const snapshot: AgreementSnapshot = {
        version: AGREEMENT_VERSION,
        language: l,
        ...text,
        principal: { companyName: company.legalName || company.name, vatNumber: company.vatNumber, address: [company.address, company.city].filter(Boolean).join(', '), person: '' },
        broker: { companyName: p.companyName ?? '', vatNumber: p.vatNumber ?? p.companyRegNumber ?? '', address: [p.address, p.city, p.country].filter(Boolean).join(', '), person: [signer, p.managerRole].filter(Boolean).join(', '), email: p.payoutEmail ?? a.email },
        bank: { bankName: p.bankName ?? '', iban: p.iban ?? '', bic: p.bic ?? '', accountHolder: p.accountHolder ?? '' },
        terms: { commissionPerUnitCents: rules.commissionPerUnitCents, ownershipMonths: rules.ownership.months },
        brokerSignature: { name: signer, at: now.toISOString(), ip, method: input.method, scanDocumentId: scanId },
      };
      const [doc] = await tx
        .insert(documents)
        .values({ type: 'broker_agreement', language: l, data: snapshot as unknown as Record<string, unknown>, label: `${text.title} · ${p.companyName ?? a.name}`, createdById: brokerId })
        .returning({ id: documents.id });
      await tx
        .update(brokerProfiles)
        .set({ agreementDocumentId: doc.id, signedAt: now, signedName: snapshot.brokerSignature.name, signedIp: ip, signMethod: input.method, signedScanDocumentId: scanId, updatedAt: now })
        .where(eq(brokerProfiles.userId, brokerId));
      await this.audit.log(
        auth,
        { category: 'documents', action: 'broker_agreement_signed', recordType: 'user', recordId: brokerId, recordLabel: a.name, meta: { documentId: doc.id, version: AGREEMENT_VERSION, method: input.method, signedName: snapshot.brokerSignature.name, scanDocumentId: scanId, ip } },
        tx,
      );
      // Tray kind with icon, EN/BG/HE text and the Countersign link.
      await this.notify.send('broker_signed', { roles: ['system_admin', 'admin'] }, { broker: a.name }, `/brokers?countersign=${brokerId}`, tx);
      return { documentId: doc.id };
    });
    return { ok: true, ...result };
  }

  /** An Admin countersigns with their e-signature; this finishes the broker's set-up. */
  async countersign(auth: AuthContext, brokerId: string, input: SignInput) {
    if (brokerFilter(auth)) throw new NotFoundException({ message: 'Broker not found' });
    if (input.name.trim().toLowerCase() !== auth.user.name.trim().toLowerCase()) {
      throw new BadRequestException({ message: 'Check the highlighted fields', fields: { name: `Type your full name as it is on your account: ${auth.user.name}` } });
    }
    const result = await this.db.transaction(async (tx) => {
      const a = await this.broker(brokerId, tx);
      const p = await this.profile(brokerId, tx, true);
      if (!p?.signedAt || !p.agreementDocumentId) throw new ConflictException({ message: `${a.name} has not signed the agreement yet` });
      if (p.countersignedAt) throw new ConflictException({ message: `${p.countersignedName ?? 'An Admin'} already countersigned this agreement` });
      const [old] = await tx.select().from(documents).where(eq(documents.id, p.agreementDocumentId)).for('update');
      const now = new Date();
      const data: AgreementSnapshot = { ...(old.data as unknown as AgreementSnapshot), adminSignature: { name: auth.user.name, at: now.toISOString(), userId: auth.user.id } };
      data.principal = { ...data.principal, person: auth.user.name };
      const [doc] = await tx
        .insert(documents)
        .values({ type: 'broker_agreement', language: old.language, data: data as unknown as Record<string, unknown>, label: old.label, referencesDocumentId: old.id, createdById: auth.user.id })
        .returning({ id: documents.id });
      await tx.update(documents).set({ supersededById: doc.id }).where(eq(documents.id, old.id));
      await tx
        .update(brokerProfiles)
        .set({ agreementDocumentId: doc.id, countersignedAt: now, countersignedById: auth.user.id, countersignedName: auth.user.name, updatedAt: now })
        .where(eq(brokerProfiles.userId, brokerId));
      await this.audit.log(
        auth,
        { category: 'documents', action: 'broker_agreement_countersigned', recordType: 'user', recordId: brokerId, recordLabel: a.name, changes: { setup: { from: 'countersign', to: 'done' } }, meta: { documentId: doc.id, replaces: old.id } },
        tx,
      );
      await this.notify.send('broker_setup_done', { users: [brokerId] }, { admin: auth.user.name }, '/brokers/setup', tx);
      return { broker: a, data, documentId: doc.id };
    });
    await this.mail.send({
      kind: 'broker_agreement',
      to: [result.broker.email],
      subject: `${result.data.title} · ${result.data.principal.companyName}`,
      body: [
        `${result.data.title}`,
        '',
        ...result.data.clauses,
        '',
        `${result.data.broker.person}: ${result.data.brokerSignature.name}, ${result.data.brokerSignature.at.slice(0, 10)}`,
        `${result.data.principal.companyName}: ${result.data.adminSignature!.name}, ${result.data.adminSignature!.at.slice(0, 10)}`,
      ].join('\n'),
      recordType: 'user',
      recordId: brokerId,
    });
    return { ok: true, documentId: result.documentId };
  }

  /** Printable page of the current agreement (signed, or countersigned), or the unsigned one filled in with the broker's details. */
  async agreementPage(auth: AuthContext, brokerId: string) {
    this.assertReach(auth, brokerId);
    const p = await this.profile(brokerId);
    if (p?.agreementDocumentId) {
      const [doc] = await this.db.select({ data: documents.data }).from(documents).where(eq(documents.id, p.agreementDocumentId));
      return agreementHtml(doc.data as unknown as AgreementSnapshot);
    }
    const a = await this.broker(brokerId);
    const [company, rules] = await Promise.all([this.settings.get('company'), this.settings.rules()]);
    const l = lang(a.language);
    return agreementHtml({
      version: AGREEMENT_VERSION,
      language: l,
      ...agreementText(l, company, rules),
      principal: { companyName: company.legalName || company.name, vatNumber: company.vatNumber, address: [company.address, company.city].filter(Boolean).join(', '), person: '' },
      broker: { companyName: p?.companyName ?? '', vatNumber: p?.vatNumber ?? p?.companyRegNumber ?? '', address: [p?.address, p?.city, p?.country].filter(Boolean).join(', '), person: [p?.managerName ?? a.name, p?.managerRole].filter(Boolean).join(', '), email: p?.payoutEmail ?? a.email },
      bank: { bankName: p?.bankName ?? '', iban: p?.iban ?? '', bic: p?.bic ?? '', accountHolder: p?.accountHolder ?? '' },
      terms: { commissionPerUnitCents: rules.commissionPerUnitCents, ownershipMonths: rules.ownership.months },
      brokerSignature: { name: '', at: '', ip: null },
    });
  }

  /** Set-up status, bank account and countersign state for every broker (Brokers & commissions). */
  async all() {
    return this.db.select().from(brokerProfiles);
  }
}

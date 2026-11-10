import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { canEdit, formatDate, type AuditCategory } from '@ananda/shared';
import { InjectDb, type Db, type Tx } from '../db/db.module';
import { auditLog, roles, sessions, users } from '../db/schema';
import { AuditService, diff } from '../core/audit.service';
import { MailService } from '../core/mail.service';
import { SettingsService } from '../core/settings.service';
import { randomToken, sha256 } from '../core/crypto';
import type { AuthContext } from '../common/context';
import type { InviteMemberInput } from './admin.schemas';
import { webOrigin } from '../core/origin';


const INVITE_COPY = {
  en: { subject: 'You are invited to ANANDA', hello: 'Hello', body: (by: string) => `${by} invited you to ANANDA, the operations and finance app.`, cta: 'Set your password here', valid: (d: string) => `The link works until ${d}.` },
  bg: { subject: 'Покана за ANANDA', hello: 'Здравейте', body: (by: string) => `${by} ви покани в ANANDA, приложението за операции и финанси.`, cta: 'Задайте паролата си тук', valid: (d: string) => `Връзката е валидна до ${d}.` },
  he: { subject: 'הוזמנת ל-ANANDA', hello: 'שלום', body: (by: string) => `${by} הזמין/ה אותך ל-ANANDA, אפליקציית התפעול והכספים.`, cta: 'הגדרת סיסמה', valid: (d: string) => `הקישור בתוקף עד ${d}.` },
} as const;

/** Team, invitations and member changes (FR-ADM-1, FR-AUTH-5). */
@Injectable()
export class UsersService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly settings: SettingsService,
  ) {}

  async team() {
    const rows = await this.db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        phone: users.phone,
        language: users.language,
        status: users.status,
        twoStepEnabled: users.totpEnabled,
        lastSignInAt: users.lastSignInAt,
        inviteExpiresAt: users.inviteExpiresAt,
        createdAt: users.createdAt,
        hasPassword: sql<boolean>`${users.passwordHash} is not null`,
        role: { id: roles.id, key: roles.key, name: roles.name, baseRole: roles.baseRole, isSystem: roles.isSystem, twoStepRequired: roles.twoStepRequired, areas: roles.areas },
      })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .orderBy(asc(users.status), asc(users.name));
    return rows.map((r) => ({ ...r, hasPassword: !!r.hasPassword }));
  }

  async invitations() {
    const inviter = alias(users, 'inviter');
    const rows = await this.db
      .select({ id: users.id, name: users.name, email: users.email, language: users.language, inviteExpiresAt: users.inviteExpiresAt, createdAt: users.createdAt, roleName: roles.name, invitedBy: inviter.name })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .leftJoin(inviter, eq(inviter.id, users.invitedById))
      .where(eq(users.status, 'invited'))
      .orderBy(desc(users.createdAt));
    const now = Date.now();
    const security = await this.settings.get('security');
    return { items: rows.map((r) => ({ ...r, expired: !r.inviteExpiresAt || r.inviteExpiresAt.getTime() < now })), inviteValidityDays: security.inviteValidityDays };
  }

  async history(limit = 200) {
    return this.db.select().from(auditLog).where(eq(auditLog.category, 'users_access' satisfies AuditCategory)).orderBy(desc(auditLog.at)).limit(limit);
  }

  private async issueToken(tx: Tx) {
    const security = await this.settings.get('security', tx);
    const token = randomToken();
    return { token, hash: sha256(token), expiresAt: new Date(Date.now() + security.inviteValidityDays * 86_400_000) };
  }

  /**
   * POST /users/invite. Also used by the "Invite new agent" panel: a user without Users & roles
   * edit may only invite the base role 'agent'.
   */
  async invite(auth: AuthContext, input: InviteMemberInput) {
    const [role] = await this.db
      .select()
      .from(roles)
      .where(input.roleId ? eq(roles.id, input.roleId) : eq(roles.key, input.roleKey!));
    if (!role) throw new BadRequestException({ message: 'Check the highlighted fields', fields: { roleId: 'Pick a role' } });
    if (!canEdit(auth.perms.areas, 'users') && role.key !== 'agent') {
      throw new ForbiddenException({ code: 'no_access', message: 'You can only invite sales agents' });
    }
    const result = await this.db.transaction(async (tx) => {
      const [existing] = await tx.select().from(users).where(eq(users.email, input.email)).for('update');
      const reusable = existing && existing.status === 'deactivated' && !existing.passwordHash;
      if (existing && !reusable) {
        throw new ConflictException({ message: 'Check the highlighted fields', fields: { email: existing.status === 'invited' ? 'This person is already invited. Resend the invitation instead.' : 'This e-mail already has an account' } });
      }
      const { token, hash, expiresAt } = await this.issueToken(tx);
      const values = { name: input.name, email: input.email, roleId: role.id, language: input.language, status: 'invited' as const, inviteTokenHash: hash, inviteExpiresAt: expiresAt, invitedById: auth.user.id };
      const [user] = existing ? await tx.update(users).set(values).where(eq(users.id, existing.id)).returning() : await tx.insert(users).values(values).returning();
      await this.audit.log(
        auth,
        { category: 'users_access', action: 'member_invited', recordType: 'user', recordId: user.id, recordLabel: `${user.name} · ${user.email}`, changes: { role: { from: null, to: role.name }, status: { from: existing?.status ?? null, to: 'invited' } }, meta: { expiresAt: expiresAt.toISOString() } },
        tx,
      );
      return { user, token, expiresAt };
    });
    await this.sendInvite(auth, result.user, result.token, result.expiresAt, input.message);
    return { id: result.user.id };
  }

  async resend(auth: AuthContext, id: string) {
    const result = await this.db.transaction(async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.id, id)).for('update');
      if (!user) throw new NotFoundException({ message: 'Member not found' });
      if (user.passwordHash || (user.status !== 'invited' && user.status !== 'deactivated')) throw new ConflictException({ message: 'This person has already set a password' });
      const { token, hash, expiresAt } = await this.issueToken(tx);
      await tx.update(users).set({ status: 'invited', inviteTokenHash: hash, inviteExpiresAt: expiresAt, invitedById: auth.user.id }).where(eq(users.id, id));
      await this.audit.log(auth, { category: 'users_access', action: 'invitation_resent', recordType: 'user', recordId: id, recordLabel: `${user.name} · ${user.email}`, changes: user.status !== 'invited' ? { status: { from: user.status, to: 'invited' } } : undefined, meta: { expiresAt: expiresAt.toISOString() } }, tx);
      return { user, token, expiresAt };
    });
    await this.sendInvite(auth, result.user, result.token, result.expiresAt);
    return { ok: true };
  }

  async cancelInvite(auth: AuthContext, id: string) {
    return this.db.transaction(async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.id, id)).for('update');
      if (!user) throw new NotFoundException({ message: 'Member not found' });
      if (user.status !== 'invited') throw new ConflictException({ message: 'This invitation is no longer open' });
      await tx.update(users).set({ status: 'deactivated', inviteTokenHash: null, inviteExpiresAt: null }).where(eq(users.id, id));
      await this.audit.log(auth, { category: 'users_access', action: 'invitation_cancelled', recordType: 'user', recordId: id, recordLabel: `${user.name} · ${user.email}`, changes: { status: { from: 'invited', to: 'deactivated' } } }, tx);
      return { ok: true };
    });
  }

  /** Change role, deactivate or reactivate. Deactivating keeps history and signs the person out everywhere. */
  async update(auth: AuthContext, id: string, patch: { roleId?: string; status?: 'active' | 'deactivated' }) {
    if (id === auth.user.id) throw new ForbiddenException({ message: 'You cannot change your own role or status. Ask another System admin.' });
    return this.db.transaction(async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.id, id)).for('update');
      if (!user) throw new NotFoundException({ message: 'Member not found' });
      const [oldRole] = await tx.select().from(roles).where(eq(roles.id, user.roleId));
      const next: { roleId?: string; status?: 'active' | 'deactivated' } = {};
      let newRole = oldRole;
      if (patch.roleId && patch.roleId !== user.roleId) {
        const [r] = await tx.select().from(roles).where(eq(roles.id, patch.roleId));
        if (!r) throw new BadRequestException({ message: 'Check the highlighted fields', fields: { roleId: 'Pick a role' } });
        newRole = r;
        next.roleId = r.id;
      }
      if (patch.status && patch.status !== user.status) {
        if (user.status === 'invited') throw new ConflictException({ message: 'Cancel the invitation instead' });
        if (patch.status === 'active' && !user.passwordHash) throw new ConflictException({ message: 'This person never set a password. Resend the invitation instead.' });
        next.status = patch.status;
      }
      if (!Object.keys(next).length) return { ok: true };

      // Never leave the team without an active System admin.
      const losesAdmin = oldRole.baseRole === 'system_admin' && user.status === 'active' && (next.status === 'deactivated' || newRole.baseRole !== 'system_admin');
      if (losesAdmin) {
        const [{ n }] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(users)
          .innerJoin(roles, eq(roles.id, users.roleId))
          .where(and(eq(roles.baseRole, 'system_admin'), eq(users.status, 'active'), ne(users.id, id)));
        if (Number(n) === 0) throw new ConflictException({ message: 'Keep at least one active System admin' });
      }

      await tx.update(users).set(next).where(eq(users.id, id));
      if (next.status === 'deactivated') await tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, id), isNull(sessions.revokedAt)));
      const changes = diff({ role: oldRole.name, status: user.status }, { role: newRole.name, status: next.status ?? user.status }, ['role', 'status']);
      const action = next.status === 'deactivated' ? 'member_deactivated' : next.status === 'active' ? 'member_reactivated' : 'role_changed';
      await this.audit.log(auth, { category: 'users_access', action, recordType: 'user', recordId: id, recordLabel: `${user.name} · ${user.email}`, changes }, tx);
      return { ok: true };
    });
  }

  private async sendInvite(auth: AuthContext, user: typeof users.$inferSelect, token: string, expiresAt: Date, message?: string) {
    const lang = (user.language in INVITE_COPY ? user.language : 'en') as keyof typeof INVITE_COPY;
    const c = INVITE_COPY[lang];
    const link = `${webOrigin()}/invite/${token}`;
    await this.mail.send({
      to: [user.email],
      subject: c.subject,
      body: [`${c.hello} ${user.name},`, '', c.body(auth.user.name), ...(message?.trim() ? ['', message.trim()] : []), '', `${c.cta}: ${link}`, c.valid(formatDate(expiresAt, lang)), '', 'ANANDA'].join('\n'),
      kind: 'invitation',
      recordType: 'user',
      recordId: user.id,
    });
  }

  /** Members of the given roles, for the role detail page. */
  async membersOf(roleIds: string[]) {
    if (!roleIds.length) return [];
    return this.db.select({ id: users.id, name: users.name, email: users.email, status: users.status, roleId: users.roleId }).from(users).where(inArray(users.roleId, roleIds)).orderBy(asc(users.name));
  }
}

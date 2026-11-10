import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import QRCode from 'qrcode';
import { and, desc, eq, gt, isNull, ne } from 'drizzle-orm';
import type { LoginInput } from '@ananda/shared';
import { InjectDb, type Db } from '../db/db.module';
import { roles, sessions, users } from '../db/schema';
import { AuditService } from '../core/audit.service';
import { SettingsService } from '../core/settings.service';
import { newTotpSecret, randomToken, sha256, totpUri, verifyTotp } from '../core/crypto';
import type { AuthContext } from '../common/context';

export interface SessionMeta {
  userAgent?: string;
  ip?: string;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  async login(input: LoginInput, meta: SessionMeta) {
    const [row] = await this.db
      .select({ user: users, role: roles })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(eq(users.email, input.email));
    const ok = row?.user.passwordHash ? await bcrypt.compare(input.password, row.user.passwordHash) : false;
    if (!row || !ok || row.user.status !== 'active') {
      if (row) await this.audit.log({ id: row.user.id, name: row.user.name }, { category: 'security', action: 'sign_in_failed', recordType: 'user', recordId: row.user.id, recordLabel: row.user.email });
      throw new UnauthorizedException({ message: 'The e-mail or password is not right' });
    }
    const security = await this.settings.get('security');
    const ttl = input.device === 'phone' ? security.phoneSessionDays * 86_400_000 : security.desktopSessionHours * 3_600_000;
    const needsTwoStep = row.role.twoStepRequired || row.user.totpEnabled;
    const token = randomToken();
    await this.db.insert(sessions).values({
      userId: row.user.id,
      tokenHash: sha256(token),
      device: input.device,
      userAgent: meta.userAgent?.slice(0, 300),
      ip: meta.ip,
      twoStepPassed: !needsTwoStep,
      expiresAt: new Date(Date.now() + ttl),
    });
    await this.db.update(users).set({ lastSignInAt: new Date() }).where(eq(users.id, row.user.id));
    await this.audit.log({ id: row.user.id, name: row.user.name }, { category: 'security', action: 'signed_in', recordType: 'user', recordId: row.user.id, recordLabel: row.user.email, meta: { device: input.device } });
    return {
      token,
      maxAgeMs: ttl,
      twoStep: needsTwoStep ? (row.user.totpEnabled ? 'verify' : 'setup') : 'none',
    } as const;
  }

  async twoStepSetup(auth: AuthContext) {
    const [user] = await this.db.select().from(users).where(eq(users.id, auth.user.id));
    if (user.totpEnabled) throw new BadRequestException({ message: 'Two-step sign-in is already set up' });
    const secret = user.totpSecret ?? newTotpSecret();
    if (!user.totpSecret) await this.db.update(users).set({ totpSecret: secret }).where(eq(users.id, user.id));
    const uri = totpUri(user.email, secret);
    return { secret, uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) };
  }

  async twoStepVerify(auth: AuthContext, code: string) {
    const [user] = await this.db.select().from(users).where(eq(users.id, auth.user.id));
    if (!verifyTotp(user.totpSecret, code)) throw new BadRequestException({ message: 'That code did not work. Enter the current code from your app.', fields: { code: 'That code did not work' } });
    if (!user.totpEnabled) {
      await this.db.update(users).set({ totpEnabled: true }).where(eq(users.id, user.id));
      await this.audit.log(auth, { category: 'security', action: 'two_step_enabled', recordType: 'user', recordId: user.id, recordLabel: user.email });
    }
    await this.db.update(sessions).set({ twoStepPassed: true }).where(eq(sessions.id, auth.sessionId));
    return { ok: true };
  }

  async logout(auth: AuthContext) {
    await this.db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, auth.sessionId));
  }

  async me(auth: AuthContext) {
    const [user] = await this.db.select().from(users).where(eq(users.id, auth.user.id));
    const [realRole] = await this.db.select().from(roles).where(eq(roles.id, user.roleId));
    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        language: user.language,
        theme: user.theme,
        twoStepEnabled: user.totpEnabled,
        roleName: realRole.name,
        baseRole: realRole.baseRole,
      },
      perms: auth.perms,
      device: auth.device,
      twoStepPassed: auth.twoStepPassed,
      twoStepState: auth.perms.twoStepRequired && !auth.twoStepPassed ? (user.totpEnabled ? 'verify' : 'setup') : 'done',
    };
  }

  async listSessions(auth: AuthContext) {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, auth.user.id), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
      .orderBy(desc(sessions.lastSeenAt));
    return rows.map((s) => ({ id: s.id, device: s.device, userAgent: s.userAgent, ip: s.ip, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, current: s.id === auth.sessionId }));
  }

  async revokeSession(auth: AuthContext, id: string | 'others') {
    const cond = id === 'others' ? ne(sessions.id, auth.sessionId) : eq(sessions.id, id);
    await this.db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, auth.user.id), isNull(sessions.revokedAt), cond));
    await this.audit.log(auth, { category: 'security', action: id === 'others' ? 'signed_out_other_devices' : 'signed_out_device', recordType: 'user', recordId: auth.user.id, recordLabel: auth.user.email });
  }

  async inviteInfo(token: string) {
    const [user] = await this.db.select().from(users).where(and(eq(users.inviteTokenHash, sha256(token)), gt(users.inviteExpiresAt, new Date())));
    if (!user || user.status !== 'invited') throw new BadRequestException({ message: 'This invitation link has expired. Ask an admin to send a new one.' });
    return { name: user.name, email: user.email, language: user.language };
  }

  async acceptInvite(token: string, password: string) {
    const [user] = await this.db.select().from(users).where(and(eq(users.inviteTokenHash, sha256(token)), gt(users.inviteExpiresAt, new Date())));
    if (!user || user.status !== 'invited') throw new BadRequestException({ message: 'This invitation link has expired. Ask an admin to send a new one.' });
    const security = await this.settings.get('security');
    if (password.length < security.passwordMinLength || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      throw new BadRequestException({ message: 'Check the highlighted fields', fields: { password: `Use at least ${security.passwordMinLength} characters with letters and numbers` } });
    }
    await this.db
      .update(users)
      .set({ passwordHash: await bcrypt.hash(password, 11), status: 'active', inviteTokenHash: null, inviteExpiresAt: null })
      .where(eq(users.id, user.id));
    await this.audit.log({ id: user.id, name: user.name }, { category: 'users_access', action: 'invitation_accepted', recordType: 'user', recordId: user.id, recordLabel: user.email });
    return { email: user.email };
  }

  async changePassword(auth: AuthContext, current: string, next: string, code: string | undefined, signOutOthers: boolean) {
    const [user] = await this.db.select().from(users).where(eq(users.id, auth.user.id));
    if (!user.passwordHash || !(await bcrypt.compare(current, user.passwordHash))) {
      throw new BadRequestException({ message: 'Check the highlighted fields', fields: { current: 'Your current password is not right' } });
    }
    if (user.totpEnabled && !verifyTotp(user.totpSecret, code)) {
      throw new ForbiddenException({ code: 'step_up_invalid', message: 'That code did not work. Enter the current code from your app.' });
    }
    const security = await this.settings.get('security');
    if (next.length < security.passwordMinLength || !/[A-Za-z]/.test(next) || !/\d/.test(next)) {
      throw new BadRequestException({ message: 'Check the highlighted fields', fields: { next: `Use at least ${security.passwordMinLength} characters with letters and numbers` } });
    }
    await this.db.update(users).set({ passwordHash: await bcrypt.hash(next, 11) }).where(eq(users.id, user.id));
    if (signOutOthers) await this.db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, user.id), ne(sessions.id, auth.sessionId), isNull(sessions.revokedAt)));
    await this.audit.log(auth, { category: 'security', action: 'password_changed', recordType: 'user', recordId: user.id, recordLabel: user.email, meta: { signOutOthers } });
  }

  async updateProfile(auth: AuthContext, patch: { language?: string; theme?: string; name?: string }) {
    if (Object.keys(patch).length) await this.db.update(users).set(patch).where(eq(users.id, auth.user.id));
  }

  /** FR-AUTH-4: a System admin sees the app exactly as another role. Writes are switched off meanwhile. */
  async preview(auth: AuthContext, roleId: string | null) {
    const [user] = await this.db.select({ role: roles }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(eq(users.id, auth.user.id));
    if (user.role.baseRole !== 'system_admin') throw new ForbiddenException({ message: 'Only a System admin can preview roles' });
    if (roleId) {
      const [role] = await this.db.select().from(roles).where(eq(roles.id, roleId));
      if (!role) throw new BadRequestException({ message: 'Role not found' });
    }
    await this.db.update(sessions).set({ previewRoleId: roleId }).where(eq(sessions.id, auth.sessionId));
  }
}

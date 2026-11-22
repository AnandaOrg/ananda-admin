import { BadRequestException, ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import QRCode from 'qrcode';
import { and, count, desc, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module';
import { roles, sessions, signInLinks, users } from '../db/schema';
import { AuditService } from '../core/audit.service';
import { MailService } from '../core/mail.service';
import { SettingsService } from '../core/settings.service';
import { webOrigin } from '../core/origin';
import { devShortcutsAllowed, isDevTwoStepCode, newTotpSecret, randomToken, sha256, totpUri, verifyTotp } from '../core/crypto';
import type { AuthContext } from '../common/context';

export interface SessionMeta {
  userAgent?: string;
  ip?: string;
}

export type Device = 'desktop' | 'phone';
export type SignInMethod = 'link' | 'google' | 'invite';

/** A sign-in link works once, for 15 minutes; at most 5 are sent per person in 15 minutes. */
const LINK_TTL_MS = 15 * 60_000;
const LINKS_PER_WINDOW = 5;

const LINK_COPY = {
  en: {
    subject: 'Your ANANDA sign-in link',
    hello: (n: string) => `Hello ${n},`,
    open: 'Open this link to sign in to ANANDA:',
    once: 'It works once, for the next 15 minutes.',
    code: 'After it, enter the code from your authenticator app.',
    ignore: "If you didn't ask to sign in, you can ignore this e-mail.",
  },
  bg: {
    subject: 'Вашата връзка за вход в ANANDA',
    hello: (n: string) => `Здравейте, ${n},`,
    open: 'Отворете тази връзка, за да влезете в ANANDA:',
    once: 'Работи веднъж, през следващите 15 минути.',
    code: 'След това въведете кода от приложението за удостоверяване.',
    ignore: 'Ако не сте поискали вход, не обръщайте внимание на този имейл.',
  },
  he: {
    subject: 'קישור הכניסה שלך ל-ANANDA',
    hello: (n: string) => `שלום ${n},`,
    open: 'יש לפתוח את הקישור הזה כדי להיכנס ל-ANANDA:',
    once: 'הקישור עובד פעם אחת, ב-15 הדקות הקרובות.',
    code: 'אחרי זה יש להזין את הקוד מאפליקציית האימות.',
    ignore: 'אם לא ביקשת להיכנס, אפשר להתעלם מהמייל הזה.',
  },
} as const;

/** Only paths inside the app (no other sites, no sign-in pages) are kept as "where to go next". */
export function safeNext(next: string | undefined | null): string | undefined {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') && !/^\/(login|two-step|invite)/.test(next) ? next : undefined;
}

@Injectable()
export class AuthService {
  private readonly log = new Logger(AuthService.name);

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly mail: MailService,
  ) {}

  /**
   * Starts a session for someone whose e-mail was just proven (link, Google or invitation).
   * The two-step code follows when their role asks for it, or when they turned it on themselves.
   */
  async startSession(userId: string, device: Device, method: SignInMethod, meta: SessionMeta) {
    const [row] = await this.db.select({ user: users, role: roles }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(eq(users.id, userId));
    if (!row || row.user.status !== 'active') throw new UnauthorizedException({ code: 'no_account', message: 'This account is not active. Ask an admin.' });
    const security = await this.settings.get('security');
    const ttl = device === 'phone' ? security.phoneSessionDays * 86_400_000 : security.desktopSessionHours * 3_600_000;
    const needsTwoStep = row.role.twoStepRequired || row.user.totpEnabled;
    const token = randomToken();
    await this.db.insert(sessions).values({
      userId: row.user.id,
      tokenHash: sha256(token),
      device,
      userAgent: meta.userAgent?.slice(0, 300),
      ip: meta.ip,
      twoStepPassed: !needsTwoStep,
      expiresAt: new Date(Date.now() + ttl),
    });
    await this.db.update(users).set({ lastSignInAt: new Date() }).where(eq(users.id, row.user.id));
    await this.audit.log({ id: row.user.id, name: row.user.name }, { category: 'security', action: 'signed_in', recordType: 'user', recordId: row.user.id, recordLabel: row.user.email, meta: { device, method } });
    return {
      token,
      maxAgeMs: ttl,
      twoStep: needsTwoStep ? (row.user.totpEnabled ? 'verify' : 'setup') : 'none',
    } as const;
  }

  /**
   * E-mails a sign-in link. The answer is the same whether or not the address has an account, so the
   * form can't be used to find out who works at ANANDA. Locally the token also comes back in the response.
   */
  async requestLink(email: string, next: string | undefined, meta: SessionMeta): Promise<{ ok: true; devToken?: string }> {
    const [user] = await this.db.select().from(users).where(eq(sql`lower(${users.email})`, email.toLowerCase()));
    if (!user || user.status !== 'active') {
      if (user) await this.audit.log({ id: user.id, name: user.name }, { category: 'security', action: 'sign_in_failed', recordType: 'user', recordId: user.id, recordLabel: user.email, meta: { method: 'link', reason: user.status } });
      return { ok: true };
    }
    const [{ n }] = await this.db
      .select({ n: count() })
      .from(signInLinks)
      .where(and(eq(signInLinks.userId, user.id), gt(signInLinks.createdAt, new Date(Date.now() - LINK_TTL_MS))));
    // Locally (tests sign the same demo people in many times) there is no limit.
    if (n >= LINKS_PER_WINDOW && !devShortcutsAllowed()) {
      this.log.warn(`Sign-in links: limit reached for ${user.email}`);
      return { ok: true };
    }
    const token = randomToken();
    // A new link replaces the ones sent before it.
    await this.db.update(signInLinks).set({ usedAt: new Date() }).where(and(eq(signInLinks.userId, user.id), isNull(signInLinks.usedAt)));
    await this.db.insert(signInLinks).values({ userId: user.id, tokenHash: sha256(token), ip: meta.ip, expiresAt: new Date(Date.now() + LINK_TTL_MS) });

    const lang = (user.language in LINK_COPY ? user.language : 'en') as keyof typeof LINK_COPY;
    const c = LINK_COPY[lang];
    const after = safeNext(next);
    const link = `${webOrigin()}/login/link?t=${token}${after ? `&next=${encodeURIComponent(after)}` : ''}`;
    const [role] = await this.db.select({ required: roles.twoStepRequired }).from(roles).where(eq(roles.id, user.roleId));
    const lines = (l: string) => [c.hello(user.name), '', c.open, l, '', c.once, ...(role?.required || user.totpEnabled ? [c.code] : []), '', c.ignore, '', 'ANANDA'].join('\n');
    await this.mail.send({ to: [user.email], subject: c.subject, body: lines(link), logBody: lines('[sign-in link]'), kind: 'sign_in_link', recordType: 'user', recordId: user.id });
    await this.audit.log({ id: user.id, name: user.name }, { category: 'security', action: 'sign_in_link_sent', recordType: 'user', recordId: user.id, recordLabel: user.email });
    return devShortcutsAllowed() ? { ok: true, devToken: token } : { ok: true };
  }

  /** Opens a sign-in link: single use, and only before it expires. */
  async verifyLink(token: string, device: Device, meta: SessionMeta) {
    const now = new Date();
    const [link] = await this.db
      .update(signInLinks)
      .set({ usedAt: now })
      .where(and(eq(signInLinks.tokenHash, sha256(token)), isNull(signInLinks.usedAt), gt(signInLinks.expiresAt, now)))
      .returning();
    if (!link) throw new BadRequestException({ code: 'link_expired', message: 'This sign-in link has expired or was already used. Ask for a new one.' });
    return this.startSession(link.userId, device, 'link', meta);
  }

  /**
   * Google sign-in: the Google account's e-mail must belong to an active ANANDA account (or an open
   * invitation, which it then accepts). After the first time, the Google account itself must match.
   */
  async googleUser(profile: { sub: string; email: string; name?: string }, meta: SessionMeta) {
    const [user] = await this.db.select().from(users).where(eq(sql`lower(${users.email})`, profile.email.toLowerCase()));
    const fail = async (reason: string) => {
      if (user) await this.audit.log({ id: user.id, name: user.name }, { category: 'security', action: 'sign_in_failed', recordType: 'user', recordId: user.id, recordLabel: user.email, meta: { method: 'google', reason } });
      return null;
    };
    if (!user) return fail('no_account');
    if (user.googleSub && user.googleSub !== profile.sub) return fail('other_google_account');
    if (user.status === 'invited') {
      if (!user.inviteExpiresAt || user.inviteExpiresAt < new Date()) return fail('invite_expired');
      await this.db.update(users).set({ status: 'active', inviteTokenHash: null, inviteExpiresAt: null, googleSub: profile.sub }).where(eq(users.id, user.id));
      await this.audit.log({ id: user.id, name: user.name }, { category: 'users_access', action: 'invitation_accepted', recordType: 'user', recordId: user.id, recordLabel: user.email, meta: { method: 'google' } });
    } else if (user.status !== 'active') {
      return fail(user.status);
    } else if (!user.googleSub) {
      await this.db.update(users).set({ googleSub: profile.sub }).where(eq(users.id, user.id));
    }
    void meta;
    return { id: user.id, invited: user.status === 'invited' };
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
    // First sign-in: the key must have been shown (QR) before a code can confirm it.
    // Locally the demo code works straight away, without scanning the QR first.
    if (!user.totpSecret && isDevTwoStepCode(code)) {
      user.totpSecret = newTotpSecret();
      await this.db.update(users).set({ totpSecret: user.totpSecret }).where(eq(users.id, user.id));
    }
    if (!user.totpEnabled && !user.totpSecret) throw new BadRequestException({ message: 'Scan the QR code first, then enter the code from your app.' });
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

  /** Accepting the invitation proves the e-mail address, so it signs the person straight in. */
  async acceptInvite(token: string, device: Device, meta: SessionMeta) {
    const [user] = await this.db.select().from(users).where(and(eq(users.inviteTokenHash, sha256(token)), gt(users.inviteExpiresAt, new Date())));
    if (!user || user.status !== 'invited') throw new BadRequestException({ message: 'This invitation link has expired. Ask an admin to send a new one.' });
    await this.db.update(users).set({ status: 'active', inviteTokenHash: null, inviteExpiresAt: null }).where(eq(users.id, user.id));
    await this.audit.log({ id: user.id, name: user.name }, { category: 'users_access', action: 'invitation_accepted', recordType: 'user', recordId: user.id, recordLabel: user.email });
    return this.startSession(user.id, device, 'invite', meta);
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

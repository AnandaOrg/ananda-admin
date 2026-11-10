import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Request } from 'express';
import { STEP_UP_ACTIONS, canEdit, canView, type Area, type SensitiveAction } from '@ananda/shared';
import { InjectDb, type Db } from '../db/db.module';
import { roles, sessions, users } from '../db/schema';
import { sha256, verifyTotp } from '../core/crypto';
import {
  ACCESS_KEY,
  ALLOW_BEFORE_TWO_STEP,
  ALLOW_IN_PREVIEW,
  PUBLIC_KEY,
  SENSITIVE_KEY,
  type AuthContext,
} from './context';

export const SESSION_COOKIE = 'ananda_session';

/**
 * One guard for every route: session, two-step sign-in, area access, sensitive actions and
 * step-up codes. Permission and scope checks always run on the server (FR-AUTH-1, FR-AUTH-2).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectDb() private readonly db: Db,
  ) {}

  private meta<T>(key: string, ctx: ExecutionContext): T | undefined {
    return this.reflector.getAllAndOverride<T>(key, [ctx.getHandler(), ctx.getClass()]);
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const isPublic = this.meta<boolean>(PUBLIC_KEY, ctx);
    const auth = await this.resolve(req);
    if (auth) req.auth = auth;
    if (isPublic) return true;
    if (!auth) throw new UnauthorizedException({ code: 'signed_out', message: 'Sign in to continue' });

    if (auth.perms.twoStepRequired && !auth.twoStepPassed && !this.meta<boolean>(ALLOW_BEFORE_TWO_STEP, ctx)) {
      throw new UnauthorizedException({ code: 'two_step_required', message: 'Enter your two-step code' });
    }

    if (auth.perms.previewing && req.method !== 'GET' && !this.meta<boolean>(ALLOW_IN_PREVIEW, ctx)) {
      throw new ForbiddenException({ code: 'preview', message: 'You are previewing a role. Changes are switched off.' });
    }

    const access = this.meta<{ level: 'view' | 'edit'; areas: Area[] }>(ACCESS_KEY, ctx);
    if (access) {
      const ok = access.areas.some((a) => (access.level === 'edit' ? canEdit(auth.perms.areas, a) : canView(auth.perms.areas, a)));
      if (!ok) throw new ForbiddenException({ code: 'no_access', message: 'You do not have access to this' });
    }

    const action = this.meta<SensitiveAction>(SENSITIVE_KEY, ctx);
    if (action) {
      if (!auth.perms.sensitive.includes(action)) throw new ForbiddenException({ code: 'no_access', message: 'You do not have access to this' });
      if (STEP_UP_ACTIONS.includes(action)) await this.checkStepUp(req, auth);
    }
    return true;
  }

  private async checkStepUp(req: Request, auth: AuthContext) {
    const code = req.header('x-two-step-code');
    if (!code) throw new ForbiddenException({ code: 'step_up_required', message: 'Enter your two-step code' });
    const [row] = await this.db.select({ secret: users.totpSecret }).from(users).where(eq(users.id, auth.user.id));
    if (!verifyTotp(row?.secret ?? null, code)) {
      throw new ForbiddenException({ code: 'step_up_invalid', message: 'That code did not work. Enter the current code from your app.' });
    }
  }

  private async resolve(req: Request): Promise<AuthContext | null> {
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) return null;
    const now = new Date();
    const [row] = await this.db
      .select({ session: sessions, user: users, role: roles })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(and(eq(sessions.tokenHash, sha256(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)));
    if (!row || row.user.status !== 'active') return null;

    if (now.getTime() - row.session.lastSeenAt.getTime() > 60_000) {
      await this.db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.session.id));
    }

    let role = row.role;
    let previewing = false;
    if (row.session.previewRoleId && row.role.baseRole === 'system_admin') {
      const [preview] = await this.db.select().from(roles).where(eq(roles.id, row.session.previewRoleId));
      if (preview) {
        role = preview;
        previewing = true;
      }
    }

    return {
      user: {
        id: row.user.id,
        name: row.user.name,
        email: row.user.email,
        language: row.user.language,
        roleId: row.user.roleId,
        totpEnabled: row.user.totpEnabled,
      },
      sessionId: row.session.id,
      device: row.session.device,
      twoStepPassed: row.session.twoStepPassed,
      perms: {
        roleId: role.id,
        roleKey: role.key,
        roleName: role.name,
        baseRole: role.baseRole,
        scope: role.scope,
        areas: role.areas,
        sensitive: role.sensitive,
        previewing,
        // Two-step sign-in follows the real role, not the previewed one.
        twoStepRequired: row.role.twoStepRequired || row.user.totpEnabled,
      },
    };
  }
}

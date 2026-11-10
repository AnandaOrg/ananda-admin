import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Area, AccessLevel, Permissions, SensitiveAction } from '@ananda/shared';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  language: string;
  roleId: string;
  totpEnabled: boolean;
}

export interface AuthContext {
  user: AuthUser;
  sessionId: string;
  device: 'desktop' | 'phone';
  twoStepPassed: boolean;
  perms: Permissions & { roleId: string; twoStepRequired: boolean };
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export const PUBLIC_KEY = 'ananda:public';
export const ACCESS_KEY = 'ananda:access';
export const SENSITIVE_KEY = 'ananda:sensitive';
export const ALLOW_BEFORE_TWO_STEP = 'ananda:pre2fa';
export const ALLOW_IN_PREVIEW = 'ananda:preview-ok';

/** Route needs no session. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);
/** Route is reachable before the two-step code is entered (set-up and verify). */
export const BeforeTwoStep = () => SetMetadata(ALLOW_BEFORE_TWO_STEP, true);
/** Write route allowed while a System admin previews another role (e.g. stop preview). */
export const AllowInPreview = () => SetMetadata(ALLOW_IN_PREVIEW, true);

/** Requires at least `level` on one of the areas. */
export const Access = (level: Exclude<AccessLevel, 'hidden'>, ...areas: Area[]) => SetMetadata(ACCESS_KEY, { level, areas });

/** Requires a sensitive action; actions in STEP_UP_ACTIONS also need a fresh code in `x-two-step-code`. */
export const Sensitive = (action: SensitiveAction) => SetMetadata(SENSITIVE_KEY, action);

export const Auth = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext => {
  const req = ctx.switchToHttp().getRequest();
  return req.auth;
});

export function can(auth: AuthContext, action: SensitiveAction): boolean {
  return auth.perms.sensitive.includes(action);
}

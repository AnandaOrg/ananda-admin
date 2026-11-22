import { createHash, randomBytes } from 'node:crypto';
import { authenticator } from 'otplib';

authenticator.options = { window: 1 };

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function newTotpSecret(): string {
  return authenticator.generateSecret();
}

export function totpUri(email: string, secret: string): string {
  return authenticator.keyuri(email, 'ANANDA', secret);
}

/**
 * Local shortcuts (the demo two-step code, the sign-in link returned in the API response): in development,
 * or in a production build only when ALLOW_DEV_TWO_STEP_CODE=true (local demo containers; never on a real server).
 */
export function devShortcutsAllowed(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.ALLOW_DEV_TWO_STEP_CODE === 'true';
}

/** True when the local demo code is allowed and matches (never on a real server). */
export function isDevTwoStepCode(code: string | undefined): boolean {
  const dev = process.env.DEV_TWO_STEP_CODE;
  return !!code && !!dev && devShortcutsAllowed() && code === dev;
}

/** Checks an authenticator code. DEV_TWO_STEP_CODE is also accepted where local shortcuts are allowed. */
export function verifyTotp(secret: string | null, code: string | undefined): boolean {
  if (!code) return false;
  if (isDevTwoStepCode(code)) return true;
  if (!secret) return false;
  try {
    return authenticator.check(code, secret);
  } catch {
    return false;
  }
}

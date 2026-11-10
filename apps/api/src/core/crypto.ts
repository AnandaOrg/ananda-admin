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
 * Checks an authenticator code. DEV_TWO_STEP_CODE is also accepted in development, or in a
 * production build only when ALLOW_DEV_TWO_STEP_CODE=true (local demo containers; never on a real server).
 */
export function verifyTotp(secret: string | null, code: string | undefined): boolean {
  if (!code) return false;
  const dev = process.env.DEV_TWO_STEP_CODE;
  const devAllowed = process.env.NODE_ENV !== 'production' || process.env.ALLOW_DEV_TWO_STEP_CODE === 'true';
  if (dev && devAllowed && code === dev) return true;
  if (!secret) return false;
  try {
    return authenticator.check(code, secret);
  } catch {
    return false;
  }
}

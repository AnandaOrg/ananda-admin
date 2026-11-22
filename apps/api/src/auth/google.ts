import { webOrigin } from '../core/origin';

/**
 * "Continue with Google" (OpenID Connect, authorization code flow). Switched on by GOOGLE_CLIENT_ID and
 * GOOGLE_CLIENT_SECRET (Google Cloud console → APIs & Services → Credentials → OAuth client ID, type
 * "Web application", authorised redirect URI `<web address>/api/auth/google/callback`).
 */
export const googleConfigured = () => !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;

const redirectUri = () => `${webOrigin()}/api/auth/google/callback`;

export function googleAuthUrl(state: string, nonce: string, loginHint?: string): string {
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    prompt: 'select_account',
  });
  if (loginHint) q.set('login_hint', loginHint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

export interface GoogleProfile {
  sub: string;
  email: string;
  name?: string;
}

/**
 * Swaps the code for the ID token and checks it. The token comes straight from Google's token endpoint
 * over TLS, so its signature needs no separate check (OpenID Connect Core 3.1.3.7); issuer, audience,
 * expiry, nonce and a verified e-mail are checked here.
 */
export async function googleProfile(code: string, nonce: string): Promise<GoogleProfile | null> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) return null;
  const { id_token } = (await res.json()) as { id_token?: string };
  const payload = id_token?.split('.')[1];
  if (!payload) return null;
  const c = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
    iss?: string;
    aud?: string;
    exp?: number;
    nonce?: string;
    sub?: string;
    email?: string;
    email_verified?: boolean | string;
    name?: string;
  };
  const issuerOk = c.iss === 'https://accounts.google.com' || c.iss === 'accounts.google.com';
  const verified = c.email_verified === true || c.email_verified === 'true';
  if (!issuerOk || c.aud !== process.env.GOOGLE_CLIENT_ID || !c.exp || c.exp * 1000 < Date.now() || c.nonce !== nonce || !c.sub || !c.email || !verified) return null;
  return { sub: c.sub, email: c.email.toLowerCase(), name: c.name };
}

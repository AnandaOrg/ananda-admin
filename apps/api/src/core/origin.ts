/**
 * Public address of the web app, used in e-mailed links and CORS. On Vercel the web and the API share
 * one domain, so the project's production URL (or this deployment's URL) is used unless WEB_ORIGIN is set.
 */
export function webOrigin(): string {
  if (process.env.WEB_ORIGIN) return process.env.WEB_ORIGIN.replace(/\/$/, '');
  if (process.env.VERCEL_ENV === 'production' && process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3010';
}

/** True when running as a Vercel Function (no long-lived process, no local disk). */
export const onVercel = () => !!process.env.VERCEL;

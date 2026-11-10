import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { NAMESPACES, LOCALE_COOKIE, asLocale } from './config';

type Messages = Record<string, unknown>;

function merge(base: Messages, over: Messages): Messages {
  const out: Messages = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && typeof base[k] === 'object' ? merge(base[k] as Messages, v as Messages) : v;
  }
  return out;
}

async function load(locale: string): Promise<Messages> {
  const entries = await Promise.all(
    NAMESPACES.map(async (ns) => {
      try {
        return [ns, (await import(`../messages/${locale}/${ns}.json`)).default] as const;
      } catch {
        return [ns, {}] as const;
      }
    }),
  );
  return Object.fromEntries(entries);
}

export default getRequestConfig(async () => {
  const locale = asLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  const en = await load('en');
  // Missing Bulgarian or Hebrew strings fall back to English rather than showing keys.
  const messages = locale === 'en' ? en : merge(en, await load(locale));
  return { locale, messages, timeZone: 'Europe/Sofia' };
});

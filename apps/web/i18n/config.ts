import { LOCALES, type Locale } from '@ananda/shared';

export const LOCALE_COOKIE = 'ananda_locale';
export const DEFAULT_LOCALE: Locale = 'en';

/** One file per area, so each module owns its own copy. */
export const NAMESPACES = [
  'common',
  'auth',
  'home',
  'sales',
  'customers',
  'collections',
  'purchasing',
  'inventory',
  'warehouse',
  'agents',
  'events',
  'money',
  'admin',
] as const;

export function asLocale(v: string | undefined): Locale {
  return (LOCALES as readonly string[]).includes(v ?? '') ? (v as Locale) : DEFAULT_LOCALE;
}

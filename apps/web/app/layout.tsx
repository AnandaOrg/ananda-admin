import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale } from 'next-intl/server';
import { isRtl } from '@ananda/shared';
import { Providers } from '@/components/providers/Providers';
import { THEME_BOOT } from '@/lib/theme';
import themeColors from './styles/theme-colors.json';
import './styles/tokens.css';
import './styles/components.css';
import './styles/app.css';

export const metadata: Metadata = {
  title: 'ANANDA',
  description: 'Operations and finance',
};

export const viewport: Viewport = { themeColor: themeColors.dark, width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  // Theme preference (System / Light / Dark) from the profile menu; "system" is resolved before paint by THEME_BOOT.
  const pref = (await cookies()).get('ananda_theme')?.value;
  const theme = pref === 'light' ? 'light' : 'dark';
  return (
    <html lang={locale} dir={isRtl(locale) ? 'rtl' : 'ltr'} data-theme={theme} data-theme-pref={pref ?? 'dark'} suppressHydrationWarning>
      <head>
        <link rel="preload" href="/fonts/Rubik-Variable.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        {pref === 'system' && <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />}
      </head>
      <body>
        <NextIntlClientProvider>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale } from 'next-intl/server';
import { isRtl } from '@ananda/shared';
import { Providers } from '@/components/providers/Providers';
import './styles/tokens.css';
import './styles/components.css';
import './styles/app.css';

export const metadata: Metadata = {
  title: 'ANANDA',
  description: 'Operations and finance',
};

export const viewport: Viewport = { themeColor: '#0A0A0B', width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} dir={isRtl(locale) ? 'rtl' : 'ltr'} data-theme="dark">
      <head>
        <link rel="preload" href="/fonts/Rubik-Variable.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body>
        <NextIntlClientProvider>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

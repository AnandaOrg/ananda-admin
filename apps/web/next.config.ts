import path from 'node:path';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// On Vercel the top-level rewrites in vercel.json send /api/* to the API service and Vercel builds
// Next.js itself. Locally and in Docker this app proxies /api/* to the API and builds a standalone server.
const onVercel = !!process.env.VERCEL;
const API = process.env.API_URL ?? 'http://localhost:4010';

const config: NextConfig = {
  ...(onVercel ? {} : { output: 'standalone' as const, outputFileTracingRoot: path.join(__dirname, '../..') }),
  transpilePackages: ['@ananda/shared'],
  async rewrites() {
    return onVercel ? [] : [{ source: '/api/:path*', destination: `${API}/api/:path*` }];
  },
};

export default createNextIntlPlugin('./i18n/request.ts')(config);

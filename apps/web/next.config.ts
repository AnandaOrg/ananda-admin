import path from 'node:path';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const API = process.env.API_URL ?? 'http://localhost:4010';

const config: NextConfig = {
  // Standalone server for the Docker image; trace files from the monorepo root.
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../..'),
  transpilePackages: ['@ananda/shared'],
  // The API sits behind the same origin so the session cookie stays first-party.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API}/api/:path*` }];
  },
};

export default createNextIntlPlugin('./i18n/request.ts')(config);

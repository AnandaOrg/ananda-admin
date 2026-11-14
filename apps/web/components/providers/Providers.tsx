'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ApiError } from '@/lib/api';
import { ToastProvider } from '@/components/ui';
import { AsOfProvider } from '@/lib/asof';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: true,
            retry: (n, e) => !(e instanceof ApiError && (e.status < 500 || e.isNetwork)) && n < 2,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <AsOfProvider>
        <ToastProvider>{children}</ToastProvider>
      </AsOfProvider>
    </QueryClientProvider>
  );
}

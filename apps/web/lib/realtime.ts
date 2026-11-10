'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Counts, badges and lists update without reload (PRD §10). With a long-lived API (local, Docker) the
 * server pushes changes over an event stream. On Vercel each request may land on a different function
 * instance, so open pages poll instead while they are visible.
 */
const MODE = process.env.NEXT_PUBLIC_REALTIME ?? (process.env.NEXT_PUBLIC_VERCEL_ENV ? 'poll' : 'stream');
const POLL_MS = 20_000;

export function useRealtime(enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    const refetchAll = () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'me' });

    if (MODE === 'poll') {
      const tick = () => document.visibilityState === 'visible' && refetchAll();
      const id = setInterval(tick, POLL_MS);
      document.addEventListener('visibilitychange', tick);
      return () => {
        clearInterval(id);
        document.removeEventListener('visibilitychange', tick);
      };
    }

    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const open = () => {
      es = new EventSource('/api/stream');
      es.onmessage = (e) => {
        try {
          const { topics } = JSON.parse(e.data) as { topics: string[] };
          if (!topics.length) return;
          if (topics.includes('*')) refetchAll();
          else topics.forEach((t) => qc.invalidateQueries({ queryKey: [t] }));
        } catch {
          /* heartbeat or malformed */
        }
      };
      es.onerror = () => {
        es?.close();
        retry = setTimeout(open, 5000);
      };
    };
    open();
    return () => {
      es?.close();
      clearTimeout(retry);
    };
  }, [enabled, qc]);
}

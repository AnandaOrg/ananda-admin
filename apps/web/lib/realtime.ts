'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/** Listens to the API's event stream and refetches what the server says changed. */
export function useRealtime(enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const open = () => {
      es = new EventSource('/api/stream');
      es.onmessage = (e) => {
        try {
          const { topics } = JSON.parse(e.data) as { topics: string[] };
          if (!topics.length) return;
          if (topics.includes('*')) qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
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

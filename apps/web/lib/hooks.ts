'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from './api';
import { useToast } from '@/components/ui/overlays';

/**
 * A write with the app's conventions: field errors next to fields, a general error in the
 * panel, a toast on success, and every list refetched (the server also pushes changes).
 */
export function useAction<TVars, TResult = unknown>(fn: (v: TVars) => Promise<TResult>, opts: { success?: string | ((r: TResult) => string); onDone?: (r: TResult) => void } = {}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [fields, setFields] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: fn,
    onMutate: () => setFields({}),
    onSuccess: (r) => {
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
      const msg = typeof opts.success === 'function' ? opts.success(r) : opts.success;
      if (msg) toast(msg);
      opts.onDone?.(r);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fields) setFields(e.fields);
    },
  });
  const error = m.error instanceof ApiError ? m.error : m.error ? new ApiError(0, m.error.message) : null;
  return { ...m, fields, error, errorText: error?.message ?? null };
}

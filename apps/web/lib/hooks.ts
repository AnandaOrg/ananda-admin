'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ApiError } from './api';
import { useLookingBack } from './asof';
import { useToast, type ToastAction } from '@/components/ui/overlays';

export interface ActionOptions<TResult> {
  /** Toast after success. Long sentences are cut to the first one; give the rest as `view`. */
  success?: string | ((r: TResult) => string);
  /** One button on the success toast, e.g. { label: 'View', href } or { label: 'Undo', onClick }. */
  successAction?: ToastAction | ((r: TResult) => ToastAction | undefined);
  onDone?: (r: TResult) => void;
  /**
   * One-tap actions on a page (no panel to show the error in): failures become an error toast with
   * Try again (or Reload when someone else changed it). Pass a short message, e.g. "Reminder not sent",
   * or `true` to use the reason from the server.
   */
  errorToast?: boolean | string;
  /** Info toast text (with Reload) when someone else already changed the record; replaces the server's raw message. */
  conflictToast?: string | ((e: ApiError) => string | undefined);
}

/**
 * A write with the app's conventions: field errors next to fields, a general error under the button
 * (`<ActionError action={a} />`) or as a toast, a toast on success, and every list refetched (the server
 * also pushes changes). While looking back at a past day it refuses to run (`blocked`).
 * `busy` is true while it runs: pass it to `<Button busy>` so it keeps its label and width with a spinner.
 */
export function useAction<TVars, TResult = unknown>(fn: (v: TVars) => Promise<TResult>, opts: ActionOptions<TResult> = {}) {
  const qc = useQueryClient();
  const toast = useToast();
  const t = useTranslations('common');
  const lookingBack = useLookingBack();
  const [fields, setFields] = useState<Record<string, string>>({});
  const last = useRef<{ v: TVars } | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const m = useMutation({
    mutationFn: (v: TVars) => {
      if (lookingBack) return Promise.reject(new ApiError(409, t('lookBack.blocked'), 'looking_back'));
      return fn(v);
    },
    onMutate: (v) => {
      last.current = { v };
      setFields({});
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
      const o = optsRef.current;
      const msg = typeof o.success === 'function' ? o.success(r) : o.success;
      const act = typeof o.successAction === 'function' ? o.successAction(r) : o.successAction;
      if (msg) toast.show(msg, { kind: 'ok', action: act });
      o.onDone?.(r);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fields) setFields(e.fields);
      const o = optsRef.current;
      if (!o.errorToast) return;
      const err = e instanceof ApiError ? e : new ApiError(0, e.message);
      if (err.isConflict) toast.show((typeof o.conflictToast === 'function' ? o.conflictToast(err) : o.conflictToast) ?? (typeof o.errorToast === 'string' ? o.errorToast : messageOf(err, t)), { kind: 'info', action: { label: t('reload'), onClick: () => qc.invalidateQueries() } });
      else toast.show(typeof o.errorToast === 'string' ? o.errorToast : messageOf(err, t), { kind: 'err', action: err.isLookingBack ? undefined : { label: t('retry'), onClick: () => last.current && m.mutate(last.current.v) } });
    },
  });
  const error = m.error instanceof ApiError ? m.error : m.error ? new ApiError(0, m.error.message) : null;
  const errorText = error ? messageOf(error, t) : null;
  /** Runs the last call again (the Try again link). */
  const retry = () => last.current && m.mutate(last.current.v);
  return { ...m, fields, error, errorText, retry, blocked: lookingBack, busy: m.isPending };
}

/** The sentence to show for an error, translated for the cases the app words itself. */
export function messageOf(e: unknown, t: (k: string) => string): string {
  if (e instanceof ApiError) {
    if (e.isNetwork) return t('errors.network');
    if (e.isServer) return t('errors.server');
    if (e.isLookingBack) return t('lookBack.blocked');
    return e.message;
  }
  return e instanceof Error ? e.message : t('error');
}

/** True only once `on` has stayed true for `ms` (skeletons appear after ~300 ms, so fast pages don't flash). */
export function useDelayed(on: boolean, ms = 300) {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!on) {
      setLate(false);
      return;
    }
    const id = setTimeout(() => setLate(true), ms);
    return () => clearTimeout(id);
  }, [on, ms]);
  return on && late;
}

/** Warns before the tab closes or reloads while a form has unsaved changes. */
export function useUnsavedChanges(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const on = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', on);
    return () => window.removeEventListener('beforeunload', on);
  }, [dirty]);
}

export { useMedia } from './media';

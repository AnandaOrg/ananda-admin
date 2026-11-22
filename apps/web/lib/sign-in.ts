'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { nextPath, type Me } from './session';
import { setLocaleCookie } from '@/components/shell/AppShell';

export type TwoStep = 'none' | 'verify' | 'setup';

/** The session is for this kind of device: phones stay signed in longer. */
export const signInDevice = (): 'desktop' | 'phone' => (window.matchMedia('(max-width: 767px)').matches ? 'phone' : 'desktop');

/**
 * After an e-mail link, Google or an accepted invitation: switch to the person's language, then the
 * two-step code (when their role asks for it), then the page they came for or their start page.
 */
export function useFinishSignIn() {
  const router = useRouter();
  const qc = useQueryClient();
  return useCallback(
    async (twoStep: TwoStep, opts: { invited?: boolean } = {}) => {
      qc.clear();
      const me = await api.get<Me>('/auth/me');
      setLocaleCookie(me.user.language);
      // A new broker who just accepted the invitation starts with their set-up.
      const start = me.perms.scope === 'shipping' ? '/warehouse' : opts.invited && me.perms.scope === 'own' ? '/brokers/setup' : '/home';
      const next = nextPath(start);
      try {
        // Back to where they were after the session ended: the shell says "Signed in again".
        if (new URLSearchParams(window.location.search).get('next')) sessionStorage.setItem('ananda:again', '1');
      } catch {
        /* storage blocked */
      }
      router.replace(twoStep !== 'none' ? `/two-step?next=${encodeURIComponent(next)}` : next);
      router.refresh();
    },
    [qc, router],
  );
}

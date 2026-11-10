'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { canEdit, canView, type Area, type Permissions, type SensitiveAction } from '@ananda/shared';
import { api } from './api';

export interface Me {
  user: { id: string; name: string; email: string; language: string; theme: string; twoStepEnabled: boolean; roleName: string; baseRole: string };
  perms: Permissions & { roleId: string; twoStepRequired: boolean };
  device: 'desktop' | 'phone';
  twoStepPassed: boolean;
  twoStepState: 'setup' | 'verify' | 'done';
}

export const meQueryKey = ['me'];

export function useMeQuery() {
  return useQuery({ queryKey: meQueryKey, queryFn: () => api.get<Me>('/auth/me'), retry: false, staleTime: 60_000 });
}

const SessionContext = createContext<Me | null>(null);

export function SessionProvider({ me, children }: { me: Me; children: ReactNode }) {
  return <SessionContext.Provider value={me}>{children}</SessionContext.Provider>;
}

/** The signed-in user and what they may do. Only available inside the app shell. */
export function useSession() {
  const me = useContext(SessionContext);
  if (!me) throw new Error('useSession outside SessionProvider');
  const { perms } = me;
  return {
    me,
    perms,
    canView: (a: Area) => canView(perms.areas, a),
    canEdit: (a: Area) => canEdit(perms.areas, a),
    can: (s: SensitiveAction) => perms.sensitive.includes(s),
    isAgent: perms.scope === 'own',
    isWarehouse: perms.scope === 'shipping',
    isAdmin: perms.scope === 'all' && perms.areas.sales === 'edit',
    readOnly: perms.previewing,
  };
}

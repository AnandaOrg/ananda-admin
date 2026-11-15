'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

/** What the open page tells the shell: breadcrumb (desktop header row) and title (phone top bar). */
export interface PageInfo {
  crumbs?: { label: string; href?: string }[];
  title?: ReactNode;
}

const SetCtx = createContext<((p: PageInfo | null) => void) | null>(null);
const GetCtx = createContext<PageInfo | null>(null);

export function PageInfoProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<PageInfo | null>(null);
  return (
    <SetCtx.Provider value={setInfo}>
      <GetCtx.Provider value={info}>{children}</GetCtx.Provider>
    </SetCtx.Provider>
  );
}

export function usePageInfo() {
  return useContext(GetCtx);
}

/** Called by `PageHeader`; outside the shell it does nothing. */
export function useRegisterPage(info: PageInfo) {
  const set = useContext(SetCtx);
  const key = JSON.stringify({ c: info.crumbs, t: typeof info.title === 'string' ? info.title : null });
  useEffect(() => {
    if (!set) return;
    set(info);
    return () => set(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [set, key]);
}

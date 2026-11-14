'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { isoDate } from '@ananda/shared';
import { setApiAsOf } from './api';

/**
 * "As of" (header calendar). Picking a past day shows every figure as it was at the end of that day
 * and makes the app read-only: the API gets `x-as-of` and refuses changes, primary buttons are off
 * (`html[data-looking-back]` in app.css), `Button` disables itself and `useAction` refuses to run.
 * Kept for the browser tab (sessionStorage), so a reload stays on the chosen day.
 */
interface AsOfValue {
  /** The day the figures are for (YYYY-MM-DD). Today when not looking back. */
  day: string;
  today: string;
  /** A past day is chosen: nothing can be changed. */
  lookingBack: boolean;
  setDay: (d: string | null) => void;
}

const KEY = 'ananda:as-of';
const Ctx = createContext<AsOfValue>({ day: isoDate(), today: isoDate(), lookingBack: false, setDay: () => {} });

export function AsOfProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [today, setToday] = useState(() => isoDate());
  const [chosen, setChosen] = useState<string | null>(null);

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = sessionStorage.getItem(KEY);
    } catch {
      /* storage blocked */
    }
    if (saved && /^\d{4}-\d{2}-\d{2}$/.test(saved) && saved < isoDate()) {
      setApiAsOf(saved);
      setChosen(saved);
      qc.resetQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    }
    // The day rolls over while the app stays open.
    const id = setInterval(() => setToday(isoDate()), 60_000);
    return () => clearInterval(id);
  }, [qc]);

  const lookingBack = !!chosen && chosen < today;

  useEffect(() => {
    const el = document.documentElement;
    if (lookingBack) el.setAttribute('data-looking-back', '');
    else el.removeAttribute('data-looking-back');
  }, [lookingBack]);

  const setDay = useCallback(
    (d: string | null) => {
      const next = d && d < isoDate() ? d : null;
      setApiAsOf(next);
      setChosen(next);
      try {
        if (next) sessionStorage.setItem(KEY, next);
        else sessionStorage.removeItem(KEY);
      } catch {
        /* storage blocked */
      }
      // Every figure on screen belongs to the old day: drop it and load again.
      qc.resetQueries({ predicate: (q) => q.queryKey[0] !== 'me' && q.queryKey[0] !== 'notifications' && q.queryKey[0] !== 'badges' });
    },
    [qc],
  );

  const value = useMemo(() => ({ day: lookingBack ? chosen! : today, today, lookingBack, setDay }), [lookingBack, chosen, today, setDay]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAsOf() {
  return useContext(Ctx);
}

/** True while looking back at a past day: anything that changes data must be off. */
export function useLookingBack() {
  return useContext(Ctx).lookingBack;
}

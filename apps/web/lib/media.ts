'use client';

import { useEffect, useState } from 'react';

/** Matches a media query (e.g. '(max-width: 767px)'); false on the server. */
export function useMedia(query: string) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const m = window.matchMedia(query);
    const f = () => setOn(m.matches);
    f();
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, [query]);
  return on;
}

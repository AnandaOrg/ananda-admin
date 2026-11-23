'use client';

import { useEffect, useState } from 'react';
import { useSession } from '@/lib/session';
import { PageSkeleton } from '@/components/ui';
import { Overview } from './_components/Overview';
import { ToShip } from './_components/ToShip';

/**
 * Warehouse opens on "To ship" (design, 17 Nov): warehouse users get the phone "To ship" cards at every
 * width, and so do Admins on the phone (with links to Delivered and Stock count). Admins on a wider
 * screen get the desktop overview.
 */
export default function WarehousePage() {
  const { isWarehouse } = useSession();
  // null until the width is known, so a phone never starts loading the desktop overview
  const [phone, setPhone] = useState<boolean | null>(null);
  useEffect(() => {
    const m = window.matchMedia('(max-width: 767px)');
    const f = () => setPhone(m.matches);
    f();
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);
  if (isWarehouse) return <ToShip />;
  if (phone === null) return <PageSkeleton />;
  return phone ? <ToShip links /> : <Overview />;
}

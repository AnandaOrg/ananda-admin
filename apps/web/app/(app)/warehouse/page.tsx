'use client';

import { useSession } from '@/lib/session';
import { Overview } from './_components/Overview';
import { ToShip } from './_components/ToShip';

/** Warehouse users get the phone "To ship" cards at every width; Admins the desktop overview. */
export default function WarehousePage() {
  const { isWarehouse } = useSession();
  return isWarehouse ? <ToShip /> : <Overview />;
}

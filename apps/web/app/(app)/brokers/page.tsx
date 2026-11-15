'use client';

import { useSession } from '@/lib/session';
import { BrokersAdmin } from './_components/BrokersAdmin';
import { MyEarnings } from './_components/MyEarnings';

/** Brokers & commissions. A signed-in broker sees only their own earnings (FR-AGT-5). */
export default function BrokersPage() {
  const { isBroker } = useSession();
  return isBroker ? <MyEarnings /> : <BrokersAdmin />;
}

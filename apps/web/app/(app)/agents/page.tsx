'use client';

import { useSession } from '@/lib/session';
import { AgentsAdmin } from './_components/AgentsAdmin';
import { MyEarnings } from './_components/MyEarnings';

/** Agents & commissions. A signed-in agent sees only their own earnings (FR-AGT-5). */
export default function AgentsPage() {
  const { isAgent } = useSession();
  return isAgent ? <MyEarnings /> : <AgentsAdmin />;
}

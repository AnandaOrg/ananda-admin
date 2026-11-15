'use client';

import { use, useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Drafts are edited in the New sale panel on the order page. */
export default function EditDraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  useEffect(() => router.replace(`/sales/${id}?edit=1`), [id, router]);
  return null;
}

'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ErrorState, PageSkeleton } from '@/components/ui';
import { SaleForm } from '../../SaleForm';
import type { OrderDetail } from '../page';

export default function EditDraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useQuery({ queryKey: ['orders', id], queryFn: () => api.get<OrderDetail>(`/orders/${id}`) });
  if (q.isLoading) return <PageSkeleton />;
  if (!q.data) return <ErrorState error={q.error} />;
  const o = q.data;
  return (
    <SaleForm
      initial={{
        id,
        number: o.order.number,
        customerId: o.order.customerId,
        cartons: Object.fromEntries(o.lines.map((l) => [l.flavour, l.cartons])),
        note: o.order.note ?? '',
        specialUnitPriceCents: o.order.specialUnitPriceCents,
      }}
    />
  );
}

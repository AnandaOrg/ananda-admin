'use client';

import { useSearchParams } from 'next/navigation';
import { SaleForm } from '../SaleForm';

export default function NewSalePage() {
  const params = useSearchParams();
  return <SaleForm initial={{ customerId: params.get('customer'), cartons: {}, note: '' }} />;
}

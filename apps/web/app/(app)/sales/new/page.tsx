'use client';

import { SalesList } from '../SalesList';

/** New sale opens as a panel over Sales & orders (links from Overview, Customers, the sidebar). */
export default function NewSalePage() {
  return <SalesList newSale />;
}

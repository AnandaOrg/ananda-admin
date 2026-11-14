import type { Flavour } from '@ananda/shared';

export type PurchaseStatus = 'ordered' | 'on_the_way' | 'received' | 'cancelled';
export type PayableKind = 'supplier_invoice' | 'freight' | 'excise';

export interface Supplier {
  id: string;
  company: string;
  country: string;
  vatNumber: string | null;
  contactName: string | null;
  ordersEmail: string;
  phone: string | null;
  approvedFlavours: Flavour[];
  defaultFlavours: Flavour[];
  leadTimeDays: number;
  paymentTermsDays: number;
  unitPriceCents: number;
  status: 'approved' | 'pending' | 'inactive';
  lastPurchaseOn: string | null;
  lastPurchaseNumber: string | null;
  purchaseCount: number;
}

export interface SupplierDetail extends Omit<Supplier, 'lastPurchaseOn' | 'lastPurchaseNumber' | 'purchaseCount'> {
  documents: { id: string; label: string | null; fileName: string | null; createdAt: string; by: string | null }[];
}

export interface SupplierList {
  items: Supplier[];
  defaults: Record<Flavour, string | null>;
}

export interface PurchaseRow {
  id: string;
  number: string;
  status: PurchaseStatus;
  supplierName: string;
  supplierCountry: string;
  orderedOn: string;
  expectedOn: string;
  arrivedOn: string | null;
  totalCartons: number;
  totalUnits: number;
  unitsReceived: number | null;
  supplierInvoiceReceived: boolean;
  payableCents: number;
  stillToPayCents: number;
  daysLate: number;
}

export type PurchaseFilter = 'all' | 'open' | 'late' | 'received';

export interface PurchaseList {
  items: PurchaseRow[];
  counts: Record<PurchaseFilter, number>;
  tiles: { onTheWayUnits: number; onTheWayCartons: number; toPaySuppliersCents: number; notInvoicedCents: number; toPayNumbers: string[]; late: number; oldestLateDays: number; oldestLateNumber: string | null; oldestLateId: string | null };
  approvedSuppliers: number;
  nextNumber: string;
}

export interface PayablePayment {
  id: string;
  payableId: string;
  paidOn: string;
  amountCents: number;
  paidFrom: string;
  bankReference: string | null;
  proofDocumentId: string | null;
  by?: string | null;
}

export interface Payable {
  id: string;
  kind: PayableKind;
  party: string;
  purchaseId: string | null;
  purchaseNumber?: string | null;
  invoiceNumber: string | null;
  dueOn: string;
  netCents: number;
  vatRate: number;
  amountCents: number;
  paidCents: number;
  stillToPayCents: number;
  documentId: string | null;
  overdue?: boolean;
  paidToday?: boolean;
  arrivedOn?: string | null;
  payments?: PayablePayment[];
}

export interface Shipment {
  id: string;
  purchaseId: string;
  carrier: string;
  mode: string;
  route: string | null;
  departOn: string | null;
  arriveOn: string | null;
  status: 'booked' | 'in_transit' | 'arrived';
}

export interface PurchaseFile {
  kind: 'purchase_order' | 'supplier_invoice' | 'carrier_invoice' | 'received_note' | 'payment' | 'upload';
  on: string | null;
  number?: string | null;
  label?: string | null;
  amountCents?: number | null;
  units?: number | null;
  part?: boolean;
  by?: string | null;
  href: string | null;
}

export interface PurchaseDetail {
  purchase: {
    id: string;
    number: string;
    status: PurchaseStatus;
    orderedOn: string;
    expectedOn: string;
    arrivedOn: string | null;
    totalCartons: number;
    totalUnits: number;
    unitsReceived: number | null;
    goodsCents: number;
    freightCents: number;
    exciseCents: number;
    landedUnitCostCents: number | null;
    supplierInvoiceReceived: boolean;
    note: string | null;
    daysLate: number;
  };
  supplier: Omit<Supplier, 'lastPurchaseOn' | 'lastPurchaseNumber' | 'purchaseCount'>;
  lines: { id: string; flavour: Flavour; cartons: number; units: number; unitPriceCents: number; unitsReceived: number | null; lineCents: number }[];
  figures: {
    goodsCents: number;
    freightCents: number;
    exciseCents: number;
    exciseEstimated: boolean;
    inventoryCostCents: number;
    landedUnitCostCents: number;
    landedEstimated: boolean;
    units: number;
    supplierVatRate: number;
    payableCents: number;
    paidCents: number;
    stillToPayCents: number;
    notInvoicedCents: number;
  };
  payables: Payable[];
  shipments: Shipment[];
  documents: { id: string; type: string; number: string | null; label: string | null; fileName: string | null; hasFile: boolean; totalCents: number | null; createdAt: string; by: string | null }[];
  messages: { id: string; topic: string; to: string; subject: string; body: string; followUpOn: string | null; resolvedAt: string | null; createdAt: string; by: string | null }[];
  waiting: { id: string; number: string; paidAt: string | null; since: string | null; brokerName: string | null; customerName: string | null; cartons: number; units: number; lines: { flavour: Flavour; cartons: number; units: number }[] }[];
  files: PurchaseFile[];
  steps: Record<'ordered' | 'on_the_way' | 'supplier_invoice' | 'paid_supplier' | 'landed_cost', { done: boolean; on: string | null; number?: string | null }>;
  actions: string[];
  followUpDays: number;
}

/** A JSON body plus optional files, for the forms that carry an upload. */
export function formWith(data: unknown, files: Record<string, File | null | undefined> = {}) {
  const fd = new FormData();
  fd.set('data', JSON.stringify(data));
  for (const [k, f] of Object.entries(files)) if (f) fd.set(k, f);
  return fd;
}

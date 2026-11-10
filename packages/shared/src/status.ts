// States of the main records (PRD §6).

export const ORDER_STATUSES = [
  'draft',
  'payment_to_confirm',
  'waiting_for_stock',
  'ready_to_send',
  'at_warehouse',
  'delivered',
  'delivered_part',
  'invoiced',
  'cancelled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Correction and Cancel are allowed only before shipping (FR-SALE-5). */
export const ORDER_PRE_SHIPPING: OrderStatus[] = ['payment_to_confirm', 'waiting_for_stock', 'ready_to_send'];
export const ORDER_OPEN: OrderStatus[] = ['payment_to_confirm', 'waiting_for_stock', 'ready_to_send', 'at_warehouse', 'delivered', 'delivered_part'];
export const ORDER_SHIPPED: OrderStatus[] = ['at_warehouse', 'delivered', 'delivered_part', 'invoiced'];

/** The five steps of the order flow; each unlocks the next (FR-SALE-4). */
export const ORDER_FLOW_STEPS = ['payment_request', 'confirm_payment', 'send_to_warehouse', 'delivered', 'invoice'] as const;
export type OrderFlowStep = (typeof ORDER_FLOW_STEPS)[number];

export function orderFlowIndex(status: OrderStatus): number {
  switch (status) {
    case 'draft':
      return 0;
    case 'payment_to_confirm':
      return 1;
    case 'waiting_for_stock':
    case 'ready_to_send':
      return 2;
    case 'at_warehouse':
      return 3;
    case 'delivered':
    case 'delivered_part':
      return 4;
    case 'invoiced':
      return 5;
    case 'cancelled':
      return -1;
  }
}

export type StatusTone = 'good' | 'warn' | 'bad' | 'info' | 'blue' | 'mute';

export const ORDER_STATUS_TONE: Record<OrderStatus, StatusTone> = {
  draft: 'mute',
  payment_to_confirm: 'info',
  waiting_for_stock: 'warn',
  ready_to_send: 'good',
  at_warehouse: 'info',
  delivered: 'info',
  delivered_part: 'warn',
  invoiced: 'good',
  cancelled: 'mute',
};

export const CUSTOMER_STATUSES = ['draft', 'needs_approval', 'active', 'declined', 'archived'] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

export const PURCHASE_STATUSES = ['ordered', 'on_the_way', 'received', 'cancelled'] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

/** Progress steps of a purchase (FR-PUR-6, §6.4). */
export const PURCHASE_FLOW_STEPS = ['ordered', 'on_the_way', 'supplier_invoice', 'paid_supplier', 'landed_cost'] as const;

export const APPROVAL_TYPES = ['new_customer', 'special_price', 'correction'] as const;
export type ApprovalType = (typeof APPROVAL_TYPES)[number];
export type ApprovalStatus = 'pending' | 'approved' | 'declined';

export const COMMISSION_STATUSES = ['coming', 'ready', 'sent', 'paid'] as const;
export type CommissionStatus = (typeof COMMISSION_STATUSES)[number];

export const DOCUMENT_TYPES = ['proforma', 'invoice', 'credit_note', 'purchase_order', 'delivery_note', 'upload'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const PAYABLE_KINDS = ['supplier_invoice', 'freight', 'excise'] as const;
export type PayableKind = (typeof PAYABLE_KINDS)[number];

export const PAYMENT_METHODS = ['bank_transfer', 'cash', 'card', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const AUDIT_CATEGORIES = ['orders', 'payments', 'documents', 'stock', 'customers', 'commission', 'users_access', 'security', 'purchasing', 'settings', 'expenses', 'events'] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

export const STOCK_MOVEMENT_KINDS = ['purchase_receipt', 'dispatch', 'return', 'credit_return', 'adjustment', 'event_out', 'event_in', 'event_sale'] as const;
export type StockMovementKind = (typeof STOCK_MOVEMENT_KINDS)[number];

// Reason lists (decision A9). "other" is always allowed.
export const REASONS = {
  decline: ['already_customer', 'wrong_details', 'not_a_fit', 'other'],
  adjustment: ['breakage', 'samples', 'count_difference', 'other'],
  credit: ['returned', 'damaged', 'price_error', 'other'],
  change_agent: ['agent_left', 'customer_request', 'performance', 'other'],
  part_delivery: ['customer_refused', 'damaged', 'short_on_truck', 'other'],
  cancel: ['customer_cancelled', 'duplicate', 'other'],
} as const;

export const EXPENSE_CATEGORIES = ['marketing', 'events', 'travel', 'office', 'software', 'fees', 'salaries', 'other'] as const;

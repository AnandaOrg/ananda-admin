// Database schema. Money is stored in integer cents; unit costs that can carry fractions of a
// cent (landed cost) use numeric. Each table maps to an entity in PRD §9.
import { relations } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { AreaMatrix, RecordScope, SensitiveAction, SystemRole } from '@ananda/shared';

const pk = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const ts = (name: string) => timestamp(name, { withTimezone: true });

export const flavourEnum = pgEnum('flavour', ['aloha', 'gaia', 'santorini', 'kyoto']);
export const orderStatusEnum = pgEnum('order_status', [
  'draft',
  'payment_to_confirm',
  'waiting_for_stock',
  'ready_to_send',
  'at_warehouse',
  'delivered',
  'delivered_part',
  'invoiced',
  'cancelled',
]);
export const customerStatusEnum = pgEnum('customer_status', ['draft', 'needs_approval', 'active', 'declined', 'archived']);
export const purchaseStatusEnum = pgEnum('purchase_status', ['ordered', 'on_the_way', 'received', 'cancelled']);
export const approvalTypeEnum = pgEnum('approval_type', ['new_customer', 'special_price', 'correction']);
export const approvalStatusEnum = pgEnum('approval_status', ['pending', 'approved', 'declined', 'withdrawn']);
export const commissionStatusEnum = pgEnum('commission_status', ['coming', 'ready', 'sent', 'paid', 'void']);
export const documentTypeEnum = pgEnum('document_type', ['proforma', 'invoice', 'credit_note', 'purchase_order', 'delivery_note', 'upload', 'broker_agreement']);
export const payableKindEnum = pgEnum('payable_kind', ['supplier_invoice', 'freight', 'excise']);
export const userStatusEnum = pgEnum('user_status', ['invited', 'active', 'deactivated']);
export const movementKindEnum = pgEnum('movement_kind', [
  'purchase_receipt',
  'dispatch',
  'return',
  'credit_return',
  'adjustment',
  'event_out',
  'event_in',
  'event_sale',
]);

// ---------- People and access ----------

export const roles = pgTable('roles', {
  id: pk(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  baseRole: text('base_role').$type<SystemRole>().notNull(),
  isSystem: boolean('is_system').notNull().default(false),
  scope: text('scope').$type<RecordScope>().notNull(),
  twoStepRequired: boolean('two_step_required').notNull().default(false),
  areas: jsonb('areas').$type<AreaMatrix>().notNull(),
  sensitive: jsonb('sensitive').$type<SensitiveAction[]>().notNull(),
  createdAt: createdAt(),
});

export const users = pgTable('users', {
  id: pk(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  phone: text('phone'),
  passwordHash: text('password_hash'),
  roleId: uuid('role_id').notNull().references(() => roles.id),
  language: text('language').notNull().default('en'),
  theme: text('theme').notNull().default('dark'),
  status: userStatusEnum('status').notNull().default('invited'),
  totpSecret: text('totp_secret'),
  totpEnabled: boolean('totp_enabled').notNull().default(false),
  /** Google account id ("sub"), stored at the first Google sign-in; later Google sign-ins must match it. */
  googleSub: text('google_sub').unique(),
  inviteTokenHash: text('invite_token_hash'),
  inviteExpiresAt: ts('invite_expires_at'),
  invitedById: uuid('invited_by_id'),
  lastSignInAt: ts('last_sign_in_at'),
  createdAt: createdAt(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: pk(),
    userId: uuid('user_id').notNull().references(() => users.id),
    tokenHash: text('token_hash').notNull().unique(),
    device: text('device').$type<'desktop' | 'phone'>().notNull(),
    userAgent: text('user_agent'),
    ip: text('ip'),
    twoStepPassed: boolean('two_step_passed').notNull().default(false),
    previewRoleId: uuid('preview_role_id'),
    createdAt: createdAt(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

/** E-mailed sign-in links: single use, 15 minutes. Only the hash of the token is stored. */
export const signInLinks = pgTable(
  'sign_in_links',
  {
    id: pk(),
    userId: uuid('user_id').notNull().references(() => users.id),
    tokenHash: text('token_hash').notNull().unique(),
    ip: text('ip'),
    createdAt: createdAt(),
    expiresAt: ts('expires_at').notNull(),
    usedAt: ts('used_at'),
  },
  (t) => [index('sign_in_links_user_idx').on(t.userId, t.createdAt)],
);

// ---------- Customers and sales ----------

export const customers = pgTable(
  'customers',
  {
    id: pk(),
    companyName: text('company_name').notNull(),
    vatNumber: text('vat_number').notNull(),
    vatValid: boolean('vat_valid'),
    vatCheckedAt: ts('vat_checked_at'),
    country: text('country').notNull().default('BG'),
    registeredAddress: text('registered_address').notNull(),
    deliveryAddress: text('delivery_address'),
    city: text('city'),
    contactName: text('contact_name').notNull(),
    phone: text('phone').notNull(),
    invoiceEmail: text('invoice_email').notNull(),
    proformaLanguage: text('proforma_language').$type<'en' | 'bg' | 'he'>().notNull().default('bg'),
    paymentTermsDays: integer('payment_terms_days').notNull().default(7),
    /** 'before_shipping' (100% before it ships), 'half_before_shipping' (50% now, 50% before shipping) or 'after_delivery_30' (30 days after delivery). */
    paymentTerms: text('payment_terms').$type<'before_shipping' | 'half_before_shipping' | 'after_delivery_30'>().notNull().default('before_shipping'),
    postcode: text('postcode'),
    note: text('note'),
    brokerId: uuid('broker_id').references(() => users.id),
    ownedUntil: date('owned_until'),
    ownershipWarnedAt: ts('ownership_warned_at'),
    status: customerStatusEnum('status').notNull().default('draft'),
    approvedAt: ts('approved_at'),
    approvedById: uuid('approved_by_id'),
    createdById: uuid('created_by_id'),
    createdAt: createdAt(),
  },
  (t) => [index('customers_broker_idx').on(t.brokerId), index('customers_vat_idx').on(t.vatNumber)],
);

export const customerContacts = pgTable('customer_contacts', {
  id: pk(),
  customerId: uuid('customer_id').notNull().references(() => customers.id),
  name: text('name').notNull(),
  role: text('role'),
  phone: text('phone'),
  email: text('email'),
  createdAt: createdAt(),
});

export const events = pgTable('events', {
  id: pk(),
  name: text('name').notNull(),
  startsOn: date('starts_on').notNull(),
  endsOn: date('ends_on').notNull(),
  place: text('place').notNull(),
  kind: text('kind').$type<'event' | 'festival'>().notNull(),
  brokerIds: jsonb('broker_ids').$type<string[]>().notNull().default([]),
  createdById: uuid('created_by_id'),
  createdAt: createdAt(),
});

export const orders = pgTable(
  'orders',
  {
    id: pk(),
    number: text('number').notNull().unique(),
    customerId: uuid('customer_id').references(() => customers.id),
    brokerId: uuid('broker_id').notNull().references(() => users.id),
    eventId: uuid('event_id').references(() => events.id),
    status: orderStatusEnum('status').notNull().default('draft'),
    totalCartons: integer('total_cartons').notNull().default(0),
    totalUnits: integer('total_units').notNull().default(0),
    tierUnitPriceCents: integer('tier_unit_price_cents').notNull().default(0),
    unitPriceCents: integer('unit_price_cents').notNull().default(0),
    specialUnitPriceCents: integer('special_unit_price_cents'),
    netCents: integer('net_cents').notNull().default(0),
    vatCents: integer('vat_cents').notNull().default(0),
    totalCents: integer('total_cents').notNull().default(0),
    commissionCents: integer('commission_cents').notNull().default(0),
    paidCents: integer('paid_cents').notNull().default(0),
    creditedCents: integer('credited_cents').notNull().default(0),
    // Snapshot of purchase cost at full payment: deals keep the cost they were counted with.
    purchaseCostCents: integer('purchase_cost_cents'),
    allocated: boolean('allocated').notNull().default(false),
    reservedUntil: ts('reserved_until'),
    holdReleasedAt: ts('hold_released_at'),
    proformaExpiresAt: ts('proforma_expires_at'),
    proformaReminderAt: ts('proforma_reminder_at'),
    paymentDueOn: date('payment_due_on'),
    note: text('note'),
    partDeliveryOutcome: text('part_delivery_outcome').$type<'credit_note' | 'redeliver'>(),
    // Customer's payment terms when the payment request was sent (FR-SALE-6): 100% before shipping, 50% deposit then the rest before shipping, or invoice due 30 days after delivery.
    paymentTerms: text('payment_terms').$type<'before_shipping' | 'half_before_shipping' | 'after_delivery_30'>().notNull().default('before_shipping'),
    createdById: uuid('created_by_id'),
    createdAt: createdAt(),
    requestSentAt: ts('request_sent_at'),
    paidAt: ts('paid_at'),
    sentToWarehouseAt: ts('sent_to_warehouse_at'),
    deliveredAt: ts('delivered_at'),
    invoicedAt: ts('invoiced_at'),
    cancelledAt: ts('cancelled_at'),
    cancelReason: text('cancel_reason'),
  },
  (t) => [index('orders_customer_idx').on(t.customerId), index('orders_broker_idx').on(t.brokerId), index('orders_status_idx').on(t.status)],
);

export const orderLines = pgTable(
  'order_lines',
  {
    id: pk(),
    orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
    flavour: flavourEnum('flavour').notNull(),
    cartons: integer('cartons').notNull(),
    units: integer('units').notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(),
    lineNetCents: integer('line_net_cents').notNull(),
    deliveredCartons: integer('delivered_cartons'),
    creditedCartons: integer('credited_cartons').notNull().default(0),
  },
  (t) => [uniqueIndex('order_lines_flavour_uq').on(t.orderId, t.flavour)],
);

export const payments = pgTable('payments', {
  id: pk(),
  orderId: uuid('order_id').notNull().references(() => orders.id),
  receivedOn: date('received_on').notNull(),
  amountCents: integer('amount_cents').notNull(),
  method: text('method').notNull(),
  bankReference: text('bank_reference'),
  confirmedById: uuid('confirmed_by_id').notNull(),
  createdAt: createdAt(),
});

export const approvalRequests = pgTable(
  'approval_requests',
  {
    id: pk(),
    type: approvalTypeEnum('type').notNull(),
    status: approvalStatusEnum('status').notNull().default('pending'),
    customerId: uuid('customer_id').references(() => customers.id),
    orderId: uuid('order_id').references(() => orders.id),
    requestedById: uuid('requested_by_id').notNull().references(() => users.id),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    reason: text('reason'),
    decidedById: uuid('decided_by_id'),
    decidedAt: ts('decided_at'),
    declineReason: text('decline_reason'),
    declineMessage: text('decline_message'),
    createdAt: createdAt(),
  },
  (t) => [index('approvals_status_idx').on(t.status)],
);

export const documents = pgTable(
  'documents',
  {
    id: pk(),
    type: documentTypeEnum('type').notNull(),
    number: text('number'),
    orderId: uuid('order_id').references(() => orders.id),
    purchaseId: uuid('purchase_id'),
    // Supplier contracts and price lists (Purchasing → Suppliers).
    supplierId: uuid('supplier_id'),
    customerId: uuid('customer_id').references(() => customers.id),
    referencesDocumentId: uuid('references_document_id'),
    supersededById: uuid('superseded_by_id'),
    language: text('language').notNull().default('en'),
    // Frozen snapshot of everything printed on the document: issued documents never change.
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    totalCents: integer('total_cents'),
    label: text('label'),
    filePath: text('file_path'),
    fileName: text('file_name'),
    mimeType: text('mime_type'),
    createdById: uuid('created_by_id'),
    createdAt: createdAt(),
  },
  (t) => [index('documents_order_idx').on(t.orderId), index('documents_purchase_idx').on(t.purchaseId)],
);

export const numberSequences = pgTable('number_sequences', {
  key: text('key').primaryKey(),
  next: integer('next').notNull().default(1),
});

export const collectionReminders = pgTable('collection_reminders', {
  id: pk(),
  orderId: uuid('order_id').notNull().references(() => orders.id),
  sentById: uuid('sent_by_id').notNull(),
  subject: text('subject').notNull(),
  message: text('message').notNull(),
  createdAt: createdAt(),
});

// ---------- Purchasing and stock ----------

export const suppliers = pgTable('suppliers', {
  id: pk(),
  company: text('company').notNull(),
  country: text('country').notNull(),
  vatNumber: text('vat_number'),
  contactName: text('contact_name'),
  ordersEmail: text('orders_email').notNull(),
  phone: text('phone'),
  approvedFlavours: jsonb('approved_flavours').$type<string[]>().notNull().default([]),
  defaultFlavours: jsonb('default_flavours').$type<string[]>().notNull().default([]),
  leadTimeDays: integer('lead_time_days').notNull().default(30),
  paymentTermsDays: integer('payment_terms_days').notNull().default(30),
  unitPriceCents: numeric('unit_price_cents', { precision: 12, scale: 4, mode: 'number' }).notNull().default(0),
  status: text('status').$type<'approved' | 'pending' | 'inactive'>().notNull().default('approved'),
  createdAt: createdAt(),
});

export const purchases = pgTable('purchases', {
  id: pk(),
  number: text('number').notNull().unique(),
  supplierId: uuid('supplier_id').notNull().references(() => suppliers.id),
  status: purchaseStatusEnum('status').notNull().default('ordered'),
  orderedOn: date('ordered_on').notNull(),
  expectedOn: date('expected_on').notNull(),
  arrivedOn: date('arrived_on'),
  totalCartons: integer('total_cartons').notNull().default(0),
  totalUnits: integer('total_units').notNull().default(0),
  unitsReceived: integer('units_received'),
  goodsCents: integer('goods_cents').notNull().default(0),
  freightCents: integer('freight_cents').notNull().default(0),
  exciseCents: integer('excise_cents').notNull().default(0),
  landedUnitCostCents: numeric('landed_unit_cost_cents', { precision: 12, scale: 4, mode: 'number' }),
  supplierInvoiceReceived: boolean('supplier_invoice_received').notNull().default(false),
  note: text('note'),
  createdById: uuid('created_by_id'),
  createdAt: createdAt(),
});

export const purchaseLines = pgTable('purchase_lines', {
  id: pk(),
  purchaseId: uuid('purchase_id').notNull().references(() => purchases.id, { onDelete: 'cascade' }),
  flavour: flavourEnum('flavour').notNull(),
  cartons: integer('cartons').notNull(),
  units: integer('units').notNull(),
  unitPriceCents: numeric('unit_price_cents', { precision: 12, scale: 4, mode: 'number' }).notNull(),
  unitsReceived: integer('units_received'),
});

export const shipments = pgTable('shipments', {
  id: pk(),
  purchaseId: uuid('purchase_id').notNull().references(() => purchases.id),
  carrier: text('carrier').notNull(),
  mode: text('mode').notNull(),
  route: text('route'),
  departOn: date('depart_on'),
  arriveOn: date('arrive_on'),
  status: text('status').$type<'booked' | 'in_transit' | 'arrived'>().notNull().default('booked'),
  createdAt: createdAt(),
});

export const payables = pgTable('payables', {
  id: pk(),
  kind: payableKindEnum('kind').notNull(),
  party: text('party').notNull(),
  supplierId: uuid('supplier_id').references(() => suppliers.id),
  purchaseId: uuid('purchase_id').references(() => purchases.id),
  invoiceNumber: text('invoice_number'),
  dueOn: date('due_on').notNull(),
  netCents: integer('net_cents').notNull(),
  vatRate: numeric('vat_rate', { precision: 5, scale: 4, mode: 'number' }).notNull().default(0.2),
  amountCents: integer('amount_cents').notNull(),
  paidCents: integer('paid_cents').notNull().default(0),
  documentId: uuid('document_id'),
  createdAt: createdAt(),
});

export const payablePayments = pgTable('payable_payments', {
  id: pk(),
  payableId: uuid('payable_id').notNull().references(() => payables.id),
  paidOn: date('paid_on').notNull(),
  amountCents: integer('amount_cents').notNull(),
  paidFrom: text('paid_from').notNull(),
  bankReference: text('bank_reference'),
  proofDocumentId: uuid('proof_document_id'),
  recordedById: uuid('recorded_by_id').notNull(),
  createdAt: createdAt(),
});

export const supplierMessages = pgTable('supplier_messages', {
  id: pk(),
  purchaseId: uuid('purchase_id').notNull().references(() => purchases.id),
  topic: text('topic').notNull(),
  to: text('to').notNull(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  sentById: uuid('sent_by_id').notNull(),
  followUpOn: date('follow_up_on'),
  resolvedAt: ts('resolved_at'),
  createdAt: createdAt(),
});

/** Ledger of every stock change. In stock = Σ units at the warehouse (event_id null). */
export const stockMovements = pgTable(
  'stock_movements',
  {
    id: pk(),
    flavour: flavourEnum('flavour').notNull(),
    units: integer('units').notNull(),
    kind: movementKindEnum('kind').notNull(),
    reason: text('reason'),
    note: text('note'),
    eventId: uuid('event_id').references(() => events.id),
    orderId: uuid('order_id').references(() => orders.id),
    purchaseId: uuid('purchase_id').references(() => purchases.id),
    byId: uuid('by_id'),
    createdAt: createdAt(),
  },
  (t) => [index('stock_flavour_idx').on(t.flavour), index('stock_event_idx').on(t.eventId)],
);

export const stockCounts = pgTable('stock_counts', {
  id: pk(),
  countedById: uuid('counted_by_id').notNull(),
  cartons: jsonb('cartons').$type<Record<string, number>>().notNull(),
  expectedCartons: jsonb('expected_cartons').$type<Record<string, number>>().notNull(),
  reconciledAt: ts('reconciled_at'),
  reconciledById: uuid('reconciled_by_id'),
  createdAt: createdAt(),
});

// ---------- Brokers, money ----------

export const commissionEntries = pgTable(
  'commission_entries',
  {
    id: pk(),
    brokerId: uuid('broker_id').notNull().references(() => users.id),
    // Either an order, or an event sale (decision A13: brokers sell at events with normal commission).
    orderId: uuid('order_id').references(() => orders.id),
    eventId: uuid('event_id').references(() => events.id),
    units: integer('units').notNull(),
    amountCents: integer('amount_cents').notNull(),
    status: commissionStatusEnum('status').notNull().default('coming'),
    readyAt: ts('ready_at'),
    sentAt: ts('sent_at'),
    paidAt: ts('paid_at'),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [index('commission_broker_idx').on(t.brokerId), index('commission_order_idx').on(t.orderId)],
);

/**
 * Broker onboarding: company and bank details the broker fills in after accepting the invitation, and
 * the broker agreement (a documents row, type broker_agreement) the broker signs and an Admin countersigns.
 * Set-up is finished only once countersigned.
 */
export const brokerProfiles = pgTable('broker_profiles', {
  userId: uuid('user_id').primaryKey().references(() => users.id),
  /** bg = Bulgaria, eu = another EU country, other = outside the EU. */
  registeredIn: text('registered_in').$type<'bg' | 'eu' | 'other'>().notNull().default('bg'),
  companyName: text('company_name'),
  vatNumber: text('vat_number'),
  companyRegNumber: text('company_reg_number'),
  vatRegistered: boolean('vat_registered'),
  address: text('address'),
  city: text('city'),
  country: text('country').notNull().default('BG'),
  managerName: text('manager_name'),
  managerRole: text('manager_role'),
  payoutEmail: text('payout_email'),
  companyAt: ts('company_at'),
  bankName: text('bank_name'),
  iban: text('iban'),
  bic: text('bic'),
  accountHolder: text('account_holder'),
  bankAddress: text('bank_address'),
  currency: text('currency').notNull().default('EUR'),
  bankConfirmationDocumentId: uuid('bank_confirmation_document_id'),
  detailsAt: ts('details_at'),
  agreementDocumentId: uuid('agreement_document_id'),
  /** app = signed in the app with a typed e-signature; paper = signed by hand, scan uploaded. */
  signMethod: text('sign_method').$type<'app' | 'paper'>(),
  signedScanDocumentId: uuid('signed_scan_document_id'),
  signedAt: ts('signed_at'),
  signedName: text('signed_name'),
  signedIp: text('signed_ip'),
  countersignedAt: ts('countersigned_at'),
  countersignedById: uuid('countersigned_by_id'),
  countersignedName: text('countersigned_name'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  createdAt: createdAt(),
});

export const brokerNudges = pgTable('broker_nudges', {
  id: pk(),
  brokerId: uuid('broker_id').notNull().references(() => users.id),
  sentById: uuid('sent_by_id').notNull(),
  subject: text('subject').notNull(),
  message: text('message').notNull(),
  createdAt: createdAt(),
});

export const expenses = pgTable('expenses', {
  id: pk(),
  spentOn: date('spent_on').notNull(),
  category: text('category').notNull(),
  description: text('description').notNull(),
  netCents: integer('net_cents').notNull(),
  vatRate: numeric('vat_rate', { precision: 5, scale: 4, mode: 'number' }).notNull().default(0.2),
  totalCents: integer('total_cents').notNull(),
  paid: boolean('paid').notNull().default(true),
  eventId: uuid('event_id').references(() => events.id),
  receiptDocumentId: uuid('receipt_document_id'),
  createdById: uuid('created_by_id'),
  createdAt: createdAt(),
});

export const bankBalances = pgTable('bank_balances', {
  id: pk(),
  account: text('account').notNull(),
  balanceOn: date('balance_on').notNull(),
  balanceCents: integer('balance_cents').notNull(),
  recordedById: uuid('recorded_by_id').notNull(),
  createdAt: createdAt(),
});

// ---------- System ----------

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  updatedById: uuid('updated_by_id'),
});

/** Append-only: a trigger in the migration rejects UPDATE and DELETE. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: pk(),
    at: ts('at').notNull().defaultNow(),
    actorId: uuid('actor_id'),
    actorName: text('actor_name'),
    category: text('category').notNull(),
    action: text('action').notNull(),
    recordType: text('record_type'),
    recordId: text('record_id'),
    recordLabel: text('record_label'),
    changes: jsonb('changes').$type<Record<string, { from: unknown; to: unknown }>>(),
    money: boolean('money').notNull().default(false),
    meta: jsonb('meta').$type<Record<string, unknown>>(),
  },
  (t) => [index('audit_at_idx').on(t.at), index('audit_category_idx').on(t.category)],
);

export const notifications = pgTable(
  'notifications',
  {
    id: pk(),
    userId: uuid('user_id').notNull().references(() => users.id),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    link: text('link'),
    // Values for the translated title/body of this kind (messages common.notify.<type>); title/body stay as the English fallback.
    data: jsonb('data').$type<Record<string, string | number>>(),
    readAt: ts('read_at'),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_user_idx').on(t.userId)],
);

export const emailLog = pgTable('email_log', {
  id: pk(),
  to: jsonb('to').$type<string[]>().notNull(),
  cc: jsonb('cc').$type<string[]>().notNull().default([]),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  kind: text('kind').notNull(),
  recordType: text('record_type'),
  recordId: text('record_id'),
  status: text('status').$type<'sent' | 'failed' | 'skipped'>().notNull(),
  error: text('error'),
  createdAt: createdAt(),
});

/** What was taken at an event, per recorded sale (FR-EVT-3): units and money excl. VAT. */
export const eventSales = pgTable(
  'event_sales',
  {
    id: pk(),
    eventId: uuid('event_id').notNull().references(() => events.id),
    brokerId: uuid('broker_id').notNull().references(() => users.id),
    units: integer('units').notNull(),
    netCents: integer('net_cents').notNull(),
    recordedById: uuid('recorded_by_id'),
    createdAt: createdAt(),
  },
  (t) => [index('event_sales_event_idx').on(t.eventId)],
);

// ---------- Relations ----------

export const usersRelations = relations(users, ({ one }) => ({ role: one(roles, { fields: [users.roleId], references: [roles.id] }) }));
export const customersRelations = relations(customers, ({ one, many }) => ({
  broker: one(users, { fields: [customers.brokerId], references: [users.id] }),
  orders: many(orders),
  contacts: many(customerContacts),
}));
export const customerContactsRelations = relations(customerContacts, ({ one }) => ({ customer: one(customers, { fields: [customerContacts.customerId], references: [customers.id] }) }));
export const ordersRelations = relations(orders, ({ one, many }) => ({
  customer: one(customers, { fields: [orders.customerId], references: [customers.id] }),
  broker: one(users, { fields: [orders.brokerId], references: [users.id] }),
  event: one(events, { fields: [orders.eventId], references: [events.id] }),
  lines: many(orderLines),
  payments: many(payments),
  documents: many(documents),
}));
export const orderLinesRelations = relations(orderLines, ({ one }) => ({ order: one(orders, { fields: [orderLines.orderId], references: [orders.id] }) }));
export const paymentsRelations = relations(payments, ({ one }) => ({ order: one(orders, { fields: [payments.orderId], references: [orders.id] }) }));
export const documentsRelations = relations(documents, ({ one }) => ({ order: one(orders, { fields: [documents.orderId], references: [orders.id] }) }));
export const approvalRequestsRelations = relations(approvalRequests, ({ one }) => ({
  customer: one(customers, { fields: [approvalRequests.customerId], references: [customers.id] }),
  order: one(orders, { fields: [approvalRequests.orderId], references: [orders.id] }),
  requestedBy: one(users, { fields: [approvalRequests.requestedById], references: [users.id] }),
}));
export const suppliersRelations = relations(suppliers, ({ many }) => ({ purchases: many(purchases) }));
export const purchasesRelations = relations(purchases, ({ one, many }) => ({
  supplier: one(suppliers, { fields: [purchases.supplierId], references: [suppliers.id] }),
  lines: many(purchaseLines),
  shipments: many(shipments),
  payables: many(payables),
  messages: many(supplierMessages),
}));
export const purchaseLinesRelations = relations(purchaseLines, ({ one }) => ({ purchase: one(purchases, { fields: [purchaseLines.purchaseId], references: [purchases.id] }) }));
export const shipmentsRelations = relations(shipments, ({ one }) => ({ purchase: one(purchases, { fields: [shipments.purchaseId], references: [purchases.id] }) }));
export const payablesRelations = relations(payables, ({ one, many }) => ({
  purchase: one(purchases, { fields: [payables.purchaseId], references: [purchases.id] }),
  supplier: one(suppliers, { fields: [payables.supplierId], references: [suppliers.id] }),
  payments: many(payablePayments),
}));
export const payablePaymentsRelations = relations(payablePayments, ({ one }) => ({ payable: one(payables, { fields: [payablePayments.payableId], references: [payables.id] }) }));
export const supplierMessagesRelations = relations(supplierMessages, ({ one }) => ({ purchase: one(purchases, { fields: [supplierMessages.purchaseId], references: [purchases.id] }) }));
export const commissionEntriesRelations = relations(commissionEntries, ({ one }) => ({
  broker: one(users, { fields: [commissionEntries.brokerId], references: [users.id] }),
  order: one(orders, { fields: [commissionEntries.orderId], references: [orders.id] }),
}));


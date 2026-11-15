import type { ColumnPickerOptions } from './layout';

/**
 * Column picker defaults per table (design system README, Breakpoints and layout › Tables). Product
 * decision: Royi or another admin can change them; update this file (and the README table) when they do.
 * `locked` always shown · `defaults` shown by default at 768–1023 · every other column starts hidden.
 * Use it as `<Table picker={TABLE_PICKERS.dealProfitDeals} … />` and give your columns these `key`s
 * (a key that your table doesn't have is ignored). At 1024 and up all columns show.
 */
export const TABLE_PICKERS = {
  dealProfitDeals: { id: 'deal-profit-deals', locked: ['deal', 'profit'], defaults: ['broker', 'paidOn', 'units', 'net'], priority: ['broker', 'paidOn', 'units', 'net', 'cost', 'commission'] },
  dealProfitBrokers: { id: 'deal-profit-brokers', locked: ['broker', 'profit'], defaults: ['net', 'margin', 'deals', 'commission'], priority: ['net', 'margin', 'deals', 'commission', 'units', 'customers'] },
  dealProfitFlavours: { id: 'deal-profit-flavours', locked: ['flavour', 'profit'], defaults: ['net', 'share', 'units', 'margin'], priority: ['net', 'share', 'units', 'margin', 'cost', 'commission'] },
  monthlyPnl: { id: 'monthly-pnl', locked: ['month', 'operating'], defaults: ['net', 'dealProfit', 'expenses'], priority: ['net', 'dealProfit', 'expenses', 'cost', 'commission'] },
  salesOrders: { id: 'sales', locked: ['customer', 'status', 'go'], defaults: ['total', 'broker'], priority: ['total', 'broker', 'created'] },
  brokerOrders: { id: 'broker-orders', locked: ['customer', 'status', 'go'], defaults: ['ordered', 'total'], priority: ['ordered', 'total', 'units'] },
  collections: { id: 'collections', locked: ['customer', 'amount', 'actions'], defaults: ['when'], priority: ['when', 'broker'] },
  auditLog: { id: 'audit', locked: ['when', 'who', 'what', 'area', 'detail'], defaults: [], priority: [] },
} satisfies Record<string, ColumnPickerOptions>;

export type TablePickerKey = keyof typeof TABLE_PICKERS;

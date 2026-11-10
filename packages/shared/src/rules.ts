// Business rules editable in Settings by the System admin (FR-ADM-3). Changes apply from the save date.
import {
  MIN_ORDER_CARTONS,
  OWNERSHIP_MONTHS,
  OWNERSHIP_WARNING_DAYS,
  PROFORMA_VALIDITY_DAYS,
  STOCK_HOLD_DAYS,
  COMMISSION_PER_UNIT_CENTS,
} from './domain';

export interface BusinessRules {
  minOrderCartons: number;
  stockHoldDays: number;
  proformaValidityDays: number;
  commissionPerUnitCents: number;
  ownership: { months: number; countedFrom: 'each_order' | 'first_order'; warningDays: number; atEnd: 'free_to_claim' | 'stay_with_agent' };
  paymentBeforeShippingPercent: number;
  supplierFollowUpDays: number;
}

export const DEFAULT_RULES: BusinessRules = {
  minOrderCartons: MIN_ORDER_CARTONS,
  stockHoldDays: STOCK_HOLD_DAYS,
  proformaValidityDays: PROFORMA_VALIDITY_DAYS,
  commissionPerUnitCents: COMMISSION_PER_UNIT_CENTS,
  ownership: { months: OWNERSHIP_MONTHS, countedFrom: 'each_order', warningDays: OWNERSHIP_WARNING_DAYS, atEnd: 'free_to_claim' },
  paymentBeforeShippingPercent: 100,
  supplierFollowUpDays: 3,
};

export interface CompanyProfile {
  name: string;
  legalName: string;
  vatNumber: string;
  address: string;
  city: string;
  country: string;
  email: string;
  phone: string;
}

export interface BankSettings {
  bank: string;
  iban: string;
  bic: string;
  accounts: string[];
}

export interface EmailSettings {
  warehouse: string;
  accounting: string;
  sender: string;
  replyTo: string;
  copyAgent: boolean;
}

export interface DocumentSettings {
  languages: Array<'en' | 'bg'>;
  proformaValidityDays: number;
  logoUrl: string | null;
}

export interface SecuritySettings {
  desktopSessionHours: number;
  phoneSessionDays: number;
  inviteValidityDays: number;
  passwordMinLength: number;
}

export const DEFAULT_SECURITY: SecuritySettings = { desktopSessionHours: 8, phoneSessionDays: 30, inviteValidityDays: 7, passwordMinLength: 10 };

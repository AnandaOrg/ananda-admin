// Request bodies of the Purchasing module that extend the shared schemas.
import { BadRequestException, PipeTransform } from '@nestjs/common';
import { z, type ZodType } from 'zod';
import { freightSchema, receivePurchaseSchema, shipmentSchema, supplierSchema } from '@ananda/shared';
import { ZodPipe } from '../common/zod.pipe';

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const supplierBodySchema = supplierSchema.extend({ status: z.enum(['approved', 'pending', 'inactive']).default('approved') });
export type SupplierBody = z.infer<typeof supplierBodySchema>;

/** FR-PUR-7: units counted per flavour, optional supplier invoice and optional carrier invoice. */
export const receiveBodySchema = receivePurchaseSchema.extend({
  /** Amount on the supplier invoice excl. VAT, when it differs from the ordered goods. */
  invoiceNetCents: z.number().int().min(0).optional(),
  freight: freightSchema.optional(),
});
export type ReceiveBody = z.infer<typeof receiveBodySchema>;

export const supplierInvoiceSchema = z.object({
  invoiceNumber: z.string().trim().min(1).max(80),
  dueOn: isoDay,
  netCents: z.number().int().min(0).optional(),
});
export type SupplierInvoiceBody = z.infer<typeof supplierInvoiceSchema>;

export const onTheWaySchema = z.object({
  expectedOn: isoDay.optional(),
  shipment: shipmentSchema.optional(),
});
export type OnTheWayBody = z.infer<typeof onTheWaySchema>;

export const uploadSchema = z.object({ label: z.string().trim().min(1).max(120).optional() });

/**
 * Validates a body that arrives either as JSON or as multipart with the JSON in a `data` field
 * (forms that carry an optional upload).
 */
export class JsonBodyPipe<T> implements PipeTransform {
  private readonly zod: ZodPipe<T>;
  constructor(schema: ZodType<T>) {
    this.zod = new ZodPipe(schema);
  }

  transform(value: unknown): T {
    let body = value;
    if (value && typeof value === 'object' && typeof (value as { data?: unknown }).data === 'string') {
      try {
        body = JSON.parse((value as { data: string }).data);
      } catch {
        throw new BadRequestException({ message: 'Check the highlighted fields', fields: { _: 'The form could not be read. Try again.' } });
      }
    }
    return this.zod.transform(body ?? {});
  }
}

export type UploadedFile = { buffer: Buffer; originalname: string; mimetype: string; size: number };

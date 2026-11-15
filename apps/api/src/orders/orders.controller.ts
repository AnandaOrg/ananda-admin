import { Body, Controller, Delete, ForbiddenException, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';
import {
  cancelOrderSchema,
  confirmPaymentSchema,
  correctionSchema,
  creditNoteSchema,
  orderDraftSchema,
  partDeliveryOutcomeSchema,
  specialPriceSchema,
} from '@ananda/shared';
import { Access, Auth, Sensitive, type AuthContext } from '../common/context';
import { ZodPipe } from '../common/zod.pipe';
import { euros, sendCsv } from '../common/csv';
import { MAX_UPLOAD_BYTES } from '../core/files.service';
import { OrdersService, type OrderListQuery } from './orders.service';

const uploadBodySchema = z.object({ kind: z.string().trim().min(1).max(40), description: z.string().trim().max(200).optional() });

const uuid = new ParseUUIDPipe();

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Access('view', 'sales')
  @Get()
  list(@Auth() auth: AuthContext, @Query() q: OrderListQuery, @Headers('x-as-of') asOf?: string) {
    // Looking back (header "As of"): only orders that existed on that day.
    const day = asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : undefined;
    return this.orders.list(auth, day && (!q.to || q.to > day) ? { ...q, to: day } : q);
  }

  @Access('view', 'sales')
  @Get('export.csv')
  async export(@Auth() auth: AuthContext, @Query() q: OrderListQuery, @Res() res: Response) {
    const { items } = await this.orders.list(auth, q);
    sendCsv(
      res,
      'orders.csv',
      ['Order', 'Customer', 'Broker', 'Created', 'Cartons', 'Units', 'Total incl. VAT', 'Paid', 'Status', 'Days late'],
      items.map((o) => [o.number, o.customerName, o.houseSale ? 'No broker' : o.brokerName, o.createdAt.toISOString().slice(0, 10), o.totalCartons, o.totalUnits, euros(o.totalCents), euros(o.paidCents), o.status, o.daysLate]),
    );
  }

  @Access('view', 'sales', 'warehouse')
  @Get(':id')
  detail(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.orders.detail(auth, id);
  }

  @Access('edit', 'sales')
  @Post()
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(orderDraftSchema)) body: z.infer<typeof orderDraftSchema>) {
    return this.orders.createDraft(auth, body);
  }

  @Access('edit', 'sales')
  @Patch(':id')
  update(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(orderDraftSchema)) body: z.infer<typeof orderDraftSchema>) {
    return this.orders.updateDraft(auth, id, body);
  }

  @Access('edit', 'sales')
  @Delete(':id')
  remove(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.orders.deleteDraft(auth, id);
  }

  @Access('edit', 'sales')
  @Post(':id/send')
  @HttpCode(200)
  send(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.orders.sendPaymentRequest(auth, id);
  }

  @Access('edit', 'sales')
  @Post(':id/special-price')
  specialPrice(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(specialPriceSchema)) body: z.infer<typeof specialPriceSchema>) {
    return this.orders.requestSpecialPrice(auth, id, body.unitPriceCents, body.reason);
  }

  @Sensitive('confirm_payment')
  @Post(':id/confirm-payment')
  @HttpCode(200)
  confirmPayment(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(confirmPaymentSchema)) body: z.infer<typeof confirmPaymentSchema>) {
    return this.orders.confirmPayment(auth, id, body);
  }

  @Access('edit', 'warehouse', 'sales')
  @Post(':id/send-to-warehouse')
  @HttpCode(200)
  sendToWarehouse(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    if (auth.perms.scope !== 'all') throw new ForbiddenException({ message: 'Only an admin can send orders to the warehouse' });
    return this.orders.sendToWarehouse(auth, id);
  }

  @Access('edit', 'sales')
  @Post(':id/part-outcome')
  @HttpCode(200)
  partOutcome(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(partDeliveryOutcomeSchema)) body: z.infer<typeof partDeliveryOutcomeSchema>) {
    return this.orders.partOutcome(auth, id, body.outcome, body.note);
  }

  @Sensitive('issue_invoices')
  @Post('invoice-all')
  @HttpCode(200)
  invoiceAll(@Auth() auth: AuthContext) {
    return this.orders.issueAllPaid(auth);
  }

  @Sensitive('issue_invoices')
  @Post(':id/invoice')
  @HttpCode(200)
  invoice(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.orders.issueInvoice(auth, id);
  }

  @Sensitive('issue_invoices')
  @Post(':id/credit-note')
  @HttpCode(200)
  creditNote(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(creditNoteSchema)) body: z.infer<typeof creditNoteSchema>) {
    return this.orders.creditNote(auth, id, body);
  }

  @Access('edit', 'sales')
  @Post(':id/correction')
  correction(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(correctionSchema)) body: z.infer<typeof correctionSchema>) {
    return this.orders.requestCorrection(auth, id, body.cartons, body.reason);
  }

  @Access('edit', 'sales')
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(cancelOrderSchema)) body: z.infer<typeof cancelOrderSchema>) {
    return this.orders.cancel(auth, id, body.reason, body.note);
  }

  @Access('edit', 'sales')
  @Post(':id/uncancel')
  @HttpCode(200)
  uncancel(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.orders.uncancel(auth, id);
  }

  /** A broker's upload on their own order (multipart: file, kind, description). Admins are told. */
  @Access('edit', 'sales')
  @Post(':id/uploads')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  upload(
    @Auth() auth: AuthContext,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(uploadBodySchema)) body: z.infer<typeof uploadBodySchema>,
    @UploadedFile() file?: { buffer: Buffer; originalname: string; mimetype: string; size: number },
  ) {
    return this.orders.upload(auth, id, file, body);
  }
}

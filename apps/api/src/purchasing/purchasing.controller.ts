import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res, UploadedFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor, FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';
import { freightSchema, payablePaymentSchema, purchaseSchema, supplierMessageSchema } from '@ananda/shared';
import { Access, Auth, Sensitive, type AuthContext } from '../common/context';
import { ZodPipe } from '../common/zod.pipe';
import { euros, sendCsv } from '../common/csv';
import { MAX_UPLOAD_BYTES } from '../core/files.service';
import {
  JsonBodyPipe,
  onTheWaySchema,
  receiveBodySchema,
  supplierBodySchema,
  supplierInvoiceSchema,
  uploadSchema,
  type OnTheWayBody,
  type ReceiveBody,
  type SupplierBody,
  type SupplierInvoiceBody,
  type UploadedFile as Upload,
} from './purchasing.schemas';
import { PurchasesService } from './purchases.service';
import { SuppliersService } from './suppliers.service';
import { PayablesService } from './payables.service';

const uuid = new ParseUUIDPipe();
const limits = { limits: { fileSize: MAX_UPLOAD_BYTES } };

@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Access('view', 'purchasing')
  @Get()
  list() {
    return this.suppliers.list();
  }

  @Access('view', 'purchasing')
  @Get(':id')
  get(@Param('id', uuid) id: string) {
    return this.suppliers.get(id);
  }

  @Access('edit', 'purchasing')
  @Post()
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(supplierBodySchema)) body: SupplierBody) {
    return this.suppliers.create(auth, body);
  }

  @Access('edit', 'purchasing')
  @Patch(':id')
  update(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(supplierBodySchema)) body: SupplierBody) {
    return this.suppliers.update(auth, id, body);
  }
}

@Controller('purchases')
export class PurchasesController {
  constructor(
    private readonly purchases: PurchasesService,
    private readonly payables: PayablesService,
  ) {}

  /** FR-PUR-5. Declared before ':id'. */
  @Access('view', 'purchasing')
  @Get('shipments')
  shipments(@Query() q: { filter?: string }) {
    return this.payables.shipments(q);
  }

  @Access('view', 'purchasing')
  @Get()
  list(@Query() q: { filter?: string; q?: string }) {
    return this.purchases.list(q);
  }

  @Access('view', 'purchasing')
  @Get('export.csv')
  async export(@Query() q: { filter?: string; q?: string }, @Res() res: Response) {
    const { items } = await this.purchases.list(q);
    sendCsv(
      res,
      'purchases.csv',
      ['Purchase', 'Supplier', 'Ordered', 'Expected', 'Arrived', 'Cartons', 'Units', 'Units received', 'Still to pay', 'Status', 'Days late'],
      items.map((p) => [p.number, p.supplierName, p.orderedOn, p.expectedOn, p.arrivedOn, p.totalCartons, p.totalUnits, p.unitsReceived, euros(p.stillToPayCents), p.status, p.daysLate]),
    );
  }

  @Access('view', 'purchasing')
  @Get(':id')
  detail(@Param('id', uuid) id: string) {
    return this.purchases.detail(id);
  }

  @Access('view', 'purchasing')
  @Get(':id/order')
  async order(@Param('id', uuid) id: string, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(await this.purchases.orderHtml(id));
  }

  @Access('edit', 'purchasing')
  @Post()
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(purchaseSchema)) body: z.infer<typeof purchaseSchema>) {
    return this.purchases.create(auth, body);
  }

  @Access('edit', 'purchasing')
  @Post(':id/on-the-way')
  @HttpCode(200)
  onTheWay(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(onTheWaySchema)) body: OnTheWayBody) {
    return this.purchases.markOnTheWay(auth, id, body);
  }

  /** Multipart: `data` (JSON) plus optional `supplierInvoice` and `carrierInvoice` files. */
  @Access('edit', 'purchasing')
  @Post(':id/receive')
  @HttpCode(200)
  @UseInterceptors(FileFieldsInterceptor([{ name: 'supplierInvoice', maxCount: 1 }, { name: 'carrierInvoice', maxCount: 1 }], limits))
  receive(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new JsonBodyPipe(receiveBodySchema)) body: ReceiveBody, @UploadedFiles() files: { supplierInvoice?: Upload[]; carrierInvoice?: Upload[] } = {}) {
    return this.purchases.receive(auth, id, body, { supplierInvoice: files?.supplierInvoice?.[0], carrierInvoice: files?.carrierInvoice?.[0] });
  }

  @Access('edit', 'purchasing')
  @Post(':id/invoice')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', limits))
  invoice(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new JsonBodyPipe(supplierInvoiceSchema)) body: SupplierInvoiceBody, @UploadedFile() file?: Upload) {
    return this.purchases.recordInvoice(auth, id, body, file);
  }

  @Access('edit', 'purchasing')
  @Post(':id/freight')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', limits))
  freight(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new JsonBodyPipe(freightSchema)) body: z.infer<typeof freightSchema>, @UploadedFile() file?: Upload) {
    return this.purchases.saveFreight(auth, id, body, file);
  }

  @Access('edit', 'purchasing')
  @Post(':id/messages')
  ask(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(supplierMessageSchema)) body: z.infer<typeof supplierMessageSchema>) {
    return this.purchases.askSupplier(auth, id, body);
  }

  @Access('edit', 'purchasing')
  @Post(':id/messages/:messageId/resolve')
  @HttpCode(200)
  resolve(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Param('messageId', uuid) messageId: string) {
    return this.purchases.resolveMessage(auth, id, messageId);
  }

  @Access('edit', 'purchasing')
  @Post(':id/documents')
  @UseInterceptors(FileInterceptor('file', limits))
  upload(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new JsonBodyPipe(uploadSchema)) body: z.infer<typeof uploadSchema>, @UploadedFile() file?: Upload) {
    return this.purchases.upload(auth, id, file, body.label);
  }
}

@Controller('payables')
export class PayablesController {
  constructor(private readonly payables: PayablesService) {}

  @Access('view', 'purchasing')
  @Get()
  list(@Query() q: { filter?: string; kind?: string }) {
    return this.payables.list(q);
  }

  @Access('view', 'purchasing')
  @Get('export.csv')
  async export(@Query() q: { filter?: string; kind?: string }, @Res() res: Response) {
    const { items } = await this.payables.list(q);
    sendCsv(
      res,
      'payables.csv',
      ['Due', 'Kind', 'Party', 'Purchase', 'Invoice', 'Excl. VAT', 'VAT rate', 'Amount', 'Paid', 'Still to pay'],
      items.map((p) => [p.dueOn, p.kind, p.party, p.purchaseNumber, p.invoiceNumber, euros(p.netCents), p.vatRate, euros(p.amountCents), euros(p.paidCents), euros(p.stillToPayCents)]),
    );
  }

  /** Bank accounts to pay from (Settings › Bank). Declared before ':id'. */
  @Access('view', 'purchasing')
  @Get('accounts')
  async accounts() {
    return { accounts: await this.payables.accounts() };
  }

  @Access('view', 'purchasing')
  @Get(':id')
  detail(@Param('id', uuid) id: string) {
    return this.payables.detail(id);
  }

  /** Multipart: `data` (JSON) plus an optional `file` (proof). Needs a fresh two-step code. */
  @Access('edit', 'purchasing')
  @Sensitive('record_supplier_payment')
  @Post(':id/payments')
  @UseInterceptors(FileInterceptor('file', limits))
  pay(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new JsonBodyPipe(payablePaymentSchema)) body: z.infer<typeof payablePaymentSchema>, @UploadedFile() file?: Upload) {
    return this.payables.recordPayment(auth, id, body, file);
  }
}

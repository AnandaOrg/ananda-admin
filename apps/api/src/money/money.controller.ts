import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { bankBalanceSchema, expenseSchema, type ExpenseInput } from '@ananda/shared';
import { z } from 'zod';
import { Access, Auth, type AuthContext } from '../common/context';
import { ZodPipe } from '../common/zod.pipe';
import { euros, sendCsv } from '../common/csv';
import { MAX_UPLOAD_BYTES } from '../core/files.service';
import { MoneyService, type PeriodQuery } from './money.service';

const uuid = new ParseUUIDPipe();

/** Multipart fields arrive as strings; turn them into the JSON shape expenseSchema expects. */
function expenseFromForm(body: Record<string, unknown>): unknown {
  const num = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v);
  const bool = (v: unknown) => (v === 'true' ? true : v === 'false' ? false : v);
  return {
    ...body,
    amountNetCents: num(body.amountNetCents),
    vatRate: num(body.vatRate),
    paid: bool(body.paid),
    eventId: body.eventId === '' || body.eventId === 'null' ? null : body.eventId,
  };
}

@Controller('money')
export class MoneyController {
  constructor(private readonly money: MoneyService) {}

  @Access('view', 'deal_profit')
  @Get('deal-profit')
  dealProfit(@Query() q: PeriodQuery) {
    return this.money.dealProfit(q);
  }

  @Access('view', 'deal_profit')
  @Get('deal-profit/export.csv')
  async dealProfitCsv(@Query() q: PeriodQuery, @Res() res: Response) {
    const d = await this.money.dealProfit(q);
    sendCsv(
      res,
      'deal-profit.csv',
      ['Paid on', 'Order', 'Credit note', 'Customer', 'Agent', 'Units', 'Net sales', 'Purchase cost', 'Commission', 'Profit after commission'],
      d.deals.map((r) => [r.paidAt.slice(0, 10), r.number, r.documentNumber, r.customerName, r.agentName, r.units, euros(r.netCents), euros(r.purchaseCostCents), euros(r.commissionCents), euros(r.profitCents)]),
    );
  }

  @Access('view', 'pnl')
  @Get('pnl')
  pnl(@Query() q: PeriodQuery) {
    return this.money.pnl(q);
  }

  @Access('view', 'pnl')
  @Get('pnl/export.csv')
  async pnlCsv(@Query() q: PeriodQuery, @Res() res: Response) {
    const d = await this.money.pnl(q);
    sendCsv(
      res,
      'monthly-pnl.csv',
      ['Month', 'Net sales', 'Purchase cost', 'Commission', 'Deal profit', 'Expenses excl. VAT', 'Operating profit'],
      d.months.map((m) => [m.month.slice(0, 7), euros(m.netCents), euros(m.purchaseCostCents), euros(m.commissionCents), euros(m.dealProfitCents), euros(m.expensesCents), euros(m.operatingProfitCents)]),
    );
  }

  @Access('view', 'pnl', 'expenses')
  @Get('bank-balances')
  bankBalances() {
    return this.money.bankHistory();
  }

  @Access('edit', 'pnl', 'expenses')
  @Post('bank-balances')
  recordBalance(@Auth() auth: AuthContext, @Body(new ZodPipe(bankBalanceSchema)) body: z.infer<typeof bankBalanceSchema>) {
    return this.money.recordBalance(auth, body);
  }

  @Access('view', 'expenses')
  @Get('expenses')
  expenses(@Query() q: PeriodQuery & { category?: string; q?: string; status?: string }) {
    return this.money.listExpenses(q);
  }

  @Access('view', 'expenses')
  @Get('expenses/export.csv')
  async expensesCsv(@Query() q: PeriodQuery & { category?: string; q?: string; status?: string }, @Res() res: Response) {
    const { items } = await this.money.listExpenses(q);
    sendCsv(
      res,
      'expenses.csv',
      ['Date', 'Category', 'Description', 'Amount excl. VAT', 'VAT rate', 'Total incl. VAT', 'Paid', 'Receipt'],
      items.map((e) => [e.spentOn, e.category, e.description, euros(e.netCents), `${Math.round(Number(e.vatRate) * 100)}%`, euros(e.totalCents), e.paid ? 'Yes' : 'No', e.receiptDocumentId ? 'Yes' : 'No']),
    );
  }

  @Access('edit', 'expenses')
  @Post('expenses')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  createExpense(@Auth() auth: AuthContext, @Body() raw: Record<string, unknown>, @UploadedFile() file?: Express.Multer.File) {
    const input = new ZodPipe(expenseSchema).transform(expenseFromForm(raw ?? {})) as ExpenseInput;
    return this.money.createExpense(auth, input, file);
  }

  @Access('edit', 'expenses')
  @Post('expenses/:id/paid')
  @HttpCode(200)
  markPaid(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.money.markPaid(auth, id);
  }
}

import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { reminderSchema } from '@ananda/shared';
import { Access, Auth, type AuthContext } from '../common/context';
import { ZodPipe } from '../common/zod.pipe';
import { euros, sendCsv } from '../common/csv';
import { CollectionsService } from './collections.service';

const uuid = new ParseUUIDPipe();

@Controller('collections')
export class CollectionsController {
  constructor(private readonly collections: CollectionsService) {}

  @Access('view', 'collections')
  @Get()
  list(@Auth() auth: AuthContext, @Query() q: { filter?: string; agentId?: string }) {
    return this.collections.list(auth, q);
  }

  @Access('view', 'collections')
  @Get('export.csv')
  async export(@Auth() auth: AuthContext, @Query() q: { filter?: string; agentId?: string }, @Res() res: Response) {
    const { items } = await this.collections.list(auth, q);
    sendCsv(
      res,
      'collections.csv',
      ['Customer', 'Order', 'Agent', 'Due', 'Days late', 'Owed incl. VAT', 'Phone', 'E-mail', 'Last reminder'],
      items.map((r) => [r.customerName, r.number, r.agentName, r.paymentDueOn, r.daysLate, euros(r.outstandingCents), r.phone, r.email, r.lastReminderAt?.slice(0, 10)]),
    );
  }

  @Access('view', 'collections')
  @Get(':orderId/reminder')
  draft(@Auth() auth: AuthContext, @Param('orderId', uuid) orderId: string) {
    return this.collections.draft(auth, orderId);
  }

  // Agents (View on Collections) may also remind their own customers: "Get in touch › Remind".
  @Access('view', 'collections')
  @Post(':orderId/reminder')
  send(@Auth() auth: AuthContext, @Param('orderId', uuid) orderId: string, @Body(new ZodPipe(reminderSchema)) body: z.infer<typeof reminderSchema>) {
    return this.collections.send(auth, orderId, body.subject, body.message);
  }
}

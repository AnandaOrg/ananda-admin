import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { eventSchema, eventStockSchema } from '@ananda/shared';
import { Access, Auth, type AuthContext } from '../common/context';
import { ZodPipe } from '../common/zod.pipe';
import { EventsService } from './events.service';
import { eventSaleSchema, type EventSaleInput } from './events.schemas';

const uuid = new ParseUUIDPipe();

/** Events & festivals (PRD §5.9). Admins edit; Agents see the events they are invited to. */
@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Access('view', 'events')
  @Get()
  list(@Auth() auth: AuthContext) {
    return this.events.list(auth);
  }

  @Access('view', 'events')
  @Get(':id')
  detail(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.events.detail(auth, id);
  }

  @Access('edit', 'events')
  @Post()
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(eventSchema)) body: z.infer<typeof eventSchema>) {
    return this.events.create(auth, body);
  }

  @Access('edit', 'events')
  @Post(':id/stock')
  @HttpCode(200)
  stock(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(eventStockSchema)) body: z.infer<typeof eventStockSchema>) {
    return this.events.moveStock(auth, id, body.direction, body.cartons);
  }

  @Access('edit', 'events')
  @Post(':id/sales')
  @HttpCode(200)
  sale(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(eventSaleSchema)) body: EventSaleInput) {
    return this.events.recordSale(auth, id, body.agentId, body.cartons);
  }
}

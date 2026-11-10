import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { allocateSchema, stockAdjustmentSchema } from '@ananda/shared';
import { Access, Auth, type AuthContext } from '../common/context';
import { ZodPipe } from '../common/zod.pipe';
import { InventoryService } from './inventory.service';

const uuid = new ParseUUIDPipe();
const reconcileSchema = z.object({ note: z.string().trim().max(500).optional() });

/** Inventory (PRD §5.6): Admins edit, Finance views. */
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Access('view', 'inventory')
  @Get()
  overview() {
    return this.inventory.overview();
  }

  @Access('view', 'inventory')
  @Get('allocation')
  allocation() {
    return this.inventory.allocation();
  }

  @Access('edit', 'inventory')
  @Post('allocate')
  @HttpCode(200)
  allocate(@Auth() auth: AuthContext, @Body(new ZodPipe(allocateSchema)) body: z.infer<typeof allocateSchema>) {
    return this.inventory.allocate(auth, body.orderIds);
  }

  @Access('edit', 'inventory')
  @Post('adjustments')
  adjust(@Auth() auth: AuthContext, @Body(new ZodPipe(stockAdjustmentSchema)) body: z.infer<typeof stockAdjustmentSchema>) {
    return this.inventory.adjust(auth, body);
  }

  @Access('view', 'inventory')
  @Get('movements')
  movements(@Query() q: { flavour?: string; kind?: string; before?: string; limit?: string }) {
    return this.inventory.movements(q);
  }

  @Access('view', 'inventory')
  @Get('counts')
  counts() {
    return this.inventory.counts();
  }

  @Access('edit', 'inventory')
  @Post('counts/:id/reconcile')
  @HttpCode(200)
  reconcile(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(reconcileSchema)) body: z.infer<typeof reconcileSchema>) {
    return this.inventory.reconcile(auth, id, body.note);
  }
}

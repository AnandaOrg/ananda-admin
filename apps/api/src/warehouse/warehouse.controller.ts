import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { FLAVOURS, stockCountSchema } from '@ananda/shared';
import { Access, Auth, type AuthContext } from '../common/context';
import { ZodPipe } from '../common/zod.pipe';
import { MAX_UPLOAD_BYTES } from '../core/files.service';
import { WarehouseService } from './warehouse.service';

const uuid = new ParseUUIDPipe();
const upload = FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } });

/** Cartons delivered now, per flavour (the rest stays in To ship). */
const partDeliveredSchema = z.object({ delivered: z.object(Object.fromEntries(FLAVOURS.map((f) => [f, z.number().int().min(0).max(100_000).optional()])) as Record<(typeof FLAVOURS)[number], z.ZodOptional<z.ZodNumber>>) });

/** Multipart fields arrive as text: `delivered` is JSON ({ aloha: 10, … }). */
function parsePart(body: Record<string, unknown>) {
  let delivered: unknown = body.delivered;
  if (typeof delivered === 'string') {
    try {
      delivered = JSON.parse(delivered);
    } catch {
      throw new BadRequestException({ message: 'Check the highlighted fields', fields: { delivered: 'Enter the cartons you delivered now' } });
    }
  }
  return new ZodPipe(partDeliveredSchema).transform({ delivered });
}

/** Warehouse & shipments (PRD §5.7). Warehouse users edit within scope "shipping". */
@Controller('warehouse')
export class WarehouseController {
  constructor(private readonly warehouse: WarehouseService) {}

  @Access('view', 'warehouse')
  @Get()
  overview(@Auth() auth: AuthContext) {
    return this.warehouse.overview(auth);
  }

  @Access('view', 'warehouse')
  @Get('to-ship')
  toShip(@Auth() auth: AuthContext) {
    return this.warehouse.toShip(auth);
  }

  @Access('view', 'warehouse')
  @Get('delivered')
  delivered(@Auth() auth: AuthContext, @Query('period') period?: string) {
    return this.warehouse.delivered(auth, period);
  }

  @Access('view', 'warehouse')
  @Get('counts/last')
  lastCount(@Auth() auth: AuthContext) {
    return this.warehouse.lastCount(auth);
  }

  @Access('edit', 'warehouse')
  @Post('orders/:id/signed-note')
  @HttpCode(200)
  @UseInterceptors(upload)
  signedNote(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @UploadedFile() file?: Express.Multer.File) {
    return this.warehouse.signedNote(auth, id, file);
  }

  @Access('edit', 'warehouse')
  @Post('orders/:id/part-delivery')
  @HttpCode(200)
  @UseInterceptors(upload)
  partDelivery(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body() body: Record<string, unknown>, @UploadedFile() file?: Express.Multer.File) {
    return this.warehouse.partDelivery(auth, id, parsePart(body ?? {}), file);
  }

  @Access('edit', 'warehouse')
  @Post('counts')
  sendCount(@Auth() auth: AuthContext, @Body(new ZodPipe(stockCountSchema)) body: z.infer<typeof stockCountSchema>) {
    return this.warehouse.sendCount(auth, body.cartons);
  }
}

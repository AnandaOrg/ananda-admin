import { Controller, Get, Headers, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { Public } from '../common/context';
import { OrdersService } from '../orders/orders.service';
import { CustomersService } from '../customers/customers.service';

/**
 * Scheduled jobs for Vercel Cron (see vercel.json). Vercel sends `Authorization: Bearer $CRON_SECRET`.
 * Locally and in Docker the same jobs run on in-process timers instead.
 */
@Controller('cron')
export class CronController {
  constructor(
    private readonly orders: OrdersService,
    private readonly customers: CustomersService,
  ) {}

  private check(auth: string | undefined) {
    const secret = process.env.CRON_SECRET;
    const expected = Buffer.from(`Bearer ${secret ?? ''}`);
    const given = Buffer.from(auth ?? '');
    if (!secret || given.length !== expected.length || !timingSafeEqual(given, expected)) throw new UnauthorizedException();
  }

  /** A8 stock holds and A12 expired proformas. */
  @Public()
  @Get('orders')
  async ordersJob(@Headers('authorization') auth?: string) {
    this.check(auth);
    return { holdsReleased: await this.orders.releaseExpiredHolds(), proformasReminded: await this.orders.remindExpiredProformas() };
  }

  /** FR-CUST-5: warn agents before ownership ends. */
  @Public()
  @Get('ownership')
  async ownershipJob(@Headers('authorization') auth?: string) {
    this.check(auth);
    return { warned: await this.customers.warnExpiringOwnership() };
  }
}

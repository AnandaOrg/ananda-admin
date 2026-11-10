import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OrdersService } from './orders.service';

@Injectable()
export class OrdersScheduler {
  private readonly log = new Logger(OrdersScheduler.name);

  constructor(private readonly orders: OrdersService) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async run() {
    const released = await this.orders.releaseExpiredHolds();
    const reminded = await this.orders.remindExpiredProformas();
    if (released || reminded) this.log.log(`Released ${released} stock holds, reminded ${reminded} expired proformas`);
  }
}

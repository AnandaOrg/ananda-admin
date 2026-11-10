import { Global, Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrdersScheduler } from './orders.scheduler';

/** Global so Approvals, Inventory and Warehouse drive the order flow through one service. */
@Global()
@Module({ controllers: [OrdersController], providers: [OrdersService, OrdersScheduler], exports: [OrdersService] })
export class OrdersModule {}

import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { DbModule } from './db/db.module';
import { CoreModule } from './core/core.module';
import { AuthGuard } from './common/auth.guard';
import { PriceStripInterceptor } from './common/price-strip.interceptor';
import { RealtimeInterceptor } from './core/realtime.service';
import { AuthModule } from './auth/auth.module';
import { SystemModule } from './system/system.module';
import { HomeModule } from './home/home.module';
import { OrdersModule } from './orders/orders.module';
import { CustomersModule } from './customers/customers.module';
import { ApprovalsModule } from './approvals/approvals.module';
import { CollectionsModule } from './collections/collections.module';
import { DocumentsModule } from './documents/documents.module';
import { PurchasingModule } from './purchasing/purchasing.module';
import { InventoryModule } from './inventory/inventory.module';
import { WarehouseModule } from './warehouse/warehouse.module';
import { AgentsModule } from './agents/agents.module';
import { EventsModule } from './events/events.module';
import { MoneyModule } from './money/money.module';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    DbModule,
    CoreModule,
    AuthModule,
    SystemModule,
    HomeModule,
    OrdersModule,
    CustomersModule,
    ApprovalsModule,
    CollectionsModule,
    DocumentsModule,
    PurchasingModule,
    InventoryModule,
    WarehouseModule,
    AgentsModule,
    EventsModule,
    MoneyModule,
    AdminModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: RealtimeInterceptor },
    { provide: APP_INTERCEPTOR, useClass: PriceStripInterceptor },
  ],
})
export class AppModule {}

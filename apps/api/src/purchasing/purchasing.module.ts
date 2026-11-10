import { Module } from '@nestjs/common';
import { PayablesController, PurchasesController, SuppliersController } from './purchasing.controller';
import { PurchasesService } from './purchases.service';
import { SuppliersService } from './suppliers.service';
import { PayablesService } from './payables.service';

/** Purchasing (PRD §5.5): suppliers, purchases, receiving, freight, payables and shipments. */
@Module({
  controllers: [SuppliersController, PurchasesController, PayablesController],
  providers: [PurchasesService, SuppliersService, PayablesService],
  exports: [PurchasesService],
})
export class PurchasingModule {}

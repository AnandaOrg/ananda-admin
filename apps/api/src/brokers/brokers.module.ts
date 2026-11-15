import { Module } from '@nestjs/common';
import { BrokersController } from './brokers.controller';
import { BrokersService } from './brokers.service';
import { BrokerSetupService } from './setup.service';

@Module({ controllers: [BrokersController], providers: [BrokersService, BrokerSetupService] })
export class BrokersModule {}

import { Module } from '@nestjs/common';
import { MoneyController } from './money.controller';
import { MoneyService } from './money.service';

@Module({ controllers: [MoneyController], providers: [MoneyService], exports: [MoneyService] })
export class MoneyModule {}

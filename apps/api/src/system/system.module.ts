import { Module } from '@nestjs/common';
import { SystemController } from './system.controller';
import { CronController } from './cron.controller';

@Module({ controllers: [SystemController, CronController] })
export class SystemModule {}

import { Module } from '@nestjs/common';
import { SystemController } from './system.controller';
import { CronController } from './cron.controller';
import { LateAlertsService } from './late-alerts.service';

@Module({ controllers: [SystemController, CronController], providers: [LateAlertsService] })
export class SystemModule {}

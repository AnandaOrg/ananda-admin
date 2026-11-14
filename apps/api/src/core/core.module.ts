import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditService } from './audit.service';
import { NumberingService } from './numbering.service';
import { SettingsService } from './settings.service';
import { MailService } from './mail.service';
import { NotifyService } from './notify.service';
import { RealtimeService } from './realtime.service';
import { FilesService } from './files.service';
import { StockService } from './stock.service';
import { FiguresService } from './figures.service';
import { AiService } from './ai.service';
import { AsOfInterceptor } from './as-of';

const services = [AuditService, NumberingService, SettingsService, MailService, NotifyService, RealtimeService, FilesService, StockService, FiguresService, AiService];

@Global()
// AsOfInterceptor: figures as of a past day (x-as-of) and no writes while looking back.
@Module({ providers: [...services, { provide: APP_INTERCEPTOR, useClass: AsOfInterceptor }], exports: services })
export class CoreModule {}

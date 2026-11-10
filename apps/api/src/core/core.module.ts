import { Global, Module } from '@nestjs/common';
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

const services = [AuditService, NumberingService, SettingsService, MailService, NotifyService, RealtimeService, FilesService, StockService, FiguresService, AiService];

@Global()
@Module({ providers: services, exports: services })
export class CoreModule {}

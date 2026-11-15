import { Module } from '@nestjs/common';
import { AuditController, RolesController, SettingsController, UsersController } from './admin.controller';
import { UsersService } from './users.service';
import { RolesService } from './roles.service';
import { AuditLogService } from './audit-log.service';
import { AdminSettingsService } from './admin-settings.service';
import { ProfileController, SettingsCardsController } from './settings-cards.controller';

@Module({
  controllers: [UsersController, RolesController, AuditController, SettingsCardsController, SettingsController, ProfileController],
  providers: [UsersService, RolesService, AuditLogService, AdminSettingsService],
  exports: [UsersService],
})
export class AdminModule {}

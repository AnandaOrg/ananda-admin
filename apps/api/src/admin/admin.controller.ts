import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { roleSchema, settingSchema, updateMemberSchema } from '@ananda/shared';
import { Access, Auth, Sensitive, type AuthContext } from '../common/context';
import { ZodPipe } from '../common/zod.pipe';
import { sendCsv } from '../common/csv';
import { UsersService } from './users.service';
import { RolesService } from './roles.service';
import { AuditLogService, type AuditQuery } from './audit-log.service';
import { AdminSettingsService } from './admin-settings.service';
import { inviteMemberSchema, type InviteMemberInput } from './admin.schemas';

const uuid = new ParseUUIDPipe();

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Access('view', 'users')
  @Get()
  team() {
    return this.users.team();
  }

  @Access('view', 'users')
  @Get('invitations')
  invitations() {
    return this.users.invitations();
  }

  @Access('view', 'users')
  @Get('history')
  history() {
    return this.users.history();
  }

  /** Also used by Agents › Invite new agent: without users:edit only the 'agent' role is allowed (checked in the service). */
  @Access('edit', 'users', 'agents')
  @Post('invite')
  invite(@Auth() auth: AuthContext, @Body(new ZodPipe(inviteMemberSchema)) body: InviteMemberInput) {
    return this.users.invite(auth, body);
  }

  @Access('edit', 'users')
  @Post(':id/resend')
  @HttpCode(200)
  resend(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.users.resend(auth, id);
  }

  @Access('edit', 'users')
  @Post(':id/cancel-invite')
  @HttpCode(200)
  cancel(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.users.cancelInvite(auth, id);
  }

  @Access('edit', 'users')
  @Patch(':id')
  update(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(updateMemberSchema)) body: z.infer<typeof updateMemberSchema>) {
    return this.users.update(auth, id, body);
  }
}

@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Access('view', 'users')
  @Get()
  list() {
    return this.roles.list();
  }

  @Access('view', 'users')
  @Get(':id')
  detail(@Param('id', uuid) id: string) {
    return this.roles.detail(id);
  }

  @Access('edit', 'users')
  @Post(':id/duplicate')
  duplicate(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.roles.duplicate(auth, id);
  }

  @Access('edit', 'users')
  @Patch(':id')
  update(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(roleSchema)) body: z.infer<typeof roleSchema>) {
    return this.roles.update(auth, id, body);
  }

  @Access('edit', 'users')
  @Delete(':id')
  remove(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.roles.remove(auth, id);
  }
}

@Controller('audit')
export class AuditController {
  constructor(private readonly log: AuditLogService) {}

  @Access('view', 'audit')
  @Get()
  async list(@Query() q: AuditQuery) {
    const [page, counts] = await Promise.all([this.log.list(q), this.log.counts()]);
    return { ...page, counts };
  }

  @Access('view', 'audit')
  @Get('people')
  people() {
    return this.log.people();
  }

  @Access('view', 'audit')
  @Get('export.csv')
  async export(@Query() q: AuditQuery, @Res() res: Response) {
    const rows = await this.log.exportRows(q);
    const show = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
    sendCsv(
      res,
      'audit-log.csv',
      ['Time', 'Person', 'Category', 'Action', 'Record type', 'Record', 'Record ID', 'Money', 'Before → after', 'Details'],
      rows.map((r) => [
        r.at.toISOString(),
        r.actorName,
        r.category,
        r.action,
        r.recordType,
        r.recordLabel,
        r.recordId,
        r.money ? 'Yes' : 'No',
        r.changes ? Object.entries(r.changes).map(([k, c]) => `${k}: ${show(c.from)} → ${show(c.to)}`).join('; ') : '',
        r.meta ? JSON.stringify(r.meta) : '',
      ]),
    );
  }
}

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: AdminSettingsService) {}

  @Access('view', 'settings')
  @Get()
  get() {
    return this.settings.get();
  }

  /** Business rules: System admin only, with a fresh two-step code (x-two-step-code). */
  @Access('edit', 'settings')
  @Sensitive('change_rules')
  @Patch('rules/:rule')
  setRule(@Auth() auth: AuthContext, @Param('rule') rule: string, @Body(new ZodPipe(settingSchema)) body: { value: unknown }) {
    return this.settings.setRule(auth, rule, body.value);
  }

  @Access('edit', 'settings')
  @Patch(':key')
  set(@Auth() auth: AuthContext, @Param('key') key: string, @Body(new ZodPipe(settingSchema)) body: { value: unknown }) {
    return this.settings.setSetting(auth, key, body.value);
  }
}

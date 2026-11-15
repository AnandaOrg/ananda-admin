import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { settingSchema } from '@ananda/shared';
import { Access, Auth, type AuthContext } from '../common/context';
import { ZodPipe } from '../common/zod.pipe';
import { AdminSettingsService } from './admin-settings.service';

/** Settings cards (Documents, E-mail, Bank and sign-in), each saved from its side panel, and the logo on documents. */
@Controller('settings')
export class SettingsCardsController {
  constructor(private readonly settings: AdminSettingsService) {}

  /** The proforma validity and the IBAN need a fresh two-step code (x-two-step-code) when they change. */
  @Access('edit', 'settings')
  @Patch('cards/:card')
  saveCard(@Auth() auth: AuthContext, @Param('card') card: string, @Req() req: Request, @Body(new ZodPipe(settingSchema)) body: { value: unknown }) {
    return this.settings.saveCard(auth, card, body.value, req.header('x-two-step-code'));
  }

  @Access('view', 'settings')
  @Get('documents/logo')
  async logo(@Res() res: Response) {
    const l = await this.settings.logo();
    res.setHeader('Content-Type', l.mime);
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-cache');
    res.send(l.buffer);
  }

  @Access('edit', 'settings')
  @Post('documents/logo')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))
  uploadLogo(@Auth() auth: AuthContext, @UploadedFile() file?: { buffer: Buffer; originalname: string; mimetype: string; size: number }) {
    return this.settings.uploadLogo(auth, file);
  }

  @Access('edit', 'settings')
  @Delete('documents/logo')
  removeLogo(@Auth() auth: AuthContext) {
    return this.settings.removeLogo(auth);
  }
}

/** Profile & devices facts for the signed-in person (every role). */
@Controller('profile')
export class ProfileController {
  constructor(private readonly settings: AdminSettingsService) {}

  @Get()
  get(@Auth() auth: AuthContext) {
    return this.settings.profile(auth);
  }
}

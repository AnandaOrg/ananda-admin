import { Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MAX_UPLOAD_BYTES } from '../core/files.service';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { commissionPaySchema, nudgeSchema } from '@ananda/shared';
import { Access, Auth, Sensitive, type AuthContext } from '../common/context';
import { ZodPipe } from '../common/zod.pipe';
import { brokerFilter } from '../core/scope';
import { BrokersService } from './brokers.service';
import { BrokerSetupService } from './setup.service';
import { brokerInviteSchema, paperSignSchema, setupBankSchema, setupCompanySchema, setupDraftSchema, signSchema, type BrokerInviteInput, type SetupBankInput, type SetupCompanyInput, type SetupDraftInput, type SignInput } from './brokers.schemas';

type Upload = { buffer: Buffer; originalname: string; mimetype: string };
const limits = { limits: { fileSize: MAX_UPLOAD_BYTES } };

const payBodySchema = commissionPaySchema.extend({ note: z.string().trim().max(1000).optional() });

const uuid = new ParseUUIDPipe();

/** Brokers & commissions (PRD §5.8). Brokers only ever reach their own earnings. */
@Controller('brokers')
export class BrokersController {
  constructor(
    private readonly brokers: BrokersService,
    private readonly setup: BrokerSetupService,
  ) {}

  @Access('view', 'brokers')
  @Get()
  overview(@Auth() auth: AuthContext) {
    // Brokers never receive other brokers' figures (FR-AUTH-2).
    if (brokerFilter(auth)) throw new NotFoundException({ message: 'Not found' });
    return this.brokers.overview();
  }

  @Access('view', 'brokers')
  @Get('me/earnings')
  myEarnings(@Auth() auth: AuthContext) {
    return this.brokers.earnings(auth, auth.user.id);
  }

  // ---- Broker onboarding: details, signature, countersignature ----

  @Access('view', 'brokers')
  @Get('me/setup')
  mySetup(@Auth() auth: AuthContext) {
    return this.setup.get(auth, auth.user.id);
  }

  @Access('view', 'brokers')
  @Post('me/setup/company')
  @HttpCode(200)
  saveCompany(@Auth() auth: AuthContext, @Body(new ZodPipe(setupCompanySchema)) body: SetupCompanyInput) {
    return this.setup.saveCompany(auth, body);
  }

  @Access('view', 'brokers')
  @Post('me/setup/bank')
  @HttpCode(200)
  saveBank(@Auth() auth: AuthContext, @Body(new ZodPipe(setupBankSchema)) body: SetupBankInput) {
    return this.setup.saveBank(auth, body);
  }

  @Access('view', 'brokers')
  @Post('me/setup/draft')
  @HttpCode(200)
  saveDraft(@Auth() auth: AuthContext, @Body(new ZodPipe(setupDraftSchema)) body: SetupDraftInput) {
    return this.setup.saveDraft(auth, body);
  }

  @Access('view', 'brokers')
  @Post('me/setup/bank-confirmation')
  @UseInterceptors(FileInterceptor('file', limits))
  bankConfirmation(@Auth() auth: AuthContext, @UploadedFile() file?: Upload) {
    return this.setup.uploadBankConfirmation(auth, file);
  }

  @Access('view', 'brokers')
  @Post('me/setup/sign')
  @HttpCode(200)
  sign(@Auth() auth: AuthContext, @Body(new ZodPipe(signSchema)) body: SignInput, @Req() req: Request) {
    return this.setup.sign(auth, { method: 'app', name: body.name }, req.ip ?? null);
  }

  @Access('view', 'brokers')
  @Post('me/setup/sign-paper')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', limits))
  signPaper(@Auth() auth: AuthContext, @Body(new ZodPipe(paperSignSchema)) _body: unknown, @Req() req: Request, @UploadedFile() file?: Upload) {
    return this.setup.sign(auth, { method: 'paper', file }, req.ip ?? null);
  }

  @Access('view', 'brokers')
  @Get(':id/setup/files/:docId')
  async setupFile(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Param('docId', uuid) docId: string, @Res() res: Response) {
    const { doc, buffer } = await this.setup.file(auth, id, docId);
    res.setHeader('Content-Type', doc.mimeType ?? 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.fileName ?? 'file')}"`);
    res.send(buffer);
  }

  @Access('edit', 'brokers')
  @Post('invite')
  invite(@Auth() auth: AuthContext, @Body(new ZodPipe(brokerInviteSchema)) body: BrokerInviteInput) {
    if (brokerFilter(auth)) throw new NotFoundException({ message: 'Not found' });
    return this.brokers.invite(auth, body);
  }

  @Access('view', 'brokers')
  @Get(':id/setup')
  brokerSetup(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.setup.get(auth, id);
  }

  @Access('edit', 'brokers')
  @Post(':id/countersign')
  @HttpCode(200)
  countersign(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(signSchema)) body: SignInput) {
    return this.setup.countersign(auth, id, body);
  }

  @Access('view', 'brokers')
  @Get(':id/agreement')
  async agreement(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Res() res: Response) {
    const html = await this.setup.agreementPage(auth, id);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }

  @Access('view', 'brokers')
  @Get(':id')
  detail(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    if (brokerFilter(auth)) throw new NotFoundException({ message: 'Broker not found' });
    return this.brokers.detail(id);
  }

  @Access('view', 'brokers')
  @Get(':id/earnings')
  earnings(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.brokers.earnings(auth, id);
  }

  @Access('edit', 'brokers')
  @Post(':id/nudge')
  nudge(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(nudgeSchema)) body: z.infer<typeof nudgeSchema>) {
    if (brokerFilter(auth)) throw new NotFoundException({ message: 'Broker not found' });
    return this.brokers.nudge(auth, id, body);
  }

  @Access('edit', 'brokers')
  @Post(':id/email')
  @HttpCode(200)
  email(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(nudgeSchema)) body: z.infer<typeof nudgeSchema>) {
    if (brokerFilter(auth)) throw new NotFoundException({ message: 'Broker not found' });
    return this.brokers.email(auth, id, body);
  }

  @Access('view', 'brokers')
  @Sensitive('pay_commission')
  @Post(':id/send-to-pay')
  @HttpCode(200)
  sendToPay(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(payBodySchema)) body: z.infer<typeof payBodySchema>) {
    return this.brokers.sendToPay(auth, id, body.entryIds, body.note);
  }

  @Access('view', 'brokers')
  @Sensitive('pay_commission')
  @Post(':id/mark-paid')
  @HttpCode(200)
  markPaid(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(commissionPaySchema)) body: z.infer<typeof commissionPaySchema>) {
    return this.brokers.markPaid(auth, id, body.entryIds);
  }
}

import { Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MAX_UPLOAD_BYTES } from '../core/files.service';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { commissionPaySchema, nudgeSchema } from '@ananda/shared';
import { Access, Auth, Sensitive, type AuthContext } from '../common/context';
import { ZodPipe } from '../common/zod.pipe';
import { agentFilter } from '../core/scope';
import { AgentsService } from './agents.service';
import { AgentSetupService } from './setup.service';
import { agentInviteSchema, paperSignSchema, setupBankSchema, setupCompanySchema, setupDraftSchema, signSchema, type AgentInviteInput, type SetupBankInput, type SetupCompanyInput, type SetupDraftInput, type SignInput } from './agents.schemas';

type Upload = { buffer: Buffer; originalname: string; mimetype: string };
const limits = { limits: { fileSize: MAX_UPLOAD_BYTES } };

const payBodySchema = commissionPaySchema.extend({ note: z.string().trim().max(1000).optional() });

const uuid = new ParseUUIDPipe();

/** Agents & commissions (PRD §5.8). Agents only ever reach their own earnings. */
@Controller('agents')
export class AgentsController {
  constructor(
    private readonly agents: AgentsService,
    private readonly setup: AgentSetupService,
  ) {}

  @Access('view', 'agents')
  @Get()
  overview(@Auth() auth: AuthContext) {
    // Agents never receive other agents' figures (FR-AUTH-2).
    if (agentFilter(auth)) throw new NotFoundException({ message: 'Not found' });
    return this.agents.overview();
  }

  @Access('view', 'agents')
  @Get('me/earnings')
  myEarnings(@Auth() auth: AuthContext) {
    return this.agents.earnings(auth, auth.user.id);
  }

  // ---- Agent onboarding: details, signature, countersignature ----

  @Access('view', 'agents')
  @Get('me/setup')
  mySetup(@Auth() auth: AuthContext) {
    return this.setup.get(auth, auth.user.id);
  }

  @Access('view', 'agents')
  @Post('me/setup/company')
  @HttpCode(200)
  saveCompany(@Auth() auth: AuthContext, @Body(new ZodPipe(setupCompanySchema)) body: SetupCompanyInput) {
    return this.setup.saveCompany(auth, body);
  }

  @Access('view', 'agents')
  @Post('me/setup/bank')
  @HttpCode(200)
  saveBank(@Auth() auth: AuthContext, @Body(new ZodPipe(setupBankSchema)) body: SetupBankInput) {
    return this.setup.saveBank(auth, body);
  }

  @Access('view', 'agents')
  @Post('me/setup/draft')
  @HttpCode(200)
  saveDraft(@Auth() auth: AuthContext, @Body(new ZodPipe(setupDraftSchema)) body: SetupDraftInput) {
    return this.setup.saveDraft(auth, body);
  }

  @Access('view', 'agents')
  @Post('me/setup/bank-confirmation')
  @UseInterceptors(FileInterceptor('file', limits))
  bankConfirmation(@Auth() auth: AuthContext, @UploadedFile() file?: Upload) {
    return this.setup.uploadBankConfirmation(auth, file);
  }

  @Access('view', 'agents')
  @Post('me/setup/sign')
  @HttpCode(200)
  sign(@Auth() auth: AuthContext, @Body(new ZodPipe(signSchema)) body: SignInput, @Req() req: Request) {
    return this.setup.sign(auth, { method: 'app', name: body.name }, req.ip ?? null);
  }

  @Access('view', 'agents')
  @Post('me/setup/sign-paper')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', limits))
  signPaper(@Auth() auth: AuthContext, @Body(new ZodPipe(paperSignSchema)) _body: unknown, @Req() req: Request, @UploadedFile() file?: Upload) {
    return this.setup.sign(auth, { method: 'paper', file }, req.ip ?? null);
  }

  @Access('view', 'agents')
  @Get(':id/setup/files/:docId')
  async setupFile(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Param('docId', uuid) docId: string, @Res() res: Response) {
    const { doc, buffer } = await this.setup.file(auth, id, docId);
    res.setHeader('Content-Type', doc.mimeType ?? 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.fileName ?? 'file')}"`);
    res.send(buffer);
  }

  @Access('edit', 'agents')
  @Post('invite')
  invite(@Auth() auth: AuthContext, @Body(new ZodPipe(agentInviteSchema)) body: AgentInviteInput) {
    if (agentFilter(auth)) throw new NotFoundException({ message: 'Not found' });
    return this.agents.invite(auth, body);
  }

  @Access('view', 'agents')
  @Get(':id/setup')
  agentSetup(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.setup.get(auth, id);
  }

  @Access('edit', 'agents')
  @Post(':id/countersign')
  @HttpCode(200)
  countersign(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(signSchema)) body: SignInput) {
    return this.setup.countersign(auth, id, body);
  }

  @Access('view', 'agents')
  @Get(':id/agreement')
  async agreement(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Res() res: Response) {
    const html = await this.setup.agreementPage(auth, id);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }

  @Access('view', 'agents')
  @Get(':id')
  detail(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    if (agentFilter(auth)) throw new NotFoundException({ message: 'Agent not found' });
    return this.agents.detail(id);
  }

  @Access('view', 'agents')
  @Get(':id/earnings')
  earnings(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.agents.earnings(auth, id);
  }

  @Access('edit', 'agents')
  @Post(':id/nudge')
  nudge(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(nudgeSchema)) body: z.infer<typeof nudgeSchema>) {
    if (agentFilter(auth)) throw new NotFoundException({ message: 'Agent not found' });
    return this.agents.nudge(auth, id, body);
  }

  @Access('edit', 'agents')
  @Post(':id/email')
  @HttpCode(200)
  email(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(nudgeSchema)) body: z.infer<typeof nudgeSchema>) {
    if (agentFilter(auth)) throw new NotFoundException({ message: 'Agent not found' });
    return this.agents.email(auth, id, body);
  }

  @Access('view', 'agents')
  @Sensitive('pay_commission')
  @Post(':id/send-to-pay')
  @HttpCode(200)
  sendToPay(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(payBodySchema)) body: z.infer<typeof payBodySchema>) {
    return this.agents.sendToPay(auth, id, body.entryIds, body.note);
  }

  @Access('view', 'agents')
  @Sensitive('pay_commission')
  @Post(':id/mark-paid')
  @HttpCode(200)
  markPaid(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(commissionPaySchema)) body: z.infer<typeof commissionPaySchema>) {
    return this.agents.markPaid(auth, id, body.entryIds);
  }
}

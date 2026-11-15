import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { Auth, type AuthContext } from '../common/context';
import { ZodPipe } from '../common/zod.pipe';
import { DocumentsService } from './documents.service';

const uuid = new ParseUUIDPipe();
const emailSchema = z.object({ to: z.array(z.string().trim().max(200)).min(1).max(10), subject: z.string().trim().min(1).max(300), message: z.string().trim().min(1).max(5000) });

@Controller('documents')
export class DocumentsController {
  constructor(private readonly docs: DocumentsService) {}

  /** The logo printed on customer documents (Settings › Documents), for the document panel. */
  @Get('logo')
  async logo(@Res() res: Response) {
    const l = await this.docs.logo();
    res.setHeader('Content-Type', l.mime);
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(l.buffer);
  }

  @Get(':id')
  get(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.docs.get(auth, id);
  }

  @Get(':id/file')
  async file(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Res() res: Response) {
    const { doc, buffer } = await this.docs.file(auth, id);
    res.setHeader('Content-Type', doc.mimeType ?? 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.fileName ?? 'file')}"`);
    res.send(buffer);
  }

  /** The paper the app shows: the same spec that is printed and e-mailed. */
  @Get(':id/paper')
  paper(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.docs.paper(auth, id);
  }

  /** The document as a printable page; `?print=1` opens the print dialog (Download PDF). */
  @Get(':id/print')
  async print(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Query('print') print: string | undefined, @Res() res: Response) {
    const { html } = await this.docs.page(auth, id, print === '1');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }

  @Post(':id/email')
  @HttpCode(200)
  email(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(emailSchema)) body: z.infer<typeof emailSchema>) {
    return this.docs.email(auth, id, body);
  }
}

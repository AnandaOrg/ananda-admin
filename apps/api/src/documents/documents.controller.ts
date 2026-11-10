import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Auth, type AuthContext } from '../common/context';
import { DocumentsService } from './documents.service';

@Controller('documents')
export class DocumentsController {
  constructor(private readonly docs: DocumentsService) {}

  @Get(':id')
  get(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.docs.get(auth, id);
  }

  @Get(':id/file')
  async file(@Auth() auth: AuthContext, @Param('id') id: string, @Res() res: Response) {
    const { doc, buffer } = await this.docs.file(auth, id);
    res.setHeader('Content-Type', doc.mimeType ?? 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.fileName ?? 'file')}"`);
    res.send(buffer);
  }

  @Get(':id/print')
  async print(@Auth() auth: AuthContext, @Param('id') id: string, @Res() res: Response) {
    const doc = await this.docs.get(auth, id);
    if (doc.type !== 'proforma' && doc.type !== 'invoice' && doc.type !== 'credit_note') return res.status(404).send('Not printable');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(this.docs.renderHtml(doc.type, doc.data as never));
  }
}

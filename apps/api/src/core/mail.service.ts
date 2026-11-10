import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { InjectDb, type Db } from '../db/db.module';
import { emailLog } from '../db/schema';
import { SettingsService } from './settings.service';

export interface MailInput {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  kind: string;
  recordType?: string;
  recordId?: string;
  attachments?: { filename: string; content: string | Buffer; contentType?: string }[];
}

/** Sender is the company address; replies go to the System admin (PRD §8.2). Every send is logged. */
@Injectable()
export class MailService {
  private readonly log = new Logger(MailService.name);
  private readonly transport: Transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? 'localhost',
    port: Number(process.env.SMTP_PORT ?? 1026),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
  ) {}

  async send(input: MailInput) {
    const to = unique(input.to);
    const cc = unique(input.cc ?? []).filter((e) => !to.includes(e));
    if (to.length === 0) return;
    const email = await this.settings.get('email');
    let status: 'sent' | 'failed' | 'skipped' = 'sent';
    let error: string | undefined;
    if (process.env.SEEDING) {
      status = 'skipped';
      error = 'Demo data: not sent';
    } else try {
      await this.transport.sendMail({
        from: email.sender || process.env.MAIL_FROM || 'ANANDA <office@ananda.local>',
        replyTo: email.replyTo || undefined,
        to,
        cc,
        subject: input.subject,
        text: input.body,
        attachments: input.attachments,
      });
    } catch (e) {
      status = 'failed';
      error = (e as Error).message;
      this.log.warn(`Mail "${input.subject}" failed: ${error}`);
    }
    await this.db.insert(emailLog).values({ to, cc, subject: input.subject, body: input.body, kind: input.kind, recordType: input.recordType, recordId: input.recordId, status, error });
  }
}

function unique(list: (string | null | undefined)[]): string[] {
  return [...new Set(list.filter((e): e is string => !!e && e.includes('@')))];
}

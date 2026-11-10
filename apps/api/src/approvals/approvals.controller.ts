import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { decisionSchema } from '@ananda/shared';
import { Access, Auth, Sensitive, type AuthContext } from '../common/context';
import { ZodPipe } from '../common/zod.pipe';
import { ApprovalsService } from './approvals.service';

const uuid = new ParseUUIDPipe();

@Controller('approvals')
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @Sensitive('approve')
  @Get()
  pending() {
    return this.approvals.pending();
  }

  @Access('view', 'sales', 'customers')
  @Get('mine')
  mine(@Auth() auth: AuthContext) {
    return this.approvals.mine(auth);
  }

  @Sensitive('approve')
  @Get(':id')
  review(@Param('id', uuid) id: string) {
    return this.approvals.review(id);
  }

  @Sensitive('approve')
  @Post(':id/approve')
  @HttpCode(200)
  approve(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.approvals.approve(auth, id);
  }

  @Sensitive('approve')
  @Post(':id/decline')
  @HttpCode(200)
  decline(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(decisionSchema)) body: z.infer<typeof decisionSchema>) {
    return this.approvals.decline(auth, id, body.reason, body.message);
  }
}

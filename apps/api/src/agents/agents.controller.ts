import { Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { commissionPaySchema, nudgeSchema } from '@ananda/shared';
import { Access, Auth, Sensitive, type AuthContext } from '../common/context';
import { ZodPipe } from '../common/zod.pipe';
import { agentFilter } from '../core/scope';
import { AgentsService } from './agents.service';

const uuid = new ParseUUIDPipe();

/** Agents & commissions (PRD §5.8). Agents only ever reach their own earnings. */
@Controller('agents')
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

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

  @Access('view', 'agents')
  @Sensitive('pay_commission')
  @Post(':id/send-to-pay')
  @HttpCode(200)
  sendToPay(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(commissionPaySchema)) body: z.infer<typeof commissionPaySchema>) {
    return this.agents.sendToPay(auth, id, body.entryIds);
  }

  @Access('view', 'agents')
  @Sensitive('pay_commission')
  @Post(':id/mark-paid')
  @HttpCode(200)
  markPaid(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(commissionPaySchema)) body: z.infer<typeof commissionPaySchema>) {
    return this.agents.markPaid(auth, id, body.entryIds);
  }
}

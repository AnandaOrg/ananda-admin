import { Body, Controller, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { changeAgentSchema, customerSchema, vatCheckSchema } from '@ananda/shared';
import { Access, Auth, type AuthContext } from '../common/context';
import { ZodPipe } from '../common/zod.pipe';
import { CustomersService } from './customers.service';

const uuid = new ParseUUIDPipe();
const createSchema = customerSchema.extend({ agentId: z.string().uuid().optional() });
const contactSchema = z.object({ name: z.string().trim().min(1).max(200), role: z.string().max(100).optional(), phone: z.string().max(40).optional(), email: z.string().email().optional() });

@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Access('view', 'customers')
  @Get()
  list(@Auth() auth: AuthContext, @Query() q: { filter?: string; q?: string; agentId?: string }) {
    return this.customers.list(auth, q);
  }

  @Access('view', 'customers', 'sales', 'agents')
  @Get('agents')
  agents() {
    return this.customers.agents();
  }

  @Access('edit', 'customers')
  @Post('vat-check')
  @HttpCode(200)
  vatCheck(@Body(new ZodPipe(vatCheckSchema)) body: z.infer<typeof vatCheckSchema>) {
    return this.customers.vatCheck(body.country, body.vatNumber);
  }

  @Access('view', 'customers')
  @Get(':id')
  card(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.customers.card(auth, id);
  }

  @Access('edit', 'customers')
  @Post()
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(createSchema)) body: z.infer<typeof createSchema>) {
    return this.customers.create(auth, body);
  }

  @Access('edit', 'customers')
  @Patch(':id')
  update(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(customerSchema.partial())) body: Partial<z.infer<typeof customerSchema>>) {
    return this.customers.update(auth, id, body);
  }

  @Access('edit', 'customers')
  @Post(':id/claim')
  @HttpCode(200)
  claim(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.customers.claim(auth, id);
  }

  @Access('edit', 'customers')
  @Post(':id/change-agent')
  @HttpCode(200)
  changeAgent(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(changeAgentSchema)) body: z.infer<typeof changeAgentSchema>) {
    if (auth.perms.scope !== 'all') throw new ForbiddenException({ message: 'Only an admin can change the agent' });
    return this.customers.changeAgent(auth, id, body.agentId, body.reason, body.note);
  }

  @Access('edit', 'customers')
  @Post(':id/archive')
  @HttpCode(200)
  archive(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(z.object({ archived: z.boolean() }))) body: { archived: boolean }) {
    if (auth.perms.scope !== 'all') throw new ForbiddenException({ message: 'Only an admin can archive customers' });
    return this.customers.archive(auth, id, body.archived);
  }

  @Access('edit', 'customers')
  @Post(':id/contacts')
  addContact(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(contactSchema)) body: z.infer<typeof contactSchema>) {
    return this.customers.addContact(auth, id, body);
  }
}

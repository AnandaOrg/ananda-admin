import { Body, Controller, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Access, Auth, type AuthContext } from '../common/context';
import { ZodPipe } from '../common/zod.pipe';
import { CustomersService, PAYMENT_TERMS, type PaymentTerms } from './customers.service';

const uuid = new ParseUUIDPipe();
const opt = (max: number) => z.string().trim().max(max).optional();
const req = (max: number) => z.string().trim().min(1, 'Required').max(max);

/** One form for Admins and brokers: VAT number on top (optional), the rest below (FR-CUST-2). */
const formSchema = z.object({
  vatNumber: opt(20),
  country: z.string().trim().length(2).toUpperCase(),
  vatValid: z.boolean().nullable().optional(),
  companyName: req(200),
  registeredAddress: req(500),
  postcode: opt(20),
  city: req(120),
  deliveryAddress: opt(500),
  contactName: req(200),
  phone: opt(40),
  invoiceEmail: z.string().trim().email('That e-mail address looks incomplete.'),
  proformaLanguage: z.enum(['en', 'bg']).optional(),
  paymentTerms: z.enum(PAYMENT_TERMS as [PaymentTerms, ...PaymentTerms[]]).optional(),
  paymentTermsDays: z.number().int().min(0).max(120).optional(),
  note: opt(2000),
  submit: z.boolean().optional(),
  brokerId: z.union([z.literal('none'), z.string().uuid()]).optional(),
});
const vatCheckSchema = z.object({ vatNumber: req(20), country: z.string().trim().max(2).optional() });
const changeBrokerSchema = z.object({ brokerId: z.union([z.literal('none'), z.string().uuid()]), reason: req(60), note: opt(2000) });
const contactSchema = z.object({ name: z.string().trim().min(1).max(200), role: z.string().max(100).optional(), phone: z.string().max(40).optional(), email: z.string().email().optional() });

@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Access('view', 'customers')
  @Get()
  list(@Auth() auth: AuthContext, @Query() q: { filter?: string; q?: string; brokerId?: string }) {
    return this.customers.list(auth, q);
  }

  @Access('view', 'customers', 'sales', 'brokers')
  @Get('brokers')
  brokers() {
    return this.customers.brokers();
  }

  @Access('edit', 'customers')
  @Post('vat-check')
  @HttpCode(200)
  vatCheck(@Body(new ZodPipe(vatCheckSchema)) body: z.infer<typeof vatCheckSchema>) {
    return this.customers.vatCheck(body.vatNumber, body.country);
  }

  @Access('view', 'customers')
  @Get(':id')
  card(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.customers.card(auth, id);
  }

  @Access('edit', 'customers')
  @Post()
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(formSchema)) body: z.infer<typeof formSchema>) {
    return this.customers.create(auth, body);
  }

  @Access('edit', 'customers')
  @Patch(':id')
  update(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(formSchema.partial())) body: Partial<z.infer<typeof formSchema>>) {
    return this.customers.update(auth, id, body);
  }

  @Access('edit', 'customers')
  @Post(':id/claim')
  @HttpCode(200)
  claim(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.customers.claim(auth, id);
  }

  @Access('edit', 'customers')
  @Post(':id/change-broker')
  @HttpCode(200)
  changeBroker(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(changeBrokerSchema)) body: z.infer<typeof changeBrokerSchema>) {
    if (auth.perms.scope !== 'all') throw new ForbiddenException({ message: 'Only an admin can change the broker' });
    return this.customers.changeBroker(auth, id, body.brokerId === 'none' ? null : body.brokerId, body.reason, body.note);
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

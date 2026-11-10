import { Body, Controller, Get, HttpCode, MessageEvent, Param, Post, Query, Sse } from '@nestjs/common';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { filter, interval, map, merge, type Observable } from 'rxjs';
import { polishSchema } from '@ananda/shared';
import { z } from 'zod';
import { InjectDb, type Db } from '../db/db.module';
import { approvalRequests, notifications, orders } from '../db/schema';
import { Auth, type AuthContext } from '../common/context';
import { ZodPipe } from '../common/zod.pipe';
import { RealtimeService } from '../core/realtime.service';
import { AiService } from '../core/ai.service';

@Controller()
export class SystemController {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly realtime: RealtimeService,
    private readonly ai: AiService,
  ) {}

  /** Server-sent events: clients refetch the listed query keys. */
  @Sse('stream')
  stream(@Auth() auth: AuthContext): Observable<MessageEvent> {
    const events = this.realtime.events$.pipe(
      filter((e) => !e.userId || e.userId === auth.user.id),
      map((e) => ({ data: { topics: e.topics } })),
    );
    const heartbeat = interval(25_000).pipe(map(() => ({ data: { topics: [] } })));
    return merge(events, heartbeat);
  }

  @Get('notifications')
  async list(@Auth() auth: AuthContext, @Query('unread') unread?: string) {
    const rows = await this.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, auth.user.id), unread ? isNull(notifications.readAt) : undefined))
      .orderBy(desc(notifications.createdAt))
      .limit(50);
    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, auth.user.id), isNull(notifications.readAt)));
    return { items: rows, unread: count };
  }

  @Post('notifications/:id/read')
  @HttpCode(200)
  async read(@Auth() auth: AuthContext, @Param('id') id: string) {
    const cond = id === 'all' ? isNull(notifications.readAt) : eq(notifications.id, id);
    await this.db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, auth.user.id), cond));
    return { ok: true };
  }

  /** Counts for the navigation: Home shows what waits for this user's OK. */
  @Get('badges')
  async badges(@Auth() auth: AuthContext) {
    let home = 0;
    if (auth.perms.sensitive.includes('approve')) {
      const [r] = await this.db.select({ n: sql<number>`count(*)::int` }).from(approvalRequests).where(eq(approvalRequests.status, 'pending'));
      home += r.n;
    }
    if (auth.perms.sensitive.includes('confirm_payment')) {
      const [r] = await this.db.select({ n: sql<number>`count(*)::int` }).from(orders).where(eq(orders.status, 'payment_to_confirm'));
      home += r.n;
    }
    const [u] = await this.db.select({ n: sql<number>`count(*)::int` }).from(notifications).where(and(eq(notifications.userId, auth.user.id), isNull(notifications.readAt)));
    return { home, unread: u.n };
  }

  @Get('ai/status')
  aiStatus() {
    return { enabled: this.ai.enabled };
  }

  @Post('ai/polish')
  @HttpCode(200)
  async polish(@Body(new ZodPipe(polishSchema)) body: z.infer<typeof polishSchema>) {
    return { text: await this.ai.polish(body.text, body.tone, body.language) };
  }
}

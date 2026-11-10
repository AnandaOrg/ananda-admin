import { Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import type { SystemRole } from '@ananda/shared';
import { InjectDb, type Db, type DbOrTx } from '../db/db.module';
import { notifications, roles, users } from '../db/schema';
import { RealtimeService } from './realtime.service';

export interface NotificationInput {
  type: string;
  title: string;
  body?: string;
  link?: string;
}

/** In-app notifications inbox (header bell with unread count). */
@Injectable()
export class NotifyService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly realtime: RealtimeService,
  ) {}

  async toUsers(userIds: (string | null | undefined)[], n: NotificationInput, tx: DbOrTx = this.db) {
    const ids = [...new Set(userIds.filter((x): x is string => !!x))];
    if (!ids.length) return;
    await tx.insert(notifications).values(ids.map((userId) => ({ userId, ...n })));
    ids.forEach((id) => this.realtime.emit(['notifications'], id));
  }

  async toRoles(baseRoles: SystemRole[], n: NotificationInput, tx: DbOrTx = this.db) {
    const ids = await this.userIdsWithRoles(baseRoles, tx);
    await this.toUsers(ids, n, tx);
  }

  async userIdsWithRoles(baseRoles: SystemRole[], tx: DbOrTx = this.db): Promise<string[]> {
    const rows = await tx
      .select({ id: users.id })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(and(inArray(roles.baseRole, baseRoles), eq(users.status, 'active')));
    return rows.map((r) => r.id);
  }

  async emailsWithRoles(baseRoles: SystemRole[], tx: DbOrTx = this.db): Promise<string[]> {
    const rows = await tx
      .select({ email: users.email })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(and(inArray(roles.baseRole, baseRoles), eq(users.status, 'active')));
    return rows.map((r) => r.email);
  }
}

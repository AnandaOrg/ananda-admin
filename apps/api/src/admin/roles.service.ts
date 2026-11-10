import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';
import { AREAS, SENSITIVE_ACTIONS, type AreaMatrix, type SensitiveAction } from '@ananda/shared';
import { InjectDb, type Db } from '../db/db.module';
import { roles, users } from '../db/schema';
import { AuditService, diff } from '../core/audit.service';
import { randomToken } from '../core/crypto';
import type { AuthContext } from '../common/context';

/** Roles: five fixed system roles; custom roles are duplicates a System admin can edit (PRD §3). */
@Injectable()
export class RolesService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const rows = await this.db
      .select({
        id: roles.id,
        key: roles.key,
        name: roles.name,
        description: roles.description,
        baseRole: roles.baseRole,
        isSystem: roles.isSystem,
        scope: roles.scope,
        twoStepRequired: roles.twoStepRequired,
        areas: roles.areas,
        sensitive: roles.sensitive,
        members: sql<number>`(select count(*)::int from ${users} where ${users.roleId} = ${roles.id} and ${users.status} <> 'deactivated')`,
      })
      .from(roles)
      .orderBy(sql`${roles.isSystem} desc`, asc(roles.createdAt));
    return rows.map((r) => ({ ...r, members: Number(r.members) }));
  }

  async detail(id: string) {
    const [role] = await this.db.select().from(roles).where(eq(roles.id, id));
    if (!role) throw new NotFoundException({ message: 'Role not found' });
    const members = await this.db
      .select({ id: users.id, name: users.name, email: users.email, status: users.status, twoStepEnabled: users.totpEnabled, lastSignInAt: users.lastSignInAt })
      .from(users)
      .where(eq(users.roleId, id))
      .orderBy(asc(users.name));
    return { ...role, members };
  }

  async duplicate(auth: AuthContext, id: string) {
    return this.db.transaction(async (tx) => {
      const [src] = await tx.select().from(roles).where(eq(roles.id, id));
      if (!src) throw new NotFoundException({ message: 'Role not found' });
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(roles).where(sql`${roles.name} like ${src.name + ' (copy%'}`);
      const name = Number(n) ? `${src.name} (copy ${Number(n) + 1})` : `${src.name} (copy)`;
      const [role] = await tx
        .insert(roles)
        .values({ key: `custom_${randomToken(6).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`, name, description: src.description, baseRole: src.baseRole, isSystem: false, scope: src.scope, twoStepRequired: src.twoStepRequired, areas: src.areas, sensitive: src.sensitive })
        .returning();
      await this.audit.log(auth, { category: 'users_access', action: 'role_duplicated', recordType: 'role', recordId: role.id, recordLabel: role.name, meta: { from: src.name, fromId: src.id } }, tx);
      return { id: role.id };
    });
  }

  async update(auth: AuthContext, id: string, input: { name: string; description?: string; areas: Partial<AreaMatrix>; sensitive: SensitiveAction[] }) {
    return this.db.transaction(async (tx) => {
      const [role] = await tx.select().from(roles).where(eq(roles.id, id)).for('update');
      if (!role) throw new NotFoundException({ message: 'Role not found' });
      if (role.isSystem) throw new ForbiddenException({ message: 'System roles cannot be changed. Duplicate it as a custom role instead.' });
      const areas = Object.fromEntries(AREAS.map((a) => [a, input.areas[a] ?? 'hidden'])) as AreaMatrix;
      const sensitive = SENSITIVE_ACTIONS.filter((s) => input.sensitive.includes(s));
      // Warehouse-based roles never see prices (FR-AUTH-3); only System admin roles change business rules.
      if (role.baseRole === 'warehouse' && sensitive.includes('see_prices')) throw new BadRequestException({ message: 'Warehouse roles never see prices', fields: { sensitive: 'Warehouse roles never see prices' } });
      if (role.baseRole !== 'system_admin' && sensitive.includes('change_rules')) throw new BadRequestException({ message: 'Only System admin roles can change business rules', fields: { sensitive: 'Only System admin roles can change business rules' } });
      const next = { name: input.name, description: input.description ?? null, areas, sensitive };
      const changes = diff(role as unknown as Record<string, unknown>, next, ['name', 'description', 'areas', 'sensitive']);
      if (!Object.keys(changes).length) return { ok: true };
      await tx.update(roles).set(next).where(eq(roles.id, id));
      await this.audit.log(auth, { category: 'users_access', action: 'role_changed', recordType: 'role', recordId: id, recordLabel: input.name, changes }, tx);
      return { ok: true };
    });
  }

  async remove(auth: AuthContext, id: string) {
    return this.db.transaction(async (tx) => {
      const [role] = await tx.select().from(roles).where(eq(roles.id, id)).for('update');
      if (!role) throw new NotFoundException({ message: 'Role not found' });
      if (role.isSystem) throw new ForbiddenException({ message: 'System roles cannot be removed' });
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(users).where(eq(users.roleId, id));
      if (Number(n) > 0) throw new ConflictException({ message: 'Move the members to another role first' });
      await tx.delete(roles).where(eq(roles.id, id));
      await this.audit.log(auth, { category: 'users_access', action: 'role_removed', recordType: 'role', recordId: id, recordLabel: role.name }, tx);
      return { ok: true };
    });
  }
}

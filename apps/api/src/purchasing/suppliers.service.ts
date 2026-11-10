import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';
import { FLAVOURS, type Flavour } from '@ananda/shared';
import { InjectDb, type Db, type Tx } from '../db/db.module';
import { purchases, suppliers } from '../db/schema';
import { AuditService, diff } from '../core/audit.service';
import type { AuthContext } from '../common/context';
import type { SupplierBody } from './purchasing.schemas';

type SupplierRow = typeof suppliers.$inferSelect;

const ordered = (list: readonly string[]) => FLAVOURS.filter((f) => list.includes(f));

/** FR-PUR-3: approved suppliers, one default per flavour. */
@Injectable()
export class SuppliersService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async list() {
    // Correlated subqueries name the outer table explicitly (single-table selects are unqualified).
    const outer = sql.raw('"suppliers"."id"');
    const rows = await this.db
      .select({
        s: suppliers,
        lastPurchaseOn: sql<string | null>`(select max(${purchases.orderedOn})::text from ${purchases} where ${purchases.supplierId} = ${outer})`,
        purchaseCount: sql<number>`(select count(*)::int from ${purchases} where ${purchases.supplierId} = ${outer})`,
      })
      .from(suppliers)
      .orderBy(asc(suppliers.company));
    const items = rows.map((r) => ({ ...r.s, lastPurchaseOn: r.lastPurchaseOn, purchaseCount: Number(r.purchaseCount) }));
    const defaults = Object.fromEntries(FLAVOURS.map((f) => [f, items.find((s) => s.status === 'approved' && s.defaultFlavours.includes(f))?.id ?? null])) as Record<Flavour, string | null>;
    return { items, defaults };
  }

  async get(id: string) {
    const [s] = await this.db.select().from(suppliers).where(eq(suppliers.id, id));
    if (!s) throw new NotFoundException({ message: 'Supplier not found' });
    return s;
  }

  async create(auth: AuthContext, input: SupplierBody) {
    return this.db.transaction(async (tx) => {
      const values = this.normalise(input);
      const moved = await this.takeDefaults(tx, values.defaultFlavours, null);
      const [row] = await tx.insert(suppliers).values(values).returning();
      await this.audit.log(
        auth,
        { category: 'purchasing', action: 'supplier_created', recordType: 'supplier', recordId: row.id, recordLabel: row.company, meta: { defaultFlavours: values.defaultFlavours, movedDefaults: moved } },
        tx,
      );
      return row;
    });
  }

  async update(auth: AuthContext, id: string, input: SupplierBody) {
    return this.db.transaction(async (tx) => {
      const [before] = await tx.select().from(suppliers).where(eq(suppliers.id, id)).for('update');
      if (!before) throw new NotFoundException({ message: 'Supplier not found' });
      const values = this.normalise(input);
      const moved = await this.takeDefaults(tx, values.defaultFlavours, id);
      const [row] = await tx.update(suppliers).set(values).where(eq(suppliers.id, id)).returning();
      const keys: (keyof SupplierRow)[] = ['company', 'country', 'vatNumber', 'contactName', 'ordersEmail', 'phone', 'approvedFlavours', 'defaultFlavours', 'leadTimeDays', 'paymentTermsDays', 'unitPriceCents', 'status'];
      const changes = diff<SupplierRow>(before, row, keys);
      await this.audit.log(
        auth,
        { category: 'purchasing', action: 'supplier_updated', recordType: 'supplier', recordId: id, recordLabel: row.company, changes, money: 'unitPriceCents' in changes, meta: moved.length ? { movedDefaults: moved } : undefined },
        tx,
      );
      return row;
    });
  }

  /** Only approved suppliers can be a default; defaults must be among the approved flavours. */
  private normalise(input: SupplierBody) {
    const approved = ordered(input.approvedFlavours);
    const wanted = ordered(input.defaultFlavours);
    const notApproved = wanted.filter((f) => !approved.includes(f));
    if (notApproved.length) throw new BadRequestException({ message: 'Check the highlighted fields', fields: { defaultFlavours: 'A supplier can only be the default for flavours it is approved for' } });
    return {
      company: input.company,
      country: input.country,
      vatNumber: input.vatNumber || null,
      contactName: input.contactName || null,
      ordersEmail: input.ordersEmail,
      phone: input.phone || null,
      approvedFlavours: approved,
      defaultFlavours: input.status === 'approved' ? wanted : [],
      leadTimeDays: input.leadTimeDays,
      paymentTermsDays: input.paymentTermsDays,
      unitPriceCents: input.unitPriceCents,
      status: input.status,
    };
  }

  /** Making a supplier the default for a flavour moves the default from the current one (FR-PUR-3). */
  private async takeDefaults(tx: Tx, flavours: Flavour[], selfId: string | null) {
    if (!flavours.length) return [];
    const all = await tx.select().from(suppliers).for('update');
    const moved: { flavour: Flavour; from: string }[] = [];
    for (const s of all) {
      if (s.id === selfId) continue;
      const keep = s.defaultFlavours.filter((f) => !flavours.includes(f as Flavour));
      if (keep.length === s.defaultFlavours.length) continue;
      for (const f of s.defaultFlavours) if (flavours.includes(f as Flavour)) moved.push({ flavour: f as Flavour, from: s.company });
      await tx.update(suppliers).set({ defaultFlavours: keep }).where(eq(suppliers.id, s.id));
    }
    return moved;
  }
}

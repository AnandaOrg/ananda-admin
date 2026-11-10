import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

export const DB = Symbol('DB');
export const InjectDb = () => Inject(DB);
const POOL = Symbol('POOL');

@Global()
@Module({
  providers: [
    { provide: POOL, // Serverless instances each hold a few connections; use the provider's pooled URL on Vercel.
      useFactory: () => new Pool({ connectionString: process.env.DATABASE_URL, max: process.env.VERCEL ? 3 : 10 }), },
    { provide: DB, inject: [POOL], useFactory: (pool: Pool) => drizzle(pool, { schema }) },
  ],
  exports: [DB],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(POOL) private readonly pool: Pool) {}
  async onApplicationShutdown() {
    await this.pool.end();
  }
}

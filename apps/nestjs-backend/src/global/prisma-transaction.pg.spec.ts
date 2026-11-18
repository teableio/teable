import { AsyncLocalStorage } from 'node:async_hooks';
import {
  DataPrismaService,
  MetaPrismaService,
  PgPoolRegistry,
  PrismaService,
} from '@teable/db-main-prisma';
import type { Prisma } from '@teable/db-main-prisma';
import { ClsService } from 'nestjs-cls';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

// The unit CI lane provisions PostgreSQL and requires this suite to run. Local
// runs without a database follow the other real-PG unit suites' skip convention.
const databaseUrl = process.env.PRISMA_DATABASE_URL;
if (process.env.UNIT_POSTGRES_REQUIRED === '1' && !databaseUrl) {
  throw new Error(
    'PRISMA_DATABASE_URL is required under UNIT_POSTGRES_REQUIRED=1 for the Prisma transaction postgres tests'
  );
}
const describeWithPostgres = databaseUrl ? describe : describe.skip;

type ITxContext = {
  client?: Prisma.TransactionClient;
  id?: string;
  timeStr?: string;
};
type ITxStore = Record<'tx' | 'dataTx', ITxContext>;

const consumers = [
  { name: 'MetaPrismaService', Service: MetaPrismaService, storeKey: 'tx' },
  { name: 'PrismaService', Service: PrismaService, storeKey: 'tx' },
  { name: 'DataPrismaService', Service: DataPrismaService, storeKey: 'dataTx' },
] as const;

describeWithPostgres('Prisma transaction COMMIT failures', () => {
  it.each(consumers)(
    '$name rejects a deferred constraint failure after the callback finishes and can transact again',
    async ({ Service: serviceConstructor, storeKey }) => {
      const schema = `prisma_commit_${crypto.randomUUID().replace(/-/g, '')}`;
      const table = `"${schema}"."commit_rows"`;
      const commitMessage = `deferred commit rejected in ${schema}`;
      const registry = new PgPoolRegistry((config) => new Pool(config));
      // Both leases resolve to the same real pool. One connection makes a leaked
      // transaction client observable in the following query/transaction.
      const controlLease = registry.acquire(databaseUrl!, { max: 1 });
      const serviceLease = registry.acquire(databaseUrl!, { max: 1 });
      const pool = controlLease.pool;
      const cls = new ClsService<ITxStore>(new AsyncLocalStorage());
      const service = new serviceConstructor(cls, serviceLease, schema);
      const cleanupErrors: unknown[] = [];

      try {
        expect(serviceLease.pool).toBe(pool);
        await pool.query(`CREATE SCHEMA "${schema}"`);
        await pool.query(
          `CREATE TABLE ${table} (id integer PRIMARY KEY, reject_commit boolean NOT NULL)`
        );
        await pool.query(`
          CREATE FUNCTION "${schema}"."reject_deferred_commit"() RETURNS trigger
          LANGUAGE plpgsql AS $$
          BEGIN
            IF NEW.reject_commit THEN
              RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = '${commitMessage}';
            END IF;
            RETURN NEW;
          END;
          $$
        `);
        await pool.query(`
          CREATE CONSTRAINT TRIGGER reject_deferred_commit
          AFTER INSERT ON ${table}
          DEFERRABLE INITIALLY DEFERRED
          FOR EACH ROW EXECUTE FUNCTION "${schema}"."reject_deferred_commit"()
        `);

        let afterTxCount = 0;
        service.bindAfterTransaction(() => {
          afterTxCount += 1;
        });

        await cls.runWith({ tx: {}, dataTx: {} }, async () => {
          let callbackReachedEnd = false;
          const transaction = service.$tx(async (tx) => {
            expect(service.txClient()).toBe(tx);
            expect(cls.get(`${storeKey}.client`)).toBe(tx);
            await tx.$executeRawUnsafe(`INSERT INTO ${table} VALUES (1, true)`);
            // The deferred constraint must not fire during the callback.
            callbackReachedEnd = true;
          });

          await expect(transaction).rejects.toThrow(commitMessage);
          expect(callbackReachedEnd).toBe(true);
          expect(afterTxCount).toBe(0);
          expect(cls.get(storeKey)).toEqual({
            client: undefined,
            id: undefined,
            timeStr: undefined,
          });
          expect(service.txClient()).toBe(service);
          expect((await pool.query(`SELECT id FROM ${table}`)).rows).toEqual([]);

          const result = await service.$tx(async (tx) => {
            expect(service.txClient()).toBe(tx);
            expect(cls.get(`${storeKey}.client`)).toBe(tx);
            await tx.$executeRawUnsafe(`INSERT INTO ${table} VALUES (2, false)`);
            return 'committed';
          });

          expect(result).toBe('committed');
          expect(afterTxCount).toBe(1);
          expect(cls.get(storeKey)).toEqual({
            client: undefined,
            id: undefined,
            timeStr: undefined,
          });
          expect(service.txClient()).toBe(service);
          expect((await pool.query(`SELECT id FROM ${table} ORDER BY id`)).rows).toEqual([
            { id: 2 },
          ]);
          expect(pool.totalCount).toBe(1);
          expect(pool.idleCount).toBe(1);
          expect(pool.waitingCount).toBe(0);
        });
      } finally {
        // Always attempt every cleanup, while preserving the original assertion
        // or database failure instead of replacing it with a teardown error.
        const cleanups = [
          () => service.onModuleDestroy(),
          () => pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`),
          () => controlLease.release(),
          () => registry.onApplicationShutdown(),
        ];
        for (const cleanup of cleanups) {
          try {
            await cleanup();
          } catch (error) {
            cleanupErrors.push(error);
          }
        }
      }
      if (cleanupErrors.length) throw cleanupErrors[0];
    }
  );
});

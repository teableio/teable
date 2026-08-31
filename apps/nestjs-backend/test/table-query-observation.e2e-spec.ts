import type { INestApplication } from '@nestjs/common';
import { PgPoolRegistry, PrismaService } from '@teable/db-main-prisma';
import type { ITableFullVo } from '@teable/openapi';
import { getRecords } from '@teable/openapi';
import { createTable, initApp, permanentDeleteTable } from './utils/init-app';

describe('table query observation isolation T7019 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let poolRegistry: PgPoolRegistry;
  let table: ITableFullVo;
  let previousForceV2All: string | undefined;
  let previousFlushInterval: string | undefined;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    previousForceV2All = process.env.FORCE_V2_ALL;
    previousFlushInterval = process.env.V2_TABLE_QUERY_OPS_FLUSH_INTERVAL_MS;
    process.env.FORCE_V2_ALL = 'true';
    process.env.V2_TABLE_QUERY_OPS_FLUSH_INTERVAL_MS = '1';
    const appContext = await initApp();
    app = appContext.app;
    prisma = app.get(PrismaService);
    poolRegistry = app.get(PgPoolRegistry);
    table = await createTable(baseId, {
      name: 'query_observation_isolation_t7019',
      records: [{ fields: { Name: 'Alpha' } }],
    });
  });

  afterAll(async () => {
    if (table?.id) await permanentDeleteTable(baseId, table.id);
    await app?.close();
    if (previousForceV2All == null) {
      delete process.env.FORCE_V2_ALL;
    } else {
      process.env.FORCE_V2_ALL = previousForceV2All;
    }
    if (previousFlushInterval == null) {
      delete process.env.V2_TABLE_QUERY_OPS_FLUSH_INTERVAL_MS;
    } else {
      process.env.V2_TABLE_QUERY_OPS_FLUSH_INTERVAL_MS = previousFlushInterval;
    }
  });

  it('returns records while observation persistence is locked', async () => {
    let releaseLock!: () => void;
    let markLockReady!: () => void;
    const lockReady = new Promise<void>((resolve) => {
      markLockReady = resolve;
    });
    const lockReleased = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const lock = prisma.$tx(async (tx) => {
      await tx.$executeRawUnsafe(
        'LOCK TABLE "table_query_observation_shard" IN ACCESS EXCLUSIVE MODE'
      );
      markLockReady();
      await lockReleased;
    });
    await lockReady;

    const request = getRecords(table.id);
    try {
      const outcome = await Promise.race([
        request.then(() => 'records'),
        new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 250)),
      ]);
      await vi.waitFor(async () => {
        const [row] = await prisma.txClient().$queryRawUnsafe<Array<{ waiting: number }>>(`
          SELECT count(*)::integer AS waiting
          FROM pg_stat_activity
          WHERE application_name = 'teable-table-query-observation'
            AND wait_event_type = 'Lock'
            AND query ILIKE '%table_query_observation_shard%'
        `);
        expect(row?.waiting).toBeGreaterThan(0);
        const pools = poolRegistry.snapshot();
        expect(pools.find((pool) => pool.poolName === 'table-query-observation')).toMatchObject({
          applicationName: 'teable-table-query-observation',
          max: 2,
        });
        expect(
          pools.filter((pool) => pool.poolName == null).every((pool) => pool.waiting === 0)
        ).toBe(true);
      });
      expect(outcome).toBe('records');
    } finally {
      releaseLock();
      await Promise.all([lock, request]);
    }
  });
});

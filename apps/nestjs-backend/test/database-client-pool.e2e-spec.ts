import type { INestApplication } from '@nestjs/common';
import { PgPoolRegistry, PrismaService } from '@teable/db-main-prisma';
import type { Knex } from 'knex';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { V2ContainerService } from '../src/features/v2/v2-container.service';
import { CUSTOM_KNEX, DATA_KNEX, META_KNEX } from '../src/global/knex';
import { initApp } from './utils/init-app';

describe('database client pool topology (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = (await initApp()).app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('bulkheads observations from the shared Prisma, V2 Kysely, and Knex pool', async () => {
    await app.get(V2ContainerService).getContainer();

    const registry = app.get(PgPoolRegistry);
    const prisma = app.get(PrismaService);
    const metaKnex = app.get<Knex>(META_KNEX);
    const dataKnex = app.get<Knex>(DATA_KNEX);
    const customKnex = app.get<Knex>(CUSTOM_KNEX);

    const activity = await prisma.$queryRawUnsafe<
      Array<{ applicationName: string; connections: bigint }>
    >(`
      SELECT application_name::text AS "applicationName", count(*)::bigint AS connections
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND usename = current_user
      GROUP BY application_name
      ORDER BY application_name
    `);
    const snapshots = registry.snapshot();

    expect(metaKnex).toBe(dataKnex);
    expect(metaKnex).toBe(customKnex);
    expect(metaKnex.client.pool).toBeUndefined();
    expect(snapshots).toHaveLength(2);
    const shared = snapshots.find((snapshot) => snapshot.poolName == null)!;
    const observations = snapshots.find(
      (snapshot) => snapshot.poolName === 'table-query-observation'
    )!;
    expect(shared).toMatchObject({ applicationName: 'teable', waiting: 0 });
    expect(observations).toMatchObject({
      applicationName: 'teable-table-query-observation',
      max: 2,
      references: 1,
      waiting: 0,
    });
    // Shared-app workers retain private test apps until process teardown because
    // closing one can end process-global pools. Those apps add leases, not pools.
    expect(shared.references).toBeGreaterThanOrEqual(3);
    expect(shared.total).toBeLessThanOrEqual(shared.max);
    expect(observations.total).toBeLessThanOrEqual(2);
    const mainActivity = activity.filter((row) => row.applicationName === 'teable');
    expect(mainActivity).toHaveLength(1);
    expect(mainActivity[0]!.connections).toBeGreaterThanOrEqual(BigInt(shared.total));
  });
});

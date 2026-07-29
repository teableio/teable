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

  it('uses one physical PostgreSQL pool for default Prisma, V2 Kysely, and Knex traffic', async () => {
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
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({ waiting: 0 });
    // Shared-app workers retain private test apps until process teardown because
    // closing one can end process-global pools. Those apps add leases, not pools.
    expect(snapshots[0]!.references).toBeGreaterThanOrEqual(3);
    expect(snapshots[0]!.total).toBeLessThanOrEqual(snapshots[0]!.max);
    expect(activity).toHaveLength(1);
    expect(activity[0]!.applicationName).toBe('teable');
    // Other retained test apps can have their own pool against this worker DB.
    // The current app's registry count must still be represented in PostgreSQL.
    expect(activity[0]!.connections).toBeGreaterThanOrEqual(BigInt(snapshots[0]!.total));
  });
});

/* eslint-disable sonarjs/no-duplicate-string */
import { readFileSync } from 'node:fs';
import { PgPoolRegistry } from '@teable/db-main-prisma';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  DataDbClientManager,
  type IComputedOutboxMaintenanceTarget,
} from '../../global/data-db-client-manager.service';
import { DataDbRuntimeCacheService } from '../../global/data-db-runtime-cache.service';
import {
  DATA_DB_MIGRATION_TABLE,
  DataDbMigrationService,
  type IDataDbMigration,
} from './data-db-migration.service';
import { dataDbKnexClientFactory } from './data-db-preflight.service';
import { encryptDataDbUrl } from './data-db-url-secret';
import { buildMigrationSharedTableSqlCopyPlans } from './space-data-db-copy-plan';
import { SpaceDataDbMigrationService } from './space-data-db-migration.service';

const databaseUrl = process.env.PRISMA_DATABASE_URL;
if (process.env.CI && !databaseUrl) {
  throw new Error('PRISMA_DATABASE_URL is required in CI for domain-event BYODB postgres tests');
}

const describeWithPostgres = databaseUrl ? describe : describe.skip;

const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toLowerCase();
const sourceSchema = `deo_src_${suffix}`;
const targetSchema = `deo_tgt_${suffix}`;
const baseId = 'bsecopy';
const otherBaseId = 'bseother';
const tableId = 'tblcopy';
const spaceId = 'spcdeotest';
const jobId = `sdmjdeo${suffix}`;

const qualify = (schema: string, table: string) =>
  `"${schema.replace(/"/g, '""')}"."${table.replace(/"/g, '""')}"`;

const queryCount = async (client: Client, sql: string, values: unknown[] = []) => {
  const result = await client.query<{ count: string }>(sql, values);
  return Number(result.rows[0]?.count ?? 0);
};

const createDomainEventTables = async (client: Client, schema: string) => {
  await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  await client.query(`
    CREATE TABLE "${schema}"."record_history" (
      "id" text PRIMARY KEY,
      "table_id" text
    )
  `);
  await client.query(`
    CREATE TABLE "${schema}"."table_trash" (
      "id" text PRIMARY KEY,
      "table_id" text
    )
  `);
  await client.query(`
    CREATE TABLE "${schema}"."record_trash" (
      "id" text PRIMARY KEY,
      "table_id" text
    )
  `);
  await client.query(`
    CREATE TABLE "${schema}"."record_removal_tombstone" (
      "id" text PRIMARY KEY,
      "table_id" text
    )
  `);
  await client.query(`
    CREATE TABLE "${schema}"."computed_update_outbox" (
      "id" text PRIMARY KEY,
      "base_id" text
    )
  `);
  await client.query(`
    CREATE TABLE "${schema}"."computed_update_dead_letter" (
      "id" text PRIMARY KEY,
      "base_id" text
    )
  `);
  await client.query(`
    CREATE TABLE "${schema}"."computed_update_outbox_seed" (
      "id" text PRIMARY KEY,
      "table_id" text
    )
  `);
  await client.query(`
    CREATE TABLE "${schema}"."__undo_log" (
      "id" text PRIMARY KEY,
      "table_name" text
    )
  `);
  await client.query(`
    CREATE TABLE "${schema}"."domain_event_outbox" (
      "id" text PRIMARY KEY,
      "base_id" text NOT NULL,
      "table_id" text,
      "message_name" text NOT NULL,
      "schema_version" integer NOT NULL,
      "aggregate_id" text,
      "payload" jsonb NOT NULL,
      "payload_bytes" integer NOT NULL,
      "catalog_generation" integer NOT NULL,
      "required_consumers" jsonb NOT NULL,
      "binding_id" text,
      "storage_epoch" integer,
      "unpublished" boolean NOT NULL DEFAULT true,
      "settled" text,
      "settled_at" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now()
    )
  `);
  await client.query(`
    CREATE TABLE "${schema}"."domain_event_delivery" (
      "id" text PRIMARY KEY,
      "event_id" text NOT NULL,
      "consumer_id" text NOT NULL,
      "status" text NOT NULL,
      "attempts" integer NOT NULL DEFAULT 0,
      "max_attempts" integer NOT NULL DEFAULT 12,
      "lease_token" text,
      "lease_expires_at" timestamptz,
      "next_attempt_at" timestamptz NOT NULL DEFAULT now(),
      "last_error" text,
      "created_at" timestamptz NOT NULL DEFAULT now()
    )
  `);
  await client.query(`
    CREATE UNIQUE INDEX "${schema}_domain_event_delivery_event_consumer_idx"
    ON "${schema}"."domain_event_delivery" ("event_id", "consumer_id")
  `);
  await client.query(`
    CREATE TABLE "${schema}"."domain_event_inbox" (
      "consumer_id" text NOT NULL,
      "event_id" text NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY ("consumer_id", "event_id")
    )
  `);
};

const insertOutboxFamily = async (
  client: Client,
  schema: string,
  input: { eventId: string; deliveryId: string; baseId: string; unpublished?: boolean }
) => {
  await client.query(
    `INSERT INTO "${schema}"."domain_event_outbox"
      ("id", "base_id", "table_id", "message_name", "schema_version", "aggregate_id",
       "payload", "payload_bytes", "catalog_generation", "required_consumers", "unpublished")
     VALUES ($1, $2, $3, 'table.record.created.v1', 1, $1, '{"recordId":"rec1"}'::jsonb, 18, 1,
             '["record.validation.v1"]'::jsonb, $4)`,
    [input.eventId, input.baseId, tableId, input.unpublished ?? true]
  );
  await client.query(
    `INSERT INTO "${schema}"."domain_event_delivery"
      ("id", "event_id", "consumer_id", "status", "attempts", "max_attempts")
     VALUES ($1, $2, 'record.validation.v1', 'pending', 0, 12)`,
    [input.deliveryId, input.eventId]
  );
  await client.query(
    `INSERT INTO "${schema}"."domain_event_inbox" ("consumer_id", "event_id")
     VALUES ('record.validation.v1', $1)`,
    [input.eventId]
  );
};

describeWithPostgres('domain event BYODB copy and delta (postgres)', () => {
  const client = new Client({ connectionString: databaseUrl });

  beforeAll(async () => {
    await client.connect();
    await createDomainEventTables(client, sourceSchema);
    await createDomainEventTables(client, targetSchema);
    await insertOutboxFamily(client, sourceSchema, {
      eventId: 'deo-copy',
      deliveryId: 'dlv-copy',
      baseId,
    });
    await insertOutboxFamily(client, sourceSchema, {
      eventId: 'deo-other',
      deliveryId: 'dlv-other',
      baseId: otherBaseId,
    });
    const copyPlans = buildMigrationSharedTableSqlCopyPlans({
      sourceSchema,
      targetSchema,
      spaceId,
      baseIds: [baseId],
      tableIds: [tableId],
    }).filter((plan) => plan.table.startsWith('domain_event_'));
    if (copyPlans.length !== 3) {
      throw new Error(
        `Expected 3 domain-event copy plans, received ${copyPlans.map((plan) => plan.table).join(',')}`
      );
    }
    for (const plan of copyPlans) {
      await client.query(plan.resetSql);
      await client.query(plan.copySql);
    }
  });

  afterAll(async () => {
    try {
      await client.query(`DROP SCHEMA IF EXISTS "${sourceSchema}" CASCADE`);
      await client.query(`DROP SCHEMA IF EXISTS "${targetSchema}" CASCADE`);
    } catch {
      // Connection may already be dead if beforeAll failed to log in.
    } finally {
      await client.end().catch(() => undefined);
    }
  });

  it('copies only the selected base outbox and its delivery/inbox children', async () => {
    await expect(
      queryCount(
        client,
        `SELECT COUNT(*) AS count FROM ${qualify(targetSchema, 'domain_event_outbox')} WHERE "base_id" = $1`,
        [baseId]
      )
    ).resolves.toBe(1);
    await expect(
      queryCount(
        client,
        `SELECT COUNT(*) AS count FROM ${qualify(targetSchema, 'domain_event_outbox')} WHERE "base_id" = $1`,
        [otherBaseId]
      )
    ).resolves.toBe(0);
    await expect(
      queryCount(
        client,
        `SELECT COUNT(*) AS count FROM ${qualify(targetSchema, 'domain_event_delivery')} WHERE "event_id" = 'deo-copy'`
      )
    ).resolves.toBe(1);
    await expect(
      queryCount(
        client,
        `SELECT COUNT(*) AS count FROM ${qualify(targetSchema, 'domain_event_delivery')} WHERE "event_id" = 'deo-other'`
      )
    ).resolves.toBe(0);
    await expect(
      queryCount(
        client,
        `SELECT COUNT(*) AS count FROM ${qualify(targetSchema, 'domain_event_inbox')} WHERE "event_id" = 'deo-copy'`
      )
    ).resolves.toBe(1);
    await expect(
      queryCount(
        client,
        `SELECT COUNT(*) AS count FROM ${qualify(targetSchema, 'domain_event_inbox')} WHERE "event_id" = 'deo-other'`
      )
    ).resolves.toBe(0);
  });

  it('captures and replays only the selected base outbox family through real triggers', async () => {
    const job = {
      id: jobId,
      spaceId,
      state: 'copying',
      targetInternalSchema: targetSchema,
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(databaseUrl as string),
      },
      inventory: {
        baseIds: [baseId],
        tableIds: [tableId],
        sourceDataDb: {
          mode: 'default',
          internalSchema: sourceSchema,
          isMetaFallback: true,
        },
        targetDataDb: { internalSchema: targetSchema },
        physicalSchemas: [],
      },
      copyStats: null as unknown,
    };
    const prismaService = {
      spaceDataDbMigrationJob: {
        findUnique: vi.fn().mockImplementation(async () => job),
        findFirst: vi.fn().mockImplementation(async () => job),
        update: vi.fn().mockImplementation(async (args: { data?: { copyStats?: unknown } }) => {
          if (args.data?.copyStats !== undefined) {
            job.copyStats = args.data.copyStats;
          }
          return job;
        }),
      },
    };
    const dataDbClientManager = {
      getDataDatabaseForSpace: vi.fn().mockResolvedValue({
        cacheKey: 'meta-fallback',
        url: databaseUrl,
        internalSchema: sourceSchema,
        isMetaFallback: true,
      }),
    };
    const service = new SpaceDataDbMigrationService(
      prismaService as never,
      {} as never,
      { getLatestSchemaVersion: vi.fn().mockReturnValue(null) } as never,
      dataDbClientManager as never,
      {} as never,
      dataDbKnexClientFactory
    );
    const install = (
      service as unknown as {
        installSourceDeltaCaptureForJob: (
          currentJob: typeof job,
          sourceDataDb: {
            url: string;
            internalSchema: string;
            isMetaFallback: boolean;
            cacheKey: string;
          }
        ) => Promise<void>;
      }
    ).installSourceDeltaCaptureForJob.bind(service);
    const replay = (
      service as unknown as {
        replayDeltaForJob: (id: string) => Promise<{ rowsApplied: number }>;
      }
    ).replayDeltaForJob.bind(service);

    await install(job, {
      cacheKey: 'meta-fallback',
      url: databaseUrl as string,
      internalSchema: sourceSchema,
      isMetaFallback: true,
    });

    await insertOutboxFamily(client, sourceSchema, {
      eventId: 'deo-delta',
      deliveryId: 'dlv-delta',
      baseId,
      unpublished: false,
    });
    await insertOutboxFamily(client, sourceSchema, {
      eventId: 'deo-other-delta',
      deliveryId: 'dlv-other-delta',
      baseId: otherBaseId,
    });
    await client.query(
      `UPDATE ${qualify(sourceSchema, 'domain_event_outbox')}
       SET "unpublished" = false, "settled" = 'succeeded'
       WHERE "id" = 'deo-copy'`
    );
    await client.query(
      `DELETE FROM ${qualify(sourceSchema, 'domain_event_delivery')} WHERE "id" = 'dlv-copy'`
    );
    await client.query(
      `UPDATE ${qualify(sourceSchema, 'domain_event_outbox')}
       SET "settled" = 'dead'
       WHERE "id" = 'deo-other'`
    );

    const captured = await client.query<{
      tableName: string;
      op: string;
      eventId: string | null;
    }>(
      `SELECT "table_name" AS "tableName", "op",
              COALESCE("new_row" ->> 'id', "old_row" ->> 'id', "new_row" ->> 'event_id', "old_row" ->> 'event_id') AS "eventId"
       FROM ${qualify(sourceSchema, '__teable_space_migration_delta_log')}
       WHERE "job_id" = $1
       ORDER BY "seq"`,
      [jobId]
    );
    const capturedKeys = captured.rows.map((row) => `${row.tableName}:${row.op}:${row.eventId}`);
    expect(capturedKeys).toEqual(
      expect.arrayContaining([
        'domain_event_outbox:INSERT:deo-delta',
        'domain_event_delivery:INSERT:dlv-delta',
        'domain_event_inbox:INSERT:deo-delta',
        'domain_event_outbox:UPDATE:deo-copy',
        'domain_event_delivery:DELETE:dlv-copy',
      ])
    );
    expect(
      captured.rows.some((row) =>
        ['deo-other', 'deo-other-delta', 'dlv-other', 'dlv-other-delta'].includes(
          row.event_id ?? ''
        )
      )
    ).toBe(false);

    await replay(jobId);

    await expect(
      queryCount(
        client,
        `SELECT COUNT(*) AS count FROM ${qualify(targetSchema, 'domain_event_outbox')} WHERE "id" = 'deo-delta'`
      )
    ).resolves.toBe(1);
    await expect(
      queryCount(
        client,
        `SELECT COUNT(*) AS count FROM ${qualify(targetSchema, 'domain_event_delivery')} WHERE "id" = 'dlv-delta'`
      )
    ).resolves.toBe(1);
    await expect(
      queryCount(
        client,
        `SELECT COUNT(*) AS count FROM ${qualify(targetSchema, 'domain_event_inbox')} WHERE "event_id" = 'deo-delta'`
      )
    ).resolves.toBe(1);
    await expect(
      queryCount(
        client,
        `SELECT COUNT(*) AS count FROM ${qualify(targetSchema, 'domain_event_outbox')} WHERE "id" = 'deo-copy' AND "settled" = 'succeeded'`
      )
    ).resolves.toBe(1);
    await expect(
      queryCount(
        client,
        `SELECT COUNT(*) AS count FROM ${qualify(targetSchema, 'domain_event_delivery')} WHERE "id" = 'dlv-copy'`
      )
    ).resolves.toBe(0);
    await expect(
      queryCount(
        client,
        `SELECT COUNT(*) AS count FROM ${qualify(targetSchema, 'domain_event_outbox')} WHERE "id" = 'deo-other-delta'`
      )
    ).resolves.toBe(0);
    await expect(
      queryCount(
        client,
        `SELECT COUNT(*) AS count FROM ${qualify(targetSchema, 'domain_event_delivery')} WHERE "id" = 'dlv-other-delta'`
      )
    ).resolves.toBe(0);
    await expect(
      queryCount(
        client,
        `SELECT COUNT(*) AS count FROM ${qualify(targetSchema, 'domain_event_outbox')} WHERE "id" = 'deo-other' AND "settled" = 'dead'`
      )
    ).resolves.toBe(0);
  });
});

describeWithPostgres('domain event maintenance migrations and probes (postgres)', () => {
  const client = new Client({ connectionString: databaseUrl });
  const schema = `deo_maintenance_${suffix}`;
  const migrationIds = [
    '20260831120000_add_domain_event_outbox',
    '20260901120000_add_domain_event_outbox_settled_at',
    '20260908120000_domain_event_delivery_lease_timestamptz',
    '20260917120000_add_domain_event_maintenance_indexes',
  ];
  const maintenanceIndexNames = [
    'domain_event_inbox_event_id_idx',
    'domain_event_outbox_legacy_settled_created_at_idx',
    'domain_event_outbox_unsettled_idx',
  ];
  let migrations: IDataDbMigration[];
  let originalFamilies: unknown[];

  const loadFamilies = async () => {
    const families: unknown[] = [];
    for (const table of ['domain_event_outbox', 'domain_event_delivery', 'domain_event_inbox']) {
      const orderColumn = table === 'domain_event_outbox' ? 'id' : 'event_id';
      const result = await client.query(
        `SELECT * FROM ${qualify(schema, table)} ORDER BY "${orderColumn}"`
      );
      families.push(result.rows);
    }
    return families;
  };

  beforeAll(async () => {
    await client.connect();
    migrations = migrationIds.map((id) => ({
      id,
      sql: readFileSync(
        new URL(
          `../../../../../packages/db-data-prisma/prisma/migrations/${id}/migration.sql`,
          import.meta.url
        ),
        'utf8'
      ),
    }));
    await expect(
      new DataDbMigrationService(migrations.slice(0, 3)).migrate(databaseUrl!, schema)
    ).resolves.toEqual(migrationIds.slice(0, 3));

    for (const eventId of [
      'modern-retained',
      'legacy-retained',
      'modern-expired',
      'legacy-expired',
      'orphaned-terminal',
    ]) {
      await insertOutboxFamily(client, schema, {
        eventId,
        deliveryId: `delivery-${eventId}`,
        baseId,
        unpublished: false,
      });
    }
    await client.query(`
      UPDATE ${qualify(schema, 'domain_event_delivery')} SET status = 'succeeded';
      UPDATE ${qualify(schema, 'domain_event_outbox')}
      SET created_at = now() - interval '16 days',
          settled = CASE WHEN id = 'orphaned-terminal' THEN NULL ELSE 'succeeded' END,
          settled_at = CASE
            WHEN id = 'modern-expired' THEN now() - interval '16 days'
            WHEN id = 'modern-retained' THEN now() - interval '13 days'
            ELSE NULL
          END;
      UPDATE ${qualify(schema, 'domain_event_outbox')}
      SET created_at = now() - interval '13 days'
      WHERE id = 'legacy-retained';
    `);
    originalFamilies = await loadFamilies();
  });

  afterAll(async () => {
    try {
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await client.end().catch(() => undefined);
    }
  });

  it('adds valid maintenance indexes without rewriting families and reruns through the ledger', async () => {
    const service = new DataDbMigrationService(migrations);
    await expect(service.migrate(databaseUrl!, schema)).resolves.toEqual([migrationIds[3]]);
    expect(await loadFamilies()).toEqual(originalFamilies);

    const indexes = await client.query<{
      name: string;
      tableName: string;
      valid: boolean;
      ready: boolean;
      columns: string[];
      predicate: string | null;
    }>(
      `SELECT index_class.relname AS name, table_class.relname AS "tableName",
              index.indisvalid AS valid, index.indisready AS ready,
              ARRAY(
                SELECT attribute.attname::text
                FROM unnest(index.indkey) WITH ORDINALITY AS key(attnum, position)
                JOIN pg_attribute AS attribute
                  ON attribute.attrelid = index.indrelid AND attribute.attnum = key.attnum
                ORDER BY key.position
              ) AS columns,
              pg_get_expr(index.indpred, index.indrelid) AS predicate
       FROM pg_index AS index
       JOIN pg_class AS index_class ON index_class.oid = index.indexrelid
       JOIN pg_class AS table_class ON table_class.oid = index.indrelid
       JOIN pg_namespace AS namespace ON namespace.oid = table_class.relnamespace
       WHERE namespace.nspname = $1 AND index_class.relname = ANY($2::text[])
       ORDER BY index_class.relname`,
      [schema, maintenanceIndexNames]
    );
    expect(indexes.rows).toEqual([
      {
        name: maintenanceIndexNames[0],
        tableName: 'domain_event_inbox',
        valid: true,
        ready: true,
        columns: ['event_id'],
        predicate: null,
      },
      {
        name: maintenanceIndexNames[1],
        tableName: 'domain_event_outbox',
        valid: true,
        ready: true,
        columns: ['created_at'],
        predicate: '((settled IS NOT NULL) AND (settled_at IS NULL))',
      },
      {
        name: maintenanceIndexNames[2],
        tableName: 'domain_event_outbox',
        valid: true,
        ready: true,
        columns: ['id'],
        predicate: '((settled IS NULL) AND (NOT unpublished))',
      },
    ]);

    const ledgerBefore = await client.query(
      `SELECT * FROM ${qualify(schema, DATA_DB_MIGRATION_TABLE)} ORDER BY id`
    );
    expect(ledgerBefore.rows.map((row) => row.id)).toEqual(migrationIds);
    await expect(service.migrate(databaseUrl!, schema)).resolves.toEqual([]);
    const ledgerAfter = await client.query(
      `SELECT * FROM ${qualify(schema, DATA_DB_MIGRATION_TABLE)} ORDER BY id`
    );
    expect(ledgerAfter.rows).toEqual(ledgerBefore.rows);
    expect(await loadFamilies()).toEqual(originalFamilies);
  });

  it('probes only unpublished events and due deliveries through the actual target schema', async () => {
    const manager = new DataDbClientManager(
      {} as never,
      {} as never,
      {} as never,
      new DataDbRuntimeCacheService(),
      new PgPoolRegistry((config) => new Pool(config))
    );
    const target: IComputedOutboxMaintenanceTarget = {
      cacheKey: `maintenance-probe:${schema}`,
      url: databaseUrl!,
      connectionUrl: databaseUrl!,
      internalSchema: schema,
      isMetaFallback: false,
      storage: 'byodb',
    };
    await expect(manager.peekDueDomainEventWork(target)).resolves.toBe(false);
    expect(await loadFamilies()).toEqual(originalFamilies);

    await insertOutboxFamily(client, schema, {
      eventId: 'probe-event',
      deliveryId: 'probe-delivery',
      baseId,
    });
    try {
      await client.query(
        `UPDATE ${qualify(schema, 'domain_event_delivery')}
         SET status = 'succeeded' WHERE event_id = 'probe-event'`
      );
      await expect(manager.peekDueDomainEventWork(target)).resolves.toBe(true);
      await client.query(
        `UPDATE ${qualify(schema, 'domain_event_outbox')}
         SET unpublished = false WHERE id = 'probe-event'`
      );
      await expect(manager.peekDueDomainEventWork(target)).resolves.toBe(false);

      for (const status of ['pending', 'processing']) {
        await client.query(
          `UPDATE ${qualify(schema, 'domain_event_delivery')}
           SET status = $1, next_attempt_at = now() + interval '1 hour'
           WHERE event_id = 'probe-event'`,
          [status]
        );
        await expect(manager.peekDueDomainEventWork(target)).resolves.toBe(false);
        await client.query(
          `UPDATE ${qualify(schema, 'domain_event_delivery')}
           SET next_attempt_at = now() - interval '1 minute'
           WHERE event_id = 'probe-event'`
        );
        await expect(manager.peekDueDomainEventWork(target)).resolves.toBe(true);
      }
    } finally {
      await client.query(`
        DELETE FROM ${qualify(schema, 'domain_event_inbox')} WHERE event_id = 'probe-event';
        DELETE FROM ${qualify(schema, 'domain_event_delivery')} WHERE event_id = 'probe-event';
        DELETE FROM ${qualify(schema, 'domain_event_outbox')} WHERE id = 'probe-event';
      `);
    }
    await expect(manager.peekDueDomainEventWork(target)).resolves.toBe(false);
    expect(await loadFamilies()).toEqual(originalFamilies);
  });
});

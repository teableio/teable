/* eslint-disable sonarjs/no-duplicate-string */
import { spawnSync } from 'child_process';
import { mkdtemp, mkdir, rm } from 'fs/promises';
import { createServer } from 'net';
import { tmpdir } from 'os';
import path from 'path';
import createKnex from 'knex';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DataDbClientManager } from '../../global/data-db-client-manager.service';
import { DataDbRuntimeCacheService } from '../../global/data-db-runtime-cache.service';
import { dataDbKnexClientFactory } from './data-db-preflight.service';
import { encryptDataDbUrl } from './data-db-url-secret';
import { buildMigrationSharedTablePsqlCopyPlans } from './space-data-db-copy-plan';
import { SpaceDataDbCopyService } from './space-data-db-copy.service';
import { SpaceDataDbMigrationService } from './space-data-db-migration.service';
import { SpaceDataDbProcessRunnerService } from './space-data-db-process-runner.service';

const requiredPostgresBins = ['initdb', 'pg_ctl', 'pg_dump', 'pg_restore', 'psql'];
const hasPostgresBinaries = requiredPostgresBins.every(
  (command) => spawnSync('which', [command], { stdio: 'ignore' }).status === 0
);
const describeWithPostgres = hasPostgresBinaries ? describe : describe.skip;
const sourceDatabase = 'source_data_db';
const targetDatabase = 'target_data_db';
const targetMismatchDatabase = 'target_mismatch_data_db';
const targetSchema = 'teable_meta_test';
const targetMismatchSchema = 'teable_meta_mismatch';
const baseId = 'bsecopy';
const otherBaseId = 'bseother';
const tableId = 'tblcopy';
const linkedTableId = 'tbllinkedcopy';
const spaceId = 'spccopy';
const otherSpaceId = 'spcother';
const jobId = 'sdmjcopy';
const targetConnectionId = 'dcncopy';
const mismatchJobId = 'sdmjmismatch';
const mismatchTargetConnectionId = 'dcnmismatch';
const mainRelationName = 'sheet1';
const linkedRelationName = 'sheet2';
const junctionRelationName = 'sheet1_sheet2_junction';
const legacyAutoNumberSequenceName = `${baseId}_${mainRelationName}_seq`;

const buildCopyInventory = () => ({
  baseIds: [baseId],
  tableIds: [tableId, linkedTableId],
  dbTableNames: [
    `${baseId}.${mainRelationName}`,
    `${baseId}.${linkedRelationName}`,
    `${baseId}.${junctionRelationName}`,
  ],
  physicalSchemas: [
    {
      schemaName: baseId,
      totalBytes: 3072,
      estimatedRows: 6,
      relations: [
        {
          schemaName: baseId,
          relationName: mainRelationName,
          relationKind: 'table',
          totalBytes: 1024,
          estimatedRows: 2,
        },
        {
          schemaName: baseId,
          relationName: linkedRelationName,
          relationKind: 'table',
          totalBytes: 1024,
          estimatedRows: 2,
        },
        {
          schemaName: baseId,
          relationName: junctionRelationName,
          relationKind: 'table',
          totalBytes: 1024,
          estimatedRows: 2,
        },
      ],
    },
  ],
});

const execFile = async (command: string, args: string[], options: { timeout?: number } = {}) => {
  const { execFile: nodeExecFile } = await import('child_process');
  return await new Promise<void>((resolve, reject) => {
    nodeExecFile(command, args, { timeout: options.timeout ?? 30_000 }, (error, stdout, stderr) => {
      if (!error) {
        resolve();
        return;
      }
      reject(
        new Error(`${command} ${args.join(' ')} failed: ${stderr || stdout || error.message}`)
      );
    });
  });
};

const getFreePort = async () =>
  await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Could not allocate a local PostgreSQL test port'));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });

const currentUser = () => encodeURIComponent(process.env.USER || 'postgres');

const pgUrl = (port: number, database: string) =>
  `postgresql://${currentUser()}@127.0.0.1:${port}/${database}`;

const queryCount = async (client: Client, sql: string, values: unknown[] = []) => {
  const result = await client.query<{ count: string }>(sql, values);
  return Number(result.rows[0]?.count ?? 0);
};

const expectProcessTiming = (result: {
  startedAt: string;
  completedAt: string;
  durationMs: number;
}) => {
  expect(Date.parse(result.startedAt)).not.toBeNaN();
  expect(Date.parse(result.completedAt)).not.toBeNaN();
  expect(result.durationMs).toBeGreaterThanOrEqual(0);
};

const createSharedTables = async (client: Client, schema: string) => {
  await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  await client.query(`
    CREATE OR REPLACE FUNCTION "${schema}"."__teable_capture_undo_row"()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      RETURN NEW;
    END;
    $$
  `);
  await client.query(`
    CREATE TABLE "${schema}"."record_history" (
      "id" text PRIMARY KEY,
      "table_id" text,
      "record_id" text,
      "field_id" text,
      "before" jsonb,
      "after" jsonb,
      "created_time" timestamp,
      "created_by" text
    )
  `);
  await client.query(`
    CREATE TABLE "${schema}"."table_trash" (
      "id" text PRIMARY KEY,
      "table_id" text,
      "resource_type" text,
      "snapshot" jsonb,
      "created_time" timestamp,
      "created_by" text
    )
  `);
  await client.query(`
    CREATE TABLE "${schema}"."record_trash" (
      "id" text PRIMARY KEY,
      "table_id" text,
      "record_id" text,
      "snapshot" jsonb,
      "created_time" timestamp,
      "created_by" text
    )
  `);
  await client.query(`
    CREATE TABLE "${schema}"."computed_update_outbox" (
      "id" text PRIMARY KEY,
      "base_id" text,
      "seed_table_id" text,
      "seed_record_ids" text,
      "change_type" text,
      "steps" text,
      "edges" text,
      "status" text,
      "attempts" text,
      "max_attempts" text,
      "next_run_at" text,
      "locked_at" timestamp,
      "locked_by" text,
      "last_error" text,
      "estimated_complexity" text,
      "plan_hash" text,
      "dirty_stats" text,
      "run_id" text,
      "origin_run_ids" text,
      "run_total_steps" text,
      "run_completed_steps_before" text,
      "affected_table_ids" text,
      "affected_field_ids" text,
      "sync_max_level" text,
      "created_at" timestamp,
      "updated_at" timestamp
    )
  `);
  await client.query(`
    CREATE TABLE "${schema}"."computed_update_dead_letter" (
      "id" text PRIMARY KEY,
      "base_id" text,
      "seed_table_id" text,
      "seed_record_ids" text,
      "change_type" text,
      "steps" text,
      "edges" text,
      "status" text,
      "attempts" text,
      "max_attempts" text,
      "next_run_at" text,
      "locked_at" timestamp,
      "locked_by" text,
      "last_error" text,
      "estimated_complexity" text,
      "plan_hash" text,
      "dirty_stats" text,
      "run_id" text,
      "origin_run_ids" text,
      "run_total_steps" text,
      "run_completed_steps_before" text,
      "affected_table_ids" text,
      "affected_field_ids" text,
      "sync_max_level" text,
      "created_at" timestamp,
      "updated_at" timestamp,
      "trace_data" jsonb,
      "failed_at" timestamp
    )
  `);
  await client.query(`
    CREATE TABLE "${schema}"."computed_update_outbox_seed" (
      "id" text PRIMARY KEY,
      "task_id" text,
      "table_id" text,
      "record_id" text
    )
  `);
  await client.query(`
    CREATE TABLE "${schema}"."computed_update_pause_scope" (
      "id" text PRIMARY KEY,
      "scope_type" text,
      "scope_id" text,
      "paused_at" timestamp,
      "paused_by" text,
      "resume_at" timestamp,
      "reason" text,
      "updated_at" timestamp,
      "updated_by" text
    )
  `);
  await client.query(`
    CREATE TABLE "${schema}"."__undo_log" (
      "id" text PRIMARY KEY,
      "batch_id" text,
      "operation" text,
      "table_name" text,
      "record_id" text,
      "old_row" jsonb,
      "new_row" jsonb,
      "created_at" timestamp
    )
  `);
};

const seedSourceData = async (client: Client) => {
  await client.query(`CREATE SCHEMA "${baseId}"`);
  await client.query(`CREATE SEQUENCE "public"."${legacyAutoNumberSequenceName}"`);
  await client.query(`
    CREATE TABLE "${baseId}"."${mainRelationName}" (
      "id" text PRIMARY KEY,
      "__auto_number" integer DEFAULT nextval('public."${legacyAutoNumberSequenceName}"'::regclass) NOT NULL,
      "__created_time" timestamp,
      "__last_modified_time" timestamp,
      "name" text,
      CONSTRAINT "sheet1_name_nonempty" CHECK (length("name") > 0)
    )
  `);
  await client.query(
    `CREATE INDEX "sheet1_name_idx" ON "${baseId}"."${mainRelationName}" ("name")`
  );
  await client.query(`
    CREATE OR REPLACE FUNCTION "${baseId}"."touch_sheet1_modified_time"()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      NEW."__last_modified_time" = COALESCE(NEW."__last_modified_time", now());
      RETURN NEW;
    END;
    $$
  `);
  await client.query(`
    CREATE TRIGGER "sheet1_touch_modified_time"
    BEFORE INSERT OR UPDATE ON "${baseId}"."${mainRelationName}"
    FOR EACH ROW
    EXECUTE FUNCTION "${baseId}"."touch_sheet1_modified_time"()
  `);
  await client.query(
    `INSERT INTO "${baseId}"."${mainRelationName}" ("id", "__created_time", "__last_modified_time", "name") VALUES
      ('rec1', now(), now(), 'A'),
      ('rec2', now(), now(), 'B')`
  );
  await client.query(`
    CREATE TABLE "${baseId}"."${linkedRelationName}" (
      "id" text PRIMARY KEY,
      "__created_time" timestamp,
      "title" text
    )
  `);
  await client.query(
    `INSERT INTO "${baseId}"."${linkedRelationName}" VALUES
      ('rec-linked-1', now(), 'Linked A'),
      ('rec-linked-2', now(), 'Linked B')`
  );
  await client.query(`
    CREATE TABLE "${baseId}"."${junctionRelationName}" (
      "id" text PRIMARY KEY,
      "sheet1_id" text NOT NULL REFERENCES "${baseId}"."${mainRelationName}" ("id"),
      "sheet2_id" text NOT NULL REFERENCES "${baseId}"."${linkedRelationName}" ("id")
    )
  `);
  await client.query(
    `INSERT INTO "${baseId}"."${junctionRelationName}" VALUES
      ('lnk1', 'rec1', 'rec-linked-1'),
      ('lnk2', 'rec2', 'rec-linked-2')`
  );
  await client.query(`CREATE SCHEMA "${otherBaseId}"`);
  await client.query(`
    CREATE TABLE "${otherBaseId}"."${mainRelationName}" (
      "id" text PRIMARY KEY,
      "__created_time" timestamp,
      "name" text
    )
  `);
  await client.query(
    `INSERT INTO "${otherBaseId}"."${mainRelationName}" VALUES ('rec-other-1', now(), 'Other space row')`
  );

  await createSharedTables(client, 'public');
  await client.query(
    `INSERT INTO "public"."record_history" VALUES
      ('rh1', $1, 'rec1', 'fld1', '{}'::jsonb, '{"name":"A"}'::jsonb, now(), 'usr'),
      ('rh2', 'tblother', 'rec9', 'fld1', '{}'::jsonb, '{}'::jsonb, now(), 'usr')`,
    [tableId]
  );
  await client.query(
    `INSERT INTO "public"."table_trash" VALUES
      ('tt1', $1, 'table', '{}'::jsonb, now(), 'usr'),
      ('tt2', 'tblother', 'table', '{}'::jsonb, now(), 'usr')`,
    [tableId]
  );
  await client.query(
    `INSERT INTO "public"."record_trash" VALUES
      ('rt1', $1, 'rec1', '{}'::jsonb, now(), 'usr'),
      ('rt2', 'tblother', 'rec9', '{}'::jsonb, now(), 'usr')`,
    [tableId]
  );
  await client.query(
    `INSERT INTO "public"."computed_update_outbox"
      ("id", "base_id", "status", "created_at", "updated_at")
     VALUES
      ('cuo1', $1, 'pending', now(), now()),
      ('cuo2', $2, 'pending', now(), now())`,
    [baseId, otherBaseId]
  );
  await client.query(
    `INSERT INTO "public"."computed_update_dead_letter"
      ("id", "base_id", "status", "created_at", "updated_at", "trace_data", "failed_at")
     VALUES
      ('cudl1', $1, 'failed', now(), now(), '{}'::jsonb, now()),
      ('cudl2', $2, 'failed', now(), now(), '{}'::jsonb, now())`,
    [baseId, otherBaseId]
  );
  await client.query(
    `INSERT INTO "public"."computed_update_outbox_seed" VALUES
      ('seed1', 'cuo1', $1, 'rec1'),
      ('seed2', 'cuo2', $1, 'rec9')`,
    [tableId]
  );
  await client.query(
    `INSERT INTO "public"."computed_update_pause_scope"
      ("id", "scope_type", "scope_id", "paused_at", "paused_by", "reason", "updated_at", "updated_by")
     VALUES
      ('pause-space', 'space', $1, now(), 'usr', $5, now(), 'usr'),
      ('pause-base', 'base', $2, now(), 'usr', 'migration', now(), 'usr'),
      ('pause-table', 'table', $3, now(), 'usr', 'migration', now(), 'usr'),
      ('pause-other', 'space', $4, now(), 'usr', 'other', now(), 'usr')`,
    [spaceId, baseId, tableId, otherSpaceId, `space-data-db-migration:${jobId}`]
  );
  await client.query(
    `INSERT INTO "public"."__undo_log" VALUES
      ('undo1', 'batch1', 'update', $1, 'rec1', '{}'::jsonb, '{}'::jsonb, now()),
      ('undo2', 'batch2', 'update', $2, 'rec9', '{}'::jsonb, '{}'::jsonb, now())`,
    [`${baseId}.${mainRelationName}`, `${otherBaseId}.${mainRelationName}`]
  );
};

const waitUntil = async (predicate: () => boolean, timeoutMs = 1000, pollMs = 10) => {
  const startedAt = Date.now();
  for (;;) {
    if (predicate()) {
      return;
    }
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
};

describeWithPostgres('SpaceDataDbCopyService integration', () => {
  let rootDir: string;
  let dataDir: string;
  let socketDir: string;
  let port: number;

  beforeAll(async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), 'teable-byodb-copy-'));
    dataDir = path.join(rootDir, 'pgdata');
    socketDir = path.join(rootDir, 'socket');
    port = await getFreePort();
    await mkdir(socketDir);
    await execFile('initdb', ['-D', dataDir, '--no-instructions', '--auth=trust']);
    await execFile('pg_ctl', [
      '-D',
      dataDir,
      '-o',
      `-F -p ${port} -k ${socketDir} -c listen_addresses=127.0.0.1`,
      '-l',
      path.join(rootDir, 'postgres.log'),
      '-w',
      'start',
    ]);

    const admin = new Client({ connectionString: pgUrl(port, 'postgres') });
    await admin.connect();
    try {
      await admin.query(`CREATE DATABASE ${sourceDatabase}`);
      await admin.query(`CREATE DATABASE ${targetDatabase}`);
      await admin.query(`CREATE DATABASE ${targetMismatchDatabase}`);
    } finally {
      await admin.end();
    }

    const source = new Client({ connectionString: pgUrl(port, sourceDatabase) });
    const target = new Client({ connectionString: pgUrl(port, targetDatabase) });
    const targetMismatch = new Client({ connectionString: pgUrl(port, targetMismatchDatabase) });
    await Promise.all([source.connect(), target.connect(), targetMismatch.connect()]);
    try {
      await seedSourceData(source);
      await createSharedTables(target, targetSchema);
      await createSharedTables(targetMismatch, targetMismatchSchema);
    } finally {
      await Promise.all([source.end(), target.end(), targetMismatch.end()]);
    }
  }, 30_000);

  afterAll(async () => {
    if (dataDir) {
      await execFile('pg_ctl', ['-D', dataDir, '-m', 'fast', '-w', 'stop']).catch(() => undefined);
    }
    if (rootDir) {
      await rm(rootDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('copies base schemas and validates/switches the migration job through real PostgreSQL tools', async () => {
    const sourceUrl = pgUrl(port, sourceDatabase);
    const targetUrl = pgUrl(port, targetDatabase);
    const service = new SpaceDataDbCopyService(new SpaceDataDbProcessRunnerService());
    await mkdir(path.join(rootDir, 'work'));

    const targetConnection = {
      id: targetConnectionId,
      status: 'migrating',
      internalSchema: targetSchema,
      encryptedUrl: encryptDataDbUrl(targetUrl),
      displayHost: '127.0.0.1',
      displayDatabase: targetDatabase,
      urlFingerprint: 'dbfp_copy_target',
    };
    let currentBinding: {
      mode: 'byodb';
      state: 'ready';
      dataDbConnection: typeof targetConnection;
    } | null = null;
    const txClient = {
      dataDbConnection: {
        update: vi.fn().mockImplementation(async (args) => {
          if (args.where?.id === targetConnectionId) {
            targetConnection.status = args.data.status ?? targetConnection.status;
          }
          return undefined;
        }),
      },
      spaceDataDbBinding: {
        upsert: vi.fn().mockImplementation(async (args) => {
          if (args.where?.spaceId === spaceId) {
            currentBinding = {
              mode: 'byodb',
              state: 'ready',
              dataDbConnection: targetConnection,
            };
          }
          return undefined;
        }),
      },
      spaceDataDbMigrationJob: {
        update: vi.fn().mockResolvedValue(undefined),
      },
    };
    const migrationJob = {
      id: jobId,
      spaceId,
      targetConnectionId,
      targetInternalSchema: targetSchema,
      createdBy: 'usr',
      startedAt: new Date('2026-05-06T00:00:00.000Z'),
      completedAt: null,
      inventory: buildCopyInventory(),
      copyStats: null,
      validationStats: null,
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(targetUrl),
      },
    };
    const prismaService = {
      $tx: vi.fn(async (fn: (client: typeof txClient) => Promise<unknown>) => fn(txClient)),
      base: {
        findUnique: vi.fn().mockImplementation(async (args) => {
          if (args.where?.id === baseId) {
            return { spaceId };
          }
          if (args.where?.id === otherBaseId) {
            return { spaceId: otherSpaceId };
          }
          return null;
        }),
      },
      spaceDataDbBinding: {
        findUnique: vi
          .fn()
          .mockImplementation(async (args) =>
            args.where?.spaceId === spaceId ? currentBinding : null
          ),
      },
      spaceDataDbMigrationJob: {
        findUnique: vi.fn().mockResolvedValue(migrationJob),
        update: vi.fn().mockResolvedValue(undefined),
      },
    };
    const baselineService = {
      getLatestSchemaVersion: vi.fn().mockReturnValue(null),
    };
    const dataDbClientManager = {
      getDataDatabaseForSpace: vi.fn().mockImplementation((_, options) => {
        if (options?.previewBinding) {
          return Promise.resolve({
            cacheKey: targetConnectionId,
            connectionId: targetConnectionId,
            internalSchema: targetSchema,
            isMetaFallback: false,
            url: targetUrl,
          });
        }
        return Promise.resolve({
          cacheKey: 'meta-fallback',
          connectionId: undefined,
          internalSchema: undefined,
          isMetaFallback: true,
          url: sourceUrl,
        });
      }),
      invalidateConnection: vi.fn(),
    };
    const runtimeCache = new DataDbRuntimeCacheService();
    const sourceFallbackKnex = createKnex({
      client: 'pg',
      connection: sourceUrl,
      pool: { min: 0, max: 1 },
    });
    const routingManager = new DataDbClientManager(
      prismaService as never,
      {} as never,
      sourceFallbackKnex,
      runtimeCache
    );
    const migrationService = new SpaceDataDbMigrationService(
      prismaService as never,
      {} as never,
      baselineService as never,
      dataDbClientManager as never,
      service as never,
      dataDbKnexClientFactory
    );

    try {
      await expect(routingManager.dataKnexForBase(baseId)).resolves.toBe(sourceFallbackKnex);

      const baseCopyStats = await migrationService.copyBaseSchemasForJob(jobId, {
        workDir: path.join(rootDir, 'work'),
        jobs: 2,
        timeoutMs: 30_000,
      });

      expect(baseCopyStats).toMatchObject({
        phase: 'base_schemas_completed',
        baseSchemas: {
          copiedRelationCount: 3,
          totalCopiedRows: 6,
          copiedRelations: expect.arrayContaining([
            expect.objectContaining({
              schemaName: baseId,
              relationName: mainRelationName,
              copiedRows: 2,
              estimatedRows: 2,
            }),
            expect.objectContaining({
              schemaName: baseId,
              relationName: linkedRelationName,
              copiedRows: 2,
              estimatedRows: 2,
            }),
            expect.objectContaining({
              schemaName: baseId,
              relationName: junctionRelationName,
              copiedRows: 2,
              estimatedRows: 2,
            }),
          ]),
        },
      });
      expectProcessTiming(baseCopyStats.baseSchemas.dump);
      expectProcessTiming(baseCopyStats.baseSchemas.restore);

      const sharedResults = await service.copySharedTables(
        buildMigrationSharedTablePsqlCopyPlans({
          sourceUrl,
          targetUrl,
          sourceSchema: 'public',
          targetSchema,
          spaceId,
          baseIds: [baseId],
          tableIds: [tableId, linkedTableId],
        }),
        { timeoutMs: 30_000 }
      );

      expect(sharedResults).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ table: 'record_history', copiedRows: 1 }),
          expect.objectContaining({ table: 'table_trash', copiedRows: 1 }),
          expect.objectContaining({ table: 'record_trash', copiedRows: 1 }),
          expect.objectContaining({ table: 'computed_update_outbox', copiedRows: 1 }),
          expect.objectContaining({ table: 'computed_update_dead_letter', copiedRows: 1 }),
          expect.objectContaining({ table: 'computed_update_outbox_seed', copiedRows: 1 }),
          expect.objectContaining({ table: 'computed_update_pause_scope', copiedRows: 3 }),
          expect.objectContaining({ table: '__undo_log', copiedRows: 1 }),
        ])
      );
      const historyCopy = sharedResults.find((result) => result.table === 'record_history');
      expect(historyCopy).toBeDefined();
      if (!historyCopy) {
        throw new Error('Expected record_history copy result');
      }
      expectProcessTiming(historyCopy.source);
      expectProcessTiming(historyCopy.target);

      const target = new Client({ connectionString: targetUrl });
      await target.connect();
      try {
        await expect(
          queryCount(target, `SELECT COUNT(*) AS count FROM "${baseId}"."${mainRelationName}"`)
        ).resolves.toBe(2);
        await target.query(
          `INSERT INTO "${baseId}"."${mainRelationName}" ("id", "__created_time", "__last_modified_time", "name")
           VALUES ('rec3', now(), now(), 'C')`
        );
        await expect(
          queryCount(
            target,
            `SELECT COUNT(*) AS count FROM "${baseId}"."${mainRelationName}" WHERE "__auto_number" = 3`
          )
        ).resolves.toBe(1);
        await expect(
          queryCount(
            target,
            `
            SELECT COUNT(*) AS count
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND c.relname = $1
              AND c.relkind = 'S'
          `,
            [legacyAutoNumberSequenceName]
          )
        ).resolves.toBe(1);
        await expect(
          queryCount(target, `SELECT COUNT(*) AS count FROM "${baseId}"."${linkedRelationName}"`)
        ).resolves.toBe(2);
        await expect(
          queryCount(target, `SELECT COUNT(*) AS count FROM "${baseId}"."${junctionRelationName}"`)
        ).resolves.toBe(2);
        await expect(
          queryCount(
            target,
            `
            SELECT COUNT(*) AS count
            FROM pg_indexes
            WHERE schemaname = $1
              AND indexname = 'sheet1_name_idx'
          `,
            [baseId]
          )
        ).resolves.toBe(1);
        await expect(
          queryCount(
            target,
            `
            SELECT COUNT(*) AS count
            FROM pg_constraint con
            JOIN pg_class c ON c.oid = con.conrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = $1
              AND c.relname = $2
              AND con.conname = 'sheet1_name_nonempty'
          `,
            [baseId, mainRelationName]
          )
        ).resolves.toBe(1);
        await expect(
          queryCount(
            target,
            `
            SELECT COUNT(*) AS count
            FROM pg_trigger tg
            JOIN pg_class c ON c.oid = tg.tgrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = $1
              AND c.relname = $2
              AND tg.tgname = 'sheet1_touch_modified_time'
              AND NOT tg.tgisinternal
          `,
            [baseId, mainRelationName]
          )
        ).resolves.toBe(1);
        await expect(
          queryCount(
            target,
            `SELECT COUNT(*) AS count FROM "${targetSchema}"."record_history" WHERE "table_id" = $1`,
            [tableId]
          )
        ).resolves.toBe(1);
        await expect(
          queryCount(
            target,
            `SELECT COUNT(*) AS count FROM "${targetSchema}"."record_history" WHERE "table_id" = 'tblother'`
          )
        ).resolves.toBe(0);
        await expect(
          queryCount(
            target,
            `SELECT COUNT(*) AS count FROM "${targetSchema}"."table_trash" WHERE "table_id" = $1`,
            [tableId]
          )
        ).resolves.toBe(1);
        await expect(
          queryCount(
            target,
            `SELECT COUNT(*) AS count FROM "${targetSchema}"."table_trash" WHERE "table_id" = 'tblother'`
          )
        ).resolves.toBe(0);
        await expect(
          queryCount(
            target,
            `SELECT COUNT(*) AS count FROM "${targetSchema}"."record_trash" WHERE "table_id" = $1`,
            [tableId]
          )
        ).resolves.toBe(1);
        await expect(
          queryCount(
            target,
            `SELECT COUNT(*) AS count FROM "${targetSchema}"."record_trash" WHERE "table_id" = 'tblother'`
          )
        ).resolves.toBe(0);
        await expect(
          queryCount(
            target,
            `SELECT COUNT(*) AS count FROM "${targetSchema}"."computed_update_outbox" WHERE "base_id" = $1`,
            [baseId]
          )
        ).resolves.toBe(1);
        await expect(
          queryCount(
            target,
            `SELECT COUNT(*) AS count FROM "${targetSchema}"."computed_update_outbox" WHERE "base_id" = $1`,
            [otherBaseId]
          )
        ).resolves.toBe(0);
        await expect(
          queryCount(
            target,
            `SELECT COUNT(*) AS count FROM "${targetSchema}"."computed_update_dead_letter" WHERE "base_id" = $1`,
            [baseId]
          )
        ).resolves.toBe(1);
        await expect(
          queryCount(
            target,
            `SELECT COUNT(*) AS count FROM "${targetSchema}"."computed_update_dead_letter" WHERE "base_id" = $1`,
            [otherBaseId]
          )
        ).resolves.toBe(0);
        await expect(
          queryCount(
            target,
            `SELECT COUNT(*) AS count FROM "${targetSchema}"."computed_update_outbox_seed"`
          )
        ).resolves.toBe(1);
        await expect(
          queryCount(
            target,
            `SELECT COUNT(*) AS count FROM "${targetSchema}"."computed_update_outbox_seed" WHERE "task_id" = 'cuo2'`
          )
        ).resolves.toBe(0);
        await expect(
          queryCount(
            target,
            `SELECT COUNT(*) AS count FROM "${targetSchema}"."computed_update_pause_scope"`
          )
        ).resolves.toBe(3);
        await expect(
          queryCount(
            target,
            `SELECT COUNT(*) AS count FROM "${targetSchema}"."computed_update_pause_scope" WHERE "scope_id" = $1`,
            [otherSpaceId]
          )
        ).resolves.toBe(0);
        await expect(
          queryCount(target, `SELECT COUNT(*) AS count FROM "${targetSchema}"."__undo_log"`)
        ).resolves.toBe(1);
        await expect(
          queryCount(
            target,
            `SELECT COUNT(*) AS count FROM "${targetSchema}"."__undo_log" WHERE "table_name" = $1`,
            [`${otherBaseId}.${mainRelationName}`]
          )
        ).resolves.toBe(0);
      } finally {
        await target.end();
      }

      await expect(migrationService.validateAndSwitchJob(jobId)).resolves.toMatchObject({
        state: 'succeeded',
        validationStats: expect.objectContaining({
          phase: 'validation_completed',
          routeSmoke: expect.objectContaining({
            ok: true,
            connectionId: targetConnectionId,
            internalSchema: targetSchema,
          }),
          baseSchemas: expect.arrayContaining([
            expect.objectContaining({ object: `base:${baseId}.${mainRelationName}` }),
            expect.objectContaining({ object: `base:${baseId}.${linkedRelationName}` }),
            expect.objectContaining({ object: `base:${baseId}.${junctionRelationName}` }),
          ]),
        }),
      });

      const postSwitchKnex = await routingManager.dataKnexForBase(baseId);
      expect(postSwitchKnex).not.toBe(sourceFallbackKnex);
      await postSwitchKnex.raw(
        `INSERT INTO "${baseId}"."${mainRelationName}" ("id", "__created_time", "name") VALUES (?, now(), ?)`,
        ['rec-post-switch', 'BYODB target']
      );
      const otherSpaceKnex = await routingManager.dataKnexForBase(otherBaseId);
      expect(otherSpaceKnex).toBe(sourceFallbackKnex);
      await otherSpaceKnex.raw(
        `INSERT INTO "${otherBaseId}"."${mainRelationName}" ("id", "__created_time", "name") VALUES (?, now(), ?)`,
        ['rec-other-post-switch', 'Default source']
      );

      const source = new Client({ connectionString: sourceUrl });
      const targetAfterSwitch = new Client({ connectionString: targetUrl });
      await Promise.all([source.connect(), targetAfterSwitch.connect()]);
      try {
        await expect(
          queryCount(
            source,
            `SELECT COUNT(*) AS count FROM "${baseId}"."${mainRelationName}" WHERE "id" = 'rec-post-switch'`
          )
        ).resolves.toBe(0);
        await expect(
          queryCount(
            targetAfterSwitch,
            `SELECT COUNT(*) AS count FROM "${baseId}"."${mainRelationName}" WHERE "id" = 'rec-post-switch'`
          )
        ).resolves.toBe(1);
        await expect(
          queryCount(
            source,
            `SELECT COUNT(*) AS count FROM "${otherBaseId}"."${mainRelationName}" WHERE "id" = 'rec-other-post-switch'`
          )
        ).resolves.toBe(1);
        await expect(
          queryCount(
            targetAfterSwitch,
            `
              SELECT COUNT(*) AS count
              FROM information_schema.schemata
              WHERE schema_name = $1
            `,
            [otherBaseId]
          )
        ).resolves.toBe(0);
      } finally {
        await Promise.all([source.end(), targetAfterSwitch.end()]);
      }

      expect(txClient.dataDbConnection.update).toHaveBeenCalledWith({
        where: { id: targetConnectionId },
        data: expect.objectContaining({ status: 'ready', lastError: null }),
      });
      expect(txClient.spaceDataDbBinding.upsert).toHaveBeenCalledWith({
        where: { spaceId },
        create: {
          spaceId,
          dataDbConnectionId: targetConnectionId,
          mode: 'byodb',
          state: 'ready',
          createdBy: 'usr',
        },
        update: {
          dataDbConnectionId: targetConnectionId,
          mode: 'byodb',
          state: 'ready',
        },
      });
      expect(txClient.spaceDataDbMigrationJob.update).toHaveBeenCalledWith({
        where: { id: jobId },
        data: expect.objectContaining({ state: 'succeeded', lastError: null }),
      });
      expect(dataDbClientManager.invalidateConnection).toHaveBeenCalledWith(targetConnectionId);
    } finally {
      await Promise.all([routingManager.onModuleDestroy(), sourceFallbackKnex.destroy()]);
    }
  }, 60_000);

  it('fails validation and keeps source routing when target base rows drift before switch', async () => {
    const sourceUrl = pgUrl(port, sourceDatabase);
    const targetUrl = pgUrl(port, targetMismatchDatabase);
    const service = new SpaceDataDbCopyService(new SpaceDataDbProcessRunnerService());
    await mkdir(path.join(rootDir, 'work-mismatch'));

    const targetConnection = {
      id: mismatchTargetConnectionId,
      status: 'migrating',
      internalSchema: targetMismatchSchema,
      encryptedUrl: encryptDataDbUrl(targetUrl),
      displayHost: '127.0.0.1',
      displayDatabase: targetMismatchDatabase,
      urlFingerprint: 'dbfp_copy_target_mismatch',
    };
    let currentBinding: {
      mode: 'byodb';
      state: 'ready';
      dataDbConnection: typeof targetConnection;
    } | null = null;
    const txClient = {
      dataDbConnection: {
        update: vi.fn().mockImplementation(async (args) => {
          if (args.where?.id === mismatchTargetConnectionId) {
            targetConnection.status = args.data.status ?? targetConnection.status;
          }
          return undefined;
        }),
      },
      spaceDataDbBinding: {
        upsert: vi.fn().mockImplementation(async (args) => {
          if (args.where?.spaceId === spaceId) {
            currentBinding = {
              mode: 'byodb',
              state: 'ready',
              dataDbConnection: targetConnection,
            };
          }
          return undefined;
        }),
      },
      spaceDataDbMigrationJob: {
        update: vi.fn().mockResolvedValue(undefined),
      },
    };
    const migrationJob = {
      id: mismatchJobId,
      spaceId,
      targetConnectionId: mismatchTargetConnectionId,
      targetInternalSchema: targetMismatchSchema,
      createdBy: 'usr',
      startedAt: new Date('2026-05-06T00:00:00.000Z'),
      completedAt: null,
      inventory: buildCopyInventory(),
      copyStats: null,
      validationStats: null,
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(targetUrl),
      },
    };
    const prismaService = {
      $tx: vi.fn(async (fn: (client: typeof txClient) => Promise<unknown>) => fn(txClient)),
      base: {
        findUnique: vi.fn().mockImplementation(async (args) => {
          if (args.where?.id === baseId) {
            return { spaceId };
          }
          return null;
        }),
      },
      spaceDataDbBinding: {
        findUnique: vi
          .fn()
          .mockImplementation(async (args) =>
            args.where?.spaceId === spaceId ? currentBinding : null
          ),
      },
      spaceDataDbMigrationJob: {
        findUnique: vi.fn().mockResolvedValue(migrationJob),
        update: vi.fn().mockResolvedValue(undefined),
      },
    };
    const dataDbClientManager = {
      getDataDatabaseForSpace: vi.fn().mockImplementation((_, options) => {
        if (options?.previewBinding) {
          return Promise.resolve({
            cacheKey: mismatchTargetConnectionId,
            connectionId: mismatchTargetConnectionId,
            internalSchema: targetMismatchSchema,
            isMetaFallback: false,
            url: targetUrl,
          });
        }
        return Promise.resolve({
          cacheKey: 'meta-fallback',
          connectionId: undefined,
          internalSchema: undefined,
          isMetaFallback: true,
          url: sourceUrl,
        });
      }),
      invalidateConnection: vi.fn(),
    };
    const sourceFallbackKnex = createKnex({
      client: 'pg',
      connection: sourceUrl,
      pool: { min: 0, max: 1 },
    });
    const routingManager = new DataDbClientManager(
      prismaService as never,
      {} as never,
      sourceFallbackKnex,
      new DataDbRuntimeCacheService()
    );
    const migrationService = new SpaceDataDbMigrationService(
      prismaService as never,
      {} as never,
      { getLatestSchemaVersion: vi.fn().mockReturnValue(null) } as never,
      dataDbClientManager as never,
      service as never,
      dataDbKnexClientFactory
    );

    try {
      await migrationService.copyBaseSchemasForJob(mismatchJobId, {
        workDir: path.join(rootDir, 'work-mismatch'),
        jobs: 2,
        timeoutMs: 30_000,
      });
      await service.copySharedTables(
        buildMigrationSharedTablePsqlCopyPlans({
          sourceUrl,
          targetUrl,
          sourceSchema: 'public',
          targetSchema: targetMismatchSchema,
          spaceId,
          baseIds: [baseId],
          tableIds: [tableId, linkedTableId],
        }),
        { timeoutMs: 30_000 }
      );

      const target = new Client({ connectionString: targetUrl });
      await target.connect();
      try {
        await target.query(
          `INSERT INTO "${baseId}"."${mainRelationName}" ("id", "__created_time", "name")
           VALUES ('rec-target-extra', now(), 'Target extra row')`
        );
      } finally {
        await target.end();
      }

      await expect(migrationService.validateAndSwitchJob(mismatchJobId)).rejects.toMatchObject({
        data: expect.objectContaining({
          errorCode: 'SPACE_DATA_DB_VALIDATION_MISMATCH',
          mismatches: expect.arrayContaining([
            expect.objectContaining({
              object: `base:${baseId}.${mainRelationName}`,
              sourceCount: 2,
              targetCount: 3,
            }),
          ]),
        }),
      });
      await expect(routingManager.dataKnexForBase(baseId)).resolves.toBe(sourceFallbackKnex);
      expect(txClient.spaceDataDbBinding.upsert).not.toHaveBeenCalled();
      expect(txClient.dataDbConnection.update).not.toHaveBeenCalled();
      expect(dataDbClientManager.invalidateConnection).not.toHaveBeenCalled();
      expect(prismaService.spaceDataDbMigrationJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mismatchJobId },
          data: expect.objectContaining({
            state: 'failed',
            lastError: 'Space data database migration validation failed',
            validationStats: expect.objectContaining({ phase: 'validation_failed' }),
          }),
        })
      );
    } finally {
      await Promise.all([routingManager.onModuleDestroy(), sourceFallbackKnex.destroy()]);
    }
  }, 60_000);

  it('waits for active computed tasks in the source data DB before draining', async () => {
    const sourceUrl = pgUrl(port, sourceDatabase);
    const source = new Client({ connectionString: sourceUrl });
    await source.connect();
    try {
      await source.query(
        `INSERT INTO "public"."computed_update_outbox"
          ("id", "base_id", "status", "locked_at", "created_at", "updated_at")
         VALUES
          ('cuo-active-drain', $1, 'processing', now(), now(), now()),
          ('cuo-active-other-base', 'bseother', 'processing', now(), now(), now())
         ON CONFLICT ("id") DO UPDATE
         SET "base_id" = EXCLUDED."base_id",
             "status" = EXCLUDED."status",
             "locked_at" = EXCLUDED."locked_at",
             "updated_at" = EXCLUDED."updated_at"`,
        [baseId]
      );
    } finally {
      await source.end();
    }

    const updates: unknown[] = [];
    const migrationJob = {
      id: jobId,
      spaceId,
      targetInternalSchema: targetSchema,
      createdBy: 'usr',
      startedAt: new Date('2026-05-06T00:00:00.000Z'),
      inventory: {
        baseIds: [baseId],
        tableIds: [tableId],
        dbTableNames: [`${baseId}.sheet1`],
        physicalSchemas: [],
      },
      targetConnection: null,
    };
    const prismaService = {
      spaceDataDbMigrationJob: {
        findUnique: vi.fn().mockResolvedValue(migrationJob),
        findFirst: vi.fn().mockResolvedValue({ id: jobId, spaceId, state: 'copying' }),
        update: vi.fn().mockImplementation(async (args: unknown) => {
          updates.push(args);
          return undefined;
        }),
      },
    };
    const dataDbClientManager = {
      getDataDatabaseForSpace: vi.fn().mockResolvedValue({
        cacheKey: 'meta-fallback',
        connectionId: undefined,
        internalSchema: undefined,
        isMetaFallback: true,
        url: sourceUrl,
      }),
      invalidateConnection: vi.fn(),
    };
    const migrationService = new SpaceDataDbMigrationService(
      prismaService as never,
      {} as never,
      { getLatestSchemaVersion: vi.fn().mockReturnValue(null) } as never,
      dataDbClientManager as never,
      new SpaceDataDbCopyService(new SpaceDataDbProcessRunnerService()) as never,
      dataDbKnexClientFactory
    );

    const drain = migrationService.waitForSourceComputedDrainForJob(jobId, {
      timeoutMs: 2000,
      pollMs: 20,
      processingLeaseMs: 120_000,
    });

    await waitUntil(() =>
      updates.some((item) => {
        const args = item as { data?: { copyStats?: { phase?: string; computedDrain?: unknown } } };
        const computedDrain = args.data?.copyStats?.computedDrain as
          | { activeCount?: number }
          | undefined;
        return (
          args.data?.copyStats?.phase === 'computed_draining' && computedDrain?.activeCount === 1
        );
      })
    );

    const finisher = new Client({ connectionString: sourceUrl });
    await finisher.connect();
    try {
      await finisher.query(
        `UPDATE "public"."computed_update_outbox"
         SET "status" = 'pending',
             "locked_at" = NULL,
             "updated_at" = now()
         WHERE "id" = 'cuo-active-drain'`
      );
    } finally {
      await finisher.end();
    }

    await expect(drain).resolves.toMatchObject({
      activeCount: 0,
      reclaimableCount: 0,
    });
    expect(prismaService.spaceDataDbMigrationJob.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: jobId },
        data: expect.objectContaining({
          copyStats: expect.objectContaining({
            phase: 'computed_drained',
            computedDrain: expect.objectContaining({
              activeCount: 0,
              reclaimableCount: 0,
            }),
          }),
        }),
      })
    );

    const verifier = new Client({ connectionString: sourceUrl });
    await verifier.connect();
    try {
      await expect(
        queryCount(
          verifier,
          `SELECT COUNT(*) AS count
           FROM "public"."computed_update_outbox"
           WHERE "id" = 'cuo-active-other-base'
             AND "base_id" = 'bseother'
             AND "status" = 'processing'`
        )
      ).resolves.toBe(1);
    } finally {
      await verifier.end();
    }
  }, 30_000);
});

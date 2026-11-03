import { HttpErrorCode } from '@teable/core';
import { PgPoolRegistry } from '@teable/db-main-prisma';
import type { Knex } from 'knex';
import { Pool } from 'pg';
import { DataType, newDb } from 'pg-mem';
import { describe, expect, it, vi } from 'vitest';
import { encryptDataDbUrl } from '../features/space/data-db-url-secret';
import {
  DataDbBindingNotReadyError,
  DataDbClientManager,
  restoreComputedOutboxDeadLetterRows,
  type IComputedOutboxDeadLetterRow,
} from './data-db-client-manager.service';
import type { IDataDbRoutingBinding } from './data-db-client-manager.service';
import { DataDbRuntimeCacheService } from './data-db-runtime-cache.service';

const withTxClient = <T extends object>(txClient: T) => ({
  ...txClient,
  txClient: vi.fn(() => txClient),
});

const createManager = (
  prismaService: ConstructorParameters<typeof DataDbClientManager>[0],
  dataPrisma: ConstructorParameters<typeof DataDbClientManager>[1],
  knex: ConstructorParameters<typeof DataDbClientManager>[2],
  runtimeCache: ConstructorParameters<typeof DataDbClientManager>[3],
  migrationService?: ConstructorParameters<typeof DataDbClientManager>[5],
  cls?: ConstructorParameters<typeof DataDbClientManager>[6]
) =>
  new DataDbClientManager(
    prismaService,
    dataPrisma,
    knex,
    runtimeCache,
    new PgPoolRegistry((config) => new Pool(config)),
    migrationService,
    cls
  );

const dataUrl = 'postgresql://teable:secret@example.com:5432/teable_data';
const internalSchema = 'teable_meta_test';
const connectionId = 'dcnxxx';
const displayHost = 'example.com';
const displayDatabase = 'teable_data';
const urlFingerprint = 'fp_xxx';

const createComputedRecoveryDb = async () => {
  const mem = newDb();
  const db = mem.adapters.createKnex();
  await db.schema.createTable('computed_update_outbox', (table: Knex.TableBuilder) => {
    table.text('id').primary();
    table.text('worker_lane').notNullable().defaultTo('production');
    table.text('base_id');
    table.text('seed_table_id');
    table.jsonb('seed_record_ids');
    table.text('change_type');
    table.jsonb('steps');
    table.jsonb('edges');
    table.text('status');
    table.integer('attempts');
    table.integer('max_attempts');
    table.timestamp('next_run_at');
    table.timestamp('locked_at');
    table.text('locked_by');
    table.text('last_error');
    table.integer('estimated_complexity');
    table.text('plan_hash').notNullable();
    table.jsonb('dirty_stats');
    table.text('run_id');
    table.specificType('origin_run_ids', 'text[]');
    table.integer('run_total_steps');
    table.integer('run_completed_steps_before');
    table.specificType('affected_table_ids', 'text[]');
    table.specificType('affected_field_ids', 'text[]');
    table.integer('sync_max_level');
    table.timestamp('source_changed_at');
    table.integer('stage_depth');
    table.text('predecessor_task_id');
    table.integer('dead_letter_restore_version');
    table.timestamp('created_at');
    table.timestamp('updated_at');
  });
  await db.raw(
    `create unique index computed_update_outbox_pending_unique_idx
       on computed_update_outbox(base_id, seed_table_id, plan_hash, change_type)
       where status = 'pending'`
  );
  await db.schema.createTable('computed_update_outbox_seed', (table: Knex.TableBuilder) => {
    table.text('id').primary();
    table.text('task_id');
    table.text('table_id');
    table.text('record_id');
    table.unique(['task_id', 'table_id', 'record_id']);
  });
  await db.schema.createTable('computed_update_dead_letter', (table: Knex.TableBuilder) =>
    table.text('id').primary()
  );
  await db.schema.createTable('computed_update_dead_letter_seed', (table: Knex.TableBuilder) => {
    table.text('task_id');
    table.text('table_id');
    table.text('record_id');
    table.primary(['task_id', 'table_id', 'record_id']);
  });
  // pg-mem cannot run the plpgsql authorization guard or its triggers; the real
  // PostgreSQL guard matrix proves that contract. Keep this unit scenario on the
  // actual delete contract: remove exactly the archives whose rerun was inserted.
  mem.public.registerFunction({
    name: 'computed_outbox_complete_restore',
    args: [mem.public.getType(DataType.text).asArray()],
    returns: DataType.integer,
    implementation: (taskIds: string[]) => {
      const ids = taskIds ?? [];
      if (ids.length === 0) return 0;
      const list = ids.map((id) => `'${String(id).replaceAll("'", "''")}'`).join(',');
      mem.public.none(`delete from computed_update_dead_letter_seed where task_id in (${list})`);
      mem.public.none(`delete from computed_update_dead_letter where id in (${list})`);
      return ids.length;
    },
  });
  return db;
};

const createDeadLetterRow = (taskId: string): IComputedOutboxDeadLetterRow => ({
  taskId,
  workerLane: 'production',
  baseId: 'bse1',
  seedTableId: 'tbl1',
  seedRecordIds: [{ tableId: 'tbl1', recordIds: [`rec-${taskId}`] }],
  changeType: 'seed',
  steps: [],
  edges: [],
  maxAttempts: 8,
  estimatedComplexity: 1,
  planHash: 'same-plan',
  dirtyStats: {
    changeType: 'update',
    impact: { valueFieldIds: ['fld1'], linkFieldIds: [] },
    beforeImageRecords: [],
    orchestration: { operationId: `op-${taskId}` },
  },
  runId: `run-${taskId}`,
  originRunIds: [],
  runTotalSteps: 1,
  runCompletedStepsBefore: 0,
  affectedTableIds: ['tbl1'],
  affectedFieldIds: ['fld1'],
  syncMaxLevel: 0,
  sourceChangedAt: new Date('2026-08-06T11:59:00.000Z'),
  createdAt: new Date('2026-08-06T12:00:00.000Z'),
});

describe('DataDbClientManager', () => {
  it('includes BYODB base-to-space routing needed to honor space pauses', async () => {
    vi.stubEnv('PRISMA_DATABASE_URL', 'postgresql://meta.example/teable');
    const prismaService = withTxClient({
      dataDbConnection: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: connectionId,
            encryptedUrl: encryptDataDbUrl(dataUrl),
            internalSchema,
            spaceBindings: [{ spaceId: 'spc_a' }, { spaceId: 'spc_b' }],
          },
        ]),
      },
      base: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'bse_a', spaceId: 'spc_a' },
          { id: 'bse_b', spaceId: 'spc_b' },
        ]),
      },
    });
    const manager = createManager(
      prismaService as never,
      {} as never,
      {} as never,
      new DataDbRuntimeCacheService()
    );

    const targets = await manager.listComputedOutboxMaintenanceTargets();

    expect(targets[1]).toMatchObject({
      storage: 'byodb',
      baseSpaceMapping: [
        { baseId: 'bse_a', spaceId: 'spc_a' },
        { baseId: 'bse_b', spaceId: 'spc_b' },
      ],
    });
  });

  it('falls back to the meta DB clients when a space has no BYODB binding', async () => {
    const prismaService = withTxClient({
      spaceDataDbBinding: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    });
    const metaFallbackDataPrisma = {};
    const metaFallbackDataKnex = {};
    const manager = createManager(
      prismaService as never,
      metaFallbackDataPrisma as never,
      metaFallbackDataKnex as never,
      new DataDbRuntimeCacheService()
    );

    await expect(manager.dataPrismaForSpace('spcxxx')).resolves.toBe(metaFallbackDataPrisma);
    await expect(manager.dataKnexForSpace('spcxxx')).resolves.toBe(metaFallbackDataKnex);
  });

  it('refuses the meta fallback when the primary shows a binding the transaction read missed', async () => {
    const txClient = {
      spaceDataDbBinding: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };
    const prismaService = {
      ...withTxClient(txClient),
      spaceDataDbBinding: {
        findUnique: vi.fn().mockResolvedValue({ mode: 'byodb' }),
      },
    };
    const manager = createManager(
      prismaService as never,
      {} as never,
      {} as never,
      new DataDbRuntimeCacheService()
    );

    await expect(manager.dataPrismaForSpace('spc_ghost', { useTransaction: true })).rejects.toThrow(
      /meta fallback while a 'byodb' binding exists/
    );
    expect(prismaService.spaceDataDbBinding.findUnique).toHaveBeenCalledWith({
      where: { spaceId: 'spc_ghost' },
      select: { mode: true },
    });
  });

  it('resolves base scoped clients through the base space', async () => {
    const prismaService = withTxClient({
      base: {
        findUnique: vi.fn().mockResolvedValue({ spaceId: 'spcxxx' }),
      },
      spaceDataDbBinding: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    });
    const metaFallbackDataPrisma = {};
    const metaFallbackDataKnex = {};
    const manager = createManager(
      prismaService as never,
      metaFallbackDataPrisma as never,
      metaFallbackDataKnex as never,
      new DataDbRuntimeCacheService()
    );

    await expect(manager.dataPrismaForBase('bsexxx')).resolves.toBe(metaFallbackDataPrisma);
    await expect(manager.dataKnexForBase('bsexxx')).resolves.toBe(metaFallbackDataKnex);
    expect(prismaService.base.findUnique).toHaveBeenCalledWith({ where: { id: 'bsexxx' } });
    expect(prismaService.txClient).not.toHaveBeenCalled();
  });

  it('resolves table scoped clients through the table base space', async () => {
    const prismaService = withTxClient({
      tableMeta: {
        findUnique: vi.fn().mockResolvedValue({ base: { spaceId: 'spcxxx' } }),
      },
      spaceDataDbBinding: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    });
    const metaFallbackDataPrisma = {};
    const metaFallbackDataKnex = {};
    const manager = createManager(
      prismaService as never,
      metaFallbackDataPrisma as never,
      metaFallbackDataKnex as never,
      new DataDbRuntimeCacheService()
    );

    await expect(manager.dataPrismaForTable('tblxxx')).resolves.toBe(metaFallbackDataPrisma);
    await expect(manager.dataKnexForTable('tblxxx')).resolves.toBe(metaFallbackDataKnex);
    expect(prismaService.tableMeta.findUnique).toHaveBeenCalledWith({
      where: { id: 'tblxxx' },
      include: { base: true },
    });
    expect(prismaService.txClient).not.toHaveBeenCalled();
  });

  it('uses the active transaction when explicitly requested', async () => {
    const txClient = {
      tableMeta: {
        findUnique: vi.fn().mockResolvedValue({ base: { spaceId: 'spc_in_tx' } }),
      },
      spaceDataDbBinding: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };
    const prismaService = {
      ...withTxClient(txClient),
      tableMeta: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };
    const metaFallbackDataPrisma = {};
    const metaFallbackDataKnex = {};
    const manager = createManager(
      prismaService as never,
      metaFallbackDataPrisma as never,
      metaFallbackDataKnex as never,
      new DataDbRuntimeCacheService()
    );

    await expect(
      manager.dataPrismaForTable('tbl_new_in_tx', { useTransaction: true })
    ).resolves.toBe(metaFallbackDataPrisma);
    expect(txClient.tableMeta.findUnique).toHaveBeenCalledWith({
      where: { id: 'tbl_new_in_tx' },
      select: { base: { select: { spaceId: true } } },
    });
    expect(prismaService.tableMeta.findUnique).not.toHaveBeenCalled();
  });

  it('uses the root meta client by default even when transaction context exists', async () => {
    const txClient = {
      tableMeta: {
        findUnique: vi.fn().mockResolvedValue({ base: { spaceId: 'spc_in_tx' } }),
      },
      spaceDataDbBinding: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };
    const prismaService = {
      ...withTxClient(txClient),
      tableMeta: {
        findUnique: vi.fn().mockResolvedValue({ base: { spaceId: 'spc_after_tx' } }),
      },
      spaceDataDbBinding: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };
    const metaFallbackDataPrisma = {};
    const metaFallbackDataKnex = {};
    const manager = createManager(
      prismaService as never,
      metaFallbackDataPrisma as never,
      metaFallbackDataKnex as never,
      new DataDbRuntimeCacheService()
    );

    await expect(manager.dataPrismaForTable('tbl_after_tx')).resolves.toBe(metaFallbackDataPrisma);
    expect(txClient.tableMeta.findUnique).not.toHaveBeenCalled();
    expect(prismaService.tableMeta.findUnique).toHaveBeenCalledWith({
      where: { id: 'tbl_after_tx' },
      include: { base: true },
    });
    expect(prismaService.spaceDataDbBinding.findUnique).toHaveBeenCalledWith({
      where: { spaceId: 'spc_after_tx' },
      include: { dataDbConnection: true },
    });
  });

  it('resolves a base and a table through the meta db once per request', async () => {
    const store = new Map<string, unknown>();
    const cls = {
      isActive: () => true,
      get: (key: string) => store.get(key),
      set: (key: string, value: unknown) => {
        store.set(key, value);
      },
    };
    const base = { id: 'bsexxx', spaceId: 'spcxxx' };
    const prismaService = withTxClient({
      base: { findUnique: vi.fn().mockResolvedValue(base) },
      tableMeta: { findUnique: vi.fn().mockResolvedValue({ id: 'tblxxx', baseId: base.id, base }) },
      spaceDataDbBinding: { findUnique: vi.fn().mockResolvedValue(null) },
    });
    const metaFallbackDataPrisma = {};
    const metaFallbackDataKnex = {};
    const manager = createManager(
      prismaService as never,
      metaFallbackDataPrisma as never,
      metaFallbackDataKnex as never,
      new DataDbRuntimeCacheService(),
      undefined,
      cls as never
    );

    await manager.getDataDatabaseForBase('bsexxx');
    await manager.dataPrismaForBase('bsexxx');
    await manager.dataKnexForBase('bsexxx');
    await manager.getDataDatabaseForTable('tblxxx');
    await manager.dataPrismaForTable('tblxxx');

    // The table load carries its base row, so the base key is already warm.
    expect(prismaService.tableMeta.findUnique).toHaveBeenCalledTimes(1);
    expect(prismaService.base.findUnique).toHaveBeenCalledTimes(1);
    expect(prismaService.spaceDataDbBinding.findUnique).toHaveBeenCalledTimes(1);
  });

  it('uses a fresh routing snapshot instead of a cached default route', async () => {
    const store = new Map<string, unknown>();
    const cls = {
      isActive: () => true,
      get: (key: string) => store.get(key),
      set: (key: string, value: unknown) => {
        store.set(key, value);
      },
    };
    const binding: IDataDbRoutingBinding = {
      mode: 'byodb',
      state: 'ready',
      dataDbConnection: {
        id: connectionId,
        status: 'ready',
        internalSchema,
        displayHost,
        displayDatabase,
        urlFingerprint,
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
    };
    const readBinding = vi.fn().mockResolvedValue(null);
    const manager = createManager(
      withTxClient({ spaceDataDbBinding: { findUnique: readBinding } }) as never,
      {} as never,
      {} as never,
      new DataDbRuntimeCacheService(),
      undefined,
      cls as never
    );
    expect((await manager.getDataDatabaseForSpace('spcxxx')).isMetaFallback).toBe(true);
    const resolved = await manager.getDataDatabaseFromRoutingSnapshot({
      spaceId: 'spcxxx',
      binding,
    });
    expect(resolved).toMatchObject({
      isMetaFallback: false,
      connectionId,
      connectionUrl: dataUrl,
      internalSchema,
    });
    expect(store.get('dataDb')).toMatchObject({ mode: 'byodb', spaceId: 'spcxxx', connectionId });
    await expect(
      manager.getDataDatabaseFromRoutingSnapshot({
        spaceId: 'spcxxx',
        binding: { ...binding, state: 'initializing' },
      })
    ).rejects.toBeInstanceOf(DataDbBindingNotReadyError);
    expect(readBinding).toHaveBeenCalledTimes(1);
  });

  it('accepts missing/default snapshots but never falls back for an invalid bound route', async () => {
    const manager = createManager(
      {} as never,
      {} as never,
      {} as never,
      new DataDbRuntimeCacheService()
    );
    for (const binding of [
      null,
      { mode: 'default', state: 'initializing', dataDbConnection: null },
    ]) {
      expect(
        (await manager.getDataDatabaseFromRoutingSnapshot({ spaceId: 'spcxxx', binding }))
          .isMetaFallback
      ).toBe(true);
    }
    await expect(
      manager.getDataDatabaseFromRoutingSnapshot({
        spaceId: 'spcxxx',
        binding: { mode: 'byodb', state: 'ready', dataDbConnection: null },
      })
    ).rejects.toThrow('was not found');
    await expect(
      manager.getDataDatabaseFromRoutingSnapshot({
        spaceId: 'spcxxx',
        binding: {
          mode: 'byodb',
          state: 'ready',
          dataDbConnection: {
            id: connectionId,
            status: 'disabled',
            encryptedUrl: encryptDataDbUrl(dataUrl),
            internalSchema,
            urlFingerprint,
            displayHost,
            displayDatabase,
          },
        },
      })
    ).rejects.toBeInstanceOf(DataDbBindingNotReadyError);
  });

  it('keeps migration failures fatal for prefetched BYODB routes', async () => {
    const migration = {
      ensureConnectionMigrated: vi.fn().mockRejectedValue(new Error('migration unavailable')),
    };
    const manager = createManager(
      {} as never,
      {} as never,
      {} as never,
      new DataDbRuntimeCacheService(),
      migration as never
    );
    const snapshot = {
      spaceId: 'spcxxx',
      binding: {
        mode: 'byodb',
        state: 'migrating',
        dataDbConnection: {
          id: connectionId,
          status: 'migrating',
          encryptedUrl: encryptDataDbUrl(dataUrl),
          internalSchema,
          urlFingerprint,
          displayHost,
          displayDatabase,
        },
      },
    };
    await expect(manager.getDataDatabaseFromRoutingSnapshot(snapshot)).rejects.toThrow(
      'migration unavailable'
    );
    migration.ensureConnectionMigrated.mockResolvedValueOnce(undefined);
    expect((await manager.getDataDatabaseFromRoutingSnapshot(snapshot)).connectionUrl).toBe(
      dataUrl
    );
  });

  it('resolves BYODB connection details from a ready space binding', async () => {
    const cls = {
      isActive: vi.fn().mockReturnValue(true),
      set: vi.fn(),
    };
    const prismaService = withTxClient({
      spaceDataDbBinding: {
        findUnique: vi.fn().mockResolvedValue({
          mode: 'byodb',
          state: 'ready',
          dataDbConnection: {
            id: connectionId,
            status: 'ready',
            internalSchema,
            displayHost,
            displayDatabase,
            urlFingerprint,
            encryptedUrl: encryptDataDbUrl(dataUrl),
          },
        }),
      },
    });
    const metaFallbackDataPrisma = {};
    const metaFallbackDataKnex = {};
    const manager = createManager(
      prismaService as never,
      metaFallbackDataPrisma as never,
      metaFallbackDataKnex as never,
      new DataDbRuntimeCacheService(),
      undefined,
      cls as never
    );

    await expect(manager.getDataDatabaseUrlForSpace('spcxxx')).resolves.toBe(
      `${dataUrl}?schema=${internalSchema}&options=-c+search_path%3D${internalSchema}`
    );
    await expect(manager.getDataDatabaseForSpace('spcxxx')).resolves.toMatchObject({
      cacheKey: connectionId,
      connectionId,
      isMetaFallback: false,
      url: `${dataUrl}?schema=${internalSchema}&options=-c+search_path%3D${internalSchema}`,
    });
    expect(cls.set).toHaveBeenCalledWith('dataDb', {
      mode: 'byodb',
      spaceId: 'spcxxx',
      connectionId,
      urlFingerprint,
      displayHost,
      displayDatabase,
      internalSchema,
    });
    await expect(manager.dataKnexForSpace('spcxxx')).resolves.toBe(metaFallbackDataKnex);
    await manager.onModuleDestroy();
  });

  it('can preview a BYODB route for a space without writing a binding', async () => {
    const prismaService = withTxClient({
      spaceDataDbBinding: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    });
    const manager = createManager(
      prismaService as never,
      {} as never,
      {} as never,
      new DataDbRuntimeCacheService()
    );

    await expect(
      manager.getDataDatabaseForSpace('spcxxx', {
        previewBinding: {
          spaceId: 'spcxxx',
          connectionId,
          encryptedUrl: encryptDataDbUrl(dataUrl),
          internalSchema,
          urlFingerprint,
          displayHost,
          displayDatabase,
        },
      })
    ).resolves.toMatchObject({
      cacheKey: connectionId,
      connectionId,
      internalSchema,
      isMetaFallback: false,
      url: `${dataUrl}?schema=${internalSchema}&options=-c+search_path%3D${internalSchema}`,
    });
    expect(prismaService.spaceDataDbBinding.findUnique).not.toHaveBeenCalled();
  });

  it('can force the original source route to meta fallback during migration', async () => {
    vi.stubEnv('PRISMA_DATABASE_URL', 'postgresql://meta.example/teable');
    const prismaService = withTxClient({
      dataDbConnection: {
        findUnique: vi.fn(),
      },
      spaceDataDbBinding: {
        findUnique: vi.fn().mockResolvedValue({
          mode: 'byodb',
          state: 'migrating',
          dataDbConnection: {
            id: connectionId,
            status: 'migrating',
            internalSchema,
            encryptedUrl: encryptDataDbUrl(dataUrl),
          },
        }),
      },
    });
    const manager = createManager(
      prismaService as never,
      {} as never,
      {} as never,
      new DataDbRuntimeCacheService()
    );

    await expect(
      manager.getDataDatabaseForSpace('spcxxx', { sourceConnectionId: null })
    ).resolves.toMatchObject({
      cacheKey: 'meta-fallback',
      isMetaFallback: true,
    });
    expect(prismaService.spaceDataDbBinding.findUnique).not.toHaveBeenCalled();
    expect(prismaService.dataDbConnection.findUnique).not.toHaveBeenCalled();
  });

  it('can resolve the original source BYODB connection during migration', async () => {
    const sourceConnectionId = 'dcnsource';
    const sourceSchema = 'source_schema';
    const sourceUrl = 'postgresql://teable:secret@source.example.com:5432/teable_data';
    const prismaService = withTxClient({
      dataDbConnection: {
        findUnique: vi.fn().mockResolvedValue({
          id: sourceConnectionId,
          internalSchema: sourceSchema,
          encryptedUrl: encryptDataDbUrl(sourceUrl),
        }),
      },
      spaceDataDbBinding: {
        findUnique: vi.fn(),
      },
    });
    const manager = createManager(
      prismaService as never,
      {} as never,
      {} as never,
      new DataDbRuntimeCacheService()
    );

    await expect(
      manager.getDataDatabaseForSpace('spcxxx', { sourceConnectionId })
    ).resolves.toMatchObject({
      cacheKey: sourceConnectionId,
      connectionId: sourceConnectionId,
      internalSchema: sourceSchema,
      isMetaFallback: false,
      url: `${sourceUrl}?schema=${sourceSchema}&options=-c+search_path%3D${sourceSchema}`,
    });
    expect(prismaService.dataDbConnection.findUnique).toHaveBeenCalledWith({
      where: { id: sourceConnectionId },
    });
    expect(prismaService.spaceDataDbBinding.findUnique).not.toHaveBeenCalled();
  });

  it('resolves BYODB connection details when no CLS context is active', async () => {
    const cls = {
      isActive: vi.fn().mockReturnValue(false),
      set: vi.fn(() => {
        throw new Error('No CLS context available');
      }),
    };
    const prismaService = withTxClient({
      spaceDataDbBinding: {
        findUnique: vi.fn().mockResolvedValue({
          mode: 'byodb',
          state: 'ready',
          dataDbConnection: {
            id: connectionId,
            status: 'ready',
            internalSchema,
            displayHost,
            displayDatabase,
            urlFingerprint,
            encryptedUrl: encryptDataDbUrl(dataUrl),
          },
        }),
      },
    });
    const manager = createManager(
      prismaService as never,
      {} as never,
      {} as never,
      new DataDbRuntimeCacheService(),
      undefined,
      cls as never
    );

    await expect(manager.getDataDatabaseUrlForSpace('spcxxx')).resolves.toBe(
      `${dataUrl}?schema=${internalSchema}&options=-c+search_path%3D${internalSchema}`
    );
    expect(cls.set).not.toHaveBeenCalled();
  });

  it('resolves ready preview routing without migration-on-acquire', async () => {
    const migration = {
      getLatestSchemaVersion: vi.fn().mockReturnValue('schema-current'),
      ensureConnectionMigrated: vi.fn(),
    };
    const prismaService = withTxClient({
      spaceDataDbBinding: {
        findUnique: vi.fn().mockResolvedValue({
          mode: 'byodb',
          state: 'ready',
          dataDbConnection: {
            id: connectionId,
            status: 'ready',
            schemaVersion: 'schema-current',
            internalSchema,
            encryptedUrl: encryptDataDbUrl(dataUrl),
          },
        }),
      },
    });
    const manager = createManager(
      prismaService as never,
      {} as never,
      {} as never,
      new DataDbRuntimeCacheService(),
      migration as never
    );

    await expect(manager.getDataDatabaseForSpacePreviewReadOnly('spcxxx')).resolves.toMatchObject({
      cacheKey: connectionId,
      connectionId,
      isMetaFallback: false,
    });
    expect(migration.ensureConnectionMigrated).not.toHaveBeenCalled();
  });

  it('returns unknown routing evidence for a stale preview database without migration writes', async () => {
    const migration = {
      getLatestSchemaVersion: vi.fn().mockReturnValue('schema-current'),
      ensureConnectionMigrated: vi.fn(),
    };
    const prismaService = withTxClient({
      tableMeta: {
        findUnique: vi.fn().mockResolvedValue({ base: { spaceId: 'spcxxx' } }),
      },
      spaceDataDbBinding: {
        findUnique: vi.fn().mockResolvedValue({
          mode: 'byodb',
          state: 'ready',
          dataDbConnection: {
            id: connectionId,
            status: 'ready',
            schemaVersion: 'schema-stale',
            internalSchema,
            encryptedUrl: encryptDataDbUrl(dataUrl),
          },
        }),
      },
    });
    const manager = createManager(
      prismaService as never,
      {} as never,
      {} as never,
      new DataDbRuntimeCacheService(),
      migration as never
    );

    await expect(manager.getDataDatabaseForTablePreviewReadOnly('tblxxx')).resolves.toBeNull();
    expect(migration.ensureConnectionMigrated).not.toHaveBeenCalled();
  });

  it('ensures the BYODB internal schema is migrated before returning a scoped URL', async () => {
    const dataDbMigrationService = {
      ensureConnectionMigrated: vi.fn().mockResolvedValue([]),
    };
    const prismaService = withTxClient({
      spaceDataDbBinding: {
        findUnique: vi.fn().mockResolvedValue({
          mode: 'byodb',
          state: 'migrating',
          dataDbConnection: {
            id: connectionId,
            status: 'migrating',
            internalSchema,
            encryptedUrl: encryptDataDbUrl(dataUrl),
          },
        }),
      },
    });
    const manager = createManager(
      prismaService as never,
      {} as never,
      {} as never,
      new DataDbRuntimeCacheService(),
      dataDbMigrationService as never
    );

    await expect(manager.getDataDatabaseForSpace('spcxxx')).resolves.toMatchObject({
      cacheKey: connectionId,
      connectionId,
      internalSchema,
      isMetaFallback: false,
    });
    expect(dataDbMigrationService.ensureConnectionMigrated).toHaveBeenCalledWith({
      connectionId,
      internalSchema,
      url: dataUrl,
    });
  });

  it(
    'restores an entire large same-plan dead-letter group without pending-plan conflicts',
    async () => {
      const db = await createComputedRecoveryDb();
      const taskCount = 2000;
      const rows = Array.from({ length: taskCount }, (_, index) =>
        createDeadLetterRow(index === 0 ? 'cuo-live' : `cuo-${index}`)
      );
      try {
        await db('computed_update_outbox').insert({
          id: 'cuo-live',
          base_id: 'bse1',
          seed_table_id: 'tbl1',
          change_type: 'seed',
          status: 'pending',
          plan_hash: 'same-plan',
        });
        await db('computed_update_dead_letter').insert(rows.map(({ taskId }) => ({ id: taskId })));

        const result = await db.transaction(
          async (trx: Knex.Transaction) => await restoreComputedOutboxDeadLetterRows(trx, rows)
        );

        expect(result).toMatchObject({ inserted: taskCount - 1, alreadyPending: 1 });
        expect(result.tasks).toHaveLength(taskCount);
        await expect(db('computed_update_outbox').count({ count: '*' })).resolves.toEqual([
          { count: taskCount },
        ]);
        // Only archives whose rerun was inserted are completed; the already-pending
        // task keeps its archive and is not rewritten.
        await expect(db('computed_update_dead_letter').pluck('id')).resolves.toEqual(['cuo-live']);
        const restoredRows = await db('computed_update_outbox')
          .whereNot({ id: 'cuo-live' })
          .select(
            'id',
            'run_id',
            'origin_run_ids',
            'dead_letter_restore_version',
            'status',
            'attempts',
            'stage_depth',
            'predecessor_task_id',
            'seed_record_ids'
          );
        expect(restoredRows).toHaveLength(taskCount - 1);
        expect(new Set(restoredRows.map((row) => row.run_id)).size).toBe(taskCount - 1);
        for (const row of restoredRows) {
          expect(row.origin_run_ids).toEqual([row.run_id]);
          expect(row.dead_letter_restore_version).toBe(1);
          expect(row.status).toBe('pending');
          expect(row.attempts).toBe(0);
          expect(row.stage_depth).toBe(0);
          expect(row.predecessor_task_id).toBeNull();
          expect(row.seed_record_ids).toBeNull();
        }
        const restoredSeeds = await db('computed_update_outbox_seed').select(
          'task_id',
          'record_id'
        );
        expect(restoredSeeds).toHaveLength(taskCount - 1);
        expect(new Set(restoredSeeds.map((row) => row.task_id)).size).toBe(taskCount - 1);
        const replayPlanHashes = await db('computed_update_outbox')
          .whereNot({ id: 'cuo-live' })
          .pluck('plan_hash');
        expect(new Set(replayPlanHashes).size).toBe(taskCount - 1);
      } finally {
        await db.destroy();
      }
      // V8 coverage instrumentation (SONAR_COVERAGE_RUN) slows this bulk restore several times over.
    },
    process.env.SONAR_COVERAGE_RUN === '1' ? 60_000 : 15_000
  );

  it('restores an archived seed trigger as a fresh rerun without continuation state', async () => {
    const db = await createComputedRecoveryDb();
    const row: IComputedOutboxDeadLetterRow = {
      ...createDeadLetterRow('cuo-seed-rerun'),
      seedRecordIds: [
        { tableId: 'tbl1', recordIds: ['rec1'] },
        { tableId: 'tbl2', recordIds: ['rec2'] },
      ],
      dirtyStats: {
        changeType: 'delete',
        impact: { valueFieldIds: ['fld1'], linkFieldIds: ['fld2'] },
        beforeImageRecords: [{ recordId: 'rec1', fieldValuesByDbName: { value: 'before' } }],
        orchestration: { operationId: 'op-seed-rerun' },
        traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01',
        tracestate: 'vendor=value',
        ledgerScopeId: 'cuo-chain-root',
        partialStageBudget: { maxSteps: 1, maxFields: 1, maxEdges: 1 },
        seedAllCursors: { tbl1: 'rec0' },
        terminalFieldErrors: [{ fieldId: 'fld-stale' }],
      },
      runTotalSteps: 9,
      runCompletedStepsBefore: 7,
      syncMaxLevel: 4,
    };
    await db('computed_update_dead_letter').insert({ id: row.taskId });

    try {
      await db.transaction(
        async (trx: Knex.Transaction) => await restoreComputedOutboxDeadLetterRows(trx, [row])
      );

      const restored = await db('computed_update_outbox').where({ id: row.taskId }).first();
      expect(restored).toMatchObject({
        change_type: 'seed',
        seed_record_ids: null,
        attempts: 0,
        run_total_steps: 0,
        run_completed_steps_before: 0,
        affected_table_ids: ['tbl1'],
        affected_field_ids: ['fld1'],
        sync_max_level: 0,
        stage_depth: 0,
        predecessor_task_id: null,
      });
      expect(JSON.parse(String(restored.steps))).toEqual([]);
      expect(JSON.parse(String(restored.edges))).toEqual([]);
      const restoredDirtyStats = JSON.parse(String(restored.dirty_stats));
      expect(restoredDirtyStats).toEqual({
        changeType: 'delete',
        impact: { valueFieldIds: ['fld1'], linkFieldIds: ['fld2'] },
        beforeImageRecords: [{ recordId: 'rec1', fieldValuesByDbName: { value: 'before' } }],
        orchestration: { operationId: 'op-seed-rerun' },
        traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01',
        tracestate: 'vendor=value',
      });
      await expect(
        db('computed_update_outbox_seed')
          .where({ task_id: row.taskId })
          .orderBy(['table_id', 'record_id'])
          .select(['table_id', 'record_id'])
      ).resolves.toEqual([
        { table_id: 'tbl1', record_id: 'rec1' },
        { table_id: 'tbl2', record_id: 'rec2' },
      ]);
    } finally {
      await db.destroy();
    }
  });

  it('restores an archived planned stage as a fresh current-stage rerun', async () => {
    const db = await createComputedRecoveryDb();
    const row: IComputedOutboxDeadLetterRow = {
      ...createDeadLetterRow('cuo-planned-stage'),
      changeType: 'update',
      steps: [{ level: 2, tableId: 'tbl2', fieldIds: ['fld2'] }],
      edges: [
        {
          fromTableId: 'tbl1',
          toTableId: 'tbl2',
          mode: 'same_record',
          propagationSourceFieldIds: ['fld1'],
        },
      ],
      dirtyStats: {
        rerunInputs: { version: 1, complete: true, seedCount: '0' },
        dirtyStats: [{ tableId: 'tbl1', recordCount: 1 }],
        beforeImageRecords: [{ recordId: 'rec1', fieldValuesByDbName: { value: 'before' } }],
        orchestration: { operationId: 'op-stage-rerun' },
        sameTableBatches: [{ tableId: 'tbl2', fieldIds: ['fld2'] }],
        ledgerScopeId: 'cuo-chain-root',
        partialStageBudget: { maxSteps: 1, maxFields: 1, maxEdges: 1 },
        seedAllCursors: { tbl1: 'rec0' },
        terminalFieldErrors: [{ fieldId: 'fld-stale' }],
      },
      runTotalSteps: 9,
      runCompletedStepsBefore: 7,
      syncMaxLevel: 2,
    };
    await db('computed_update_dead_letter').insert({ id: row.taskId });

    try {
      await db.transaction(
        async (trx: Knex.Transaction) => await restoreComputedOutboxDeadLetterRows(trx, [row])
      );

      const restored = await db('computed_update_outbox').where({ id: row.taskId }).first();
      expect(restored).toMatchObject({
        change_type: 'update',
        seed_record_ids: null,
        attempts: 0,
        run_total_steps: 1,
        run_completed_steps_before: 0,
        sync_max_level: 2,
        stage_depth: 0,
        predecessor_task_id: null,
      });
      expect(JSON.parse(String(restored.steps))).toEqual(row.steps);
      expect(JSON.parse(String(restored.edges))).toEqual([
        { fromTableId: 'tbl1', toTableId: 'tbl2', mode: 'same_record' },
      ]);
      expect(row.edges).toEqual([
        {
          fromTableId: 'tbl1',
          toTableId: 'tbl2',
          mode: 'same_record',
          propagationSourceFieldIds: ['fld1'],
        },
      ]);
      expect(JSON.parse(String(restored.dirty_stats))).toEqual({
        plannedRerun: true,
        dirtyStats: [{ tableId: 'tbl1', recordCount: 1 }],
        beforeImageRecords: [{ recordId: 'rec1', fieldValuesByDbName: { value: 'before' } }],
        orchestration: { operationId: 'op-stage-rerun' },
        sameTableBatches: [{ tableId: 'tbl2', fieldIds: ['fld2'] }],
      });
      await expect(
        db('computed_update_outbox_seed').where({ task_id: row.taskId }).select('record_id')
      ).resolves.toEqual([{ record_id: `rec-${row.taskId}` }]);
      await expect(
        db('computed_update_dead_letter').where({ id: row.taskId })
      ).resolves.toHaveLength(0);
    } finally {
      await db.destroy();
    }
  });

  it('reruns an archived field backfill from the start of its field scope', async () => {
    const db = await createComputedRecoveryDb();
    const row: IComputedOutboxDeadLetterRow = {
      ...createDeadLetterRow('cuo-backfill'),
      changeType: 'field-backfill',
      seedRecordIds: null,
      dirtyStats: { fieldBackfillCursor: 'rec-old' },
      affectedFieldIds: ['fld1', 'fld2'],
      runCompletedStepsBefore: 7,
    };
    await db('computed_update_dead_letter').insert({ id: row.taskId });
    try {
      await db.transaction(
        async (trx: Knex.Transaction) => await restoreComputedOutboxDeadLetterRows(trx, [row])
      );
      const restored = await db('computed_update_outbox').where({ id: row.taskId }).first();
      expect(restored).toMatchObject({
        change_type: 'field-backfill',
        affected_field_ids: ['fld1', 'fld2'],
        run_total_steps: 1,
        run_completed_steps_before: 0,
      });
      expect(JSON.parse(String(restored.dirty_stats))).toEqual({});
    } finally {
      await db.destroy();
    }
  });

  it.each(['insert', 'update', 'delete'])(
    'preserves an incomplete historical partial %s archive',
    async (changeType) => {
      const db = await createComputedRecoveryDb();
      const row = {
        ...createDeadLetterRow('legacy-partial'),
        changeType,
        predecessorTaskId: 'prior-task',
        dirtyStats: { partialStageBudget: { maxSteps: 1, maxFields: 1, maxEdges: 1 } },
      };
      await db('computed_update_dead_letter').insert({ id: row.taskId });
      try {
        await expect(
          db.transaction((trx: Knex.Transaction) => restoreComputedOutboxDeadLetterRows(trx, [row]))
        ).rejects.toThrow('no complete durable rerun inputs');
        expect(await db('computed_update_dead_letter').where({ id: row.taskId })).toHaveLength(1);
        expect(await db('computed_update_outbox').where({ id: row.taskId })).toHaveLength(0);
      } finally {
        await db.destroy();
      }
    }
  );

  it('lists BYODB-bound bases even when their connection is not queryable', async () => {
    const prismaService = withTxClient({
      base: {
        findMany: vi.fn().mockResolvedValue([{ id: 'bse_disabled' }, { id: 'bse_ready' }]),
      },
    });
    const manager = createManager(
      prismaService as never,
      {} as never,
      {} as never,
      new DataDbRuntimeCacheService()
    );

    await expect(manager.listByodbBoundBaseIds()).resolves.toEqual(['bse_disabled', 'bse_ready']);
    expect(prismaService.base.findMany).toHaveBeenCalledWith({
      where: {
        deletedTime: null,
        space: {
          dataDbBinding: {
            is: { mode: 'byodb' },
          },
        },
      },
      select: { id: true },
    });
  });

  it('refuses to resolve a BYODB space whose connection is disabled', async () => {
    const prismaService = withTxClient({
      spaceDataDbBinding: {
        findUnique: vi.fn().mockResolvedValue({
          mode: 'byodb',
          state: 'ready',
          dataDbConnection: {
            id: connectionId,
            status: 'disabled',
            internalSchema,
            displayHost,
            displayDatabase,
            urlFingerprint,
            encryptedUrl: encryptDataDbUrl(dataUrl),
          },
        }),
      },
    });
    const manager = createManager(
      prismaService as never,
      {} as never,
      {} as never,
      new DataDbRuntimeCacheService(),
      { ensureConnectionMigrated: vi.fn() } as never
    );

    await expect(manager.getDataDatabaseForSpace('spcDisabled')).rejects.toMatchObject({
      name: DataDbBindingNotReadyError.name,
      code: HttpErrorCode.DATABASE_CONNECTION_UNAVAILABLE,
      message: 'Data database binding for space spcDisabled is not ready',
    });
  });
});

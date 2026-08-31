import { HttpErrorCode } from '@teable/core';
import { PgPoolRegistry } from '@teable/db-main-prisma';
import type { Knex } from 'knex';
import { Pool } from 'pg';
import { newDb } from 'pg-mem';
import { describe, expect, it, vi } from 'vitest';
import { encryptDataDbUrl } from '../features/space/data-db-url-secret';
import {
  DataDbBindingNotReadyError,
  DataDbClientManager,
  restoreComputedOutboxDeadLetterRows,
  type IComputedOutboxDeadLetterRow,
} from './data-db-client-manager.service';
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
  const db = newDb().adapters.createKnex();
  await db.schema.createTable('computed_update_outbox', (table: Knex.TableBuilder) => {
    table.text('id').primary();
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
    table.timestamp('created_at');
    table.timestamp('updated_at');
  });
  await db.raw(
    `create unique index computed_update_outbox_pending_unique_idx
       on computed_update_outbox(base_id, seed_table_id, plan_hash, change_type)
       where status = 'pending'`
  );
  await db.schema.createTable('computed_update_dead_letter', (table: Knex.TableBuilder) =>
    table.text('id').primary()
  );
  return db;
};

const createDeadLetterRow = (taskId: string): IComputedOutboxDeadLetterRow => ({
  taskId,
  baseId: 'bse1',
  seedTableId: 'tbl1',
  seedRecordIds: [`rec-${taskId}`],
  changeType: 'update',
  steps: [],
  edges: [],
  maxAttempts: 8,
  estimatedComplexity: 1,
  planHash: 'same-plan',
  dirtyStats: null,
  runId: `run-${taskId}`,
  originRunIds: [],
  runTotalSteps: 1,
  runCompletedStepsBefore: 0,
  affectedTableIds: ['tbl1'],
  affectedFieldIds: ['fld1'],
  syncMaxLevel: 0,
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
    expect(prismaService.base.findUnique).toHaveBeenCalledWith({
      where: { id: 'bsexxx' },
      select: { spaceId: true },
    });
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
      select: { base: { select: { spaceId: true } } },
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
      select: { base: { select: { spaceId: true } } },
    });
    expect(prismaService.spaceDataDbBinding.findUnique).toHaveBeenCalledWith({
      where: { spaceId: 'spc_after_tx' },
      include: { dataDbConnection: true },
    });
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

  it('restores an entire large same-plan dead-letter group without pending-plan conflicts', async () => {
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
        change_type: 'update',
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
      await expect(db('computed_update_dead_letter').count({ count: '*' })).resolves.toEqual([
        { count: 0 },
      ]);
      const replayPlanHashes = await db('computed_update_outbox')
        .whereNot({ id: 'cuo-live' })
        .pluck('plan_hash');
      expect(new Set(replayPlanHashes).size).toBe(taskCount - 1);
    } finally {
      await db.destroy();
    }
  }, 15_000);

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

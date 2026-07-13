/* eslint-disable sonarjs/no-duplicate-string */
import { FieldType, HttpErrorCode } from '@teable/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fingerprintDatabaseUrl, fingerprintDataDbConnection } from './data-db-preflight.service';
import { encryptDataDbUrl } from './data-db-url-secret';
import { spaceDataDbMigrationStages } from './space-data-db-migration-progress';
import { SpaceDataDbMigrationService } from './space-data-db-migration.service';
import {
  SpaceDataDbProcessCanceledError,
  SpaceDataDbProcessError,
  SpaceDataDbProcessPipelineError,
} from './space-data-db-process-runner.service';

const dataUrl = 'postgresql://teable:secret@example.com:5432/teable_data';
const internalSchema = 'teable_meta_test';
const schemaVersion = '20260421000000_init_data_db_baseline';
const capabilities = {
  createSchema: true,
  createTable: true,
  createFunction: true,
  createTrigger: true,
  createRole: false,
  grantPrivileges: true,
  inspectActivity: true,
};

const processResult = (command: string, stdout = '') => ({
  command,
  args: [],
  exitCode: 0,
  signal: null,
  stderr: '',
  stdout,
  startedAt: '2026-05-06T00:00:00.000Z',
  completedAt: '2026-05-06T00:00:01.000Z',
  durationMs: 1000,
});

const columnSignatureRows = (
  columns: {
    ordinalPosition?: number;
    columnName: string;
    formattedType: string;
    notNull?: boolean;
    defaultExpression?: string | null;
  }[] = [
    { columnName: '__id', formattedType: 'text', notNull: true },
    { columnName: 'fldName', formattedType: 'text' },
  ]
) =>
  columns.map((column, index) => ({
    ordinalPosition: column.ordinalPosition ?? index + 1,
    columnName: column.columnName,
    formattedType: column.formattedType,
    notNull: column.notNull ?? false,
    defaultExpression: column.defaultExpression ?? null,
    identity: '',
    generated: '',
    collation: 'default',
  }));

const indexSignatureRows = (
  indexes: {
    indexName: string;
    isPrimary?: boolean;
    isUnique?: boolean;
    definition: string;
  }[] = []
) =>
  indexes.map((index) => ({
    indexName: index.indexName,
    isPrimary: index.isPrimary ?? false,
    isUnique: index.isUnique ?? false,
    isValid: true,
    definition: index.definition,
  }));

const constraintSignatureRows = (
  constraints: {
    constraintName: string;
    constraintType: string;
    definition: string;
  }[] = []
) => constraints;

const triggerSignatureRows = (
  triggers: {
    triggerName: string;
    enabled?: string;
    definition: string;
  }[] = []
) =>
  triggers.map((trigger) => ({
    triggerName: trigger.triggerName,
    enabled: trigger.enabled ?? 'O',
    definition: trigger.definition,
  }));

describe('SpaceDataDbMigrationService', () => {
  const txClient = {
    dataDbConnection: {
      upsert: vi.fn(),
      update: vi.fn(),
    },
    spaceDataDbBinding: {
      upsert: vi.fn(),
    },
    spaceDataDbMigrationJob: {
      create: vi.fn(),
      update: vi.fn(),
    },
  };
  const prismaService = {
    $tx: vi.fn(async (fn: (client: typeof txClient) => Promise<unknown>) => fn(txClient)),
    spaceDataDbBinding: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    spaceDataDbMigrationJob: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    schemaOperation: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    base: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    space: {
      findMany: vi.fn(),
    },
    tableMeta: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    field: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    $queryRawUnsafe: vi.fn(),
  };
  const preflightService = {
    preflight: vi.fn(),
  };
  const baselineService = {
    initialize: vi.fn(),
    getLatestSchemaVersion: vi.fn(),
  };
  const sourceDataPrisma = {
    $queryRawUnsafe: vi.fn(),
  };
  const dataDbClientManager = {
    dataPrismaForSpace: vi.fn(),
    getDataDatabaseForSpace: vi.fn(),
    invalidateConnection: vi.fn(),
  };
  const copyService = {
    assertPostgresToolsAvailable: vi.fn(),
    copyBaseSchemas: vi.fn(),
    copySharedTables: vi.fn(),
    copySharedTablesViaPostgresFdw: vi.fn(),
  };
  const targetClient = {
    raw: vi.fn(),
    destroy: vi.fn(),
  };
  const sourceSnapshotTransaction = {
    raw: vi.fn(),
    rollback: vi.fn(),
  };
  const sourceClient = {
    raw: vi.fn(),
    destroy: vi.fn(),
    beginTransaction: vi.fn(),
  };

  beforeEach(() => {
    vi.stubEnv('PRISMA_DATABASE_URL', 'postgresql://source.example/teable');
    txClient.dataDbConnection.upsert.mockReset().mockResolvedValue({ id: 'dcnxxx' });
    txClient.dataDbConnection.update.mockReset().mockResolvedValue(undefined);
    txClient.spaceDataDbBinding.upsert.mockReset().mockResolvedValue(undefined);
    txClient.spaceDataDbMigrationJob.create.mockReset().mockResolvedValue({ id: 'sdmjxxx' });
    txClient.spaceDataDbMigrationJob.update.mockReset().mockResolvedValue(undefined);
    prismaService.$tx.mockClear();
    prismaService.spaceDataDbBinding.findUnique.mockReset().mockResolvedValue(null);
    prismaService.spaceDataDbMigrationJob.findFirst.mockReset().mockResolvedValue(null);
    prismaService.spaceDataDbMigrationJob.findMany.mockReset().mockResolvedValue([]);
    prismaService.spaceDataDbMigrationJob.findUnique.mockReset().mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      sourceConnectionId: null,
      targetConnectionId: 'dcnxxx',
      switchOnCompletion: true,
      targetInternalSchema: internalSchema,
      createdBy: 'usrxxx',
      inventory: {
        baseIds: ['bsexxx'],
        tableIds: ['tblxxx'],
        dbTableNames: ['bsexxx.sheet1'],
        physicalSchemas: [{ schemaName: 'bsexxx', relations: [], totalBytes: 1024 }],
      },
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
    });
    prismaService.spaceDataDbMigrationJob.update.mockReset().mockResolvedValue(undefined);
    prismaService.spaceDataDbMigrationJob.updateMany.mockReset().mockResolvedValue({ count: 0 });
    prismaService.schemaOperation.count.mockReset().mockResolvedValue(0);
    prismaService.schemaOperation.findMany.mockReset().mockResolvedValue([]);
    prismaService.base.count.mockReset().mockResolvedValue(0);
    prismaService.base.findMany.mockReset().mockResolvedValue([
      {
        id: 'bsexxx',
        tables: [{ id: 'tblxxx', dbTableName: 'bsexxx.sheet1' }],
      },
    ]);
    prismaService.space.findMany.mockReset().mockResolvedValue([
      {
        id: 'spcxxx',
        name: 'Space',
        baseGroup: [
          {
            id: 'bsexxx',
            tables: [{ id: 'tblxxx' }],
          },
        ],
      },
    ]);
    prismaService.tableMeta.count.mockReset().mockResolvedValue(0);
    prismaService.tableMeta.findMany.mockReset().mockImplementation((args?: unknown) => {
      const where = (args as { where?: { baseId?: { in?: string[] }; id?: { in?: string[] } } })
        ?.where;
      if (where?.baseId?.in) {
        return Promise.resolve(
          where.baseId.in.flatMap((baseId) => (baseId === 'bsexxx' ? [{ id: 'tblxxx' }] : []))
        );
      }
      if (where?.id?.in?.includes('tblxxx')) {
        return Promise.resolve([{ id: 'tblxxx', dbTableName: 'bsexxx.sheet1' }]);
      }
      return Promise.resolve([
        {
          id: 'tblxxx',
          base: { spaceId: 'spcxxx' },
          dbTableName: 'bsexxx.sheet1',
        },
      ]);
    });
    prismaService.field.count.mockReset().mockResolvedValue(0);
    prismaService.field.findMany.mockReset().mockResolvedValue([]);
    prismaService.$queryRawUnsafe.mockReset().mockResolvedValue([]);
    prismaService.spaceDataDbBinding.findMany.mockReset().mockResolvedValue([]);
    preflightService.preflight.mockReset().mockResolvedValue({
      ok: true,
      provider: 'postgres',
      classification: 'empty',
      capabilities,
      errors: [],
    });
    baselineService.initialize.mockReset().mockResolvedValue(schemaVersion);
    baselineService.getLatestSchemaVersion.mockReset().mockReturnValue(schemaVersion);
    sourceDataPrisma.$queryRawUnsafe.mockReset().mockResolvedValue([
      {
        schemaName: 'bsexxx',
        relationName: 'sheet1',
        relationKind: 'table',
        totalBytes: '1024',
        estimatedRows: '10',
      },
    ]);
    dataDbClientManager.dataPrismaForSpace.mockReset().mockResolvedValue(sourceDataPrisma);
    dataDbClientManager.getDataDatabaseForSpace.mockReset().mockImplementation((_, options) => {
      if ('sourceConnectionId' in (options ?? {})) {
        if (options.sourceConnectionId === 'dcnsource') {
          return Promise.resolve({
            cacheKey: 'dcnsource',
            connectionId: 'dcnsource',
            internalSchema: 'source_schema',
            isMetaFallback: false,
            url: 'postgresql://source.example/byodb?schema=source_schema&options=-c+search_path%3Dsource_schema',
          });
        }
        return Promise.resolve({
          cacheKey: 'meta-fallback',
          connectionId: undefined,
          internalSchema: undefined,
          isMetaFallback: true,
          url: 'postgresql://source.example/teable',
        });
      }
      if (options?.previewBinding) {
        const previewSchema = options.previewBinding.internalSchema;
        return Promise.resolve({
          cacheKey: 'dcnxxx',
          connectionId: 'dcnxxx',
          internalSchema: previewSchema,
          isMetaFallback: false,
          url: `${dataUrl}?schema=${previewSchema}&options=-c+search_path%3D${previewSchema}`,
        });
      }
      return Promise.resolve({
        cacheKey: 'meta-fallback',
        connectionId: undefined,
        internalSchema: undefined,
        isMetaFallback: true,
        url: 'postgresql://source.example/teable',
      });
    });
    dataDbClientManager.invalidateConnection.mockReset();
    copyService.assertPostgresToolsAvailable
      .mockReset()
      .mockResolvedValue([
        processResult('pg_dump'),
        processResult('pg_restore'),
        processResult('psql'),
      ]);
    copyService.copyBaseSchemas.mockReset().mockImplementation((input?: { strategy?: string }) => {
      if (input?.strategy === 'pg_dump_restore') {
        return Promise.resolve({
          strategy: 'pg_dump_restore',
          dump: processResult('pg_dump'),
          restore: processResult('pg_restore'),
        });
      }
      return Promise.resolve({
        strategy: 'pg_dump_stream_restore',
        stream: {
          source: processResult('pg_dump'),
          target: processResult('pg_restore'),
        },
      });
    });
    copyService.copySharedTables.mockReset().mockResolvedValue([
      {
        strategy: 'psql_copy',
        table: 'record_history',
        copiedRows: 5,
        source: processResult('psql'),
        target: processResult('psql', 'COPY 5\n'),
      },
    ]);
    copyService.copySharedTablesViaPostgresFdw.mockReset().mockResolvedValue([
      {
        strategy: 'postgres_fdw',
        table: 'record_history',
        copiedRows: 5,
        target: processResult('psql', 'INSERT 0 5\n'),
      },
    ]);
    targetClient.raw.mockReset().mockResolvedValue({ rows: [] });
    targetClient.destroy.mockReset().mockResolvedValue(undefined);
    sourceSnapshotTransaction.raw.mockReset().mockImplementation((sql: string) => {
      if (sql.includes('pg_export_snapshot')) {
        return { rows: [{ snapshotId: '00000003-0000001A-1' }] };
      }
      return { rows: [] };
    });
    sourceSnapshotTransaction.rollback.mockReset().mockResolvedValue(undefined);
    sourceClient.beginTransaction.mockReset().mockResolvedValue(sourceSnapshotTransaction);
    sourceClient.raw.mockReset().mockImplementation((sql: string) => {
      if (sql.includes('pg_export_snapshot')) {
        return { rows: [{ snapshotId: '00000003-0000001A-1' }] };
      }
      if (sql.includes(`MAX("seq")`)) {
        return { rows: [{ maxSeq: 0 }] };
      }
      return { rows: [] };
    });
    sourceClient.destroy.mockReset().mockResolvedValue(undefined);
  });

  const createService = (
    statfs?: never,
    queues?: {
      baseImportCsvQueue?: unknown;
      baseImportJunctionCsvQueue?: unknown;
      tableImportCsvChunkQueue?: unknown;
      tableImportCsvQueue?: unknown;
    }
  ) =>
    new SpaceDataDbMigrationService(
      prismaService as never,
      preflightService as never,
      baselineService as never,
      dataDbClientManager as never,
      copyService as never,
      (url) => (url.includes('source.example') ? sourceClient : targetClient),
      statfs,
      queues?.baseImportCsvQueue as never,
      queues?.baseImportJunctionCsvQueue as never,
      queues?.tableImportCsvChunkQueue as never,
      queues?.tableImportCsvQueue as never
    );

  const mockValidationClient = (
    client: Pick<typeof sourceClient, 'raw'>,
    rowCount: number,
    signatures: {
      columns?: ReturnType<typeof columnSignatureRows>;
      indexes?: ReturnType<typeof indexSignatureRows>;
      constraints?: ReturnType<typeof constraintSignatureRows>;
      triggers?: ReturnType<typeof triggerSignatureRows>;
      contentHash?: string;
    } = {}
  ) => {
    const columns = signatures.columns ?? columnSignatureRows();
    const indexes = signatures.indexes ?? indexSignatureRows();
    const constraints = signatures.constraints ?? constraintSignatureRows();
    const triggers = signatures.triggers ?? triggerSignatureRows();
    client.raw.mockImplementation((sql: string) => {
      if (sql.includes('FROM pg_class c')) {
        return {
          rows: [
            {
              schemaName: 'bsexxx',
              relationName: 'sheet1',
              relationKind: 'table',
            },
          ],
        };
      }
      if (sql.includes('FROM pg_attribute a')) {
        return {
          rows: columns.map((row) => ({ schemaName: 'bsexxx', relationName: 'sheet1', ...row })),
        };
      }
      if (sql.includes('FROM pg_index i')) {
        return {
          rows: indexes.map((row) => ({ schemaName: 'bsexxx', relationName: 'sheet1', ...row })),
        };
      }
      if (sql.includes('FROM pg_constraint con')) {
        return {
          rows: constraints.map((row) => ({
            schemaName: 'bsexxx',
            relationName: 'sheet1',
            ...row,
          })),
        };
      }
      if (sql.includes('FROM pg_trigger tg')) {
        return {
          rows: triggers.map((row) => ({ schemaName: 'bsexxx', relationName: 'sheet1', ...row })),
        };
      }
      if (sql.includes('FROM "bsexxx"."sheet1"')) {
        return { rows: [{ count: String(rowCount), contentHash: signatures.contentHash ?? null }] };
      }
      if (sql.includes(`MAX("seq")`)) {
        return { rows: [{ maxSeq: 0 }] };
      }
      if (sql.includes('to_regprocedure')) {
        return { rows: [{ exists: true }] };
      }
      if (sql.includes('__teable_data_schema_migrations')) {
        return { rows: [{ exists: true }] };
      }
      if (sql.includes('COUNT(*)')) {
        return { rows: [{ count: '0' }] };
      }
      return { rows: [] };
    });
  };

  it('rejects concurrent active migration for the same space', async () => {
    prismaService.spaceDataDbMigrationJob.findFirst.mockResolvedValue({
      id: 'sdmjactive',
      state: 'copying',
    });
    const service = createService();

    await expect(
      service.startMigrationForSpace('spcxxx', 'usrxxx', {
        url: dataUrl,
        targetMode: 'migrate-space',
        internalSchema,
      })
    ).rejects.toMatchObject({
      code: HttpErrorCode.CONFLICT,
      data: expect.objectContaining({
        errorCode: 'SPACE_DATA_DB_MIGRATION_ACTIVE',
        migrationJobId: 'sdmjactive',
      }),
    });
    expect(preflightService.preflight).not.toHaveBeenCalled();
    expect(targetClient.raw).not.toHaveBeenCalled();
    expect(prismaService.$tx).not.toHaveBeenCalled();
  });

  it('returns preflight errors when the migration target URL cannot be parsed', async () => {
    preflightService.preflight.mockResolvedValue({
      ok: false,
      provider: 'postgres',
      classification: 'non-empty-unknown',
      capabilities,
      errors: [{ code: 'INVALID_DATABASE_URL', message: 'Invalid URL' }],
    });
    const service = createService();

    await expect(
      service.startMigrationForSpace('spcxxx', 'usrxxx', {
        url: 'not-a-postgres-url',
        targetMode: 'migrate-space',
      })
    ).rejects.toMatchObject({
      code: HttpErrorCode.CONFLICT,
      data: expect.objectContaining({
        preflight: expect.objectContaining({
          errors: [expect.objectContaining({ code: 'INVALID_DATABASE_URL' })],
        }),
      }),
    });
    expect(targetClient.raw).not.toHaveBeenCalled();
    expect(prismaService.$tx).not.toHaveBeenCalled();
  });

  it('persists source physical schema inventory for DB-to-DB copy planning', async () => {
    sourceDataPrisma.$queryRawUnsafe.mockResolvedValue([
      {
        schemaName: 'bsexxx',
        relationName: 'junction_tblxxx_fldxxx',
        relationKind: 'table',
        totalBytes: '2048',
        estimatedRows: '3',
      },
      {
        schemaName: 'bsexxx',
        relationName: 'sheet1',
        relationKind: 'table',
        totalBytes: '1024',
        estimatedRows: '10',
      },
      {
        schemaName: 'bsexxx',
        relationName: 'sheet1___auto_number_seq',
        relationKind: 'sequence',
        totalBytes: '512',
        estimatedRows: null,
      },
    ]);
    const service = createService();

    await service.startMigrationForSpace('spcxxx', 'usrxxx', {
      url: dataUrl,
      targetMode: 'migrate-space',
      internalSchema,
    });

    expect(dataDbClientManager.dataPrismaForSpace).toHaveBeenCalledWith('spcxxx');
    expect(sourceDataPrisma.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('FROM pg_class c'),
      ['bsexxx']
    );
    expect(txClient.spaceDataDbMigrationJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        inventory: expect.objectContaining({
          sourceDataDb: {
            mode: 'default',
            cacheKey: 'meta-fallback',
            connectionId: null,
            internalSchema: null,
            isMetaFallback: true,
          },
          targetDataDb: {
            internalSchema,
          },
          physicalSchemas: [
            {
              schemaName: 'bsexxx',
              totalBytes: 3584,
              estimatedRows: 13,
              relations: [
                {
                  schemaName: 'bsexxx',
                  relationName: 'junction_tblxxx_fldxxx',
                  relationKind: 'table',
                  totalBytes: 2048,
                  estimatedRows: 3,
                },
                {
                  schemaName: 'bsexxx',
                  relationName: 'sheet1',
                  relationKind: 'table',
                  totalBytes: 1024,
                  estimatedRows: 10,
                },
                {
                  schemaName: 'bsexxx',
                  relationName: 'sheet1___auto_number_seq',
                  relationKind: 'sequence',
                  totalBytes: 512,
                  estimatedRows: null,
                },
              ],
            },
          ],
          postgresExtensionDependencies: [],
          outOfScopeForeignKeys: [],
          estimatedTotalBytes: 3584,
          estimatedTotalRows: 13,
        }),
      }),
      select: { id: true },
    });
  });

  it('persists out-of-space foreign keys for filtered per-space restore planning', async () => {
    sourceDataPrisma.$queryRawUnsafe
      .mockResolvedValueOnce([
        {
          schemaName: 'bsexxx',
          relationName: 'sheet1',
          relationKind: 'table',
          totalBytes: '1024',
          estimatedRows: '10',
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          schemaName: 'bsexxx',
          tableName: 'sheet1',
          constraintName: 'fk_out_of_scope',
          referencedSchemaName: 'bseyyy',
          referencedTableName: 'sheet2',
        },
      ]);
    const service = createService();

    await service.startMigrationForSpace('spcxxx', 'usrxxx', {
      url: dataUrl,
      targetMode: 'migrate-space',
      internalSchema,
    });

    expect(sourceDataPrisma.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('referenced_ns.nspname <> ALL($1::text[])'),
      ['bsexxx']
    );
    expect(txClient.spaceDataDbMigrationJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        inventory: expect.objectContaining({
          outOfScopeForeignKeys: [
            {
              schemaName: 'bsexxx',
              tableName: 'sheet1',
              constraintName: 'fk_out_of_scope',
              referencedSchemaName: 'bseyyy',
              referencedTableName: 'sheet2',
            },
          ],
        }),
      }),
      select: { id: true },
    });
  });

  it('requires explicit confirmation before starting a large estimated migration', async () => {
    const largeBytes = 51 * 1024 * 1024 * 1024;
    sourceDataPrisma.$queryRawUnsafe.mockResolvedValue([
      {
        schemaName: 'bsexxx',
        relationName: 'sheet1',
        relationKind: 'table',
        totalBytes: String(largeBytes),
        estimatedRows: '10',
      },
    ]);
    const service = createService();

    await expect(
      service.startMigrationForSpace('spcxxx', 'usrxxx', {
        url: dataUrl,
        targetMode: 'migrate-space',
        internalSchema,
      })
    ).rejects.toMatchObject({
      code: HttpErrorCode.CONFLICT,
      data: expect.objectContaining({
        errorCode: 'SPACE_DATA_DB_LARGE_MIGRATION_CONFIRMATION_REQUIRED',
        confirmationField: 'confirmLargeMigration',
        estimatedTotalBytes: largeBytes,
        estimatedTotalRows: 10,
        thresholds: expect.objectContaining({
          bytes: 50 * 1024 * 1024 * 1024,
        }),
      }),
    });
    expect(targetClient.raw).not.toHaveBeenCalled();
    expect(baselineService.initialize).not.toHaveBeenCalled();
    expect(prismaService.$tx).not.toHaveBeenCalled();
  });

  it('starts a large estimated migration when operator confirmation is present', async () => {
    const largeBytes = 51 * 1024 * 1024 * 1024;
    sourceDataPrisma.$queryRawUnsafe.mockResolvedValue([
      {
        schemaName: 'bsexxx',
        relationName: 'sheet1',
        relationKind: 'table',
        totalBytes: String(largeBytes),
        estimatedRows: '10',
      },
    ]);
    const service = createService();

    await expect(
      service.startMigrationForSpace('spcxxx', 'usrxxx', {
        url: dataUrl,
        targetMode: 'migrate-space',
        internalSchema,
        confirmLargeMigration: true,
      })
    ).resolves.toMatchObject({
      jobId: 'sdmjxxx',
      connectionId: 'dcnxxx',
    });
    expect(baselineService.initialize).toHaveBeenCalledWith(dataUrl, internalSchema);
    expect(txClient.spaceDataDbMigrationJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        inventory: expect.objectContaining({
          estimatedTotalBytes: largeBytes,
          estimatedTotalRows: 10,
        }),
      }),
      select: { id: true },
    });
  });

  it('rejects migrate-space when target disk capacity is known to be insufficient', async () => {
    const estimatedBytes = 1024;
    targetClient.raw.mockImplementation((query: string) => {
      if (query.includes("current_setting('data_directory')")) {
        return Promise.resolve({ rows: [{ setting: '/home/postgres/pgdata/pgroot/data' }] });
      }
      if (query.includes('SELECT line FROM __teable_target_disk_capacity')) {
        return Promise.resolve({ rows: [{ line: '/home/postgres/pgdata|4096|1024|3072' }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const service = createService();

    await expect(
      service.startMigrationForSpace('spcxxx', 'usrxxx', {
        url: dataUrl,
        targetMode: 'migrate-space',
        internalSchema,
      })
    ).rejects.toMatchObject({
      code: HttpErrorCode.CONFLICT,
      data: expect.objectContaining({
        errorCode: 'SPACE_DATA_DB_TARGET_DISK_INSUFFICIENT',
        estimatedTotalBytes: estimatedBytes,
        requiredBytes: 1024 * 1024 * 1024,
        availableBytes: 3072,
        targetDisk: expect.objectContaining({
          checked: true,
          mountPath: '/home/postgres/pgdata',
        }),
      }),
    });
    expect(baselineService.initialize).not.toHaveBeenCalled();
    expect(prismaService.$tx).not.toHaveBeenCalled();
    expect(targetClient.destroy).toHaveBeenCalled();
  });

  it('does not block migrate-space when target disk capacity cannot be inspected', async () => {
    targetClient.raw.mockImplementation((query: string) => {
      if (query.includes("current_setting('data_directory')")) {
        return Promise.resolve({ rows: [{ setting: '/var/lib/postgresql/data' }] });
      }
      if (query.includes('COPY __teable_target_disk_capacity FROM PROGRAM')) {
        return Promise.reject(
          new Error('must be superuser to COPY to or from an external program')
        );
      }
      return Promise.resolve({ rows: [] });
    });
    const service = createService();

    await expect(
      service.startMigrationForSpace('spcxxx', 'usrxxx', {
        url: dataUrl,
        targetMode: 'migrate-space',
        internalSchema,
      })
    ).resolves.toMatchObject({
      jobId: 'sdmjxxx',
      connectionId: 'dcnxxx',
    });
    expect(baselineService.initialize).toHaveBeenCalledWith(dataUrl, internalSchema);
    expect(txClient.spaceDataDbMigrationJob.create).toHaveBeenCalled();
  });

  it('cleans retryable same-job target artifacts before starting a new migration', async () => {
    const matchingInventory = {
      sourceDataDb: {
        mode: 'default',
        cacheKey: 'meta-fallback',
        connectionId: null,
        internalSchema: null,
        isMetaFallback: true,
      },
      targetDataDb: {
        internalSchema,
      },
      baseIds: ['bsexxx'],
      tableIds: ['tblxxx'],
      dbTableNames: ['bsexxx.sheet1'],
      physicalSchemas: [
        {
          schemaName: 'bsexxx',
          totalBytes: 1024,
          estimatedRows: 10,
          relations: [
            {
              schemaName: 'bsexxx',
              relationName: 'sheet1',
              relationKind: 'table',
              totalBytes: 1024,
              estimatedRows: 10,
            },
          ],
        },
      ],
      estimatedTotalBytes: 1024,
      estimatedTotalRows: 10,
    };
    prismaService.spaceDataDbMigrationJob.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'sdmjold',
        state: 'failed',
        targetConnectionId: 'dcnxxx',
        inventory: matchingInventory,
      });
    targetClient.raw.mockResolvedValue({ rows: [] });
    const service = createService();
    const cleanup = vi.spyOn(service, 'cleanupTargetArtifactsForJob').mockResolvedValue({
      reason: 'retry_before_start',
      baseSchemas: [],
      sharedTables: [],
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });

    await expect(
      service.startMigrationForSpace('spcxxx', 'usrxxx', {
        url: dataUrl,
        targetMode: 'migrate-space',
        internalSchema,
      })
    ).resolves.toMatchObject({
      jobId: 'sdmjxxx',
      connectionId: 'dcnxxx',
    });

    expect(cleanup).toHaveBeenCalledWith('sdmjold', 'retry_before_start', {
      truncateSharedTables: true,
    });
    expect(baselineService.initialize).toHaveBeenCalledWith(dataUrl, internalSchema);
  });

  it('cleans previous successful dry-run target artifacts before starting a new migration', async () => {
    prismaService.spaceDataDbMigrationJob.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'sdmjdryrun',
        spaceId: 'spcxxx',
        state: 'succeeded',
        switchOnCompletion: false,
        targetConnectionId: 'dcnxxx',
        inventory: {
          targetDataDb: { internalSchema },
          baseIds: ['bseold'],
          tableIds: [],
          dbTableNames: [],
          physicalSchemas: [{ schemaName: 'bseold', relations: [] }],
        },
      });
    targetClient.raw.mockResolvedValue({ rows: [] });
    const service = createService();
    const cleanup = vi.spyOn(service, 'cleanupTargetArtifactsForJob').mockResolvedValue({
      reason: 'retry_before_start',
      baseSchemas: [],
      sharedTables: [],
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });

    await expect(
      service.startMigrationForSpace('spcxxx', 'usrxxx', {
        url: dataUrl,
        targetMode: 'migrate-space',
        internalSchema,
      })
    ).resolves.toMatchObject({
      jobId: 'sdmjxxx',
      connectionId: 'dcnxxx',
    });

    expect(cleanup).toHaveBeenCalledWith('sdmjdryrun', 'retry_before_start', {
      truncateSharedTables: true,
    });
    expect(prismaService.spaceDataDbMigrationJob.findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([{ state: 'succeeded', switchOnCompletion: false }]),
        }),
      })
    );
    expect(txClient.spaceDataDbMigrationJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          switchOnCompletion: false,
          state: 'waiting_worker',
        }),
      })
    );
  });

  it('allows preflight to pass when conflicts belong to a previous successful dry-run', async () => {
    prismaService.spaceDataDbMigrationJob.findFirst.mockResolvedValueOnce({
      id: 'sdmjdryrun',
      spaceId: 'spcxxx',
      state: 'succeeded',
      switchOnCompletion: false,
      targetConnectionId: 'dcnxxx',
      inventory: {
        targetDataDb: { internalSchema },
        baseIds: ['bsexxx'],
        tableIds: ['tblxxx'],
        dbTableNames: ['bsexxx.sheet1'],
        physicalSchemas: [{ schemaName: 'bsexxx', relations: [] }],
      },
    });
    targetClient.raw.mockImplementation((sql: string) => {
      if (sql.includes('FROM information_schema.schemata')) {
        return Promise.resolve({ rows: [{ schemaName: 'bsexxx' }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const service = createService();

    await expect(
      service.preflightMigrationTargetForSpace('spcxxx', {
        url: dataUrl,
        targetMode: 'migrate-space',
        internalSchema,
      })
    ).resolves.toMatchObject({
      ok: true,
      internalSchema,
    });

    expect(
      targetClient.raw.mock.calls.some(([sql]) =>
        String(sql).includes('FROM information_schema.schemata')
      )
    ).toBe(false);
    expect(baselineService.initialize).not.toHaveBeenCalled();
    expect(prismaService.$tx).not.toHaveBeenCalled();
  });

  it('does not clean retry target artifacts when the previous job inventory differs', async () => {
    prismaService.spaceDataDbMigrationJob.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'sdmjold',
        state: 'failed',
        targetConnectionId: 'dcnxxx',
        inventory: {
          targetDataDb: { internalSchema },
          baseIds: ['bseother'],
          tableIds: [],
          dbTableNames: [],
          physicalSchemas: [],
        },
      });
    targetClient.raw.mockImplementation((sql: string) => {
      if (sql.includes('FROM information_schema.schemata')) {
        return Promise.resolve({ rows: [{ schemaName: 'bsexxx' }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const service = createService();
    const cleanup = vi.spyOn(service, 'cleanupTargetArtifactsForJob');

    await expect(
      service.startMigrationForSpace('spcxxx', 'usrxxx', {
        url: dataUrl,
        targetMode: 'migrate-space',
        internalSchema,
      })
    ).rejects.toMatchObject({
      code: HttpErrorCode.CONFLICT,
      data: expect.objectContaining({
        errorCode: 'SPACE_DATA_DB_TARGET_CONFLICT',
      }),
    });

    expect(cleanup).not.toHaveBeenCalled();
    expect(baselineService.initialize).not.toHaveBeenCalled();
    expect(prismaService.$tx).not.toHaveBeenCalled();
  });

  it('rejects target databases with conflicting base schemas before creating a job', async () => {
    targetClient.raw.mockImplementation((sql: string) => {
      if (sql.includes('FROM information_schema.schemata')) {
        return Promise.resolve({ rows: [{ schemaName: 'bsexxx' }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const service = createService();

    await expect(
      service.startMigrationForSpace('spcxxx', 'usrxxx', {
        url: dataUrl,
        targetMode: 'migrate-space',
        internalSchema,
      })
    ).rejects.toMatchObject({
      code: HttpErrorCode.CONFLICT,
      data: expect.objectContaining({
        errorCode: 'SPACE_DATA_DB_TARGET_CONFLICT',
      }),
    });
    expect(baselineService.initialize).not.toHaveBeenCalled();
    expect(prismaService.$tx).not.toHaveBeenCalled();
    expect(targetClient.destroy).toHaveBeenCalled();
  });

  it('rejects target databases with conflicting shared rows before creating a job', async () => {
    targetClient.raw.mockImplementation((sql: string, bindings?: unknown[]) => {
      if (sql.includes('FROM information_schema.schemata')) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes('SELECT to_regclass')) {
        const qualifiedTable = Array.isArray(bindings) ? bindings[0] : undefined;
        return Promise.resolve({
          rows: [{ exists: qualifiedTable === `"${internalSchema}"."record_history"` }],
        });
      }
      if (sql.includes(`FROM "${internalSchema}"."record_history"`)) {
        return Promise.resolve({ rows: [{ count: '2' }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const service = createService();

    await expect(
      service.startMigrationForSpace('spcxxx', 'usrxxx', {
        url: dataUrl,
        targetMode: 'migrate-space',
        internalSchema,
      })
    ).rejects.toMatchObject({
      code: HttpErrorCode.CONFLICT,
      data: expect.objectContaining({
        errorCode: 'SPACE_DATA_DB_TARGET_CONFLICT',
        conflicts: [{ object: `table:${internalSchema}.record_history`, count: 2 }],
      }),
    });
    expect(baselineService.initialize).not.toHaveBeenCalled();
    expect(prismaService.$tx).not.toHaveBeenCalled();
    expect(targetClient.destroy).toHaveBeenCalled();
  });

  it('rejects migrate-space when the source needs pg_trgm but the target cannot create it', async () => {
    sourceDataPrisma.$queryRawUnsafe.mockImplementation((query: string) => {
      if (query.includes('pg_get_indexdef')) {
        return Promise.resolve([
          {
            extensionName: 'pg_trgm',
            objectType: 'operator_class',
            schemaName: 'public',
            objectName: 'gin_trgm_ops',
            accessMethod: 'gin',
            sourceSchemaName: 'bsexxx',
            sourceRelationName: 'sheet1',
            sourceIndexName: 'sheet1_name_trgm_idx',
          },
        ]);
      }
      return Promise.resolve([
        {
          schemaName: 'bsexxx',
          relationName: 'sheet1',
          relationKind: 'table',
          totalBytes: '1024',
          estimatedRows: '10',
        },
      ]);
    });
    targetClient.raw.mockImplementation((sql: string) => {
      if (sql.includes('CREATE EXTENSION')) {
        return Promise.reject(new Error('permission denied to create extension "pg_trgm"'));
      }
      if (sql.includes('FROM pg_opclass opc')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });
    const service = createService();

    await expect(
      service.startMigrationForSpace('spcxxx', 'usrxxx', {
        url: dataUrl,
        targetMode: 'migrate-space',
        internalSchema,
      })
    ).rejects.toMatchObject({
      code: HttpErrorCode.CONFLICT,
      data: expect.objectContaining({
        errorCode: 'SPACE_DATA_DB_TARGET_EXTENSION_MISSING',
        errors: [
          expect.objectContaining({
            code: 'MISSING_POSTGRES_EXTENSION',
            message: expect.stringContaining('permission denied to create extension "pg_trgm"'),
            remediation: expect.stringContaining('CREATE EXTENSION IF NOT EXISTS pg_trgm'),
          }),
        ],
        missingExtensions: [
          expect.objectContaining({
            extensionName: 'pg_trgm',
            schemaName: 'public',
            objectName: 'gin_trgm_ops',
          }),
        ],
      }),
    });
    expect(baselineService.initialize).not.toHaveBeenCalled();
    expect(prismaService.$tx).not.toHaveBeenCalled();
    expect(targetClient.raw).toHaveBeenCalledWith(
      'CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "public"'
    );
    expect(targetClient.destroy).toHaveBeenCalled();
  });

  it('starts migrate-space after creating the required pg_trgm operator class on target', async () => {
    sourceDataPrisma.$queryRawUnsafe.mockImplementation((query: string) => {
      if (query.includes('pg_get_indexdef')) {
        return Promise.resolve([
          {
            extensionName: 'pg_trgm',
            objectType: 'operator_class',
            schemaName: 'public',
            objectName: 'gin_trgm_ops',
            accessMethod: 'gin',
            sourceSchemaName: 'bsexxx',
            sourceRelationName: 'sheet1',
            sourceIndexName: 'sheet1_name_trgm_idx',
          },
        ]);
      }
      return Promise.resolve([
        {
          schemaName: 'bsexxx',
          relationName: 'sheet1',
          relationKind: 'table',
          totalBytes: '1024',
          estimatedRows: '10',
        },
      ]);
    });
    targetClient.raw.mockImplementation((sql: string) => {
      if (sql.includes('CREATE EXTENSION')) {
        return {
          rows: [],
        };
      }
      if (sql.includes('FROM pg_opclass opc')) {
        return {
          rows: [{ schemaName: 'public', objectName: 'gin_trgm_ops', accessMethod: 'gin' }],
        };
      }
      return { rows: [] };
    });
    const service = createService();

    await expect(
      service.startMigrationForSpace('spcxxx', 'usrxxx', {
        url: dataUrl,
        targetMode: 'migrate-space',
        internalSchema,
      })
    ).resolves.toMatchObject({
      jobId: 'sdmjxxx',
      connectionId: 'dcnxxx',
    });

    expect(baselineService.initialize).toHaveBeenCalledWith(dataUrl, internalSchema);
    expect(targetClient.raw).toHaveBeenCalledWith(
      'CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "public"'
    );
    expect(txClient.spaceDataDbMigrationJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        inventory: expect.objectContaining({
          postgresExtensionDependencies: [
            expect.objectContaining({
              extensionName: 'pg_trgm',
              schemaName: 'public',
              objectName: 'gin_trgm_ops',
              sourceObjects: ['bsexxx.sheet1.sheet1_name_trgm_idx'],
            }),
          ],
        }),
      }),
      select: { id: true },
    });
  });

  it('accepts pg_trgm installed in the target extensions schema when it is search-path visible', async () => {
    sourceDataPrisma.$queryRawUnsafe.mockImplementation((query: string) => {
      if (query.includes('pg_get_indexdef')) {
        return Promise.resolve([
          {
            extensionName: 'pg_trgm',
            objectType: 'operator_class',
            schemaName: 'public',
            objectName: 'gin_trgm_ops',
            accessMethod: 'gin',
            sourceSchemaName: 'bsexxx',
            sourceRelationName: 'sheet1',
            sourceIndexName: 'sheet1_name_trgm_idx',
          },
        ]);
      }
      return Promise.resolve([
        {
          schemaName: 'bsexxx',
          relationName: 'sheet1',
          relationKind: 'table',
          totalBytes: '1024',
          estimatedRows: '10',
        },
      ]);
    });
    targetClient.raw.mockImplementation((sql: string) => {
      if (sql.includes('CREATE EXTENSION') && sql.includes('WITH SCHEMA "public"')) {
        return Promise.reject(new Error('permission denied for schema public'));
      }
      if (sql.includes('CREATE EXTENSION') && sql.includes('WITH SCHEMA "extensions"')) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes('FROM pg_opclass opc')) {
        return Promise.resolve({
          rows: [{ schemaName: 'extensions', objectName: 'gin_trgm_ops', accessMethod: 'gin' }],
        });
      }
      return Promise.resolve({ rows: [] });
    });
    const service = createService();

    await expect(
      service.startMigrationForSpace('spcxxx', 'usrxxx', {
        url: dataUrl,
        targetMode: 'migrate-space',
        internalSchema,
      })
    ).resolves.toMatchObject({
      jobId: 'sdmjxxx',
      connectionId: 'dcnxxx',
    });

    expect(targetClient.raw).toHaveBeenCalledWith(
      'CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "public"'
    );
    expect(targetClient.raw).toHaveBeenCalledWith(
      'CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "extensions"'
    );
    expect(baselineService.initialize).toHaveBeenCalledWith(dataUrl, internalSchema);
  });

  it('preflights migrate-space pg_trgm dependencies before target schema initialization', async () => {
    sourceDataPrisma.$queryRawUnsafe.mockImplementation((query: string) => {
      if (query.includes('pg_get_indexdef')) {
        return Promise.resolve([
          {
            extensionName: 'pg_trgm',
            objectType: 'operator_class',
            schemaName: 'public',
            objectName: 'gin_trgm_ops',
            accessMethod: 'gin',
            sourceSchemaName: 'bsexxx',
            sourceRelationName: 'sheet1',
            sourceIndexName: 'sheet1_name_trgm_idx',
          },
        ]);
      }
      return Promise.resolve([
        {
          schemaName: 'bsexxx',
          relationName: 'sheet1',
          relationKind: 'table',
          totalBytes: '1024',
          estimatedRows: '10',
        },
      ]);
    });
    targetClient.raw.mockImplementation((sql: string) => {
      if (sql.includes('CREATE EXTENSION')) {
        return Promise.reject(new Error('permission denied to create extension "pg_trgm"'));
      }
      if (sql.includes('FROM pg_opclass opc')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });
    const service = createService();

    await expect(
      service.preflightMigrationTargetForSpace('spcxxx', {
        url: dataUrl,
        targetMode: 'migrate-space',
        internalSchema,
      })
    ).rejects.toMatchObject({
      code: HttpErrorCode.CONFLICT,
      data: expect.objectContaining({
        errorCode: 'SPACE_DATA_DB_TARGET_EXTENSION_MISSING',
        errors: [
          expect.objectContaining({
            code: 'MISSING_POSTGRES_EXTENSION',
            message: expect.stringContaining('permission denied to create extension "pg_trgm"'),
          }),
        ],
      }),
    });

    expect(preflightService.preflight).toHaveBeenCalledWith({
      url: dataUrl,
      targetMode: 'migrate-space',
      internalSchema,
    });
    expect(targetClient.raw).toHaveBeenCalledWith(
      'CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "public"'
    );
    expect(baselineService.initialize).not.toHaveBeenCalled();
    expect(prismaService.$tx).not.toHaveBeenCalled();
  });

  it('creates a migration job without switching routing when preflight passes', async () => {
    const service = createService();

    await expect(
      service.startMigrationForSpace('spcxxx', 'usrxxx', {
        url: dataUrl,
        targetMode: 'migrate-space',
        internalSchema,
      })
    ).resolves.toEqual({
      jobId: 'sdmjxxx',
      connectionId: 'dcnxxx',
    });

    expect(preflightService.preflight).toHaveBeenCalledWith({
      url: dataUrl,
      targetMode: 'migrate-space',
      internalSchema,
    });
    expect(baselineService.initialize).toHaveBeenCalledWith(dataUrl, internalSchema);
    expect(txClient.dataDbConnection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: 'migrating',
          schemaVersion,
        }),
        update: expect.objectContaining({
          status: 'migrating',
          schemaVersion,
        }),
      })
    );
    expect(txClient.spaceDataDbMigrationJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        spaceId: 'spcxxx',
        targetConnectionId: 'dcnxxx',
        targetMode: 'migrate-space',
        switchOnCompletion: false,
        state: 'waiting_worker',
        inventory: expect.objectContaining({
          sourceDataDb: {
            mode: 'default',
            cacheKey: 'meta-fallback',
            connectionId: null,
            internalSchema: null,
            isMetaFallback: true,
          },
          targetDataDb: {
            internalSchema,
          },
          relatedSpaces: expect.objectContaining({
            primarySpaceId: 'spcxxx',
            hasCrossSpaceLinks: false,
          }),
          spaceIds: ['spcxxx'],
          copySpaceIds: ['spcxxx'],
          baseIds: ['bsexxx'],
          tableIds: ['tblxxx'],
          sharedTableIds: ['tblxxx'],
          relatedSharedTableIds: ['tblxxx'],
          dbTableNames: ['bsexxx.sheet1'],
          physicalSchemas: [
            {
              schemaName: 'bsexxx',
              totalBytes: 1024,
              estimatedRows: 10,
              relations: [
                {
                  schemaName: 'bsexxx',
                  relationName: 'sheet1',
                  relationKind: 'table',
                  totalBytes: 1024,
                  estimatedRows: 10,
                },
              ],
            },
          ],
          postgresExtensionDependencies: [],
          outOfScopeForeignKeys: [],
          estimatedTotalBytes: 1024,
          estimatedTotalRows: 10,
        }),
        createdBy: 'usrxxx',
      }),
      select: { id: true },
    });
    expect(dataDbClientManager.invalidateConnection).toHaveBeenCalledWith('dcnxxx');
  });

  it('starts and switches a migration for cross-space linked spaces together', async () => {
    prismaService.field.findMany.mockResolvedValue([
      {
        id: 'fldlink',
        type: FieldType.Link,
        isLookup: null,
        isConditionalLookup: false,
        options: JSON.stringify({ foreignTableId: 'tblrelated' }),
        lookupOptions: null,
        tableId: 'tblxxx',
        table: {
          id: 'tblxxx',
          base: { spaceId: 'spcxxx' },
        },
      },
    ]);
    prismaService.tableMeta.findMany.mockImplementation((args?: unknown) => {
      const where = (
        args as {
          where?: {
            id?: { in?: string[] };
            baseId?: { in?: string[] };
            base?: { spaceId?: { in?: string[] } };
          };
        }
      )?.where;
      const rows = [
        { id: 'tblxxx', dbTableName: 'bsexxx.sheet1', base: { spaceId: 'spcxxx' } },
        { id: 'tblrelated', dbTableName: 'bserelated.sheet1', base: { spaceId: 'spcrelated' } },
      ];
      if (where?.base?.spaceId?.in) {
        return Promise.resolve(
          rows.filter((row) => where.base!.spaceId!.in!.includes(row.base.spaceId))
        );
      }
      if (where?.id?.in) {
        return Promise.resolve(rows.filter((row) => where.id!.in!.includes(row.id)));
      }
      if (where?.baseId?.in) {
        const byBase: Record<string, string> = { bsexxx: 'tblxxx', bserelated: 'tblrelated' };
        return Promise.resolve(
          where.baseId.in.flatMap((baseId) =>
            byBase[baseId] ? rows.filter((row) => row.id === byBase[baseId]) : []
          )
        );
      }
      return Promise.resolve(rows);
    });
    prismaService.space.findMany.mockResolvedValue([
      {
        id: 'spcxxx',
        name: 'Primary',
        baseGroup: [{ id: 'bsexxx', tables: [{ id: 'tblxxx' }] }],
      },
      {
        id: 'spcrelated',
        name: 'Related',
        baseGroup: [{ id: 'bserelated', tables: [{ id: 'tblrelated' }] }],
      },
    ]);
    sourceDataPrisma.$queryRawUnsafe.mockImplementation((sql: string) => {
      if (sql.includes('FROM pg_class c')) {
        return Promise.resolve([
          {
            schemaName: 'bsexxx',
            relationName: 'sheet1',
            relationKind: 'table',
            totalBytes: '1024',
            estimatedRows: '10',
          },
          {
            schemaName: 'bserelated',
            relationName: 'sheet1',
            relationKind: 'table',
            totalBytes: '2048',
            estimatedRows: '20',
          },
        ]);
      }
      return Promise.resolve([]);
    });
    const service = createService();

    await expect(
      service.startMigrationForSpace('spcxxx', 'usrxxx', {
        url: dataUrl,
        targetMode: 'migrate-space',
        internalSchema,
        switchOnCompletion: true,
      })
    ).resolves.toMatchObject({
      jobId: 'sdmjxxx',
      connectionId: 'dcnxxx',
    });

    expect(txClient.spaceDataDbMigrationJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        inventory: expect.objectContaining({
          spaceIds: ['spcrelated', 'spcxxx'],
          copySpaceIds: ['spcrelated', 'spcxxx'],
          baseIds: ['bserelated', 'bsexxx'],
          tableIds: ['tblrelated', 'tblxxx'],
          dbTableNames: ['bserelated.sheet1', 'bsexxx.sheet1'],
          relatedSpaces: expect.objectContaining({
            primarySpaceId: 'spcxxx',
            hasCrossSpaceLinks: true,
            spaces: expect.arrayContaining([
              expect.objectContaining({ spaceId: 'spcxxx', isPrimary: true }),
              expect.objectContaining({ spaceId: 'spcrelated', isPrimary: false }),
            ]),
            links: [
              expect.objectContaining({
                fromSpaceId: 'spcxxx',
                toSpaceId: 'spcrelated',
                fromFieldId: 'fldlink',
              }),
            ],
          }),
        }),
      }),
      select: { id: true },
    });

    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      sourceConnectionId: null,
      targetConnectionId: 'dcnxxx',
      switchOnCompletion: true,
      targetInternalSchema: internalSchema,
      createdBy: 'usrxxx',
      startedAt: new Date('2026-05-06T00:00:00.000Z'),
      completedAt: null,
      inventory: txClient.spaceDataDbMigrationJob.create.mock.calls[0][0].data.inventory,
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
    });
    vi.spyOn(service, 'validateCopyForJob').mockResolvedValue({
      phase: 'validation_completed',
      progress: {
        phase: 'validation_completed',
        totalSteps: 9,
        completedSteps: 8,
        percent: 94,
        stage: 'validate' as const,
        stages: spaceDataDbMigrationStages,
        estimatedTotalBytes: 3072,
        completedEstimatedBytes: 3072,
        estimatedTotalRows: 30,
        completedEstimatedRows: 30,
        copiedBytes: 3072,
        bytesPerSecond: null,
        startedAt: '2026-05-06T00:00:00.000Z',
        updatedAt: '2026-05-06T00:01:00.000Z',
        etaMs: null,
      },
      targetSchemaVersion: { latest: schemaVersion, exists: true },
      routeSmoke: {
        ok: true,
        connectionId: 'dcnxxx',
        internalSchema,
        cacheKey: 'dcnxxx',
        isMetaFallback: false,
      },
      baseSchemas: [],
      sharedTables: [],
      undoFunction: { exists: true },
      completedAt: '2026-05-06T00:01:00.000Z',
    });

    await expect(service.validateAndSwitchJob('sdmjxxx')).resolves.toMatchObject({
      state: 'succeeded',
    });

    expect(txClient.spaceDataDbBinding.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { spaceId: 'spcrelated' } })
    );
    expect(txClient.spaceDataDbBinding.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { spaceId: 'spcxxx' } })
    );
  });

  it('starts a repair migration for default spaces linked to an existing target-bound space', async () => {
    const targetInternalSchema = 'spcalready';
    prismaService.field.findMany.mockResolvedValue([
      {
        id: 'fldlink',
        type: FieldType.Link,
        isLookup: null,
        isConditionalLookup: false,
        options: JSON.stringify({ foreignTableId: 'tblalready' }),
        lookupOptions: null,
        tableId: 'tblrelated',
        table: {
          id: 'tblrelated',
          base: { spaceId: 'spcrelated' },
        },
      },
    ]);
    prismaService.tableMeta.findMany.mockImplementation((args?: unknown) => {
      const where = (
        args as {
          where?: {
            id?: { in?: string[] };
            baseId?: { in?: string[] };
            base?: { spaceId?: { in?: string[] } };
          };
        }
      )?.where;
      const live = [
        { id: 'tblrelated', dbTableName: 'bserelated.sheet1', base: { spaceId: 'spcrelated' } },
        { id: 'tblalready', dbTableName: 'bsealready.sheet1', base: { spaceId: 'spcalready' } },
      ];
      if (where?.base?.spaceId?.in) {
        return Promise.resolve(
          live.filter((row) => where.base!.spaceId!.in!.includes(row.base.spaceId))
        );
      }
      if (where?.id?.in) {
        return Promise.resolve(live.filter((row) => where.id!.in!.includes(row.id)));
      }
      if (where?.baseId?.in) {
        const byBase: Record<string, Array<{ id: string }>> = {
          bserelated: [{ id: 'tblrelated' }, { id: 'tbldeletedrelated' }],
          bsealready: [{ id: 'tblalready' }, { id: 'tbldeletedalready' }],
        };
        return Promise.resolve(where.baseId.in.flatMap((baseId) => byBase[baseId] ?? []));
      }
      return Promise.resolve(live);
    });
    prismaService.space.findMany.mockResolvedValue([
      {
        id: 'spcalready',
        name: 'Already',
        baseGroup: [{ id: 'bsealready', tables: [{ id: 'tblalready' }] }],
      },
      {
        id: 'spcrelated',
        name: 'Related',
        baseGroup: [{ id: 'bserelated', tables: [{ id: 'tblrelated' }] }],
      },
    ]);
    prismaService.spaceDataDbBinding.findMany.mockResolvedValue([
      {
        spaceId: 'spcalready',
        mode: 'byodb',
        state: 'ready',
        dataDbConnection: {
          id: 'dcnalready',
          encryptedUrl: encryptDataDbUrl(dataUrl),
          urlFingerprint: fingerprintDataDbConnection(dataUrl, targetInternalSchema),
          displayHost: 'example.com:5432',
          displayDatabase: 'teable_data',
          internalSchema: targetInternalSchema,
        },
      },
    ]);
    sourceDataPrisma.$queryRawUnsafe.mockImplementation((sql: string) => {
      if (sql.includes('FROM pg_class c')) {
        return Promise.resolve([
          {
            schemaName: 'bserelated',
            relationName: 'sheet1',
            relationKind: 'table',
            totalBytes: '2048',
            estimatedRows: '20',
          },
        ]);
      }
      return Promise.resolve([]);
    });
    const service = createService();

    await expect(
      service.startMigrationForSpace('spcrelated', 'usrxxx', {
        url: dataUrl,
        targetMode: 'migrate-space',
        switchOnCompletion: true,
      })
    ).resolves.toMatchObject({
      jobId: 'sdmjxxx',
      connectionId: 'dcnxxx',
    });

    expect(preflightService.preflight).toHaveBeenCalledWith({
      url: dataUrl,
      targetMode: 'migrate-space',
      internalSchema: targetInternalSchema,
    });
    expect(txClient.dataDbConnection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { urlFingerprint: fingerprintDataDbConnection(dataUrl, targetInternalSchema) },
      })
    );
    expect(txClient.spaceDataDbMigrationJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        spaceId: 'spcrelated',
        targetInternalSchema,
        inventory: expect.objectContaining({
          spaceIds: ['spcalready', 'spcrelated'],
          copySpaceIds: ['spcrelated'],
          baseIds: ['bserelated'],
          tableIds: ['tblrelated'],
          sharedTableIds: ['tbldeletedrelated', 'tblrelated'],
          relatedSharedTableIds: [
            'tblalready',
            'tbldeletedalready',
            'tbldeletedrelated',
            'tblrelated',
          ],
          dbTableNames: ['bserelated.sheet1'],
          relatedSpaces: expect.objectContaining({
            primarySpaceId: 'spcrelated',
            hasCrossSpaceLinks: true,
            spaces: expect.arrayContaining([
              expect.objectContaining({
                spaceId: 'spcalready',
                dataDbMode: 'byodb',
                dataDbDatabaseFingerprint: fingerprintDatabaseUrl(dataUrl),
              }),
              expect.objectContaining({ spaceId: 'spcrelated', dataDbMode: 'default' }),
            ]),
          }),
        }),
      }),
      select: { id: true },
    });

    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcrelated',
      sourceConnectionId: null,
      targetConnectionId: 'dcnxxx',
      switchOnCompletion: true,
      targetInternalSchema,
      createdBy: 'usrxxx',
      startedAt: new Date('2026-05-06T00:00:00.000Z'),
      completedAt: null,
      inventory: txClient.spaceDataDbMigrationJob.create.mock.calls[0][0].data.inventory,
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
    });
    vi.spyOn(service, 'validateCopyForJob').mockResolvedValue({
      phase: 'validation_completed',
      progress: {
        phase: 'validation_completed',
        totalSteps: 9,
        completedSteps: 8,
        percent: 94,
        stage: 'validate' as const,
        stages: spaceDataDbMigrationStages,
        estimatedTotalBytes: 2048,
        completedEstimatedBytes: 2048,
        estimatedTotalRows: 20,
        completedEstimatedRows: 20,
        copiedBytes: 2048,
        bytesPerSecond: null,
        startedAt: '2026-05-06T00:00:00.000Z',
        updatedAt: '2026-05-06T00:01:00.000Z',
        etaMs: null,
      },
      targetSchemaVersion: { latest: schemaVersion, exists: true },
      routeSmoke: {
        ok: true,
        connectionId: 'dcnxxx',
        internalSchema: targetInternalSchema,
        cacheKey: 'dcnxxx',
        isMetaFallback: false,
      },
      baseSchemas: [],
      sharedTables: [],
      undoFunction: { exists: true },
      completedAt: '2026-05-06T00:01:00.000Z',
    });

    await expect(service.validateAndSwitchJob('sdmjxxx')).resolves.toMatchObject({
      state: 'succeeded',
    });

    expect(txClient.spaceDataDbBinding.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { spaceId: 'spcalready' } })
    );
    expect(txClient.spaceDataDbBinding.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { spaceId: 'spcrelated' } })
    );
  });

  it('rejects a repair migration when linked BYODB spaces use another physical database', async () => {
    const otherUrl = 'postgresql://teable:secret@other.example:5432/teable_data';
    prismaService.field.findMany.mockResolvedValue([
      {
        id: 'fldlink',
        type: FieldType.Link,
        isLookup: null,
        isConditionalLookup: false,
        options: JSON.stringify({ foreignTableId: 'tblalready' }),
        lookupOptions: null,
        tableId: 'tblrelated',
        table: {
          id: 'tblrelated',
          base: { spaceId: 'spcrelated' },
        },
      },
    ]);
    prismaService.tableMeta.findMany.mockResolvedValueOnce([
      {
        id: 'tblalready',
        base: { spaceId: 'spcalready' },
      },
    ]);
    prismaService.space.findMany.mockResolvedValue([
      {
        id: 'spcalready',
        name: 'Already',
        baseGroup: [{ id: 'bsealready', tables: [{ id: 'tblalready' }] }],
      },
      {
        id: 'spcrelated',
        name: 'Related',
        baseGroup: [{ id: 'bserelated', tables: [{ id: 'tblrelated' }] }],
      },
    ]);
    prismaService.spaceDataDbBinding.findMany.mockResolvedValue([
      {
        spaceId: 'spcalready',
        mode: 'byodb',
        state: 'ready',
        dataDbConnection: {
          id: 'dcnalready',
          encryptedUrl: encryptDataDbUrl(otherUrl),
          urlFingerprint: fingerprintDataDbConnection(otherUrl, 'spcalready'),
          displayHost: 'other.example:5432',
          displayDatabase: 'teable_data',
          internalSchema: 'spcalready',
        },
      },
    ]);
    const service = createService();

    await expect(
      service.startMigrationForSpace('spcrelated', 'usrxxx', {
        url: dataUrl,
        targetMode: 'migrate-space',
      })
    ).rejects.toMatchObject({
      code: HttpErrorCode.CONFLICT,
      data: expect.objectContaining({
        errorCode: 'SPACE_DATA_DB_RELATED_SPACES_REQUIRED',
        mismatchedSpaceIds: ['spcalready'],
      }),
    });

    expect(txClient.spaceDataDbMigrationJob.create).not.toHaveBeenCalled();
  });

  it('claims the oldest waiting-worker migration job for a worker', async () => {
    prismaService.spaceDataDbMigrationJob.findFirst.mockResolvedValue({
      id: 'sdmjwaiting',
      state: 'waiting_worker',
    });
    prismaService.spaceDataDbMigrationJob.updateMany.mockResolvedValue({ count: 1 });
    const service = createService();

    await expect(service.claimNextPendingMigrationJob('worker-1')).resolves.toEqual({
      jobId: 'sdmjwaiting',
    });

    expect(prismaService.spaceDataDbMigrationJob.findFirst).toHaveBeenCalledWith({
      where: {
        targetMode: 'migrate-space',
        state: { in: ['waiting_worker', 'pending'] },
      },
      orderBy: [{ createdTime: 'asc' }, { id: 'asc' }],
      select: { id: true, state: true },
    });
    expect(prismaService.spaceDataDbMigrationJob.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'sdmjwaiting',
        state: 'waiting_worker',
      },
      data: expect.objectContaining({
        state: 'preflight',
        startedAt: expect.any(Date),
        lastError: null,
        copyStats: expect.objectContaining({
          phase: 'worker_claimed',
          worker: expect.objectContaining({
            id: 'worker-1',
            previousState: 'waiting_worker',
            claimedAt: expect.any(String),
          }),
        }),
      }),
    });
  });

  it('still claims legacy pending migration jobs for a worker', async () => {
    prismaService.spaceDataDbMigrationJob.findFirst.mockResolvedValue({
      id: 'sdmjpending',
      state: 'pending',
    });
    prismaService.spaceDataDbMigrationJob.updateMany.mockResolvedValue({ count: 1 });
    const service = createService();

    await expect(service.claimNextPendingMigrationJob('worker-1')).resolves.toEqual({
      jobId: 'sdmjpending',
    });

    expect(prismaService.spaceDataDbMigrationJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'sdmjpending',
          state: 'pending',
        },
        data: expect.objectContaining({
          state: 'preflight',
        }),
      })
    );
  });

  it('does not claim a migration job when another worker wins the claim update', async () => {
    prismaService.spaceDataDbMigrationJob.findFirst.mockResolvedValue({
      id: 'sdmjwaiting',
      state: 'waiting_worker',
    });
    prismaService.spaceDataDbMigrationJob.updateMany.mockResolvedValue({ count: 0 });
    const service = createService();

    await expect(service.claimNextPendingMigrationJob('worker-1')).resolves.toBeNull();
  });

  it('returns null when no pending migration job exists for a worker', async () => {
    const service = createService();

    await expect(service.claimNextPendingMigrationJob('worker-1')).resolves.toBeNull();

    expect(prismaService.spaceDataDbMigrationJob.updateMany).not.toHaveBeenCalled();
  });

  it('recovers stale active migration jobs left behind by interrupted workers', async () => {
    const now = new Date('2026-05-06T01:00:00.000Z');
    prismaService.spaceDataDbMigrationJob.findMany.mockResolvedValue([
      {
        id: 'sdmjstale',
        spaceId: 'spcxxx',
        state: 'copying',
        targetInternalSchema: internalSchema,
        startedAt: new Date('2026-05-06T00:00:00.000Z'),
        completedAt: null,
        createdBy: 'usrxxx',
        lastModifiedTime: new Date('2026-05-06T00:20:00.000Z'),
        inventory: { baseIds: ['bsexxx'], tableIds: ['tblxxx'] },
        copyStats: { phase: 'copying_base_schemas' },
        validationStats: null,
        sourceConnectionId: null,
        targetConnectionId: 'dcnxxx',
        targetConnection: { encryptedUrl: encryptDataDbUrl(dataUrl) },
      },
    ]);
    prismaService.spaceDataDbMigrationJob.updateMany.mockResolvedValue({ count: 1 });
    const service = createService();
    const resumeSource = vi.spyOn(service, 'resumeSourceComputedForJob').mockResolvedValue({
      deleted: 1,
    } as never);
    const cleanupTarget = vi.spyOn(service, 'cleanupTargetArtifactsForJob').mockResolvedValue({
      reason: 'stale_active_job',
      baseSchemas: [],
      sharedTables: [],
      startedAt: now.toISOString(),
      completedAt: now.toISOString(),
    } as never);

    await expect(
      service.recoverStaleActiveMigrationJobs('worker-1', { now, staleAfterMs: 30 * 60 * 1000 })
    ).resolves.toEqual([
      expect.objectContaining({
        jobId: 'sdmjstale',
        state: 'copying',
        lastError: expect.stringContaining('no worker progress since 2026-05-06T00:20:00.000Z'),
      }),
    ]);

    expect(prismaService.spaceDataDbMigrationJob.findMany).toHaveBeenCalledWith({
      where: {
        targetMode: 'migrate-space',
        state: { in: ['preflight', 'freezing_writes', 'copying', 'validating', 'switching'] },
        OR: [
          { lastModifiedTime: null },
          { lastModifiedTime: { lt: new Date('2026-05-06T00:30:00.000Z') } },
        ],
      },
      include: { targetConnection: true },
      orderBy: [{ lastModifiedTime: 'asc' }, { createdTime: 'asc' }, { id: 'asc' }],
    });
    expect(prismaService.spaceDataDbMigrationJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'sdmjstale',
          state: 'copying',
        }),
        data: expect.objectContaining({
          state: 'failed',
          completedAt: now,
          lastError: expect.stringContaining(
            'Space data database migration job sdmjstale is stale'
          ),
          copyStats: expect.objectContaining({
            phase: 'copying_base_schemas',
            staleRecovery: expect.objectContaining({
              errorCode: 'SPACE_DATA_DB_STALE_ACTIVE_JOB',
              workerId: 'worker-1',
              previousState: 'copying',
              staleAfterMs: 30 * 60 * 1000,
            }),
          }),
        }),
      })
    );
    expect(resumeSource).toHaveBeenCalledWith('sdmjstale');
    expect(cleanupTarget).toHaveBeenCalledWith('sdmjstale', 'stale_active_job', {
      truncateSharedTables: true,
    });
  });

  it('surfaces the last base schema copy error when recovering a stale copy job', async () => {
    const now = new Date('2026-05-06T01:00:00.000Z');
    prismaService.spaceDataDbMigrationJob.findMany.mockResolvedValue([
      {
        id: 'sdmjstale',
        spaceId: 'spcxxx',
        state: 'copying',
        targetInternalSchema: internalSchema,
        startedAt: new Date('2026-05-06T00:00:00.000Z'),
        completedAt: null,
        createdBy: 'usrxxx',
        lastModifiedTime: new Date('2026-05-06T00:20:00.000Z'),
        inventory: { baseIds: ['bsexxx'], tableIds: ['tblxxx'] },
        copyStats: {
          phase: 'copying_base_schemas',
          baseSchemas: {
            activeCopy: {
              phase: 'restore',
              sampledAt: '2026-05-06T00:20:00.000Z',
              activeRelationCount: 0,
              activeRelations: [],
              error: 'connection to target database timed out',
            },
          },
        },
        validationStats: null,
        sourceConnectionId: null,
        targetConnectionId: 'dcnxxx',
        targetConnection: { encryptedUrl: encryptDataDbUrl(dataUrl) },
      },
    ]);
    prismaService.spaceDataDbMigrationJob.updateMany.mockResolvedValue({ count: 1 });
    const service = createService();
    vi.spyOn(service, 'resumeSourceComputedForJob').mockResolvedValue({ deleted: 1 } as never);
    vi.spyOn(service, 'cleanupTargetArtifactsForJob').mockResolvedValue({
      reason: 'stale_active_job',
      baseSchemas: [],
      sharedTables: [],
      startedAt: now.toISOString(),
      completedAt: now.toISOString(),
    } as never);

    await expect(
      service.recoverStaleActiveMigrationJobs('worker-1', { now, staleAfterMs: 30 * 60 * 1000 })
    ).resolves.toEqual([
      expect.objectContaining({
        jobId: 'sdmjstale',
        lastError: expect.stringContaining(
          'Base schema copy stopped during target PostgreSQL restore progress polling'
        ),
      }),
    ]);

    expect(prismaService.spaceDataDbMigrationJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastError: expect.stringContaining('connection to target database timed out'),
        }),
      })
    );
  });

  it('surfaces the last base schema copy heartbeat when recovering a stale copy job without a copy error', async () => {
    const now = new Date('2026-05-06T01:00:00.000Z');
    prismaService.spaceDataDbMigrationJob.findMany.mockResolvedValue([
      {
        id: 'sdmjstale',
        spaceId: 'spcxxx',
        state: 'copying',
        targetInternalSchema: internalSchema,
        startedAt: new Date('2026-05-06T00:00:00.000Z'),
        completedAt: null,
        createdBy: 'usrxxx',
        lastModifiedTime: new Date('2026-05-06T00:20:00.000Z'),
        inventory: { baseIds: ['bsexxx'], tableIds: ['tblxxx'] },
        copyStats: {
          phase: 'copying_base_schemas',
          baseSchemas: {
            heartbeat: {
              stage: 'progress_poll',
              phase: 'restore',
              updatedAt: '2026-05-06T00:20:00.000Z',
            },
          },
        },
        validationStats: null,
        sourceConnectionId: null,
        targetConnectionId: 'dcnxxx',
        targetConnection: { encryptedUrl: encryptDataDbUrl(dataUrl) },
      },
    ]);
    prismaService.spaceDataDbMigrationJob.updateMany.mockResolvedValue({ count: 1 });
    const service = createService();
    vi.spyOn(service, 'resumeSourceComputedForJob').mockResolvedValue({ deleted: 1 } as never);
    vi.spyOn(service, 'cleanupTargetArtifactsForJob').mockResolvedValue({
      reason: 'stale_active_job',
      baseSchemas: [],
      sharedTables: [],
      startedAt: now.toISOString(),
      completedAt: now.toISOString(),
    } as never);

    await expect(
      service.recoverStaleActiveMigrationJobs('worker-1', { now, staleAfterMs: 30 * 60 * 1000 })
    ).resolves.toEqual([
      expect.objectContaining({
        jobId: 'sdmjstale',
        lastError: expect.stringContaining(
          'Base schema copy stopped while waiting for target PostgreSQL restore progress polling'
        ),
      }),
    ]);
  });

  it('copies base schemas for an existing migration job and records copy stats', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      startedAt: new Date('2026-05-06T00:00:00.000Z'),
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
      inventory: {
        baseIds: ['bsexxx'],
        tableIds: ['tblxxx'],
        dbTableNames: ['bsexxx.sheet1'],
        physicalSchemas: [
          {
            schemaName: 'bsexxx',
            relations: [
              {
                schemaName: 'bsexxx',
                relationName: 'sheet1',
                relationKind: 'table',
                totalBytes: 1024,
                estimatedRows: 10,
              },
            ],
            totalBytes: 1024,
            estimatedRows: 10,
          },
        ],
        outOfScopeForeignKeys: [
          {
            schemaName: 'bsexxx',
            tableName: 'sheet1',
            constraintName: 'fk_out_of_scope',
            referencedSchemaName: 'bseyyy',
            referencedTableName: 'sheet2',
          },
        ],
        estimatedTotalBytes: 1024,
        estimatedTotalRows: 10,
      },
    });
    targetClient.raw.mockImplementation((sql: string) => {
      if (sql.includes('FROM "bsexxx"."sheet1"')) {
        return { rows: [{ count: '10' }] };
      }
      return { rows: [] };
    });
    const service = createService();

    await expect(
      service.copyBaseSchemasForJob('sdmjxxx', {
        workDir: '/tmp/sdmjxxx',
        jobs: 2,
        timeoutMs: 1000,
      })
    ).resolves.toMatchObject({
      phase: 'base_schemas_completed',
      baseSchemas: {
        schemaNames: ['bsexxx'],
        copiedRelationCount: 1,
        totalCopiedRows: 10,
        copiedRelations: [
          expect.objectContaining({
            schemaName: 'bsexxx',
            relationName: 'sheet1',
            copiedRows: 10,
            estimatedRows: 10,
          }),
        ],
      },
    });

    expect(dataDbClientManager.getDataDatabaseForSpace).toHaveBeenCalledWith('spcxxx', {
      sourceConnectionId: null,
    });
    expect(copyService.copyBaseSchemas).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceUrl: 'postgresql://source.example/teable',
        targetUrl: dataUrl,
        schemaNames: ['bsexxx'],
        workDir: '/tmp/sdmjxxx',
        jobs: 2,
        strategy: 'pg_dump_restore',
        excludedForeignKeys: [
          {
            schemaName: 'bsexxx',
            tableName: 'sheet1',
            constraintName: 'fk_out_of_scope',
            referencedSchemaName: 'bseyyy',
            referencedTableName: 'sheet2',
          },
        ],
        processOptions: expect.objectContaining({
          timeoutMs: 1000,
          pollMs: 5000,
          pollFailureTimeoutMs: 30000,
          pollTimeoutMs: 30000,
          shouldCancel: expect.any(Function),
        }),
        hooks: expect.objectContaining({
          onDumpProgressPoll: expect.any(Function),
          onRestoreProgressPoll: expect.any(Function),
        }),
      })
    );
    expect(prismaService.spaceDataDbMigrationJob.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { id: 'sdmjxxx' },
        data: expect.objectContaining({
          state: 'copying',
          copyStats: expect.objectContaining({
            phase: 'copying_base_schemas',
            progress: expect.objectContaining({
              estimatedTotalBytes: 1024,
              completedEstimatedBytes: 0,
              estimatedTotalRows: 10,
              completedEstimatedRows: 0,
              completedSteps: 5,
              totalSteps: 9,
              etaMs: expect.any(Number),
            }),
          }),
        }),
      })
    );
    expect(prismaService.spaceDataDbMigrationJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sdmjxxx' },
        data: expect.objectContaining({
          state: 'copying',
          copyStats: expect.objectContaining({
            phase: 'base_schemas_completed',
            progress: expect.objectContaining({
              completedEstimatedBytes: 1024,
              completedEstimatedRows: 10,
              completedSteps: 6,
            }),
            baseSchemas: expect.objectContaining({
              copiedRelationCount: 1,
              totalCopiedRows: 10,
              strategy: 'pg_dump_restore',
              dump: expect.objectContaining({
                command: 'pg_dump',
                startedAt: '2026-05-06T00:00:00.000Z',
                completedAt: '2026-05-06T00:00:01.000Z',
                durationMs: 1000,
              }),
              restore: expect.objectContaining({
                command: 'pg_restore',
                durationMs: 1000,
              }),
            }),
          }),
        }),
      })
    );
  });

  it('pre-creates legacy public auto-number sequences from dependency metadata', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      startedAt: new Date('2026-05-06T00:00:00.000Z'),
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
      inventory: {
        baseIds: ['bsexxx'],
        tableIds: ['tblxxx'],
        dbTableNames: ['bsexxx.sheet1'],
        physicalSchemas: [
          {
            schemaName: 'bsexxx',
            relations: [
              {
                schemaName: 'bsexxx',
                relationName: 'sheet1',
                relationKind: 'table',
                totalBytes: 1024,
                estimatedRows: 10,
              },
            ],
            totalBytes: 1024,
            estimatedRows: 10,
          },
        ],
        estimatedTotalBytes: 1024,
        estimatedTotalRows: 10,
      },
    });
    sourceClient.raw.mockImplementation((sql: string) => {
      if (sql.includes('pg_attrdef')) {
        return {
          rows: [
            {
              tableSchema: 'bsexxx',
              tableName: 'sheet1',
              sequenceSchema: 'public',
              sequenceName: 'bsexxx_sheet1_seq',
            },
          ],
        };
      }
      if (sql.includes('last_value')) {
        return { rows: [{ lastValue: '2', isCalled: true }] };
      }
      return { rows: [] };
    });
    targetClient.raw.mockImplementation((sql: string) => {
      if (sql.includes('FROM "bsexxx"."sheet1"')) {
        return { rows: [{ count: '10' }] };
      }
      return { rows: [] };
    });
    const service = createService();

    await expect(
      service.copyBaseSchemasForJob('sdmjxxx', {
        workDir: '/tmp/sdmjxxx',
        jobs: 2,
      })
    ).resolves.toMatchObject({
      phase: 'base_schemas_completed',
    });

    expect(targetClient.raw).toHaveBeenCalledWith(
      'CREATE SEQUENCE IF NOT EXISTS "public"."bsexxx_sheet1_seq"'
    );
    expect(targetClient.raw).toHaveBeenCalledWith(
      `SELECT setval(?::regclass, ?::bigint, ?::boolean)`,
      ['public."bsexxx_sheet1_seq"', '2', true]
    );

    const createSequenceCallOrder =
      targetClient.raw.mock.invocationCallOrder[
        targetClient.raw.mock.calls.findIndex(
          ([sql]) => sql === 'CREATE SEQUENCE IF NOT EXISTS "public"."bsexxx_sheet1_seq"'
        )
      ];
    expect(createSequenceCallOrder).toBeLessThan(
      copyService.copyBaseSchemas.mock.invocationCallOrder[0]
    );
  });

  it('uses the inventory source connection when the current binding already points at the target', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      sourceConnectionId: null,
      startedAt: new Date('2026-05-06T00:00:00.000Z'),
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
      inventory: {
        sourceDataDb: {
          mode: 'default',
          cacheKey: 'meta-fallback',
          connectionId: null,
          internalSchema: null,
          isMetaFallback: true,
        },
        baseIds: ['bsexxx'],
        tableIds: ['tblxxx'],
        dbTableNames: ['bsexxx.sheet1'],
        physicalSchemas: [
          {
            schemaName: 'bsexxx',
            relations: [
              {
                schemaName: 'bsexxx',
                relationName: 'sheet1',
                relationKind: 'table',
                totalBytes: 1024,
                estimatedRows: 10,
              },
            ],
            totalBytes: 1024,
            estimatedRows: 10,
          },
        ],
      },
    });
    dataDbClientManager.getDataDatabaseForSpace.mockImplementation((_, options) => {
      if ('sourceConnectionId' in (options ?? {})) {
        return Promise.resolve({
          cacheKey: 'meta-fallback',
          isMetaFallback: true,
          url: 'postgresql://source.example/teable',
        });
      }
      return Promise.resolve({
        cacheKey: 'dcnxxx',
        connectionId: 'dcnxxx',
        internalSchema,
        isMetaFallback: false,
        url: `${dataUrl}?schema=${internalSchema}&options=-c+search_path%3D${internalSchema}`,
      });
    });
    targetClient.raw.mockImplementation((sql: string) => {
      if (sql.includes('FROM "bsexxx"."sheet1"')) {
        return { rows: [{ count: '10' }] };
      }
      return { rows: [] };
    });
    const service = createService();

    await expect(
      service.copyBaseSchemasForJob('sdmjxxx', {
        workDir: '/tmp/sdmjxxx',
        jobs: 2,
      })
    ).resolves.toMatchObject({
      phase: 'base_schemas_completed',
    });

    expect(dataDbClientManager.getDataDatabaseForSpace).toHaveBeenCalledWith('spcxxx', {
      sourceConnectionId: null,
    });
    expect(copyService.copyBaseSchemas).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceUrl: 'postgresql://source.example/teable',
        targetUrl: dataUrl,
      })
    );
  });

  it('records active pg_stat_progress_copy samples while dumping and restoring base schemas', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      startedAt: new Date('2026-05-06T00:00:00.000Z'),
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
      inventory: {
        baseIds: ['bsexxx'],
        tableIds: ['tblxxx'],
        dbTableNames: ['bsexxx.sheet1'],
        physicalSchemas: [
          {
            schemaName: 'bsexxx',
            relations: [
              {
                schemaName: 'bsexxx',
                relationName: 'sheet1',
                relationKind: 'table',
                totalBytes: 1024,
                estimatedRows: 10,
              },
            ],
            totalBytes: 1024,
            estimatedRows: 10,
          },
        ],
        estimatedTotalBytes: 1024,
        estimatedTotalRows: 10,
      },
    });
    sourceClient.raw.mockImplementation((sql: string) => {
      if (sql.includes('pg_stat_progress_copy')) {
        return {
          rows: [
            {
              schemaName: 'bsexxx',
              relationName: 'sheet1',
              command: 'COPY TO',
              copyType: 'PIPE',
              bytesProcessed: '512',
              bytesTotal: '1024',
              tuplesProcessed: '4',
              tuplesExcluded: '0',
            },
          ],
        };
      }
      return { rows: [] };
    });
    targetClient.raw.mockImplementation((sql: string) => {
      if (sql.includes('pg_stat_progress_copy')) {
        return {
          rows: [
            {
              schemaName: 'bsexxx',
              relationName: 'sheet1',
              command: 'COPY FROM',
              copyType: 'PIPE',
              bytesProcessed: '768',
              bytesTotal: '1024',
              tuplesProcessed: '7',
              tuplesExcluded: '0',
            },
          ],
        };
      }
      if (sql.includes('FROM "bsexxx"."sheet1"')) {
        return { rows: [{ count: '10' }] };
      }
      return { rows: [] };
    });
    copyService.copyBaseSchemas.mockImplementation(
      async (input: {
        hooks?: {
          onDumpProgressPoll?: () => Promise<void>;
          onRestoreProgressPoll?: () => Promise<void>;
        };
      }) => {
        await input.hooks?.onDumpProgressPoll?.();
        await input.hooks?.onRestoreProgressPoll?.();
        return {
          strategy: 'pg_dump_stream_restore',
          stream: {
            source: processResult('pg_dump'),
            target: processResult('pg_restore'),
          },
        };
      }
    );
    const service = createService();

    await expect(
      service.copyBaseSchemasForJob('sdmjxxx', {
        workDir: '/tmp/sdmjxxx',
        timeoutMs: 1000,
        progressPollMs: 250,
      })
    ).resolves.toMatchObject({
      phase: 'base_schemas_completed',
    });

    const progressUpdates = prismaService.spaceDataDbMigrationJob.update.mock.calls
      .map(([args]) => args)
      .filter((args) => args.data.copyStats?.baseSchemas?.activeCopy);

    expect(progressUpdates).toHaveLength(2);
    expect(progressUpdates[0]).toMatchObject({
      data: {
        copyStats: {
          phase: 'copying_base_schemas',
          baseSchemas: {
            strategy: 'pg_dump_stream_restore',
            activeCopy: {
              phase: 'dump',
              activeRelationCount: 1,
              activeRelations: [
                {
                  schemaName: 'bsexxx',
                  relationName: 'sheet1',
                  command: 'COPY TO',
                  bytesProcessed: 512,
                  bytesTotal: 1024,
                  tuplesProcessed: 4,
                  estimatedRows: 10,
                  totalBytes: 1024,
                },
              ],
            },
          },
        },
      },
    });
    expect(progressUpdates[1]).toMatchObject({
      data: {
        copyStats: {
          baseSchemas: {
            activeCopy: {
              phase: 'restore',
              activeRelations: [
                expect.objectContaining({
                  command: 'COPY FROM',
                  bytesProcessed: 768,
                  tuplesProcessed: 7,
                }),
              ],
            },
          },
        },
      },
    });
  });

  it('records a base schema heartbeat before pg_stat_progress_copy inspection resolves', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      startedAt: new Date('2026-05-06T00:00:00.000Z'),
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
      inventory: {
        baseIds: ['bsexxx'],
        tableIds: ['tblxxx'],
        dbTableNames: ['bsexxx.sheet1'],
        physicalSchemas: [
          {
            schemaName: 'bsexxx',
            relations: [
              {
                schemaName: 'bsexxx',
                relationName: 'sheet1',
                relationKind: 'table',
                totalBytes: 1024,
                estimatedRows: 10,
              },
            ],
            totalBytes: 1024,
            estimatedRows: 10,
          },
        ],
        estimatedTotalBytes: 1024,
        estimatedTotalRows: 10,
      },
    });
    let resolveProgressQuery: (value: { rows: unknown[] }) => void = vi.fn();
    const progressQuery = new Promise<{ rows: unknown[] }>((resolve) => {
      resolveProgressQuery = resolve;
    });
    targetClient.raw.mockImplementation((sql: string) => {
      if (sql.includes('pg_stat_progress_copy')) {
        return progressQuery;
      }
      if (sql.includes('FROM "bsexxx"."sheet1"')) {
        return { rows: [{ count: '10' }] };
      }
      return { rows: [] };
    });
    copyService.copyBaseSchemas.mockImplementation(
      async (input: {
        hooks?: {
          onRestoreProgressPoll?: () => Promise<void>;
        };
      }) => {
        const pollPromise = input.hooks?.onRestoreProgressPoll?.();
        await Promise.resolve();
        expect(
          prismaService.spaceDataDbMigrationJob.update.mock.calls.some(([args]) => {
            const heartbeat = args.data.copyStats?.baseSchemas?.heartbeat;
            return heartbeat?.stage === 'progress_poll' && heartbeat?.phase === 'restore';
          })
        ).toBe(true);
        resolveProgressQuery({ rows: [] });
        await pollPromise;
        return {
          strategy: 'pg_dump_stream_restore',
          stream: {
            source: processResult('pg_dump'),
            target: processResult('pg_restore'),
          },
        };
      }
    );
    const service = createService();

    await expect(
      service.copyBaseSchemasForJob('sdmjxxx', {
        workDir: '/tmp/sdmjxxx',
        progressPollMs: 250,
      })
    ).resolves.toMatchObject({
      phase: 'base_schemas_completed',
    });
  });

  it('keeps base schema copy fresh while collecting post-copy row stats', async () => {
    vi.useFakeTimers();
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      startedAt: new Date('2026-05-06T00:00:00.000Z'),
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
      inventory: {
        baseIds: ['bsexxx'],
        tableIds: ['tblxxx'],
        dbTableNames: ['bsexxx.sheet1'],
        physicalSchemas: [
          {
            schemaName: 'bsexxx',
            relations: [
              {
                schemaName: 'bsexxx',
                relationName: 'sheet1',
                relationKind: 'table',
                totalBytes: 1024,
                estimatedRows: 10,
              },
            ],
            totalBytes: 1024,
            estimatedRows: 10,
          },
        ],
        estimatedTotalBytes: 1024,
        estimatedTotalRows: 10,
      },
    });
    let resolveCount: (value: { rows: { count: string }[] }) => void = vi.fn();
    const countRows = new Promise<{ rows: { count: string }[] }>((resolve) => {
      resolveCount = resolve;
    });
    targetClient.raw.mockImplementation((sql: string) => {
      if (sql.includes('FROM "bsexxx"."sheet1"')) {
        return countRows;
      }
      return { rows: [] };
    });
    const service = createService();

    const promise = service.copyBaseSchemasForJob('sdmjxxx', {
      workDir: '/tmp/sdmjxxx',
      progressPollMs: 50,
    });
    await vi.advanceTimersByTimeAsync(150);

    const heartbeatCount = prismaService.spaceDataDbMigrationJob.update.mock.calls.filter(
      ([args]) => args.data.copyStats?.baseSchemas?.heartbeat?.stage === 'post_copy_stats'
    ).length;
    expect(heartbeatCount).toBeGreaterThanOrEqual(2);

    resolveCount({ rows: [{ count: '10' }] });
    await expect(promise).resolves.toMatchObject({
      phase: 'base_schemas_completed',
    });
    vi.useRealTimers();
  });

  it('marks the migration failed when base schema copy fails', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
      inventory: {
        baseIds: ['bsexxx'],
        tableIds: [],
        dbTableNames: [],
        physicalSchemas: [],
      },
    });
    copyService.copyBaseSchemas.mockRejectedValue(
      new SpaceDataDbProcessError('pg_dump failed', {
        ...processResult('pg_dump'),
        exitCode: 1,
        stderr: 'dump stderr',
      })
    );
    const service = createService();

    await expect(
      service.copyBaseSchemasForJob('sdmjxxx', {
        workDir: '/tmp/sdmjxxx',
      })
    ).rejects.toThrow('pg_dump failed');

    expect(prismaService.spaceDataDbMigrationJob.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'sdmjxxx' },
        data: expect.objectContaining({
          state: 'failed',
          lastError: 'pg_dump failed: pg_dump - exit 1 - dump stderr',
          copyStats: expect.objectContaining({
            phase: 'base_schemas_failed',
            baseSchemas: expect.objectContaining({
              error: 'pg_dump failed: pg_dump - exit 1 - dump stderr',
              failure: expect.objectContaining({
                type: 'process',
                result: expect.objectContaining({
                  command: 'pg_dump',
                  exitCode: 1,
                  stderr: 'dump stderr',
                  durationMs: 1000,
                }),
              }),
            }),
          }),
        }),
      })
    );
  });

  it('preserves canceled state when a base schema copy process is killed by cancel', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      state: 'copying',
      startedAt: new Date('2026-05-06T00:00:00.000Z'),
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
      inventory: {
        baseIds: ['bsexxx'],
        tableIds: [],
        dbTableNames: [],
        physicalSchemas: [],
      },
    });
    prismaService.spaceDataDbMigrationJob.findFirst.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      state: 'canceled',
    });
    copyService.copyBaseSchemas.mockRejectedValue(
      new SpaceDataDbProcessCanceledError({
        ...processResult('pg_dump'),
        command: 'pg_dump',
        args: [],
        exitCode: null,
        signal: 'SIGTERM',
        stderr: '',
        stdout: '',
      })
    );
    const service = createService();

    await expect(
      service.copyBaseSchemasForJob('sdmjxxx', {
        workDir: '/tmp/sdmjxxx',
      })
    ).rejects.toBeInstanceOf(SpaceDataDbProcessCanceledError);

    expect(prismaService.spaceDataDbMigrationJob.update).toHaveBeenCalledTimes(1);
    expect(prismaService.spaceDataDbMigrationJob.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: 'failed',
        }),
      })
    );
  });

  it('copies shared rows for an existing migration job and records copy stats', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      startedAt: new Date('2026-05-06T00:00:00.000Z'),
      targetInternalSchema: internalSchema,
      switchOnCompletion: true,
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
      inventory: {
        baseIds: ['bsexxx'],
        tableIds: ['tblxxx'],
        dbTableNames: ['bsexxx.sheet1'],
        physicalSchemas: [
          { schemaName: 'bsexxx', relations: [], totalBytes: 1024, estimatedRows: 10 },
        ],
        estimatedTotalBytes: 1024,
        estimatedTotalRows: 10,
      },
    });
    const service = createService();
    const pauseTargetComputed = vi.spyOn(service, 'pauseTargetComputedForJob');

    await expect(
      service.copySharedRowsForJob('sdmjxxx', { timeoutMs: 1000 })
    ).resolves.toMatchObject({
      phase: 'shared_rows_completed',
      sharedTables: {
        copiedTableCount: 1,
        totalCopiedRows: 5,
        copiedTables: [{ table: 'record_history', copiedRows: 5 }],
      },
    });

    expect(dataDbClientManager.getDataDatabaseForSpace).toHaveBeenCalledWith('spcxxx', {
      sourceConnectionId: null,
    });
    expect(copyService.copySharedTables).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          table: 'record_history',
          sourceSql: expect.stringContaining('FROM "public"."record_history"'),
          targetSql: expect.stringContaining(`COPY "${internalSchema}"."record_history"`),
        }),
        expect.objectContaining({
          table: 'computed_update_outbox',
          sourceSql: expect.stringContaining(`"base_id" = ANY(ARRAY['bsexxx']::text[])`),
        }),
      ]),
      expect.objectContaining({
        timeoutMs: 1000,
        onPoll: expect.any(Function),
        shouldCancel: expect.any(Function),
      }),
      expect.objectContaining({
        onTableCopied: expect.any(Function),
      })
    );
    expect(prismaService.spaceDataDbMigrationJob.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { id: 'sdmjxxx' },
        data: expect.objectContaining({
          state: 'copying',
          copyStats: expect.objectContaining({ phase: 'copying_shared_rows' }),
        }),
      })
    );
    expect(prismaService.spaceDataDbMigrationJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sdmjxxx' },
        data: expect.objectContaining({
          state: 'copying',
          copyStats: expect.objectContaining({
            phase: 'shared_rows_completed',
            progress: expect.objectContaining({
              completedSteps: 7,
              completedEstimatedBytes: 1024,
              completedEstimatedRows: 10,
            }),
            sharedTables: expect.objectContaining({
              strategy: 'psql_copy',
              totalCopiedRows: 5,
              copiedTables: expect.arrayContaining([
                expect.objectContaining({
                  strategy: 'psql_copy',
                  table: 'record_history',
                  copiedRows: 5,
                  source: expect.objectContaining({
                    command: 'psql',
                    durationMs: 1000,
                  }),
                  target: expect.objectContaining({
                    command: 'psql',
                    stdout: 'COPY 5\n',
                    durationMs: 1000,
                  }),
                }),
              ]),
            }),
          }),
        }),
      })
    );
    expect(pauseTargetComputed).not.toHaveBeenCalled();
  });

  it('pauses target computed claims after pause scopes are copied and before target outbox rows', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      startedAt: new Date('2026-05-06T00:00:00.000Z'),
      targetInternalSchema: internalSchema,
      switchOnCompletion: true,
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
      inventory: {
        baseIds: ['bsexxx'],
        tableIds: ['tblxxx'],
        dbTableNames: ['bsexxx.sheet1'],
        physicalSchemas: [
          { schemaName: 'bsexxx', relations: [], totalBytes: 1024, estimatedRows: 10 },
        ],
        estimatedTotalBytes: 1024,
        estimatedTotalRows: 10,
      },
      createdBy: 'usrxxx',
    });
    copyService.copySharedTables.mockImplementation(
      async (
        plans: Array<{ table: string }>,
        _options: unknown,
        hooks: {
          onTableCopied?: (
            result: { table: string; copiedRows: number; source: unknown; target: unknown },
            index: number,
            total: number
          ) => void | Promise<void>;
        }
      ) => {
        const results = [];
        for (const [index, plan] of plans.entries()) {
          const result = {
            strategy: 'psql_copy',
            table: plan.table,
            copiedRows: index + 1,
            source: processResult('psql'),
            target: processResult('psql', `COPY ${index + 1}\n`),
          };
          results.push(result);
          await hooks.onTableCopied?.(result, index, plans.length);
        }
        return results;
      }
    );
    const service = createService();
    const pauseTargetComputed = vi.spyOn(service, 'pauseTargetComputedForJob');

    await expect(
      service.copySharedRowsForJob('sdmjxxx', { timeoutMs: 1000 })
    ).resolves.toMatchObject({
      phase: 'shared_rows_completed',
    });

    const copiedTableNames = (
      copyService.copySharedTables.mock.calls[0][0] as Array<{ table: string }>
    ).map((plan) => plan.table);
    expect(copiedTableNames.indexOf('computed_update_pause_scope')).toBeLessThan(
      copiedTableNames.indexOf('computed_update_outbox')
    );
    expect(pauseTargetComputed).toHaveBeenCalledWith('sdmjxxx');
    expect(targetClient.raw).toHaveBeenCalledWith(
      expect.stringContaining(`INSERT INTO "${internalSchema}"."computed_update_pause_scope"`),
      [
        'sdmp_sdmjxxx_spcxxx',
        'spcxxx',
        'usrxxx',
        'space-data-db-migration:sdmjxxx',
        'usrxxx',
        'space-data-db-migration:sdmjxxx',
      ]
    );
  });

  it('copies shared rows only for the default subset during repair migrations', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcrelated',
      startedAt: new Date('2026-05-06T00:00:00.000Z'),
      targetInternalSchema: internalSchema,
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
      inventory: {
        relatedSpaces: {
          primarySpaceId: 'spcrelated',
          hasCrossSpaceLinks: true,
          spaces: [
            {
              spaceId: 'spcalready',
              name: 'Already',
              isPrimary: false,
              baseIds: ['bsealready'],
              tableIds: ['tblalready'],
              dataDbMode: 'byodb',
            },
            {
              spaceId: 'spcrelated',
              name: 'Related',
              isPrimary: true,
              baseIds: ['bserelated'],
              tableIds: ['tblrelated'],
              dataDbMode: 'default',
            },
          ],
          links: [],
        },
        spaceIds: ['spcalready', 'spcrelated'],
        copySpaceIds: ['spcrelated'],
        baseIds: ['bserelated'],
        tableIds: ['tblrelated'],
        sharedTableIds: ['tblrelated', 'tbldeletedrelated'],
        dbTableNames: ['bserelated.sheet1'],
        physicalSchemas: [
          { schemaName: 'bserelated', relations: [], totalBytes: 1024, estimatedRows: 10 },
        ],
        estimatedTotalBytes: 1024,
        estimatedTotalRows: 10,
      },
    });
    const service = createService();

    await expect(
      service.copySharedRowsForJob('sdmjxxx', { timeoutMs: 1000 })
    ).resolves.toMatchObject({
      phase: 'shared_rows_completed',
    });

    expect(copyService.copySharedTables).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          table: 'record_history',
          sourceSql: expect.stringContaining(
            `"table_id" = ANY(ARRAY['tblrelated', 'tbldeletedrelated']::text[])`
          ),
        }),
        expect.objectContaining({
          table: 'computed_update_outbox_seed',
          sourceSql: expect.stringContaining(`"table_id" = ANY(ARRAY['tblrelated']::text[])`),
        }),
        expect.objectContaining({
          table: 'computed_update_pause_scope',
          sourceSql: expect.stringContaining(`"scope_id" = ANY(ARRAY['spcrelated']::text[])`),
        }),
      ]),
      expect.anything(),
      expect.anything()
    );
    const plans = copyService.copySharedTables.mock.calls.at(-1)?.[0] as Array<{
      sourceSql: string;
    }>;
    expect(JSON.stringify(plans)).not.toContain('spcalready');
    expect(JSON.stringify(plans)).not.toContain('tblalready');
    expect(JSON.stringify(plans)).not.toContain('bsealready');
    expect(JSON.stringify(plans)).not.toContain('tbldeletedalready');
  });

  it('copies shared rows through postgres_fdw when explicitly selected', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      startedAt: new Date('2026-05-06T00:00:00.000Z'),
      targetInternalSchema: internalSchema,
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
      inventory: {
        baseIds: ['bsexxx'],
        tableIds: ['tblxxx'],
        dbTableNames: ['bsexxx.sheet1'],
        physicalSchemas: [
          { schemaName: 'bsexxx', relations: [], totalBytes: 1024, estimatedRows: 10 },
        ],
        estimatedTotalBytes: 1024,
        estimatedTotalRows: 10,
      },
    });
    const service = createService();

    await expect(
      service.copySharedRowsForJob('sdmjxxx', { timeoutMs: 1000, strategy: 'postgres_fdw' })
    ).resolves.toMatchObject({
      phase: 'shared_rows_completed',
      sharedTables: {
        strategy: 'postgres_fdw',
        copiedTableCount: 1,
        totalCopiedRows: 5,
        copiedTables: [{ strategy: 'postgres_fdw', table: 'record_history', copiedRows: 5 }],
      },
    });

    expect(copyService.copySharedTables).not.toHaveBeenCalled();
    expect(copyService.copySharedTablesViaPostgresFdw).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          table: 'record_history',
          sql: expect.stringContaining('CREATE EXTENSION IF NOT EXISTS postgres_fdw'),
          target: expect.objectContaining({ command: 'psql' }),
        }),
        expect.objectContaining({
          table: 'computed_update_outbox',
          sql: expect.stringContaining(`"base_id" = ANY(ARRAY['bsexxx']::text[])`),
        }),
      ]),
      expect.objectContaining({
        timeoutMs: 1000,
        shouldCancel: expect.any(Function),
      }),
      expect.objectContaining({
        onTableCopied: expect.any(Function),
      })
    );
  });

  it('marks the migration failed when shared row copy fails', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      targetInternalSchema: internalSchema,
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
      inventory: {
        baseIds: ['bsexxx'],
        tableIds: ['tblxxx'],
        sharedTableIds: ['tblxxx', 'tbldeleted'],
        dbTableNames: ['bsexxx.sheet1'],
        physicalSchemas: [],
      },
    });
    copyService.copySharedTables.mockImplementation(
      async (
        _plans: unknown[],
        _options: unknown,
        hooks: {
          onTableCopied?: (result: unknown, index: number, total: number) => void | Promise<void>;
        }
      ) => {
        await hooks.onTableCopied?.(
          {
            table: 'record_history',
            copiedRows: 5,
            source: processResult('psql'),
            target: processResult('psql', 'COPY 5\n'),
          },
          0,
          8
        );
        throw new SpaceDataDbProcessPipelineError('psql copy failed', {
          label: 'shared-table:record_trash',
          source: {
            ...processResult('psql'),
            exitCode: 1,
            stderr: 'source failed',
          },
          target: {
            ...processResult('psql'),
            exitCode: null,
            signal: 'SIGTERM',
          },
        });
      }
    );
    const service = createService();

    await expect(service.copySharedRowsForJob('sdmjxxx', {})).rejects.toThrow('psql copy failed');

    expect(prismaService.spaceDataDbMigrationJob.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'sdmjxxx' },
        data: expect.objectContaining({
          state: 'failed',
          lastError: 'psql copy failed',
          copyStats: expect.objectContaining({
            phase: 'shared_rows_failed',
            sharedTables: expect.objectContaining({
              copiedTableCount: 1,
              totalCopiedRows: 5,
              copiedTables: [
                expect.objectContaining({
                  table: 'record_history',
                  copiedRows: 5,
                }),
              ],
              error: 'psql copy failed',
              failure: expect.objectContaining({
                type: 'pipeline',
                result: expect.objectContaining({
                  label: 'shared-table:record_trash',
                  source: expect.objectContaining({
                    command: 'psql',
                    exitCode: 1,
                    stderr: 'source failed',
                  }),
                  target: expect.objectContaining({
                    command: 'psql',
                    signal: 'SIGTERM',
                  }),
                }),
              }),
            }),
          }),
        }),
      })
    );
  });

  it('cleans target schemas and scoped shared rows idempotently before switch', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      state: 'failed',
      targetInternalSchema: internalSchema,
      copyStats: { phase: 'shared_rows_failed' },
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
      inventory: {
        baseIds: ['bsexxx'],
        tableIds: ['tblxxx'],
        sharedTableIds: ['tblxxx', 'tbldeleted'],
        dbTableNames: ['bsexxx.sheet1'],
        physicalSchemas: [],
      },
    });
    targetClient.raw.mockImplementation((sql: string) => {
      if (sql.includes('FROM information_schema.schemata')) {
        return { rows: [{ schemaName: 'bsexxx' }] };
      }
      if (sql.includes('to_regclass')) {
        return { rows: [{ exists: true }] };
      }
      if (sql.includes('WITH deleted')) {
        return { rows: [{ count: '3' }] };
      }
      return { rows: [] };
    });
    const service = createService();

    await expect(
      service.cleanupTargetArtifactsForJob('sdmjxxx', 'copy_failed')
    ).resolves.toMatchObject({
      reason: 'copy_failed',
      baseSchemas: [{ schemaName: 'bsexxx', dropped: true }],
      sharedTables: expect.arrayContaining([
        expect.objectContaining({ table: 'record_history', deletedRows: 3 }),
      ]),
    });

    expect(targetClient.raw).toHaveBeenCalledWith('DROP SCHEMA IF EXISTS "bsexxx" CASCADE');
    expect(
      targetClient.raw.mock.calls.some(
        ([sql, bindings]) =>
          typeof sql === 'string' &&
          sql.includes('WITH deleted') &&
          JSON.stringify(bindings).includes('tbldeleted')
      )
    ).toBe(true);
    expect(prismaService.spaceDataDbMigrationJob.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'sdmjxxx' },
        data: expect.objectContaining({
          copyStats: expect.objectContaining({
            phase: 'shared_rows_failed',
            targetCleanup: expect.objectContaining({
              reason: 'copy_failed',
              completedAt: expect.any(String),
            }),
          }),
        }),
      })
    );
  });

  it('truncates target shared tables when the target connection is unbound', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      state: 'failed',
      targetInternalSchema: internalSchema,
      copyStats: { phase: 'shared_rows_failed' },
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
      inventory: {
        baseIds: ['bsexxx'],
        tableIds: ['tblxxx'],
        sharedTableIds: ['tblxxx'],
        dbTableNames: ['bsexxx.sheet1'],
        physicalSchemas: [],
      },
    });
    targetClient.raw.mockImplementation((sql: string) => {
      if (sql.includes('FROM information_schema.schemata')) {
        return { rows: [] };
      }
      if (sql.includes('to_regclass')) {
        return { rows: [{ exists: true }] };
      }
      return { rows: [] };
    });
    const service = createService();

    await expect(
      service.cleanupTargetArtifactsForJob('sdmjxxx', 'retry_before_start', {
        truncateSharedTables: true,
      })
    ).resolves.toMatchObject({
      reason: 'retry_before_start',
      truncateSharedTables: true,
      sharedTables: expect.arrayContaining([
        expect.objectContaining({ table: 'record_history', deletedRows: null, truncated: true }),
      ]),
    });

    const truncateCalls = targetClient.raw.mock.calls.filter(
      ([sql]) => typeof sql === 'string' && sql.startsWith('TRUNCATE TABLE ')
    );
    expect(truncateCalls).toHaveLength(1);
    expect(truncateCalls[0][0]).toContain(`"${internalSchema}"."record_history"`);
    expect(truncateCalls[0][0]).toContain(`"${internalSchema}"."computed_update_outbox_seed"`);
    expect(truncateCalls[0][0]).toContain(`"${internalSchema}"."computed_update_outbox"`);
    expect(
      targetClient.raw.mock.calls.some(
        ([sql]) => typeof sql === 'string' && sql.includes('WITH deleted')
      )
    ).toBe(false);
  });

  it('returns a clear conflict when retry target cleanup fails', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      state: 'failed',
      targetInternalSchema: internalSchema,
      copyStats: { phase: 'shared_rows_failed' },
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
      inventory: {
        baseIds: ['bsexxx'],
        tableIds: ['tblxxx'],
        sharedTableIds: ['tblxxx'],
        dbTableNames: ['bsexxx.sheet1'],
        physicalSchemas: [],
      },
    });
    targetClient.raw.mockImplementation((sql: string) => {
      if (sql.includes('to_regclass')) {
        return { rows: [{ exists: true }] };
      }
      if (sql.startsWith('TRUNCATE TABLE ')) {
        throw new Error('cannot truncate a table referenced in a foreign key constraint');
      }
      return { rows: [] };
    });
    const service = createService();

    await expect(
      service.cleanupTargetArtifactsForJob('sdmjxxx', 'retry_before_start', {
        truncateSharedTables: true,
      })
    ).rejects.toMatchObject({
      code: HttpErrorCode.CONFLICT,
      data: expect.objectContaining({
        errorCode: 'SPACE_DATA_DB_TARGET_CLEANUP_FAILED',
        targetError: expect.stringContaining('foreign key constraint'),
      }),
    });
    expect(prismaService.spaceDataDbMigrationJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          copyStats: expect.objectContaining({
            targetCleanup: expect.objectContaining({
              failedAt: expect.any(String),
              error: expect.stringContaining('foreign key constraint'),
            }),
          }),
        }),
      })
    );
  });

  it('refuses automatic target cleanup after a successful switch', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      state: 'succeeded',
      switchOnCompletion: true,
      targetInternalSchema: internalSchema,
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
      inventory: {
        baseIds: ['bsexxx'],
        tableIds: ['tblxxx'],
      },
    });
    const service = createService();

    await expect(service.cleanupTargetArtifactsForJob('sdmjxxx')).rejects.toMatchObject({
      code: HttpErrorCode.CONFLICT,
    });

    expect(targetClient.raw).not.toHaveBeenCalled();
  });

  it('fails validation on base table row-count mismatch and does not switch routing', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      targetConnectionId: 'dcnxxx',
      targetInternalSchema: internalSchema,
      createdBy: 'usrxxx',
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
      inventory: {
        baseIds: ['bsexxx'],
        tableIds: [],
        dbTableNames: ['bsexxx.sheet1'],
        physicalSchemas: [{ schemaName: 'bsexxx', relations: [], totalBytes: 1024 }],
      },
    });
    mockValidationClient(sourceClient, 3);
    mockValidationClient(targetClient, 2);
    const service = createService();

    await expect(service.validateAndSwitchJob('sdmjxxx')).rejects.toMatchObject({
      code: HttpErrorCode.CONFLICT,
      data: expect.objectContaining({
        errorCode: 'SPACE_DATA_DB_VALIDATION_MISMATCH',
        mismatches: [
          expect.objectContaining({
            object: 'base:bsexxx.sheet1',
            sourceCount: 3,
            targetCount: 2,
          }),
        ],
      }),
    });

    expect(txClient.spaceDataDbBinding.upsert).not.toHaveBeenCalled();
    expect(txClient.dataDbConnection.update).not.toHaveBeenCalled();
    expect(prismaService.spaceDataDbMigrationJob.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'sdmjxxx' },
        data: expect.objectContaining({
          state: 'failed',
          lastError: 'Space data database migration validation failed',
          validationStats: expect.objectContaining({ phase: 'validation_failed' }),
        }),
      })
    );
    expect(sourceClient.destroy).toHaveBeenCalled();
    expect(targetClient.destroy).toHaveBeenCalled();
  });

  it('fails validation when content hashes differ despite equal row counts', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      targetConnectionId: 'dcnxxx',
      targetInternalSchema: internalSchema,
      createdBy: 'usrxxx',
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
      inventory: {
        baseIds: ['bsexxx'],
        tableIds: [],
        dbTableNames: ['bsexxx.sheet1'],
        physicalSchemas: [{ schemaName: 'bsexxx', relations: [], totalBytes: 1024 }],
      },
    });
    mockValidationClient(sourceClient, 3, { contentHash: '1111' });
    mockValidationClient(targetClient, 3, { contentHash: '2222' });
    const service = createService();

    await expect(service.validateAndSwitchJob('sdmjxxx')).rejects.toMatchObject({
      code: HttpErrorCode.CONFLICT,
      data: expect.objectContaining({
        errorCode: 'SPACE_DATA_DB_VALIDATION_MISMATCH',
        mismatches: [
          expect.objectContaining({
            object: 'base:bsexxx.sheet1',
            reason: 'content_hash_mismatch',
            sourceCount: 3,
            targetCount: 3,
            sourceContentHash: '1111',
            targetContentHash: '2222',
          }),
        ],
      }),
    });

    expect(txClient.spaceDataDbBinding.upsert).not.toHaveBeenCalled();
  });

  it('renders time-based columns via extract(epoch) in the content hash query', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      targetConnectionId: 'dcnxxx',
      targetInternalSchema: internalSchema,
      createdBy: 'usrxxx',
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
      inventory: {
        baseIds: ['bsexxx'],
        tableIds: [],
        dbTableNames: ['bsexxx.sheet1'],
        physicalSchemas: [{ schemaName: 'bsexxx', relations: [], totalBytes: 1024 }],
      },
    });
    const columns = columnSignatureRows([
      { columnName: '__id', formattedType: 'text', notNull: true },
      { columnName: '__created_time', formattedType: 'timestamp with time zone' },
    ]);
    mockValidationClient(sourceClient, 3, { columns });
    mockValidationClient(targetClient, 3, { columns });
    const service = createService();

    await expect(service.validateAndSwitchJob('sdmjxxx')).resolves.toMatchObject({
      state: 'succeeded',
    });

    expect(sourceClient.raw).toHaveBeenCalledWith(
      expect.stringContaining('extract(epoch from "__created_time")::text')
    );
    expect(sourceClient.raw).toHaveBeenCalledWith(expect.stringContaining('length("__id"::text)'));
    expect(sourceClient.raw).toHaveBeenCalledWith(expect.stringContaining("THEN 'N' ELSE 'V'"));
  });

  it('uses unambiguous length-prefixed column encoding for content hashes', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      targetConnectionId: 'dcnxxx',
      targetInternalSchema: internalSchema,
      createdBy: 'usrxxx',
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
      inventory: {
        baseIds: ['bsexxx'],
        tableIds: [],
        dbTableNames: ['bsexxx.sheet1'],
        physicalSchemas: [{ schemaName: 'bsexxx', relations: [], totalBytes: 1024 }],
      },
    });
    const columns = columnSignatureRows([
      { columnName: '__id', formattedType: 'text', notNull: true },
      { columnName: '__name', formattedType: 'text' },
    ]);
    mockValidationClient(sourceClient, 3, { columns });
    mockValidationClient(targetClient, 3, { columns });
    const service = createService();

    await expect(service.validateAndSwitchJob('sdmjxxx')).resolves.toMatchObject({
      state: 'succeeded',
    });

    const hashSql = sourceClient.raw.mock.calls
      .map(([sql]) => String(sql))
      .find((sql) => sql.includes('contentHash'));
    expect(hashSql).toContain('CASE WHEN "__id"::text IS NULL THEN \'N\'');
    expect(hashSql).toContain('\'V\' || length("__id"::text)::text || \':\' || "__id"::text');
    expect(hashSql).toContain('CASE WHEN "__name"::text IS NULL THEN \'N\'');
    expect(hashSql).not.toContain('chr(1)');
    expect(hashSql).not.toContain('chr(2)');
  });

  it('skips content hashing when BYODB_SPACE_DATA_DB_VALIDATION_CONTENT_HASH is off', async () => {
    process.env.BYODB_SPACE_DATA_DB_VALIDATION_CONTENT_HASH = 'off';
    try {
      prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
        id: 'sdmjxxx',
        spaceId: 'spcxxx',
        targetConnectionId: 'dcnxxx',
        targetInternalSchema: internalSchema,
        createdBy: 'usrxxx',
        targetConnection: {
          encryptedUrl: encryptDataDbUrl(dataUrl),
        },
        inventory: {
          baseIds: ['bsexxx'],
          tableIds: [],
          dbTableNames: ['bsexxx.sheet1'],
          physicalSchemas: [{ schemaName: 'bsexxx', relations: [], totalBytes: 1024 }],
        },
      });
      mockValidationClient(sourceClient, 3);
      mockValidationClient(targetClient, 3);
      const service = createService();

      await expect(service.validateAndSwitchJob('sdmjxxx')).resolves.toMatchObject({
        state: 'succeeded',
      });

      const hashCalls = sourceClient.raw.mock.calls.filter(([sql]) =>
        String(sql).includes('contentHash')
      );
      expect(hashCalls).toHaveLength(0);
    } finally {
      delete process.env.BYODB_SPACE_DATA_DB_VALIDATION_CONTENT_HASH;
    }
  });

  it('fails validation on base table column signature mismatch and does not switch routing', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      targetConnectionId: 'dcnxxx',
      targetInternalSchema: internalSchema,
      createdBy: 'usrxxx',
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
      inventory: {
        baseIds: ['bsexxx'],
        tableIds: [],
        dbTableNames: ['bsexxx.sheet1'],
        physicalSchemas: [{ schemaName: 'bsexxx', relations: [], totalBytes: 1024 }],
      },
    });
    mockValidationClient(sourceClient, 3, { columns: columnSignatureRows() });
    mockValidationClient(targetClient, 3, {
      columns: columnSignatureRows([{ columnName: '__id', formattedType: 'text', notNull: true }]),
    });
    const service = createService();

    await expect(service.validateAndSwitchJob('sdmjxxx')).rejects.toMatchObject({
      code: HttpErrorCode.CONFLICT,
      data: expect.objectContaining({
        errorCode: 'SPACE_DATA_DB_VALIDATION_MISMATCH',
        mismatches: [
          expect.objectContaining({
            object: 'base:bsexxx.sheet1',
            reason: 'column_signature_mismatch',
            sourceColumns: expect.arrayContaining([
              expect.objectContaining({ columnName: 'fldName', formattedType: 'text' }),
            ]),
            targetColumns: [expect.objectContaining({ columnName: '__id', formattedType: 'text' })],
          }),
        ],
      }),
    });

    expect(txClient.spaceDataDbBinding.upsert).not.toHaveBeenCalled();
    expect(txClient.dataDbConnection.update).not.toHaveBeenCalled();
  });

  it('accepts restored table columns when dropped source columns leave ordinal gaps', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      sourceConnectionId: 'dcnsource',
      targetConnectionId: 'dcnxxx',
      switchOnCompletion: true,
      targetInternalSchema: internalSchema,
      createdBy: 'usrxxx',
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
      inventory: {
        baseIds: ['bsexxx'],
        tableIds: ['tblxxx'],
        dbTableNames: ['bsexxx.sheet1'],
        physicalSchemas: [{ schemaName: 'bsexxx', relations: [], totalBytes: 1024 }],
      },
    });
    mockValidationClient(sourceClient, 3, {
      columns: columnSignatureRows([
        { columnName: '__id', formattedType: 'text', notNull: true },
        { ordinalPosition: 3, columnName: 'fldName', formattedType: 'text' },
      ]),
    });
    mockValidationClient(targetClient, 3, {
      columns: columnSignatureRows([
        { columnName: '__id', formattedType: 'text', notNull: true },
        { columnName: 'fldName', formattedType: 'text' },
      ]),
    });
    const service = createService();

    await expect(service.validateAndSwitchJob('sdmjxxx')).resolves.toMatchObject({
      state: 'succeeded',
      validationStats: expect.objectContaining({
        phase: 'validation_completed',
        baseSchemas: [
          expect.objectContaining({
            object: 'base:bsexxx.sheet1',
            sourceCount: 3,
            targetCount: 3,
          }),
        ],
      }),
    });

    expect(txClient.spaceDataDbBinding.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { spaceId: 'spcxxx' },
      })
    );
  });

  it('allows existing related target rows during repair validation', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcrelated',
      sourceConnectionId: null,
      targetConnectionId: 'dcnxxx',
      switchOnCompletion: true,
      targetInternalSchema: internalSchema,
      createdBy: 'usrxxx',
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
      inventory: {
        relatedSpaces: {
          primarySpaceId: 'spcrelated',
          hasCrossSpaceLinks: true,
          spaces: [
            {
              spaceId: 'spcalready',
              name: 'Already',
              isPrimary: false,
              baseIds: ['bsealready'],
              tableIds: ['tblalready'],
              dataDbMode: 'byodb',
            },
            {
              spaceId: 'spcrelated',
              name: 'Related',
              isPrimary: true,
              baseIds: ['bserelated'],
              tableIds: ['tblrelated'],
              dataDbMode: 'default',
            },
          ],
          links: [],
        },
        spaceIds: ['spcalready', 'spcrelated'],
        copySpaceIds: ['spcrelated'],
        baseIds: ['bserelated'],
        tableIds: ['tblrelated'],
        dbTableNames: ['bserelated.sheet1'],
        physicalSchemas: [{ schemaName: 'bserelated', relations: [], totalBytes: 1024 }],
      },
    });
    const sourceCountSqls: string[] = [];
    sourceClient.raw.mockImplementation((sql: string) => {
      if (sql.includes('COUNT(*)')) {
        sourceCountSqls.push(sql);
        return { rows: [{ count: sql.includes('tblrelated') ? '3' : '0' }] };
      }
      return { rows: [] };
    });
    const targetCountCalls: Array<{ sql: string; bindings?: unknown[] }> = [];
    targetClient.raw.mockImplementation((sql: string, bindings?: unknown[]) => {
      if (sql.includes('to_regprocedure') || sql.includes('__teable_data_schema_migrations')) {
        return { rows: [{ exists: true }] };
      }
      if (sql.includes('COUNT(*)')) {
        targetCountCalls.push({ sql, bindings });
        if (sql.includes('NOT (') && sql.includes('tblalready')) {
          return { rows: [{ count: '0' }] };
        }
        return { rows: [{ count: sql.includes('tblrelated') ? '3' : '0' }] };
      }
      return { rows: [] };
    });
    const service = createService();

    await expect(service.validateAndSwitchJob('sdmjxxx')).resolves.toMatchObject({
      state: 'succeeded',
    });

    expect(sourceCountSqls.some((sql) => sql.includes('tblalready'))).toBe(false);
    expect(
      targetCountCalls.some(
        (call) => call.sql.includes('NOT (') && JSON.stringify(call.bindings).includes('tblalready')
      )
    ).toBe(true);
    expect(txClient.spaceDataDbBinding.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { spaceId: 'spcalready' } })
    );
    expect(txClient.spaceDataDbBinding.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { spaceId: 'spcrelated' } })
    );
  });

  it('scopes base table foreign key validation to schemas inside the migrated space', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      sourceConnectionId: 'dcnsource',
      targetConnectionId: 'dcnxxx',
      switchOnCompletion: true,
      targetInternalSchema: internalSchema,
      createdBy: 'usrxxx',
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
      inventory: {
        baseIds: ['bsexxx'],
        tableIds: ['tblxxx'],
        dbTableNames: ['bsexxx.sheet1'],
        physicalSchemas: [{ schemaName: 'bsexxx', relations: [], totalBytes: 1024 }],
        outOfScopeForeignKeys: [
          {
            schemaName: 'bsexxx',
            tableName: 'sheet1',
            constraintName: 'fk_out_of_scope',
            referencedSchemaName: 'bseyyy',
            referencedTableName: 'sheet2',
          },
        ],
      },
    });
    mockValidationClient(sourceClient, 3);
    mockValidationClient(targetClient, 3);
    const service = createService();

    await expect(service.validateAndSwitchJob('sdmjxxx')).resolves.toMatchObject({
      state: 'succeeded',
    });

    expect(sourceClient.raw).toHaveBeenCalledWith(
      expect.stringContaining('referenced_ns.nspname = ANY(?::text[])'),
      [['bsexxx'], ['bsexxx']]
    );
    expect(targetClient.raw).toHaveBeenCalledWith(
      expect.stringContaining('referenced_ns.nspname = ANY(?::text[])'),
      [['bsexxx'], ['bsexxx']]
    );
  });

  it('ignores active migration delta triggers during base table validation', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      sourceConnectionId: 'dcnsource',
      targetConnectionId: 'dcnxxx',
      switchOnCompletion: true,
      targetInternalSchema: internalSchema,
      createdBy: 'usrxxx',
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
      inventory: {
        baseIds: ['bsexxx'],
        tableIds: ['tblxxx'],
        dbTableNames: ['bsexxx.sheet1'],
        physicalSchemas: [{ schemaName: 'bsexxx', relations: [], totalBytes: 1024 }],
      },
    });
    const undoTrigger = {
      triggerName: '__teable_undo_capture',
      definition:
        'CREATE TRIGGER __teable_undo_capture AFTER INSERT OR DELETE OR UPDATE ON bsexxx.sheet1',
    };
    mockValidationClient(sourceClient, 3, {
      triggers: triggerSignatureRows([
        {
          triggerName: '__teable_mig_delta_sdmjxxx',
          definition:
            'CREATE TRIGGER __teable_mig_delta_sdmjxxx AFTER INSERT OR DELETE OR UPDATE ON bsexxx.sheet1',
        },
        undoTrigger,
      ]),
    });
    mockValidationClient(targetClient, 3, {
      triggers: triggerSignatureRows([undoTrigger]),
    });
    const service = createService();

    await expect(service.validateAndSwitchJob('sdmjxxx')).resolves.toMatchObject({
      state: 'succeeded',
    });
  });

  it('serializes JSON scalar values before replaying delta rows', async () => {
    targetClient.raw.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM information_schema.columns')) {
        return { rows: [{ columnName: 'jsonField' }] };
      }
      return { rows: [] };
    });
    const service = createService();
    const applyDeltaRowToTarget = (
      service as unknown as {
        applyDeltaRowToTarget: (input: unknown) => Promise<boolean>;
      }
    ).applyDeltaRowToTarget;

    await expect(
      applyDeltaRowToTarget.call(service, {
        targetClient,
        row: {
          seq: 1,
          schemaName: 'bsexxx',
          tableName: 'sheet1',
          op: 'INSERT',
          pk: null,
          oldRow: null,
          newRow: {
            __id: 'recxxx',
            jsonField: 'plain text',
            textField: 'plain text',
          },
          capturedAt: '2026-05-06T00:00:00.000Z',
        },
        sourceSchema: 'public',
        targetSchema: internalSchema,
        jsonColumnCache: new Map(),
      })
    ).resolves.toBe(true);

    expect(targetClient.raw).toHaveBeenLastCalledWith(
      expect.stringContaining('INSERT INTO "bsexxx"."sheet1"'),
      ['recxxx', '"plain text"', 'plain text']
    );
  });

  it('fails validation on base table index constraint or trigger signature mismatch', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      targetConnectionId: 'dcnxxx',
      targetInternalSchema: internalSchema,
      createdBy: 'usrxxx',
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
      inventory: {
        baseIds: ['bsexxx'],
        tableIds: [],
        dbTableNames: ['bsexxx.sheet1'],
        physicalSchemas: [{ schemaName: 'bsexxx', relations: [], totalBytes: 1024 }],
      },
    });
    mockValidationClient(sourceClient, 3, {
      indexes: indexSignatureRows([
        {
          indexName: 'sheet1_name_idx',
          definition: 'CREATE INDEX sheet1_name_idx ON bsexxx.sheet1 USING btree ("fldName")',
        },
      ]),
      constraints: constraintSignatureRows([
        {
          constraintName: 'sheet1_name_check',
          constraintType: 'c',
          definition: 'CHECK (length("fldName") > 0)',
        },
      ]),
      triggers: triggerSignatureRows([
        {
          triggerName: 'sheet1_update_trigger',
          definition: 'CREATE TRIGGER sheet1_update_trigger BEFORE UPDATE ON bsexxx.sheet1',
        },
      ]),
    });
    mockValidationClient(targetClient, 3);
    const service = createService();

    await expect(service.validateAndSwitchJob('sdmjxxx')).rejects.toMatchObject({
      code: HttpErrorCode.CONFLICT,
      data: expect.objectContaining({
        errorCode: 'SPACE_DATA_DB_VALIDATION_MISMATCH',
        mismatches: expect.arrayContaining([
          expect.objectContaining({
            object: 'base:bsexxx.sheet1',
            reason: 'index_signature_mismatch',
            sourceIndexes: expect.arrayContaining([
              expect.objectContaining({ indexName: 'sheet1_name_idx' }),
            ]),
            targetIndexes: [],
          }),
          expect.objectContaining({
            object: 'base:bsexxx.sheet1',
            reason: 'constraint_signature_mismatch',
            sourceConstraints: expect.arrayContaining([
              expect.objectContaining({ constraintName: 'sheet1_name_check' }),
            ]),
            targetConstraints: [],
          }),
          expect.objectContaining({
            object: 'base:bsexxx.sheet1',
            reason: 'trigger_signature_mismatch',
            sourceTriggers: expect.arrayContaining([
              expect.objectContaining({ triggerName: 'sheet1_update_trigger' }),
            ]),
            targetTriggers: [],
          }),
        ]),
      }),
    });

    expect(txClient.spaceDataDbBinding.upsert).not.toHaveBeenCalled();
    expect(txClient.dataDbConnection.update).not.toHaveBeenCalled();
  });

  it('fails validation when the target data DB baseline schema version is not current', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      targetConnectionId: 'dcnxxx',
      targetInternalSchema: internalSchema,
      createdBy: 'usrxxx',
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
      inventory: {
        baseIds: ['bsexxx'],
        tableIds: [],
        dbTableNames: ['bsexxx.sheet1'],
        physicalSchemas: [{ schemaName: 'bsexxx', relations: [], totalBytes: 1024 }],
      },
    });
    mockValidationClient(sourceClient, 3);
    mockValidationClient(targetClient, 3);
    targetClient.raw.mockImplementation((sql: string) => {
      if (sql.includes('FROM pg_class c')) {
        return {
          rows: [
            {
              schemaName: 'bsexxx',
              relationName: 'sheet1',
              relationKind: 'table',
            },
          ],
        };
      }
      if (sql.includes('FROM pg_attribute a')) {
        return {
          rows: columnSignatureRows().map((row) => ({
            schemaName: 'bsexxx',
            relationName: 'sheet1',
            ...row,
          })),
        };
      }
      if (sql.includes('FROM "bsexxx"."sheet1"')) {
        return { rows: [{ count: '3' }] };
      }
      if (sql.includes('to_regprocedure')) {
        return { rows: [{ exists: true }] };
      }
      if (sql.includes('__teable_data_schema_migrations')) {
        return { rows: [{ exists: false }] };
      }
      if (sql.includes('COUNT(*)')) {
        return { rows: [{ count: '0' }] };
      }
      return { rows: [] };
    });
    const service = createService();

    await expect(service.validateAndSwitchJob('sdmjxxx')).rejects.toMatchObject({
      code: HttpErrorCode.CONFLICT,
      data: expect.objectContaining({
        errorCode: 'SPACE_DATA_DB_VALIDATION_MISMATCH',
        mismatches: [
          expect.objectContaining({
            object: `schema:${internalSchema}.__teable_data_schema_migrations`,
            reason: 'target_schema_version_mismatch',
          }),
        ],
      }),
    });

    expect(txClient.spaceDataDbBinding.upsert).not.toHaveBeenCalled();
    expect(targetClient.raw).toHaveBeenCalledWith(
      expect.stringContaining(`"${internalSchema}"."__teable_data_schema_migrations"`),
      [schemaVersion]
    );
  });

  it('fails validation when dry-run routing does not resolve to the target BYODB connection', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      targetConnectionId: 'dcnxxx',
      targetInternalSchema: internalSchema,
      createdBy: 'usrxxx',
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
      inventory: {
        baseIds: ['bsexxx'],
        tableIds: [],
        dbTableNames: ['bsexxx.sheet1'],
        physicalSchemas: [{ schemaName: 'bsexxx', relations: [], totalBytes: 1024 }],
      },
    });
    mockValidationClient(sourceClient, 3);
    mockValidationClient(targetClient, 3);
    dataDbClientManager.getDataDatabaseForSpace.mockImplementation((_, options) => {
      if (options?.previewBinding) {
        return Promise.resolve({
          cacheKey: 'meta-fallback',
          isMetaFallback: true,
          url: 'postgresql://source.example/teable',
        });
      }
      return Promise.resolve({ url: 'postgresql://source.example/teable' });
    });
    const service = createService();

    await expect(service.validateAndSwitchJob('sdmjxxx')).rejects.toMatchObject({
      code: HttpErrorCode.CONFLICT,
      data: expect.objectContaining({
        errorCode: 'SPACE_DATA_DB_VALIDATION_MISMATCH',
        mismatches: [
          expect.objectContaining({
            object: 'route:spcxxx',
            reason: 'target_route_smoke_failed',
          }),
        ],
      }),
    });

    expect(txClient.spaceDataDbBinding.upsert).not.toHaveBeenCalled();
    expect(dataDbClientManager.getDataDatabaseForSpace).toHaveBeenCalledWith('spcxxx', {
      previewBinding: expect.objectContaining({
        spaceId: 'spcxxx',
        connectionId: 'dcnxxx',
        internalSchema,
      }),
    });
  });

  it('fails validation when copied target shared tables contain out-of-scope rows', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      targetConnectionId: 'dcnxxx',
      targetInternalSchema: internalSchema,
      createdBy: 'usrxxx',
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
      inventory: {
        baseIds: ['bsexxx'],
        tableIds: ['tblxxx'],
        dbTableNames: ['bsexxx.sheet1'],
        physicalSchemas: [{ schemaName: 'bsexxx', relations: [], totalBytes: 1024 }],
      },
    });
    mockValidationClient(sourceClient, 3);
    mockValidationClient(targetClient, 3);
    targetClient.raw.mockImplementation((sql: string) => {
      if (sql.includes('FROM pg_class c')) {
        return {
          rows: [
            {
              schemaName: 'bsexxx',
              relationName: 'sheet1',
              relationKind: 'table',
            },
          ],
        };
      }
      if (sql.includes('FROM pg_attribute a')) {
        return {
          rows: columnSignatureRows().map((row) => ({
            schemaName: 'bsexxx',
            relationName: 'sheet1',
            ...row,
          })),
        };
      }
      if (sql.includes('FROM "bsexxx"."sheet1"')) {
        return { rows: [{ count: '3' }] };
      }
      if (sql.includes('to_regprocedure')) {
        return { rows: [{ exists: true }] };
      }
      if (sql.includes('__teable_data_schema_migrations')) {
        return { rows: [{ exists: true }] };
      }
      if (
        sql.includes(`FROM "${internalSchema}"."record_history"`) &&
        sql.includes('NOT ("table_id" = ANY')
      ) {
        return { rows: [{ count: '1' }] };
      }
      if (sql.includes('COUNT(*)')) {
        return { rows: [{ count: '0' }] };
      }
      return { rows: [] };
    });
    const service = createService();

    await expect(service.validateAndSwitchJob('sdmjxxx')).rejects.toMatchObject({
      code: HttpErrorCode.CONFLICT,
      data: expect.objectContaining({
        errorCode: 'SPACE_DATA_DB_VALIDATION_MISMATCH',
        mismatches: [
          expect.objectContaining({
            object: 'shared:record_history',
            reason: 'out_of_scope_target_rows',
            targetCount: 1,
          }),
        ],
      }),
    });

    expect(txClient.spaceDataDbBinding.upsert).not.toHaveBeenCalled();
  });

  it('validates copied data without switching the space binding by default', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      sourceConnectionId: 'dcnsource',
      targetConnectionId: 'dcnxxx',
      switchOnCompletion: false,
      targetInternalSchema: internalSchema,
      createdBy: 'usrxxx',
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
      inventory: {
        baseIds: ['bsexxx'],
        tableIds: ['tblxxx'],
        dbTableNames: ['bsexxx.sheet1'],
        physicalSchemas: [{ schemaName: 'bsexxx', relations: [], totalBytes: 1024 }],
      },
    });
    mockValidationClient(sourceClient, 3);
    mockValidationClient(targetClient, 3);
    const service = createService();

    await expect(service.validateAndSwitchJob('sdmjxxx')).resolves.toMatchObject({
      state: 'succeeded',
      validationStats: expect.objectContaining({
        phase: 'validation_completed',
        switchOnCompletion: false,
        switched: false,
      }),
    });

    expect(prismaService.spaceDataDbMigrationJob.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sdmjxxx' },
        data: expect.objectContaining({ state: 'switching' }),
      })
    );
    expect(txClient.spaceDataDbBinding.upsert).not.toHaveBeenCalled();
    expect(sourceClient.raw).toHaveBeenCalledWith(
      expect.stringContaining(`DELETE FROM "public"."computed_update_pause_scope"`),
      ['space', ['spcxxx'], 'space-data-db-migration:sdmjxxx']
    );
    expect(txClient.dataDbConnection.update).toHaveBeenCalledWith({
      where: { id: 'dcnxxx' },
      data: expect.objectContaining({
        status: 'ready',
        lastError: null,
      }),
    });
    expect(txClient.spaceDataDbMigrationJob.update).toHaveBeenCalledWith({
      where: { id: 'sdmjxxx' },
      data: expect.objectContaining({
        state: 'succeeded',
        validationStats: expect.objectContaining({
          switchOnCompletion: false,
          switched: false,
        }),
        lastError: null,
      }),
    });
    expect(dataDbClientManager.invalidateConnection).toHaveBeenCalledWith('dcnxxx');
    expect(dataDbClientManager.invalidateConnection).not.toHaveBeenCalledWith('dcnsource');
  });

  it('downgrades test-only validation mismatches to a source-changed warning', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      sourceConnectionId: 'dcnsource',
      targetConnectionId: 'dcnxxx',
      switchOnCompletion: false,
      targetInternalSchema: internalSchema,
      createdBy: 'usrxxx',
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
      inventory: {
        baseIds: ['bsexxx'],
        tableIds: ['tblxxx'],
        dbTableNames: ['bsexxx.sheet1'],
        physicalSchemas: [{ schemaName: 'bsexxx', relations: [], totalBytes: 1024 }],
      },
    });
    mockValidationClient(sourceClient, 3);
    mockValidationClient(targetClient, 4);
    const sourceRaw = sourceClient.raw.getMockImplementation();
    let seqCalls = 0;
    sourceClient.raw.mockImplementation((sql: string, ...args: unknown[]) => {
      if (sql.includes(`MAX("seq")`)) {
        seqCalls += 1;
        return { rows: [{ maxSeq: seqCalls === 1 ? 10 : 11 }] };
      }
      return sourceRaw?.(sql, ...args) ?? { rows: [] };
    });
    const service = createService();

    await expect(service.validateAndSwitchJob('sdmjxxx')).resolves.toMatchObject({
      state: 'succeeded',
      validationStats: expect.objectContaining({
        phase: 'validation_completed',
        warnings: ['source_changed_during_validation'],
        sourceDelta: {
          validationStartSeq: 10,
          validationEndSeq: 11,
        },
        mismatches: [
          expect.objectContaining({
            object: 'base:bsexxx.sheet1',
            reason: 'row_count_mismatch',
          }),
        ],
      }),
    });

    expect(txClient.spaceDataDbBinding.upsert).not.toHaveBeenCalled();
  });

  it('validates copied data and switches the space binding to the target BYODB connection', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      sourceConnectionId: 'dcnsource',
      targetConnectionId: 'dcnxxx',
      switchOnCompletion: true,
      targetInternalSchema: internalSchema,
      createdBy: 'usrxxx',
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
      inventory: {
        baseIds: ['bsexxx'],
        tableIds: ['tblxxx'],
        dbTableNames: ['bsexxx.sheet1'],
        physicalSchemas: [{ schemaName: 'bsexxx', relations: [], totalBytes: 1024 }],
      },
    });
    mockValidationClient(sourceClient, 3);
    mockValidationClient(targetClient, 3);
    const service = createService();
    const resumeTargetComputed = vi.spyOn(service, 'resumeTargetComputedForJob');

    await expect(service.validateAndSwitchJob('sdmjxxx')).resolves.toMatchObject({
      state: 'succeeded',
      validationStats: expect.objectContaining({
        phase: 'validation_completed',
        switchOnCompletion: true,
        switched: true,
        switchedAt: expect.any(String),
        routeSmoke: expect.objectContaining({
          ok: true,
          connectionId: 'dcnxxx',
          internalSchema,
        }),
        baseSchemas: [
          expect.objectContaining({
            object: 'base:bsexxx.sheet1',
            sourceCount: 3,
            targetCount: 3,
          }),
        ],
      }),
    });

    expect(prismaService.spaceDataDbMigrationJob.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { id: 'sdmjxxx' },
        data: expect.objectContaining({
          state: 'freezing_writes',
          validationStats: expect.objectContaining({ phase: 'validating_copy' }),
        }),
      })
    );
    expect(prismaService.spaceDataDbMigrationJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sdmjxxx' },
        data: expect.objectContaining({
          state: 'freezing_writes',
          validationStats: expect.objectContaining({ phase: 'validation_completed' }),
        }),
      })
    );
    expect(prismaService.spaceDataDbMigrationJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sdmjxxx' },
        data: expect.objectContaining({ state: 'switching' }),
      })
    );
    expect(txClient.dataDbConnection.update).toHaveBeenCalledWith({
      where: { id: 'dcnxxx' },
      data: expect.objectContaining({
        status: 'ready',
        lastError: null,
      }),
    });
    expect(txClient.spaceDataDbBinding.upsert).toHaveBeenCalledWith({
      where: { spaceId: 'spcxxx' },
      create: {
        spaceId: 'spcxxx',
        dataDbConnectionId: 'dcnxxx',
        mode: 'byodb',
        state: 'ready',
        createdBy: 'usrxxx',
      },
      update: {
        dataDbConnectionId: 'dcnxxx',
        mode: 'byodb',
        state: 'ready',
      },
    });
    expect(targetClient.raw).toHaveBeenCalledWith(
      expect.stringContaining(`DELETE FROM "${internalSchema}"."computed_update_pause_scope"`),
      ['space', ['spcxxx'], 'space-data-db-migration:sdmjxxx']
    );
    expect(dataDbClientManager.invalidateConnection).toHaveBeenCalledWith('dcnxxx');
    expect(dataDbClientManager.invalidateConnection).toHaveBeenCalledWith('dcnsource');
    const targetInvalidateCallIndex = dataDbClientManager.invalidateConnection.mock.calls.findIndex(
      ([connectionId]) => connectionId === 'dcnxxx'
    );
    const targetInvalidateOrder =
      dataDbClientManager.invalidateConnection.mock.invocationCallOrder[targetInvalidateCallIndex];
    const resumeTargetComputedOrder = resumeTargetComputed.mock.invocationCallOrder[0];
    expect(targetInvalidateOrder).toBeDefined();
    expect(resumeTargetComputedOrder).toBeDefined();
    expect(targetInvalidateOrder!).toBeLessThan(resumeTargetComputedOrder!);
    expect(prismaService.spaceDataDbMigrationJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sdmjxxx' },
        data: expect.objectContaining({
          state: 'succeeded',
          lastError: null,
        }),
      })
    );
  });

  it('keeps a switched migration succeeded when target computed resume fails after cutover', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      sourceConnectionId: 'dcnsource',
      targetConnectionId: 'dcnxxx',
      switchOnCompletion: true,
      targetInternalSchema: internalSchema,
      createdBy: 'usrxxx',
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
      inventory: {
        baseIds: ['bsexxx'],
        tableIds: ['tblxxx'],
        dbTableNames: ['bsexxx.sheet1'],
        physicalSchemas: [{ schemaName: 'bsexxx', relations: [], totalBytes: 1024 }],
      },
    });
    mockValidationClient(sourceClient, 3);
    mockValidationClient(targetClient, 3);
    const service = createService();
    vi.spyOn(service, 'resumeTargetComputedForJob').mockRejectedValueOnce(
      new Error('resume failed')
    );

    await expect(service.validateAndSwitchJob('sdmjxxx')).resolves.toMatchObject({
      state: 'succeeded',
      validationStats: expect.objectContaining({
        switchOnCompletion: true,
        switched: true,
        warnings: ['target_computed_resume_failed: resume failed'],
      }),
    });

    expect(txClient.spaceDataDbBinding.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { spaceId: 'spcxxx' },
      })
    );
    expect(prismaService.spaceDataDbMigrationJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sdmjxxx' },
        data: expect.objectContaining({
          state: 'succeeded',
          validationStats: expect.objectContaining({
            warnings: ['target_computed_resume_failed: resume failed'],
          }),
          lastError: null,
        }),
      })
    );
  });

  it('keeps validation fresh while row counts are running', async () => {
    vi.useFakeTimers();
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      sourceConnectionId: 'dcnsource',
      targetConnectionId: 'dcnxxx',
      targetInternalSchema: internalSchema,
      createdBy: 'usrxxx',
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
      inventory: {
        baseIds: ['bsexxx'],
        tableIds: ['tblxxx'],
        dbTableNames: ['bsexxx.sheet1'],
        physicalSchemas: [{ schemaName: 'bsexxx', relations: [], totalBytes: 1024 }],
      },
    });
    mockValidationClient(sourceClient, 3);
    let resolveTargetCount: (value: { rows: { count: string }[] }) => void = vi.fn();
    const targetCountRows = new Promise<{ rows: { count: string }[] }>((resolve) => {
      resolveTargetCount = resolve;
    });
    targetClient.raw.mockImplementation((sql: string) => {
      if (sql.includes('FROM pg_class c')) {
        return {
          rows: [
            {
              schemaName: 'bsexxx',
              relationName: 'sheet1',
              relationKind: 'table',
            },
          ],
        };
      }
      if (sql.includes('FROM pg_attribute a')) {
        return {
          rows: columnSignatureRows().map((row) => ({
            schemaName: 'bsexxx',
            relationName: 'sheet1',
            ...row,
          })),
        };
      }
      if (sql.includes('FROM pg_index i')) {
        return { rows: [] };
      }
      if (sql.includes('FROM pg_constraint con')) {
        return { rows: [] };
      }
      if (sql.includes('FROM pg_trigger tg')) {
        return { rows: [] };
      }
      if (sql.includes('FROM "bsexxx"."sheet1"')) {
        return targetCountRows;
      }
      if (sql.includes('to_regprocedure')) {
        return { rows: [{ exists: true }] };
      }
      if (sql.includes('__teable_data_schema_migrations')) {
        return { rows: [{ exists: true }] };
      }
      if (sql.includes('COUNT(*)')) {
        return { rows: [{ count: '0' }] };
      }
      return { rows: [] };
    });
    const service = createService();

    const promise = service.validateAndSwitchJob('sdmjxxx');
    await vi.advanceTimersByTimeAsync(15_000);

    const heartbeatCount = prismaService.spaceDataDbMigrationJob.update.mock.calls.filter(
      ([args]) => args.data.validationStats?.heartbeat?.stage === 'validating_copy'
    ).length;
    expect(heartbeatCount).toBeGreaterThanOrEqual(2);

    resolveTargetCount({ rows: [{ count: '3' }] });
    await expect(promise).resolves.toMatchObject({
      state: 'succeeded',
    });
    vi.useRealTimers();
  });

  it('waits for active source computed tasks to finish or become reclaimable', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      targetInternalSchema: internalSchema,
      createdBy: 'usrxxx',
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
      inventory: {
        baseIds: ['bsexxx'],
        tableIds: ['tblxxx'],
        dbTableNames: ['bsexxx.sheet1'],
        physicalSchemas: [],
      },
    });
    sourceClient.raw
      .mockResolvedValueOnce({
        rows: [
          {
            activeCount: '1',
            reclaimableCount: '0',
            oldestActiveLockedAt: '2026-05-06T00:00:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            activeCount: '0',
            reclaimableCount: '1',
            oldestActiveLockedAt: null,
          },
        ],
      });
    const service = createService();

    await expect(
      service.waitForSourceComputedDrainForJob('sdmjxxx', {
        timeoutMs: 50,
        pollMs: 1,
        processingLeaseMs: 120_000,
      })
    ).resolves.toMatchObject({
      activeCount: 0,
      reclaimableCount: 1,
    });

    expect(sourceClient.raw).toHaveBeenCalledTimes(2);
    expect(sourceClient.raw).toHaveBeenCalledWith(
      expect.stringContaining(`FROM "public"."computed_update_outbox"`),
      [expect.any(Date), expect.any(Date), expect.any(Date), ['bsexxx']]
    );
    expect(prismaService.spaceDataDbMigrationJob.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'sdmjxxx' },
        data: expect.objectContaining({
          copyStats: expect.objectContaining({
            phase: 'computed_drained',
            computedDrain: expect.objectContaining({
              activeCount: 0,
              reclaimableCount: 1,
            }),
          }),
        }),
      })
    );
    expect(sourceClient.destroy).toHaveBeenCalled();
  });

  it('fails the migration when source computed tasks stay active past the drain timeout', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      targetInternalSchema: internalSchema,
      createdBy: 'usrxxx',
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
      inventory: {
        baseIds: ['bsexxx'],
        tableIds: ['tblxxx'],
        dbTableNames: ['bsexxx.sheet1'],
        physicalSchemas: [],
      },
    });
    sourceClient.raw.mockResolvedValue({
      rows: [
        {
          activeCount: '2',
          reclaimableCount: '0',
          oldestActiveLockedAt: '2026-05-06T00:00:00.000Z',
        },
      ],
    });
    const service = createService();

    await expect(
      service.waitForSourceComputedDrainForJob('sdmjxxx', {
        timeoutMs: 0,
        pollMs: 1,
        processingLeaseMs: 120_000,
      })
    ).rejects.toMatchObject({
      code: HttpErrorCode.CONFLICT,
      data: expect.objectContaining({
        errorCode: 'SPACE_DATA_DB_COMPUTED_DRAIN_TIMEOUT',
        activeCount: 2,
      }),
    });

    expect(prismaService.spaceDataDbMigrationJob.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'sdmjxxx' },
        data: expect.objectContaining({
          state: 'failed',
          lastError: expect.stringContaining('Timed out waiting for source computed tasks'),
          copyStats: expect.objectContaining({
            phase: 'computed_drain_timeout',
          }),
        }),
      })
    );
    expect(sourceClient.destroy).toHaveBeenCalled();
  });

  it('marks the migration failed when source computed drain inspection fails', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      targetInternalSchema: internalSchema,
      createdBy: 'usrxxx',
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
      inventory: {
        baseIds: ['bsexxx'],
        tableIds: ['tblxxx'],
        dbTableNames: ['bsexxx.sheet1'],
        physicalSchemas: [],
      },
    });
    sourceClient.raw.mockRejectedValue(new Error('source query failed'));
    const service = createService();

    await expect(
      service.waitForSourceComputedDrainForJob('sdmjxxx', {
        timeoutMs: 50,
        pollMs: 1,
        processingLeaseMs: 120_000,
      })
    ).rejects.toThrow('source query failed');

    expect(prismaService.spaceDataDbMigrationJob.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'sdmjxxx' },
        data: expect.objectContaining({
          state: 'failed',
          lastError: 'source query failed',
          copyStats: expect.objectContaining({
            phase: 'computed_drain_failed',
          }),
        }),
      })
    );
    expect(sourceClient.destroy).toHaveBeenCalled();
  });

  it('waits for open schema operations for the space to finish before copy', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      targetInternalSchema: internalSchema,
      createdBy: 'usrxxx',
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
      inventory: {
        baseIds: ['bsexxx'],
        tableIds: ['tblxxx'],
        dbTableNames: ['bsexxx.sheet1'],
        physicalSchemas: [],
      },
    });
    prismaService.schemaOperation.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    prismaService.schemaOperation.findMany
      .mockResolvedValueOnce([
        {
          id: 'sgoxxx',
          status: 'running',
          phase: 'alter_table',
          baseId: 'bsexxx',
          tableId: 'tblxxx',
          lockedAt: new Date('2026-05-06T00:00:00.000Z'),
          lockedBy: 'worker-1',
          createdTime: new Date('2026-05-06T00:00:00.000Z'),
          lastModifiedTime: new Date('2026-05-06T00:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const service = createService();

    await expect(
      service.waitForSchemaOperationsForJob('sdmjxxx', {
        timeoutMs: 50,
        pollMs: 1,
      })
    ).resolves.toMatchObject({
      openCount: 0,
    });

    expect(prismaService.schemaOperation.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        AND: expect.arrayContaining([
          expect.objectContaining({
            status: { in: ['pending', 'running', 'error'] },
          }),
        ]),
      }),
    });
    expect(prismaService.spaceDataDbMigrationJob.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'sdmjxxx' },
        data: expect.objectContaining({
          copyStats: expect.objectContaining({
            phase: 'schema_operations_drained',
            schemaOperations: expect.objectContaining({ openCount: 0 }),
          }),
        }),
      })
    );
  });

  it('ignores stale non-terminal schema operations while draining before copy', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      targetInternalSchema: internalSchema,
      createdBy: 'usrxxx',
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
      inventory: {
        baseIds: ['bsexxx'],
        tableIds: ['tblxxx'],
        dbTableNames: ['bsexxx.sheet1'],
        physicalSchemas: [],
      },
    });
    prismaService.schemaOperation.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    prismaService.schemaOperation.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 'sgostale',
        status: 'error',
        phase: 'table.delete',
        baseId: 'bsexxx',
        tableId: 'tblxxx',
        lockedAt: null,
        lockedBy: null,
        createdTime: new Date('2026-05-01T00:00:00.000Z'),
        lastModifiedTime: new Date('2026-05-01T00:00:00.000Z'),
      },
    ]);
    const service = createService();

    await expect(
      service.waitForSchemaOperationsForJob('sdmjxxx', {
        timeoutMs: 0,
        pollMs: 1,
      })
    ).resolves.toMatchObject({
      openCount: 0,
      staleIgnoredCount: 1,
      staleIgnoredSample: [expect.objectContaining({ id: 'sgostale', status: 'error' })],
    });

    expect(prismaService.spaceDataDbMigrationJob.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'sdmjxxx' },
        data: expect.objectContaining({
          copyStats: expect.objectContaining({
            phase: 'schema_operations_drained',
            schemaOperations: expect.objectContaining({
              openCount: 0,
              staleIgnoredCount: 1,
            }),
          }),
        }),
      })
    );
  });

  it('fails the migration when schema operations remain open past the drain timeout', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      targetInternalSchema: internalSchema,
      createdBy: 'usrxxx',
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
      inventory: {
        baseIds: ['bsexxx'],
        tableIds: ['tblxxx'],
        dbTableNames: ['bsexxx.sheet1'],
        physicalSchemas: [],
      },
    });
    prismaService.schemaOperation.count.mockResolvedValueOnce(2).mockResolvedValueOnce(0);
    prismaService.schemaOperation.findMany.mockResolvedValue([
      {
        id: 'sgoxxx',
        status: 'running',
        phase: 'alter_table',
        baseId: 'bsexxx',
        tableId: 'tblxxx',
        lockedAt: new Date('2026-05-06T00:00:00.000Z'),
        lockedBy: 'worker-1',
        createdTime: new Date('2026-05-06T00:00:00.000Z'),
        lastModifiedTime: new Date('2026-05-06T00:00:00.000Z'),
      },
    ]);
    const service = createService();

    await expect(
      service.waitForSchemaOperationsForJob('sdmjxxx', {
        timeoutMs: 0,
        pollMs: 1,
      })
    ).rejects.toMatchObject({
      code: HttpErrorCode.CONFLICT,
      data: expect.objectContaining({
        errorCode: 'SPACE_DATA_DB_SCHEMA_OPERATION_DRAIN_TIMEOUT',
        openCount: 2,
      }),
    });

    expect(prismaService.spaceDataDbMigrationJob.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'sdmjxxx' },
        data: expect.objectContaining({
          state: 'failed',
          lastError: expect.stringContaining('Timed out waiting for schema operations'),
          copyStats: expect.objectContaining({
            phase: 'schema_operation_drain_timeout',
          }),
        }),
      })
    );
  });

  it('waits for provisioning resources and import queue jobs before copy', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      targetInternalSchema: internalSchema,
      createdBy: 'usrxxx',
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
      inventory: {
        baseIds: ['bsexxx'],
        tableIds: ['tblxxx'],
        dbTableNames: ['bsexxx.sheet1'],
        physicalSchemas: [],
      },
    });
    prismaService.base.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    prismaService.base.findMany
      .mockResolvedValueOnce([
        {
          id: 'bsexxx',
          provisionState: 'pending',
          createdTime: new Date('2026-05-06T00:00:00.000Z'),
          lastModifiedTime: new Date('2026-05-06T00:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValue([]);
    const importJob = {
      id: 'import-table-csv-chunk:tblxxx:abc123',
      data: {
        baseId: 'bsexxx',
        table: { id: 'tblxxx', name: 'Sheet 1' },
      },
      timestamp: new Date('2026-05-06T00:00:00.000Z').getTime(),
      getState: vi.fn().mockResolvedValue('active'),
    };
    const tableImportCsvChunkQueue = {
      getJobs: vi.fn().mockResolvedValueOnce([importJob]).mockResolvedValueOnce([]),
    };
    const service = createService(undefined, { tableImportCsvChunkQueue });

    await expect(
      service.waitForBackgroundWritersForJob('sdmjxxx', {
        timeoutMs: 50,
        pollMs: 1,
      })
    ).resolves.toMatchObject({
      openCount: 0,
    });

    expect(prismaService.base.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        AND: expect.arrayContaining([
          expect.objectContaining({
            provisionState: { in: ['pending', 'deleting'] },
          }),
        ]),
      }),
    });
    expect(tableImportCsvChunkQueue.getJobs).toHaveBeenCalledWith(
      ['waiting', 'active', 'delayed', 'prioritized', 'waiting-children'],
      0,
      99,
      false
    );
    expect(prismaService.spaceDataDbMigrationJob.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'sdmjxxx' },
        data: expect.objectContaining({
          copyStats: expect.objectContaining({
            phase: 'background_writers_drained',
            backgroundWriters: expect.objectContaining({ openCount: 0 }),
          }),
        }),
      })
    );
  });

  it('ignores stale non-terminal provisioning resources while draining background writers', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      targetInternalSchema: internalSchema,
      createdBy: 'usrxxx',
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
      inventory: {
        baseIds: ['bsestale'],
        tableIds: ['tblxxx'],
        dbTableNames: ['bsestale.sheet1'],
        physicalSchemas: [],
      },
    });
    prismaService.tableMeta.findMany.mockResolvedValue([]);
    prismaService.base.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    prismaService.base.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 'bsestale',
        provisionState: 'pending',
        createdTime: new Date('2026-05-01T00:00:00.000Z'),
        lastModifiedTime: new Date('2026-05-01T00:00:00.000Z'),
      },
    ]);
    const service = createService();

    await expect(
      service.waitForBackgroundWritersForJob('sdmjxxx', {
        timeoutMs: 0,
        pollMs: 1,
      })
    ).resolves.toMatchObject({
      openCount: 0,
      provisionResourceCount: 0,
      staleIgnoredCount: 1,
      staleIgnoredSample: [expect.objectContaining({ id: 'bsestale', state: 'pending' })],
    });

    expect(prismaService.spaceDataDbMigrationJob.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'sdmjxxx' },
        data: expect.objectContaining({
          copyStats: expect.objectContaining({
            phase: 'background_writers_drained',
            backgroundWriters: expect.objectContaining({
              openCount: 0,
              staleIgnoredCount: 1,
            }),
          }),
        }),
      })
    );
  });

  it('does not block on terminal provisioning errors', async () => {
    prismaService.base.findMany.mockResolvedValue([]);
    prismaService.tableMeta.findMany.mockResolvedValue([]);
    const service = createService();

    await expect(
      service.waitForBackgroundWritersForJob('sdmjxxx', {
        timeoutMs: 0,
        pollMs: 1,
      })
    ).resolves.toMatchObject({
      openCount: 0,
      provisionResourceCount: 0,
    });

    for (const resource of [prismaService.base, prismaService.tableMeta, prismaService.field]) {
      expect(resource.count).toHaveBeenCalledWith({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              provisionState: { in: ['pending', 'deleting'] },
            }),
          ]),
        }),
      });
    }
  });

  it('ignores soft-deleted provisioning resources outside the migration inventory', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      targetInternalSchema: internalSchema,
      createdBy: 'usrxxx',
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
      inventory: {
        baseIds: ['bseactive'],
        tableIds: ['tblactive'],
        dbTableNames: ['bseactive.sheet1'],
        physicalSchemas: [],
      },
    });
    prismaService.base.count.mockResolvedValue(0);
    prismaService.base.findMany.mockResolvedValue([]);

    const service = createService();

    await expect(
      service.waitForBackgroundWritersForJob('sdmjxxx', {
        timeoutMs: 0,
        pollMs: 1,
      })
    ).resolves.toMatchObject({
      openCount: 0,
    });

    expect(prismaService.base.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        AND: expect.arrayContaining([
          expect.objectContaining({
            deletedTime: null,
            provisionState: { in: ['pending', 'deleting'] },
            OR: expect.arrayContaining([{ spaceId: 'spcxxx' }, { id: { in: ['bseactive'] } }]),
          }),
        ]),
      }),
    });
    expect(prismaService.tableMeta.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        AND: expect.arrayContaining([
          expect.objectContaining({
            deletedTime: null,
            provisionState: { in: ['pending', 'deleting'] },
          }),
        ]),
      }),
    });
    expect(prismaService.field.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        AND: expect.arrayContaining([
          expect.objectContaining({
            deletedTime: null,
            tableId: { in: ['tblactive'] },
            provisionState: { in: ['pending', 'deleting'] },
          }),
        ]),
      }),
    });
  });

  it('fails the migration when background writer queue inspection hangs', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      targetInternalSchema: internalSchema,
      createdBy: 'usrxxx',
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
      inventory: {
        baseIds: ['bsexxx'],
        tableIds: ['tblxxx'],
        dbTableNames: ['bsexxx.sheet1'],
        physicalSchemas: [],
      },
    });
    const baseImportCsvQueue = {
      getJobs: vi.fn().mockImplementation(() => new Promise(() => undefined)),
    };
    const service = createService(undefined, { baseImportCsvQueue });

    await expect(
      service.waitForBackgroundWritersForJob('sdmjxxx', {
        timeoutMs: 1000,
        pollMs: 1,
        probeTimeoutMs: 1,
      })
    ).rejects.toThrow('Timed out inspecting import queues after 1ms');

    expect(prismaService.spaceDataDbMigrationJob.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'sdmjxxx' },
        data: expect.objectContaining({
          state: 'failed',
          lastError: 'Timed out inspecting import queues after 1ms',
          copyStats: expect.objectContaining({
            phase: 'background_writer_drain_failed',
          }),
        }),
      })
    );
  });

  it('scans open queue jobs in bounded batches while draining background writers', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      targetInternalSchema: internalSchema,
      createdBy: 'usrxxx',
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
      inventory: {
        baseIds: ['bsexxx'],
        tableIds: ['tblxxx'],
        dbTableNames: ['bsexxx.sheet1'],
        physicalSchemas: [],
      },
    });
    const unrelatedJob = {
      id: 'import-table-csv-chunk:tblother:abc123',
      data: {
        baseId: 'bseother',
        table: { id: 'tblother', name: 'Other' },
      },
      getState: vi.fn().mockResolvedValue('waiting'),
    };
    const scopedJob = {
      id: 'import-table-csv-chunk:tblxxx:def456',
      data: {
        baseId: 'bsexxx',
        table: { id: 'tblxxx', name: 'Sheet 1' },
      },
      getState: vi.fn().mockResolvedValue('active'),
    };
    const tableImportCsvChunkQueue = {
      getJobs: vi.fn().mockResolvedValueOnce([unrelatedJob]).mockResolvedValueOnce([scopedJob]),
    };
    const service = createService(undefined, { tableImportCsvChunkQueue });

    await expect(
      service.waitForBackgroundWritersForJob('sdmjxxx', {
        timeoutMs: 0,
        pollMs: 1,
        queueScanBatchSize: 1,
        queueScanLimit: 2,
      })
    ).rejects.toMatchObject({
      code: HttpErrorCode.CONFLICT,
      data: expect.objectContaining({
        errorCode: 'SPACE_DATA_DB_BACKGROUND_WRITER_DRAIN_TIMEOUT',
        openCount: 1,
        queueJobCount: 1,
      }),
    });

    expect(tableImportCsvChunkQueue.getJobs).toHaveBeenNthCalledWith(
      1,
      ['waiting', 'active', 'delayed', 'prioritized', 'waiting-children'],
      0,
      0,
      false
    );
    expect(tableImportCsvChunkQueue.getJobs).toHaveBeenNthCalledWith(
      2,
      ['waiting', 'active', 'delayed', 'prioritized', 'waiting-children'],
      1,
      1,
      false
    );
  });

  it('fails the migration when background writers remain open past the drain timeout', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      targetInternalSchema: internalSchema,
      createdBy: 'usrxxx',
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
      inventory: {
        baseIds: ['bsexxx'],
        tableIds: ['tblxxx'],
        dbTableNames: ['bsexxx.sheet1'],
        physicalSchemas: [],
      },
    });
    const importJob = {
      id: 'base_import_csv_job',
      data: {
        baseId: 'bsexxx',
        tableIdMap: {
          oldTableId: 'tblxxx',
        },
      },
      getState: vi.fn().mockResolvedValue('waiting'),
    };
    const baseImportCsvQueue = {
      getJobs: vi.fn().mockResolvedValue([importJob]),
    };
    const service = createService(undefined, { baseImportCsvQueue });

    await expect(
      service.waitForBackgroundWritersForJob('sdmjxxx', {
        timeoutMs: 0,
        pollMs: 1,
      })
    ).rejects.toMatchObject({
      code: HttpErrorCode.CONFLICT,
      data: expect.objectContaining({
        errorCode: 'SPACE_DATA_DB_BACKGROUND_WRITER_DRAIN_TIMEOUT',
        openCount: 1,
        queueJobCount: 1,
      }),
    });

    expect(prismaService.spaceDataDbMigrationJob.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'sdmjxxx' },
        data: expect.objectContaining({
          state: 'failed',
          lastError: expect.stringContaining('Timed out waiting for background writers'),
          copyStats: expect.objectContaining({
            phase: 'background_writer_drain_timeout',
          }),
        }),
      })
    );
  });

  it('fails before copy when the source inventory changed after freeze', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      targetInternalSchema: internalSchema,
      createdBy: 'usrxxx',
      inventory: {
        sourceDataDb: {
          mode: 'default',
          cacheKey: 'meta-fallback',
          connectionId: null,
          internalSchema: null,
          isMetaFallback: true,
        },
        targetDataDb: {
          internalSchema,
        },
        baseIds: ['bsexxx'],
        tableIds: ['tblold'],
        dbTableNames: ['bsexxx.sheet1'],
        physicalSchemas: [
          {
            schemaName: 'bsexxx',
            relations: [
              {
                schemaName: 'bsexxx',
                relationName: 'sheet1',
                relationKind: 'table',
                totalBytes: 1024,
                estimatedRows: 10,
              },
            ],
            totalBytes: 1024,
            estimatedRows: 10,
          },
        ],
      },
    });
    prismaService.space.findMany.mockResolvedValue([
      {
        id: 'spcxxx',
        name: 'Space',
        baseGroup: [
          {
            id: 'bsexxx',
            tables: [{ id: 'tblnew' }],
          },
        ],
      },
    ]);
    prismaService.tableMeta.findMany.mockResolvedValue([
      { id: 'tblnew', dbTableName: 'bsexxx.sheet2', base: { spaceId: 'spcxxx' } },
    ]);
    const service = createService();

    await expect(service.assertSourceInventoryUnchangedForJob('sdmjxxx')).rejects.toMatchObject({
      code: HttpErrorCode.CONFLICT,
      data: expect.objectContaining({
        errorCode: 'SPACE_DATA_DB_INVENTORY_CHANGED',
        mismatches: expect.arrayContaining([
          expect.objectContaining({
            object: 'tableIds',
            reason: 'inventory_changed',
            added: ['tblnew'],
            removed: ['tblold'],
          }),
          expect.objectContaining({
            object: 'dbTableNames',
            added: ['bsexxx.sheet2'],
            removed: ['bsexxx.sheet1'],
          }),
        ]),
      }),
    });

    expect(prismaService.spaceDataDbMigrationJob.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'sdmjxxx' },
        data: expect.objectContaining({
          state: 'failed',
          lastError: expect.stringContaining('Source inventory changed'),
          copyStats: expect.objectContaining({
            phase: 'source_inventory_changed',
          }),
        }),
      })
    );
    expect(copyService.copyBaseSchemas).not.toHaveBeenCalled();
  });

  it('fails before copy when deleted-table shared scope changed after freeze', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      targetInternalSchema: internalSchema,
      createdBy: 'usrxxx',
      inventory: {
        sourceDataDb: {
          mode: 'default',
          cacheKey: 'meta-fallback',
          connectionId: null,
          internalSchema: null,
          isMetaFallback: true,
        },
        targetDataDb: {
          internalSchema,
        },
        baseIds: ['bsexxx'],
        tableIds: ['tblxxx'],
        sharedTableIds: ['tblxxx'],
        relatedSharedTableIds: ['tblxxx'],
        dbTableNames: ['bsexxx.sheet1'],
        physicalSchemas: [
          {
            schemaName: 'bsexxx',
            relations: [
              {
                schemaName: 'bsexxx',
                relationName: 'sheet1',
                relationKind: 'table',
                totalBytes: 1024,
                estimatedRows: 10,
              },
            ],
            totalBytes: 1024,
            estimatedRows: 10,
          },
        ],
      },
    });
    prismaService.tableMeta.findMany.mockImplementation((args?: unknown) => {
      const where = (args as { where?: { baseId?: { in?: string[] }; id?: { in?: string[] } } })
        ?.where;
      if (where?.baseId?.in) {
        return Promise.resolve([{ id: 'tblxxx' }, { id: 'tbldeleted' }]);
      }
      return Promise.resolve([
        { id: 'tblxxx', dbTableName: 'bsexxx.sheet1', base: { spaceId: 'spcxxx' } },
      ]);
    });
    const service = createService();

    await expect(service.assertSourceInventoryUnchangedForJob('sdmjxxx')).rejects.toMatchObject({
      code: HttpErrorCode.CONFLICT,
      data: expect.objectContaining({
        errorCode: 'SPACE_DATA_DB_INVENTORY_CHANGED',
        mismatches: expect.arrayContaining([
          expect.objectContaining({
            object: 'sharedTableIds',
            added: ['tbldeleted'],
          }),
        ]),
      }),
    });
  });

  it('does not treat equivalent extension dependency objects as changed when JSON key order differs', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      targetInternalSchema: internalSchema,
      createdBy: 'usrxxx',
      inventory: {
        sourceDataDb: {
          isMetaFallback: true,
          internalSchema: null,
          connectionId: null,
          cacheKey: 'meta-fallback',
          mode: 'default',
        },
        targetDataDb: {
          internalSchema,
        },
        baseIds: ['bsexxx'],
        tableIds: ['tblxxx'],
        dbTableNames: ['bsexxx.sheet1'],
        physicalSchemas: [
          {
            estimatedRows: 10,
            totalBytes: 1024,
            relations: [
              {
                estimatedRows: 10,
                totalBytes: 1024,
                relationKind: 'table',
                relationName: 'sheet1',
                schemaName: 'bsexxx',
              },
            ],
            schemaName: 'bsexxx',
          },
        ],
        postgresExtensionDependencies: [
          {
            sourceObjects: ['bsexxx.sheet1.idx_trgm_sheet1_fldName'],
            accessMethod: 'gin',
            objectName: 'gin_trgm_ops',
            schemaName: 'public',
            objectType: 'operator_class',
            extensionName: 'pg_trgm',
          },
        ],
        estimatedTotalBytes: 1024,
        estimatedTotalRows: 10,
      },
    });
    sourceDataPrisma.$queryRawUnsafe
      .mockResolvedValueOnce([
        {
          schemaName: 'bsexxx',
          relationName: 'sheet1',
          relationKind: 'table',
          totalBytes: '1024',
          estimatedRows: '10',
        },
      ])
      .mockResolvedValueOnce([
        {
          extensionName: 'pg_trgm',
          objectType: 'operator_class',
          schemaName: 'public',
          objectName: 'gin_trgm_ops',
          accessMethod: 'gin',
          sourceSchemaName: 'bsexxx',
          sourceRelationName: 'sheet1',
          sourceIndexName: 'idx_trgm_sheet1_fldName',
        },
      ]);
    const service = createService();

    await expect(service.assertSourceInventoryUnchangedForJob('sdmjxxx')).resolves.toBeUndefined();

    expect(prismaService.spaceDataDbMigrationJob.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'sdmjxxx' },
        data: expect.objectContaining({
          lastError: null,
          copyStats: expect.objectContaining({
            phase: 'source_inventory_verified',
          }),
        }),
      })
    );
  });

  it('fails before copy when the temp work directory has insufficient free space', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      targetInternalSchema: internalSchema,
      createdBy: 'usrxxx',
      inventory: {
        baseIds: ['bsexxx'],
        tableIds: ['tblxxx'],
        dbTableNames: ['bsexxx.sheet1'],
        physicalSchemas: [
          {
            schemaName: 'bsexxx',
            relations: [],
            totalBytes: 2048,
            estimatedRows: 10,
          },
        ],
        estimatedTotalBytes: 2048,
        estimatedTotalRows: 10,
      },
    });
    const statfs = vi.fn().mockResolvedValue({
      bavail: 3,
      bfree: 3,
      bsize: 1024,
    });
    const service = createService(statfs as never);

    await expect(
      service.assertTempWorkDirCapacityForJob('sdmjxxx', '/tmp/sdmjxxx', {
        multiplier: 2,
        minFreeBytes: 0,
        baseSchemaCopyStrategy: 'pg_dump_restore',
      })
    ).rejects.toMatchObject({
      code: HttpErrorCode.CONFLICT,
      data: expect.objectContaining({
        errorCode: 'SPACE_DATA_DB_TEMP_DISK_INSUFFICIENT',
        requiredBytes: 4096,
        availableBytes: 3072,
      }),
    });

    expect(statfs).toHaveBeenCalledWith('/tmp/sdmjxxx');
    expect(prismaService.spaceDataDbMigrationJob.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'sdmjxxx' },
        data: expect.objectContaining({
          state: 'failed',
          lastError: expect.stringContaining('Insufficient temp disk space'),
          copyStats: expect.objectContaining({
            phase: 'temp_disk_insufficient',
          }),
        }),
      })
    );
    expect(copyService.copyBaseSchemas).not.toHaveBeenCalled();
  });

  it('does not require full dump space for streaming base-schema copy', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      targetInternalSchema: internalSchema,
      createdBy: 'usrxxx',
      inventory: {
        baseIds: ['bsexxx'],
        tableIds: ['tblxxx'],
        dbTableNames: ['bsexxx.sheet1'],
        physicalSchemas: [],
        estimatedTotalBytes: 2048,
        estimatedTotalRows: 10,
      },
    });
    const statfs = vi.fn().mockResolvedValue({
      bavail: 3,
      bfree: 3,
      bsize: 1024,
    });
    const service = createService(statfs as never);

    await expect(
      service.assertTempWorkDirCapacityForJob('sdmjxxx', '/tmp/sdmjxxx', {
        multiplier: 2,
        minFreeBytes: 1024,
        baseSchemaCopyStrategy: 'pg_dump_stream_restore',
      })
    ).resolves.toBeUndefined();

    expect(prismaService.spaceDataDbMigrationJob.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          copyStats: expect.objectContaining({
            phase: 'temp_disk_checked',
            tempDisk: expect.objectContaining({
              strategy: 'pg_dump_stream_restore',
              requiresFullDumpSpace: false,
              requiredBytes: 1024,
              availableBytes: 3072,
            }),
          }),
        }),
      })
    );
  });

  it('runs a migration job through copy, validation, and switch phases in order', async () => {
    const service = createService();
    const pauseSource = vi.spyOn(service, 'pauseSourceComputedForJob').mockResolvedValue({
      created: true,
    } as never);
    const waitForSourceComputedDrain = vi
      .spyOn(service, 'waitForSourceComputedDrainForJob')
      .mockResolvedValue({
        activeCount: 0,
        reclaimableCount: 0,
      } as never);
    const waitForSchemaOperations = vi
      .spyOn(service, 'waitForSchemaOperationsForJob')
      .mockResolvedValue({
        openCount: 0,
      } as never);
    const waitForBackgroundWriters = vi
      .spyOn(service, 'waitForBackgroundWritersForJob')
      .mockResolvedValue({
        openCount: 0,
      } as never);
    const assertSourceInventoryUnchanged = vi
      .spyOn(service, 'assertSourceInventoryUnchangedForJob')
      .mockResolvedValue(undefined);
    const assertTempWorkDirCapacity = vi
      .spyOn(service, 'assertTempWorkDirCapacityForJob')
      .mockResolvedValue(undefined);
    const resumeSource = vi.spyOn(service, 'resumeSourceComputedForJob').mockResolvedValue({
      deleted: 0,
    } as never);
    const copyBaseSchemas = vi.spyOn(service, 'copyBaseSchemasForJob').mockResolvedValue({
      phase: 'base_schemas_completed',
    } as never);
    const copySharedRows = vi.spyOn(service, 'copySharedRowsForJob').mockResolvedValue({
      phase: 'shared_rows_completed',
    } as never);
    const validateAndSwitch = vi.spyOn(service, 'validateAndSwitchJob').mockResolvedValue({
      state: 'succeeded',
    } as never);

    await expect(
      service.runMigrationJob('sdmjxxx', {
        workDir: '/tmp/sdmjxxx',
        jobs: 2,
        timeoutMs: 1000,
      })
    ).resolves.toEqual({ state: 'succeeded' });

    expect(copyService.assertPostgresToolsAvailable).toHaveBeenCalledWith(
      'pg_dump_stream_restore',
      expect.objectContaining({
        timeoutMs: 1000,
        shouldCancel: expect.any(Function),
      })
    );
    expect(pauseSource).toHaveBeenCalledWith('sdmjxxx');
    expect(waitForSourceComputedDrain).toHaveBeenCalledWith('sdmjxxx', {
      timeoutMs: 600_000,
      pollMs: 5_000,
      processingLeaseMs: 120_000,
    });
    expect(waitForSchemaOperations).toHaveBeenCalledWith('sdmjxxx', {
      timeoutMs: 600_000,
      pollMs: 5_000,
    });
    expect(waitForSchemaOperations).toHaveBeenCalledTimes(2);
    expect(waitForBackgroundWriters).toHaveBeenCalledWith('sdmjxxx', {
      timeoutMs: 600_000,
      pollMs: 5_000,
      probeTimeoutMs: 30_000,
      queueScanBatchSize: 100,
      queueScanLimit: 1000,
    });
    expect(assertSourceInventoryUnchanged).toHaveBeenCalledWith('sdmjxxx');
    expect(assertSourceInventoryUnchanged).toHaveBeenCalledTimes(2);
    expect(assertTempWorkDirCapacity).toHaveBeenCalledWith('sdmjxxx', '/tmp/sdmjxxx', {
      multiplier: 2,
      minFreeBytes: 536_870_912,
      baseSchemaCopyStrategy: 'pg_dump_stream_restore',
    });
    expect(resumeSource).not.toHaveBeenCalled();
    expect(copyBaseSchemas).toHaveBeenCalledWith('sdmjxxx', {
      workDir: '/tmp/sdmjxxx',
      jobs: 2,
      timeoutMs: 1000,
      strategy: 'pg_dump_stream_restore',
      snapshotId: '00000003-0000001A-1',
    });
    expect(copySharedRows).toHaveBeenCalledWith('sdmjxxx', {
      timeoutMs: 1000,
      strategy: 'psql_copy',
      snapshotId: '00000003-0000001A-1',
    });
    expect(sourceClient.beginTransaction).toHaveBeenCalledWith({
      isolationLevel: 'repeatable read',
      readOnly: true,
    });
    expect(sourceSnapshotTransaction.raw).toHaveBeenCalledWith(
      'SET LOCAL idle_in_transaction_session_timeout = 0'
    );
    expect(sourceSnapshotTransaction.raw).toHaveBeenCalledWith(
      'SELECT pg_export_snapshot() AS "snapshotId"'
    );
    expect(sourceSnapshotTransaction.rollback).toHaveBeenCalledTimes(1);
    expect(copySharedRows.mock.invocationCallOrder[0]).toBeLessThan(
      sourceSnapshotTransaction.rollback.mock.invocationCallOrder[0]
    );
    expect(validateAndSwitch).toHaveBeenCalledWith('sdmjxxx');
    expect(copyService.assertPostgresToolsAvailable.mock.invocationCallOrder[0]).toBeLessThan(
      waitForSchemaOperations.mock.invocationCallOrder[0]
    );
    expect(waitForSchemaOperations.mock.invocationCallOrder[0]).toBeLessThan(
      assertSourceInventoryUnchanged.mock.invocationCallOrder[0]
    );
    expect(assertSourceInventoryUnchanged.mock.invocationCallOrder[0]).toBeLessThan(
      assertTempWorkDirCapacity.mock.invocationCallOrder[0]
    );
    expect(assertTempWorkDirCapacity.mock.invocationCallOrder[0]).toBeLessThan(
      copyBaseSchemas.mock.invocationCallOrder[0]
    );
    expect(copyBaseSchemas.mock.invocationCallOrder[0]).toBeLessThan(
      copySharedRows.mock.invocationCallOrder[0]
    );
    expect(copySharedRows.mock.invocationCallOrder[0]).toBeLessThan(
      pauseSource.mock.invocationCallOrder[0]
    );
    expect(pauseSource.mock.invocationCallOrder[0]).toBeLessThan(
      waitForSourceComputedDrain.mock.invocationCallOrder[0]
    );
    expect(waitForSourceComputedDrain.mock.invocationCallOrder[0]).toBeLessThan(
      waitForSchemaOperations.mock.invocationCallOrder[1]
    );
    expect(waitForSchemaOperations.mock.invocationCallOrder[1]).toBeLessThan(
      waitForBackgroundWriters.mock.invocationCallOrder[0]
    );
    expect(waitForBackgroundWriters.mock.invocationCallOrder[0]).toBeLessThan(
      assertSourceInventoryUnchanged.mock.invocationCallOrder[1]
    );
    expect(assertSourceInventoryUnchanged.mock.invocationCallOrder[1]).toBeLessThan(
      validateAndSwitch.mock.invocationCallOrder[0]
    );
  });

  it('runs a test-only migration job without freezing source writes', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      sourceConnectionId: null,
      targetConnectionId: 'dcnxxx',
      switchOnCompletion: false,
      targetInternalSchema: internalSchema,
      createdBy: 'usrxxx',
      inventory: {
        baseIds: ['bsexxx'],
        tableIds: ['tblxxx'],
        dbTableNames: ['bsexxx.sheet1'],
        physicalSchemas: [{ schemaName: 'bsexxx', relations: [], totalBytes: 1024 }],
      },
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
    });
    const service = createService();
    const pauseSource = vi.spyOn(service, 'pauseSourceComputedForJob').mockResolvedValue({
      created: true,
    } as never);
    const waitForSourceComputedDrain = vi
      .spyOn(service, 'waitForSourceComputedDrainForJob')
      .mockResolvedValue({
        activeCount: 0,
        reclaimableCount: 0,
      } as never);
    const waitForSchemaOperations = vi
      .spyOn(service, 'waitForSchemaOperationsForJob')
      .mockResolvedValue({
        openCount: 0,
      } as never);
    const waitForBackgroundWriters = vi
      .spyOn(service, 'waitForBackgroundWritersForJob')
      .mockResolvedValue({
        openCount: 0,
      } as never);
    const assertSourceInventoryUnchanged = vi
      .spyOn(service, 'assertSourceInventoryUnchangedForJob')
      .mockResolvedValue(undefined);
    const assertTempWorkDirCapacity = vi
      .spyOn(service, 'assertTempWorkDirCapacityForJob')
      .mockResolvedValue(undefined);
    const copyBaseSchemas = vi.spyOn(service, 'copyBaseSchemasForJob').mockResolvedValue({
      phase: 'base_schemas_completed',
    } as never);
    const copySharedRows = vi.spyOn(service, 'copySharedRowsForJob').mockResolvedValue({
      phase: 'shared_rows_completed',
    } as never);
    const validateAndSwitch = vi.spyOn(service, 'validateAndSwitchJob').mockResolvedValue({
      state: 'succeeded',
    } as never);

    await expect(service.runMigrationJob('sdmjxxx', { workDir: '/tmp/sdmjxxx' })).resolves.toEqual({
      state: 'succeeded',
    });

    expect(pauseSource).not.toHaveBeenCalled();
    expect(waitForSourceComputedDrain).not.toHaveBeenCalled();
    expect(waitForSchemaOperations).toHaveBeenCalledWith('sdmjxxx', {
      timeoutMs: 600_000,
      pollMs: 5_000,
    });
    expect(waitForBackgroundWriters).not.toHaveBeenCalled();
    expect(assertSourceInventoryUnchanged).toHaveBeenCalledWith('sdmjxxx');
    expect(assertTempWorkDirCapacity).toHaveBeenCalledWith('sdmjxxx', '/tmp/sdmjxxx', {
      multiplier: 2,
      minFreeBytes: 536_870_912,
      baseSchemaCopyStrategy: 'pg_dump_stream_restore',
    });
    expect(copyBaseSchemas).toHaveBeenCalledWith('sdmjxxx', {
      workDir: '/tmp/sdmjxxx',
      jobs: 1,
      timeoutMs: 86_400_000,
      strategy: 'pg_dump_stream_restore',
      snapshotId: '00000003-0000001A-1',
    });
    expect(copySharedRows).toHaveBeenCalledWith('sdmjxxx', {
      timeoutMs: 86_400_000,
      strategy: 'psql_copy',
      snapshotId: '00000003-0000001A-1',
    });
    expect(validateAndSwitch).toHaveBeenCalledWith('sdmjxxx');
  });

  it('caps copy jobs before passing them to pg_dump and pg_restore', async () => {
    const service = createService();
    vi.spyOn(service, 'pauseSourceComputedForJob').mockResolvedValue({ created: false } as never);
    vi.spyOn(service, 'waitForSourceComputedDrainForJob').mockResolvedValue({
      activeCount: 0,
      reclaimableCount: 0,
    } as never);
    vi.spyOn(service, 'waitForSchemaOperationsForJob').mockResolvedValue({
      openCount: 0,
    } as never);
    vi.spyOn(service, 'waitForBackgroundWritersForJob').mockResolvedValue({
      openCount: 0,
    } as never);
    vi.spyOn(service, 'assertSourceInventoryUnchangedForJob').mockResolvedValue(undefined);
    vi.spyOn(service, 'assertTempWorkDirCapacityForJob').mockResolvedValue(undefined);
    const copyBaseSchemas = vi.spyOn(service, 'copyBaseSchemasForJob').mockResolvedValue({
      phase: 'base_schemas_completed',
    } as never);
    vi.spyOn(service, 'copySharedRowsForJob').mockResolvedValue({
      phase: 'shared_rows_completed',
    } as never);
    vi.spyOn(service, 'validateAndSwitchJob').mockResolvedValue({
      state: 'succeeded',
    } as never);

    await expect(
      service.runMigrationJob('sdmjxxx', {
        workDir: '/tmp/sdmjxxx',
        jobs: 20,
        maxJobs: 3,
        timeoutMs: 1000,
      })
    ).resolves.toEqual({ state: 'succeeded' });

    expect(copyBaseSchemas).toHaveBeenCalledWith('sdmjxxx', {
      workDir: '/tmp/sdmjxxx',
      jobs: 3,
      timeoutMs: 1000,
      strategy: 'pg_dump_stream_restore',
      snapshotId: '00000003-0000001A-1',
    });
  });

  it('checks pgcopydb and passes the selected base-schema strategy when explicitly requested', async () => {
    copyService.assertPostgresToolsAvailable.mockResolvedValueOnce([
      processResult('pg_dump'),
      processResult('pg_restore'),
      processResult('psql'),
      processResult('pgcopydb'),
    ]);
    const service = createService();
    vi.spyOn(service, 'pauseSourceComputedForJob').mockResolvedValue({ created: false } as never);
    vi.spyOn(service, 'waitForSourceComputedDrainForJob').mockResolvedValue({
      activeCount: 0,
      reclaimableCount: 0,
    } as never);
    vi.spyOn(service, 'waitForSchemaOperationsForJob').mockResolvedValue({
      openCount: 0,
    } as never);
    vi.spyOn(service, 'waitForBackgroundWritersForJob').mockResolvedValue({
      openCount: 0,
    } as never);
    vi.spyOn(service, 'assertSourceInventoryUnchangedForJob').mockResolvedValue(undefined);
    vi.spyOn(service, 'assertTempWorkDirCapacityForJob').mockResolvedValue(undefined);
    const copyBaseSchemas = vi.spyOn(service, 'copyBaseSchemasForJob').mockResolvedValue({
      phase: 'base_schemas_completed',
    } as never);
    const copySharedRows = vi.spyOn(service, 'copySharedRowsForJob').mockResolvedValue({
      phase: 'shared_rows_completed',
    } as never);
    vi.spyOn(service, 'validateAndSwitchJob').mockResolvedValue({
      state: 'succeeded',
    } as never);

    await expect(
      service.runMigrationJob('sdmjxxx', {
        workDir: '/tmp/sdmjxxx',
        jobs: 4,
        baseSchemaCopyStrategy: 'pgcopydb',
        sharedTableCopyStrategy: 'postgres_fdw',
        timeoutMs: 1000,
      })
    ).resolves.toEqual({ state: 'succeeded' });

    expect(copyService.assertPostgresToolsAvailable).toHaveBeenCalledWith(
      'pgcopydb',
      expect.objectContaining({ timeoutMs: 1000, shouldCancel: expect.any(Function) })
    );
    expect(copyBaseSchemas).toHaveBeenCalledWith('sdmjxxx', {
      workDir: '/tmp/sdmjxxx',
      jobs: 4,
      timeoutMs: 1000,
      strategy: 'pgcopydb',
      snapshotId: '00000003-0000001A-1',
    });
    expect(copySharedRows).toHaveBeenCalledWith('sdmjxxx', {
      timeoutMs: 1000,
      strategy: 'postgres_fdw',
      snapshotId: '00000003-0000001A-1',
    });
    expect(prismaService.spaceDataDbMigrationJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sdmjxxx' },
        data: expect.objectContaining({
          copyStats: expect.objectContaining({
            phase: 'postgres_tools_checked',
            postgresTools: expect.objectContaining({
              requiredTools: ['pg_dump', 'pg_restore', 'psql', 'pgcopydb'],
            }),
          }),
        }),
      })
    );
  });

  it('fails fast before pausing source computed work when PostgreSQL client tools are unavailable', async () => {
    prismaService.spaceDataDbMigrationJob.findFirst
      .mockResolvedValueOnce({
        id: 'sdmjxxx',
        state: 'preflight',
      })
      .mockResolvedValueOnce({
        id: 'sdmjxxx',
        state: 'freezing_writes',
      })
      .mockResolvedValueOnce({
        id: 'sdmjxxx',
        state: 'failed',
      });
    copyService.assertPostgresToolsAvailable.mockRejectedValueOnce(
      new Error('spawn pg_dump ENOENT')
    );
    const service = createService();
    const pauseSource = vi.spyOn(service, 'pauseSourceComputedForJob').mockResolvedValue({
      created: true,
    } as never);

    await expect(
      service.runMigrationJob('sdmjxxx', { workDir: '/tmp/sdmjxxx', timeoutMs: 60_000 })
    ).rejects.toMatchObject({
      code: HttpErrorCode.VALIDATION_ERROR,
      data: expect.objectContaining({
        errorCode: 'SPACE_DATA_DB_POSTGRES_TOOL_UNAVAILABLE',
        requiredTools: ['pg_dump', 'pg_restore', 'psql'],
        cause: 'spawn pg_dump ENOENT',
      }),
    });

    expect(pauseSource).not.toHaveBeenCalled();
    expect(copyService.copyBaseSchemas).not.toHaveBeenCalled();
    expect(prismaService.spaceDataDbMigrationJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sdmjxxx' },
        data: expect.objectContaining({
          copyStats: expect.objectContaining({
            phase: 'postgres_tools_checking',
          }),
        }),
      })
    );
    expect(prismaService.spaceDataDbMigrationJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sdmjxxx' },
        data: expect.objectContaining({
          state: 'failed',
          lastError: 'spawn pg_dump ENOENT',
          copyStats: expect.objectContaining({
            phase: 'postgres_tools_unavailable',
            postgresTools: expect.objectContaining({
              requiredTools: ['pg_dump', 'pg_restore', 'psql'],
              error: 'spawn pg_dump ENOENT',
            }),
          }),
        }),
      })
    );
    expect(prismaService.spaceDataDbMigrationJob.updateMany).toHaveBeenCalledWith({
      where: { id: 'sdmjxxx', state: 'failed' },
      data: expect.objectContaining({
        state: 'failed',
        completedAt: expect.any(Date),
        lastError: 'Required PostgreSQL client tools are unavailable for space data DB migration',
      }),
    });
  });

  it('cancels a pre-copy migration and resumes the migration-owned source pause', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      state: 'freezing_writes',
      targetConnectionId: 'dcnxxx',
      targetInternalSchema: internalSchema,
      createdBy: 'usrxxx',
      startedAt: new Date('2026-05-06T00:00:00.000Z'),
      inventory: {
        baseIds: ['bsexxx'],
        tableIds: ['tblxxx'],
        dbTableNames: ['bsexxx.sheet1'],
        physicalSchemas: [],
      },
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
    });
    prismaService.spaceDataDbMigrationJob.findFirst.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      targetMode: 'migrate-space',
      state: 'canceled',
      targetInternalSchema: internalSchema,
      inventory: { baseIds: ['bsexxx'] },
      copyStats: { phase: 'canceled_before_copy' },
      validationStats: null,
      lastError: 'Space data database migration canceled by usrxxx',
      startedAt: new Date('2026-05-06T00:00:00.000Z'),
      completedAt: new Date('2026-05-06T00:01:00.000Z'),
      createdTime: new Date('2026-05-06T00:00:00.000Z'),
      lastModifiedTime: new Date('2026-05-06T00:01:00.000Z'),
      targetConnection: null,
    });
    sourceClient.raw.mockResolvedValue({ rows: [{ id: 'sdmp_sdmjxxx' }] });
    const service = createService();

    await expect(
      service.cancelMigrationForSpace('spcxxx', 'sdmjxxx', 'usrxxx')
    ).resolves.toMatchObject({
      jobId: 'sdmjxxx',
      state: 'canceled',
    });

    expect(sourceClient.raw).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM "public"."computed_update_pause_scope"'),
      ['space', ['spcxxx'], 'space-data-db-migration:sdmjxxx']
    );
    expect(txClient.dataDbConnection.update).toHaveBeenCalledWith({
      where: { id: 'dcnxxx' },
      data: expect.objectContaining({
        status: 'error',
        lastError: expect.stringContaining('canceled by usrxxx'),
      }),
    });
    expect(txClient.spaceDataDbMigrationJob.update).toHaveBeenCalledWith({
      where: { id: 'sdmjxxx' },
      data: expect.objectContaining({
        state: 'canceled',
        lastError: expect.stringContaining('canceled by usrxxx'),
        copyStats: expect.objectContaining({
          phase: 'canceled_before_copy',
          canceled: expect.objectContaining({ canceledBy: 'usrxxx' }),
        }),
      }),
    });
  });

  it('rejects canceling a migration that has entered validation', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      state: 'validating',
      targetConnectionId: 'dcnxxx',
      targetInternalSchema: internalSchema,
      createdBy: 'usrxxx',
      inventory: { baseIds: ['bsexxx'] },
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
    });
    const service = createService();

    await expect(
      service.cancelMigrationForSpace('spcxxx', 'sdmjxxx', 'usrxxx')
    ).rejects.toMatchObject({
      code: HttpErrorCode.CONFLICT,
      data: expect.objectContaining({
        errorCode: 'SPACE_DATA_DB_MIGRATION_CANCEL_CONFLICT',
        migrationState: 'validating',
      }),
    });

    expect(sourceClient.raw).not.toHaveBeenCalled();
    expect(txClient.spaceDataDbMigrationJob.update).not.toHaveBeenCalled();
  });

  it('rolls back a completed migration after a clean post-switch proof', async () => {
    const completedAt = new Date('2026-05-06T00:10:00.000Z');
    const job = {
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      state: 'succeeded',
      sourceConnectionId: null,
      targetConnectionId: 'dcnxxx',
      switchOnCompletion: true,
      targetInternalSchema: internalSchema,
      createdBy: 'usrxxx',
      startedAt: new Date('2026-05-06T00:00:00.000Z'),
      completedAt,
      inventory: {
        sourceDataDb: {
          mode: 'default',
          cacheKey: 'meta-fallback',
          connectionId: null,
          internalSchema: null,
          isMetaFallback: true,
        },
        targetDataDb: { internalSchema },
        baseIds: ['bsexxx'],
        tableIds: ['tblxxx'],
        dbTableNames: ['bsexxx.sheet1'],
        physicalSchemas: [],
      },
      validationStats: {
        phase: 'validation_completed',
        baseSchemas: [],
        sharedTables: [],
      },
      copyStats: null,
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
    };
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue(job);
    prismaService.spaceDataDbMigrationJob.findFirst.mockResolvedValue({
      ...job,
      targetMode: 'migrate-space',
      state: 'rolled_back',
      lastError: null,
      createdTime: new Date('2026-05-06T00:00:00.000Z'),
      lastModifiedTime: new Date('2026-05-06T00:11:00.000Z'),
      targetConnection: null,
    });
    const service = createService();
    vi.spyOn(
      service as unknown as {
        inspectPostSwitchRollbackProof: (job: unknown) => Promise<unknown>;
      },
      'inspectPostSwitchRollbackProof'
    ).mockResolvedValue({
      eligible: true,
      switchedAt: completedAt.toISOString(),
      checkedAt: '2026-05-06T00:11:00.000Z',
      findings: [],
    });
    const resumeSource = vi
      .spyOn(
        service as unknown as {
          resumeOriginalSourceComputedPause: (
            job: unknown,
            sourceDataDb: unknown
          ) => Promise<{ deleted: number }>;
        },
        'resumeOriginalSourceComputedPause'
      )
      .mockResolvedValue({ deleted: 1 });

    await expect(
      service.rollbackMigrationForSpace('spcxxx', 'sdmjxxx', 'usrrollback')
    ).resolves.toMatchObject({
      jobId: 'sdmjxxx',
      state: 'rolled_back',
    });

    expect(prismaService.spaceDataDbMigrationJob.update).toHaveBeenCalledWith({
      where: { id: 'sdmjxxx' },
      data: { state: 'switching', lastError: null },
    });
    expect(txClient.spaceDataDbBinding.upsert).toHaveBeenCalledWith({
      where: { spaceId: 'spcxxx' },
      create: expect.objectContaining({
        spaceId: 'spcxxx',
        dataDbConnectionId: null,
        mode: 'default',
        state: 'ready',
        createdBy: 'usrrollback',
      }),
      update: {
        dataDbConnectionId: null,
        mode: 'default',
        state: 'ready',
      },
    });
    expect(txClient.spaceDataDbMigrationJob.update).toHaveBeenCalledWith({
      where: { id: 'sdmjxxx' },
      data: expect.objectContaining({
        state: 'rolled_back',
        lastError: null,
        validationStats: expect.objectContaining({
          rollback: expect.objectContaining({
            eligible: true,
            rolledBackBy: 'usrrollback',
          }),
        }),
      }),
    });
    expect(dataDbClientManager.invalidateConnection).toHaveBeenCalledWith('dcnxxx');
    expect(resumeSource).toHaveBeenCalledWith(
      job,
      expect.objectContaining({ cacheKey: 'meta-fallback', isMetaFallback: true })
    );
  });

  it('rejects post-switch rollback when target writes are detected', async () => {
    const completedAt = new Date('2026-05-06T00:10:00.000Z');
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      state: 'succeeded',
      sourceConnectionId: null,
      targetConnectionId: 'dcnxxx',
      switchOnCompletion: true,
      targetInternalSchema: internalSchema,
      createdBy: 'usrxxx',
      startedAt: new Date('2026-05-06T00:00:00.000Z'),
      completedAt,
      inventory: {
        sourceDataDb: {
          mode: 'default',
          cacheKey: 'meta-fallback',
          connectionId: null,
          internalSchema: null,
          isMetaFallback: true,
        },
        targetDataDb: { internalSchema },
        baseIds: ['bsexxx'],
        tableIds: ['tblxxx'],
        dbTableNames: ['bsexxx.sheet1'],
        physicalSchemas: [],
      },
      validationStats: {
        phase: 'validation_completed',
        baseSchemas: [],
        sharedTables: [],
      },
      copyStats: null,
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
    });
    const service = createService();
    vi.spyOn(
      service as unknown as {
        inspectPostSwitchRollbackProof: (job: unknown) => Promise<unknown>;
      },
      'inspectPostSwitchRollbackProof'
    ).mockResolvedValue({
      eligible: false,
      switchedAt: completedAt.toISOString(),
      checkedAt: '2026-05-06T00:11:00.000Z',
      findings: [{ object: 'base:bsexxx.sheet1', reason: 'row_count_changed' }],
    });

    await expect(
      service.rollbackMigrationForSpace('spcxxx', 'sdmjxxx', 'usrrollback')
    ).rejects.toMatchObject({
      code: HttpErrorCode.CONFLICT,
      data: expect.objectContaining({
        errorCode: 'SPACE_DATA_DB_ROLLBACK_UNSAFE',
        rollback: expect.objectContaining({
          eligible: false,
        }),
      }),
    });

    expect(prismaService.spaceDataDbMigrationJob.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'sdmjxxx' },
      data: { state: 'switching', lastError: null },
    });
    expect(prismaService.spaceDataDbMigrationJob.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'sdmjxxx' },
      data: expect.objectContaining({
        state: 'succeeded',
        lastError: expect.stringContaining('rollback is unsafe'),
        validationStats: expect.objectContaining({
          rollback: expect.objectContaining({ eligible: false }),
        }),
      }),
    });
    expect(txClient.spaceDataDbBinding.upsert).not.toHaveBeenCalled();
    expect(dataDbClientManager.invalidateConnection).not.toHaveBeenCalled();
  });

  it('rejects rollback for a successful dry-run migration that did not switch routing', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      state: 'succeeded',
      sourceConnectionId: null,
      targetConnectionId: 'dcnxxx',
      switchOnCompletion: false,
      targetInternalSchema: internalSchema,
      createdBy: 'usrxxx',
      completedAt: new Date('2026-05-06T00:10:00.000Z'),
      inventory: {
        baseIds: ['bsexxx'],
        tableIds: ['tblxxx'],
      },
      validationStats: {
        phase: 'validation_completed',
        switchOnCompletion: false,
        switched: false,
      },
      copyStats: null,
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
    });
    const service = createService();

    await expect(
      service.rollbackMigrationForSpace('spcxxx', 'sdmjxxx', 'usrrollback')
    ).rejects.toMatchObject({
      code: HttpErrorCode.CONFLICT,
      data: expect.objectContaining({
        errorCode: 'SPACE_DATA_DB_ROLLBACK_UNSAFE',
      }),
    });

    expect(prismaService.spaceDataDbMigrationJob.update).not.toHaveBeenCalledWith({
      where: { id: 'sdmjxxx' },
      data: { state: 'switching', lastError: null },
    });
    expect(txClient.spaceDataDbBinding.upsert).not.toHaveBeenCalled();
  });

  it('rejects rollback from a BYODB source before entering the active switching state', async () => {
    prismaService.spaceDataDbMigrationJob.findUnique.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      state: 'succeeded',
      sourceConnectionId: 'dcnsource',
      targetConnectionId: 'dcntarget',
      switchOnCompletion: true,
      targetInternalSchema: internalSchema,
      createdBy: 'usrxxx',
      completedAt: new Date('2026-05-06T00:10:00.000Z'),
      inventory: {
        sourceDataDb: {
          mode: 'byodb',
          cacheKey: 'dcnsource',
          connectionId: 'dcnsource',
          internalSchema,
          isMetaFallback: false,
        },
        targetDataDb: { internalSchema },
        baseIds: ['bsexxx'],
        tableIds: [],
        dbTableNames: [],
        physicalSchemas: [],
      },
      validationStats: null,
      copyStats: null,
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
    });
    const service = createService();

    await expect(
      service.rollbackMigrationForSpace('spcxxx', 'sdmjxxx', 'usrrollback')
    ).rejects.toMatchObject({
      code: HttpErrorCode.VALIDATION_ERROR,
    });

    expect(prismaService.spaceDataDbMigrationJob.update).not.toHaveBeenCalledWith({
      where: { id: 'sdmjxxx' },
      data: { state: 'switching', lastError: null },
    });
  });

  it('proves a post-switch rollback is clean when target inventory, counts, and timestamps match', async () => {
    const service = createService();
    targetClient.raw.mockImplementation((sql: string) => {
      if (sql.includes('FROM pg_class c')) {
        return {
          rows: [
            {
              schemaName: 'bsexxx',
              relationName: 'sheet1',
              relationKind: 'table',
            },
          ],
        };
      }
      if (sql.includes('FROM information_schema.columns')) {
        return { rows: [{ columnName: '__last_modified_time' }] };
      }
      if (sql.includes('FROM "bsexxx"."sheet1"')) {
        return { rows: [{ count: sql.includes('> ?::timestamp') ? '0' : '5' }] };
      }
      if (sql.includes('COUNT(*)')) {
        return { rows: [{ count: '0' }] };
      }
      return { rows: [] };
    });

    await expect(
      (
        service as unknown as {
          inspectPostSwitchRollbackProof: (job: unknown) => Promise<{
            eligible: boolean;
            findings: unknown[];
          }>;
        }
      ).inspectPostSwitchRollbackProof({
        id: 'sdmjxxx',
        spaceId: 'spcxxx',
        completedAt: new Date('2026-05-06T00:10:00.000Z'),
        targetInternalSchema: internalSchema,
        inventory: {
          baseIds: ['bsexxx'],
          tableIds: [],
          dbTableNames: ['bsexxx.sheet1'],
          physicalSchemas: [
            {
              schemaName: 'bsexxx',
              totalBytes: 1024,
              estimatedRows: 5,
              relations: [
                {
                  schemaName: 'bsexxx',
                  relationName: 'sheet1',
                  relationKind: 'table',
                  totalBytes: 1024,
                  estimatedRows: 5,
                },
              ],
            },
          ],
        },
        validationStats: {
          baseSchemas: [{ object: 'base:bsexxx.sheet1', sourceCount: 5, targetCount: 5 }],
          sharedTables: [
            { object: 'shared:computed_update_outbox', sourceCount: 0, targetCount: 0 },
            { object: 'shared:computed_update_dead_letter', sourceCount: 0, targetCount: 0 },
            { object: 'shared:computed_update_pause_scope', sourceCount: 0, targetCount: 0 },
            { object: 'shared:__undo_log', sourceCount: 0, targetCount: 0 },
          ],
        },
        targetConnection: {
          encryptedUrl: encryptDataDbUrl(dataUrl),
        },
      })
    ).resolves.toMatchObject({
      eligible: true,
      findings: [],
    });
  });

  it('flags post-switch rollback as unsafe when target row counts or timestamps changed', async () => {
    const service = createService();
    targetClient.raw.mockImplementation((sql: string) => {
      if (sql.includes('FROM pg_class c')) {
        return {
          rows: [
            {
              schemaName: 'bsexxx',
              relationName: 'sheet1',
              relationKind: 'table',
            },
          ],
        };
      }
      if (sql.includes('FROM information_schema.columns')) {
        return { rows: [{ columnName: '__last_modified_time' }] };
      }
      if (sql.includes('FROM "bsexxx"."sheet1"')) {
        return { rows: [{ count: sql.includes('> ?::timestamp') ? '2' : '6' }] };
      }
      if (sql.includes('COUNT(*)')) {
        return { rows: [{ count: '0' }] };
      }
      return { rows: [] };
    });

    const proof = await (
      service as unknown as {
        inspectPostSwitchRollbackProof: (job: unknown) => Promise<{
          eligible: boolean;
          findings: { reason: string }[];
        }>;
      }
    ).inspectPostSwitchRollbackProof({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      completedAt: new Date('2026-05-06T00:10:00.000Z'),
      targetInternalSchema: internalSchema,
      inventory: {
        baseIds: ['bsexxx'],
        tableIds: [],
        dbTableNames: ['bsexxx.sheet1'],
        physicalSchemas: [
          {
            schemaName: 'bsexxx',
            totalBytes: 1024,
            estimatedRows: 5,
            relations: [
              {
                schemaName: 'bsexxx',
                relationName: 'sheet1',
                relationKind: 'table',
                totalBytes: 1024,
                estimatedRows: 5,
              },
            ],
          },
        ],
      },
      validationStats: {
        baseSchemas: [{ object: 'base:bsexxx.sheet1', sourceCount: 5, targetCount: 5 }],
        sharedTables: [
          { object: 'shared:computed_update_outbox', sourceCount: 0, targetCount: 0 },
          { object: 'shared:computed_update_dead_letter', sourceCount: 0, targetCount: 0 },
          { object: 'shared:computed_update_pause_scope', sourceCount: 0, targetCount: 0 },
          { object: 'shared:__undo_log', sourceCount: 0, targetCount: 0 },
        ],
      },
      targetConnection: {
        encryptedUrl: encryptDataDbUrl(dataUrl),
      },
    });

    expect(proof.eligible).toBe(false);
    expect(proof.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: 'row_count_changed' }),
        expect.objectContaining({ reason: 'post_switch_timestamp_rows' }),
      ])
    );
  });

  it('stops the runner before physical copy when cancellation is observed at a checkpoint', async () => {
    prismaService.spaceDataDbMigrationJob.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'sdmjxxx',
        spaceId: 'spcxxx',
        state: 'canceled',
      });
    const service = createService();
    vi.spyOn(service, 'pauseSourceComputedForJob').mockResolvedValue({ created: true } as never);
    vi.spyOn(service, 'waitForSourceComputedDrainForJob').mockResolvedValue({
      activeCount: 0,
      reclaimableCount: 0,
    } as never);
    vi.spyOn(service, 'waitForSchemaOperationsForJob').mockResolvedValue({
      openCount: 0,
    } as never);
    vi.spyOn(service, 'waitForBackgroundWritersForJob').mockResolvedValue({
      openCount: 0,
    } as never);
    vi.spyOn(service, 'assertSourceInventoryUnchangedForJob').mockResolvedValue(undefined);
    vi.spyOn(service, 'assertTempWorkDirCapacityForJob').mockResolvedValue(undefined);
    const copyBaseSchemas = vi.spyOn(service, 'copyBaseSchemasForJob').mockResolvedValue({
      phase: 'base_schemas_completed',
    } as never);
    const resumeSource = vi.spyOn(service, 'resumeSourceComputedForJob').mockResolvedValue({
      deleted: 1,
    } as never);

    await expect(
      service.runMigrationJob('sdmjxxx', { workDir: '/tmp/sdmjxxx' })
    ).rejects.toMatchObject({
      code: HttpErrorCode.CONFLICT,
      data: expect.objectContaining({
        errorCode: 'SPACE_DATA_DB_MIGRATION_CANCELED',
      }),
    });

    expect(copyBaseSchemas).not.toHaveBeenCalled();
    expect(resumeSource).not.toHaveBeenCalled();
  });

  it('resumes a migration-created source computed pause when copy fails before switch', async () => {
    const service = createService();
    vi.spyOn(service, 'pauseSourceComputedForJob').mockResolvedValue({ created: true } as never);
    vi.spyOn(service, 'waitForSourceComputedDrainForJob').mockResolvedValue({
      activeCount: 0,
      reclaimableCount: 0,
    } as never);
    vi.spyOn(service, 'waitForSchemaOperationsForJob').mockResolvedValue({
      openCount: 0,
    } as never);
    vi.spyOn(service, 'waitForBackgroundWritersForJob').mockResolvedValue({
      openCount: 0,
    } as never);
    vi.spyOn(service, 'assertSourceInventoryUnchangedForJob').mockResolvedValue(undefined);
    vi.spyOn(service, 'assertTempWorkDirCapacityForJob').mockResolvedValue(undefined);
    vi.spyOn(service, 'copyBaseSchemasForJob').mockRejectedValue(new Error('copy failed'));
    const copySharedRows = vi.spyOn(service, 'copySharedRowsForJob');
    const validateAndSwitch = vi.spyOn(service, 'validateAndSwitchJob');
    const resumeSource = vi.spyOn(service, 'resumeSourceComputedForJob').mockResolvedValue({
      deleted: 1,
    } as never);
    const cleanupTargetArtifacts = vi
      .spyOn(service, 'cleanupTargetArtifactsForJob')
      .mockResolvedValue({
        reason: 'pre_switch_failure',
        baseSchemas: [],
        sharedTables: [],
        startedAt: '2026-05-06T00:00:00.000Z',
        completedAt: '2026-05-06T00:00:01.000Z',
      } as never);

    await expect(service.runMigrationJob('sdmjxxx', { workDir: '/tmp/sdmjxxx' })).rejects.toThrow(
      'copy failed'
    );
    expect(resumeSource).not.toHaveBeenCalled();
    expect(cleanupTargetArtifacts).toHaveBeenCalledWith('sdmjxxx', 'pre_switch_failure');
    expect(copySharedRows).not.toHaveBeenCalled();
    expect(validateAndSwitch).not.toHaveBeenCalled();
    expect(txClient.spaceDataDbBinding.upsert).not.toHaveBeenCalled();
    expect(txClient.dataDbConnection.update).not.toHaveBeenCalled();
  });

  it('returns a sanitized migration job status', async () => {
    prismaService.spaceDataDbMigrationJob.findFirst.mockResolvedValue({
      id: 'sdmjxxx',
      spaceId: 'spcxxx',
      targetMode: 'migrate-space',
      switchOnCompletion: false,
      state: 'copying',
      targetInternalSchema: internalSchema,
      inventory: { baseIds: ['bsexxx'] },
      copyStats: { phase: 'copying_shared_rows' },
      validationStats: null,
      lastError: null,
      startedAt: new Date('2026-05-06T00:00:00.000Z'),
      completedAt: null,
      createdTime: new Date('2026-05-06T00:00:00.000Z'),
      lastModifiedTime: new Date('2026-05-06T00:01:00.000Z'),
      targetConnection: {
        provider: 'postgres',
        displayHost: 'example.com:5432',
        displayDatabase: 'teable_data',
        internalSchema,
        schemaVersion,
        lastValidatedAt: new Date('2026-05-06T00:00:00.000Z'),
        lastError: null,
        encryptedUrl: 'encrypted-secret',
        capabilities,
      },
    });
    const service = createService();

    await expect(service.getMigrationJobStatus('spcxxx', 'sdmjxxx')).resolves.toMatchObject({
      jobId: 'sdmjxxx',
      spaceId: 'spcxxx',
      state: 'copying',
      switchOnCompletion: false,
      targetConnection: {
        displayHost: 'example.com:5432',
        displayDatabase: 'teable_data',
      },
      copyStats: {
        phase: 'copying_shared_rows',
      },
    });
    const status = await service.getMigrationJobStatus('spcxxx', 'sdmjxxx');
    expect(JSON.stringify(status)).not.toContain('encrypted-secret');
    expect(prismaService.spaceDataDbMigrationJob.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sdmjxxx' },
      })
    );
  });
});

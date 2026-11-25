/* eslint-disable @typescript-eslint/naming-convention */
import { AsyncLocalStorage } from 'node:async_hooks';
import { PassThrough } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FieldType } from '@teable/core';
import type { IBaseJson } from '@teable/openapi';
import archiver from 'archiver';
import Knex from 'knex';
import { ClsService } from 'nestjs-cls';
import type { Mock } from 'vitest';
import { vi } from 'vitest';

import type { IClsStore } from '../../../types/cls';
import type { INewAuditOperationInput } from '../../audit/audit-scope';
import { RecordMutationPolicyService } from '../../record-mutation-policy/record-mutation-policy.service';

import { BASE_IMPORT_DATA_COMPLETE, BASE_IMPORT_DATA_STATUS } from '../base-import-completion';
import { BaseImportCsvQueueProcessor } from './base-import-csv.processor';
import { BaseImportJunctionCsvQueueProcessor } from './base-import-junction.processor';

const createCsvZipStream = (entries: Record<string, string>) => {
  const archive = archiver('zip', { zlib: { level: 0 } });
  for (const [name, content] of Object.entries(entries)) {
    archive.append(content, { name });
  }
  void archive.finalize();
  return archive;
};

describe('BaseImportCsvQueueProcessor', () => {
  it.each([undefined, { type: 'appUser' as const, id: 'apuFrozen' }])(
    'uses only the producer frozen initiator, not executor or archive (%s)',
    async (recordInitiator) => {
      const cls = new ClsService<IClsStore>(new AsyncLocalStorage());
      const processor = Object.create(BaseImportCsvQueueProcessor.prototype) as {
        handleBaseImportCsv: (job: { data: Record<string, unknown> }) => Promise<void>;
      };
      const inScope = vi.fn(async () => {
        expect(cls.get('recordInitiator')).toEqual(recordInitiator);
        expect(cls.get('user.id')).toBe('usrExecutor');
      });
      Object.assign(processor, {
        cls,
        audit: {
          withOperation: async <T>(
            _operation: INewAuditOperationInput,
            callback: () => Promise<T>
          ) => callback(),
        },
        handleBaseImportCsvInScope: inScope,
      });
      await processor.handleBaseImportCsv({
        data: {
          userId: 'usrExecutor',
          baseId: 'bseImport',
          recordInitiator,
          structure: { createdByActorType: 'user', createdByActorId: 'forgedArchiveActor' },
        },
      });
      expect(inScope).toHaveBeenCalledOnce();
    }
  );

  it('waits for csv entry pipelines before running persisted computed backfill', async () => {
    const structure = {
      tables: [
        {
          id: 'tblSource',
          fields: [{ id: 'fldName', dbFieldName: 'Name', type: FieldType.SingleLineText }],
        },
      ],
    } as unknown as IBaseJson;
    let chunkFinished = false;
    const recomputeForTables = vi.fn(async () => {
      expect(chunkFinished).toBe(true);
    });
    const processor = Object.create(BaseImportCsvQueueProcessor.prototype) as {
      handleBaseImportCsvInScope: (job: { data: Record<string, unknown> }) => Promise<void>;
      handleChunk: ReturnType<typeof vi.fn>;
      storageAdapter: { downloadFile: ReturnType<typeof vi.fn> };
      cls: ClsService<IClsStore>;
      prismaService: { base: { findUniqueOrThrow: ReturnType<typeof vi.fn> } };
      persistedComputedBackfillService: { recomputeForTables: ReturnType<typeof vi.fn> };
      logger: { log: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
    };
    Object.assign(processor, {
      recordMutationPolicy: new RecordMutationPolicyService(),
      eventEmitter: new EventEmitter2(),
    });

    processor.cls = new ClsService<IClsStore>(new AsyncLocalStorage());
    processor.storageAdapter = {
      downloadFile: vi
        .fn()
        .mockResolvedValue(createCsvZipStream({ 'tables/tblSource.csv': '__id,Name\nrec1,Alpha' })),
    };
    processor.prismaService = {
      base: { findUniqueOrThrow: vi.fn().mockResolvedValue({ v2Enabled: false }) },
    };
    processor.handleChunk = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      chunkFinished = true;
    });
    processor.persistedComputedBackfillService = { recomputeForTables };
    processor.logger = { log: vi.fn(), error: vi.fn() };

    await processor.handleBaseImportCsvInScope({
      data: {
        path: 'import.zip',
        userId: 'usrImport',
        baseId: 'bseImport',
        tableIdMap: { tblSource: 'tblTarget' },
        fieldIdMap: {},
        viewIdMap: {},
        fkMap: {},
        structure,
      },
    });

    expect(processor.handleChunk).toHaveBeenCalledTimes(1);
    expect(recomputeForTables).toHaveBeenCalledWith(['tblTarget']);
  });

  it('isolates serialized CSV chunk transaction slots while inheriting job attribution', async () => {
    const cls = new ClsService(new AsyncLocalStorage());
    const processor = Object.create(BaseImportCsvQueueProcessor.prototype) as {
      handleBaseImportCsvInScope: (job: { data: Record<string, unknown> }) => Promise<void>;
      handleChunk: ReturnType<typeof vi.fn>;
      cls: ClsService;
      storageAdapter: { downloadFile: ReturnType<typeof vi.fn> };
      prismaService: { base: { findUniqueOrThrow: ReturnType<typeof vi.fn> } };
      persistedComputedBackfillService: { recomputeForTables: ReturnType<typeof vi.fn> };
      logger: { log: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
    };
    Object.assign(processor, {
      recordMutationPolicy: new RecordMutationPolicyService(),
      eventEmitter: new EventEmitter2(),
    });
    const contexts: object[] = [];
    let activeChunks = 0;
    processor.cls = cls;
    processor.storageAdapter = {
      downloadFile: vi.fn().mockResolvedValue(
        createCsvZipStream({
          'tables/tblFirst.csv': '__id,Name\nrecFirst,Alpha',
          'tables/tblSecond.csv': '__id,Name\nrecSecond,Beta',
        })
      ),
    };
    processor.prismaService = {
      base: { findUniqueOrThrow: vi.fn().mockResolvedValue({ v2Enabled: false }) },
    };
    processor.handleChunk = vi.fn(async (chunk: Record<string, string>[]) => {
      const initialDataTxId = cls.get('dataTx.id');
      expect(cls.get('tx.id')).toBeUndefined();
      contexts.push(cls.get('dataTx'));
      activeChunks += 1;
      expect(activeChunks).toBe(1);
      expect(initialDataTxId).toBeUndefined();
      expect(cls.get('user.id')).toBe('usrImport');
      expect(cls.get('audit.operationId')).toBe('operationImport');
      expect(cls.get('origin.byApi')).toBe(true);
      const chunkId = chunk[0]!.__id;
      cls.set('dataTx.id', chunkId);
      cls.set('tx.id', chunkId);
      // Chunks in one job serialize their DDL. Yield without waiting for a
      // later chunk, which cannot start until this one has finished.
      await Promise.resolve();
      expect(cls.get('dataTx.id')).toBe(chunkId);
      expect(cls.get('tx.id')).toBe(chunkId);
      activeChunks -= 1;
    });
    processor.persistedComputedBackfillService = { recomputeForTables: vi.fn() };
    processor.logger = { log: vi.fn(), error: vi.fn() };

    const jobContext = {
      user: { id: 'usrImport' },
      audit: { operationId: 'operationImport' },
      origin: { byApi: true },
      tx: {},
      dataTx: {},
    };
    await cls.runWith(jobContext, () =>
      processor.handleBaseImportCsvInScope({
        data: {
          path: 'import.zip',
          userId: 'usrImport',
          baseId: 'bseImport',
          tableIdMap: { tblFirst: 'tblTargetFirst', tblSecond: 'tblTargetSecond' },
          fieldIdMap: {},
          viewIdMap: {},
          fkMap: {},
          structure: {
            tables: [
              { id: 'tblFirst', fields: [] },
              { id: 'tblSecond', fields: [] },
            ],
          },
        },
      })
    );

    expect(processor.handleChunk).toHaveBeenCalledTimes(2);
    expect(contexts[0]).not.toBe(contexts[1]);
    expect(jobContext.tx).toEqual({});
    expect(jobContext.dataTx).toEqual({});
    expect(processor.persistedComputedBackfillService.recomputeForTables).toHaveBeenCalledOnce();
  });

  it('keeps concurrent CSV jobs attributed to their own CLS scope', async () => {
    const cls = new ClsService(new AsyncLocalStorage());
    const processor = Object.create(BaseImportCsvQueueProcessor.prototype) as {
      handleBaseImportCsvInScope: (job: { data: Record<string, unknown> }) => Promise<void>;
      handleChunk: Mock;
      cls: ClsService;
      storageAdapter: { downloadFile: Mock };
      prismaService: { base: { findUniqueOrThrow: Mock } };
      persistedComputedBackfillService: { recomputeForTables: Mock };
      logger: { log: Mock; error: Mock };
    };
    Object.assign(processor, {
      recordMutationPolicy: new RecordMutationPolicyService(),
      eventEmitter: new EventEmitter2(),
    });
    const transactionContexts: object[] = [];
    processor.cls = cls;
    processor.storageAdapter = {
      downloadFile: vi.fn(async (_bucket: string, path: string) =>
        createCsvZipStream({ 'tables/tblSource.csv': `__id,Name\nrec${path},Alpha` })
      ),
    };
    processor.prismaService = {
      base: { findUniqueOrThrow: vi.fn().mockResolvedValue({ v2Enabled: false }) },
    };
    processor.handleChunk = vi.fn(
      async (chunk: Record<string, string>[], { userId }: { userId: string }) => {
        transactionContexts.push(cls.get('dataTx'), cls.get('tx'));
        expect(cls.get('dataTx.id')).toBeUndefined();
        expect(cls.get('tx.id')).toBeUndefined();
        expect(cls.get('user.id')).toBe(userId);
        expect(cls.get('audit.operationId')).toBe(`operation${userId}`);
        const chunkId = chunk[0]!.__id;
        cls.set('dataTx.id', chunkId);
        cls.set('tx.id', chunkId);
        await Promise.resolve();
        expect(cls.get('dataTx.id')).toBe(chunkId);
        expect(cls.get('tx.id')).toBe(chunkId);
        expect(cls.get('user.id')).toBe(userId);
        expect(cls.get('audit.operationId')).toBe(`operation${userId}`);
      }
    );
    processor.persistedComputedBackfillService = { recomputeForTables: vi.fn() };
    processor.logger = { log: vi.fn(), error: vi.fn() };
    const jobContexts = ['usrFirst', 'usrSecond'].map((userId) => ({
      user: { id: userId },
      audit: { operationId: `operation${userId}` },
      tx: {},
      dataTx: {},
    }));

    await Promise.all(
      jobContexts.map((context) =>
        cls.runWith(context, () =>
          processor.handleBaseImportCsvInScope({
            data: {
              path: context.user.id,
              userId: context.user.id,
              baseId: `bse${context.user.id}`,
              tableIdMap: { tblSource: `tbl${context.user.id}` },
              fieldIdMap: {},
              viewIdMap: {},
              fkMap: {},
              structure: { tables: [{ id: 'tblSource', fields: [] }] },
            },
          })
        )
      )
    );

    expect(processor.handleChunk).toHaveBeenCalledTimes(2);
    expect(new Set(transactionContexts).size).toBe(4);
    for (const context of jobContexts) {
      expect(context.tx).toEqual({});
      expect(context.dataTx).toEqual({});
    }
    expect(processor.persistedComputedBackfillService.recomputeForTables).toHaveBeenCalledTimes(2);
  });

  it('drains an active chunk after a parser failure before accepting a retry', async () => {
    const processor = Object.create(BaseImportCsvQueueProcessor.prototype) as {
      process: (job: { id: string; data: Record<string, unknown> }) => Promise<void>;
      handleBaseImportCsv: ReturnType<typeof vi.fn>;
      handleBaseImportCsvInScope: (job: { data: Record<string, unknown> }) => Promise<void>;
      handleChunk: ReturnType<typeof vi.fn>;
      processedJobs: Set<string>;
      cls: ClsService<IClsStore>;
      storageAdapter: { downloadFile: ReturnType<typeof vi.fn> };
      notificationService: { sendCommonNotify: ReturnType<typeof vi.fn> };
      prismaService: { base: { findUniqueOrThrow: ReturnType<typeof vi.fn> } };
      persistedComputedBackfillService: { recomputeForTables: ReturnType<typeof vi.fn> };
      logger: { log: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
    };
    Object.assign(processor, {
      recordMutationPolicy: new RecordMutationPolicyService(),
      eventEmitter: new EventEmitter2(),
    });
    const { promise: activeChunkEntered, resolve: markActiveChunkEntered } =
      Promise.withResolvers<void>();
    const { promise: downloadClosed, resolve: markDownloadClosed } = Promise.withResolvers<void>();
    const { promise: releaseActiveChunk, resolve: finishActiveChunk } =
      Promise.withResolvers<void>();
    const firstDownload = new PassThrough();
    firstDownload.once('close', markDownloadClosed);
    const firstArchive = await buffer(
      createCsvZipStream({
        'tables/tblActive.csv': '__id,Name\nrecActive,Alpha',
      })
    );
    const endDirectoryOffset = firstArchive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    expect(endDirectoryOffset).toBeGreaterThanOrEqual(0);
    const centralDirectoryOffset = firstArchive.readUInt32LE(endDirectoryOffset + 16);
    const completedRecords: string[] = [];
    let downloads = 0;
    processor.processedJobs = new Set();
    processor.cls = new ClsService<IClsStore>(new AsyncLocalStorage());
    processor.storageAdapter = {
      downloadFile: vi.fn(async () => {
        downloads += 1;
        return downloads === 1
          ? firstDownload
          : createCsvZipStream({ 'tables/tblActive.csv': '__id,Name\nrecRetry,Retry' });
      }),
    };
    processor.handleChunk = vi.fn(async (chunk: Record<string, string>[]) => {
      const recordIds = chunk.map((record) => record.__id!);
      if (recordIds.includes('recActive')) {
        markActiveChunkEntered();
        await releaseActiveChunk;
      }
      completedRecords.push(...recordIds);
    });
    processor.notificationService = {
      sendCommonNotify: vi.fn().mockResolvedValue({ sentCount: 1 }),
    };
    processor.prismaService = {
      base: { findUniqueOrThrow: vi.fn().mockResolvedValue({ v2Enabled: false }) },
    };
    processor.persistedComputedBackfillService = { recomputeForTables: vi.fn() };
    processor.logger = { log: vi.fn(), error: vi.fn() };
    processor.handleBaseImportCsv = vi.fn((job) => processor.handleBaseImportCsvInScope(job));
    const job = {
      id: 'import-job',
      data: {
        path: 'import.zip',
        userId: 'usrImport',
        baseId: 'bseImport',
        tableIdMap: { tblActive: 'tblTargetActive' },
        fieldIdMap: {},
        viewIdMap: {},
        fkMap: {},
        structure: {
          tables: [{ id: 'tblActive', fields: [] }],
        },
      },
    };

    let firstSettled = false;
    const firstResult = processor.process(job).then(
      () => {
        firstSettled = true;
        return undefined;
      },
      (error: unknown) => {
        firstSettled = true;
        return error;
      }
    );
    try {
      // Supply one complete real ZIP entry, but keep the download open before
      // its central directory so the parser is still waiting for another header.
      firstDownload.write(firstArchive.subarray(0, centralDirectoryOffset));
      await activeChunkEntered;
      // An invalid next-header signature triggers the real unzipper error path
      // independently of the already-started chunk's blocked work.
      firstDownload.write(Buffer.alloc(4));
      await downloadClosed;
      await expect(processor.process(job)).resolves.toBeUndefined();
      expect(downloads).toBe(1);
      expect(firstSettled).toBe(false);
      expect(completedRecords).toEqual([]);

      finishActiveChunk();
      const firstFailure = await firstResult;
      expect(firstFailure).toBeInstanceOf(Error);
      expect((firstFailure as Error).message).toBe('Base import CSV processing failed');
      expect(completedRecords).toEqual(['recActive']);

      await expect(processor.process(job)).resolves.toBeUndefined();
      expect(downloads).toBe(2);
      expect(completedRecords).toEqual(['recActive', 'recRetry']);
    } finally {
      finishActiveChunk();
      firstDownload.destroy();
      await firstResult;
    }
  });

  it.each([0, 1])(
    'imports current actors without history or archive identity for capability %s',
    async (actorStorageVersion) => {
      const executedSql: string[] = [];
      const dataKnex = Knex({ client: 'pg' });
      const dataPrisma = {
        $queryRawUnsafe: vi
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([{ name: '__id' }, { name: 'fldText' }]),
        $executeRawUnsafe: vi.fn(async (sql: string) => {
          executedSql.push(sql);
          return 1;
        }),
      };
      const prismaService = {
        tableMeta: {
          findUniqueOrThrow: vi.fn().mockResolvedValue({ dbTableName: 'bse_data.tbl_imported' }),
        },
        txClient: vi.fn().mockReturnValue({
          attachmentsTable: {
            createMany: vi.fn().mockResolvedValue(undefined),
          },
        }),
      };
      const dataDbClientManager = {
        dataPrismaForBase: vi.fn().mockResolvedValue(dataPrisma),
        dataKnexForBase: vi.fn().mockResolvedValue(dataKnex),
        getDataDatabaseForBase: vi.fn().mockResolvedValue({
          url: 'postgresql://user:pass@example.test:5432/data?schema=teable_internal',
        }),
      };
      const processor = Object.create(BaseImportCsvQueueProcessor.prototype) as {
        handleChunk: (
          results: Record<string, unknown>[],
          config: {
            baseId: string;
            tableId: string;
            userId: string;
            fieldIdMap: Record<string, string>;
            viewIdMap: Record<string, string>;
            fkMap: Record<string, string>;
            attachmentsFields: { dbFieldName: string; id: string }[];
            notNullFieldMap: Map<string, { dbFieldType: string; isMultipleCellValue: boolean }>;
            fieldDbNameMap: Map<string, string>;
          },
          excludeDbFieldNames: string[]
        ) => Promise<void>;
        prismaService: typeof prismaService;
        dbProvider: {
          getForeignKeysInfo: ReturnType<typeof vi.fn>;
          columnInfo: ReturnType<typeof vi.fn>;
        };
        dataDbClientManager: typeof dataDbClientManager;
      };
      Object.assign(processor, { recordMutationPolicy: new RecordMutationPolicyService() });

      processor.prismaService = prismaService;
      processor.dbProvider = {
        getForeignKeysInfo: vi.fn().mockReturnValue('SELECT * FROM foreign_keys'),
        columnInfo: vi.fn().mockReturnValue('SELECT * FROM columns'),
      };
      processor.dataDbClientManager = dataDbClientManager;
      const persistRecordCreateOperationAudit = vi.fn(async (_tableId, _count, _ids, execute) =>
        execute('audit-journal')
      );
      Object.assign(processor, {
        audit: { emitAtomic: vi.fn().mockResolvedValue(undefined) },
        cls: { get: vi.fn(() => ({ type: 'appUser', id: 'apuCurrent' })) },
        recordActorStorageService: {
          withTableWrite: vi.fn(async (_id, callback) => callback({ actorStorageVersion })),
        },
        eventEmitterService: { persistRecordCreateOperationAudit },
      });

      await processor.handleChunk(
        [
          {
            __id: 'recImported',
            fldText: 'Imported value',
            __created_by_actor_type: 'user',
            __created_by_actor_id: 'forgedCreator',
            __last_modified_by_actor_type: 'user',
            __last_modified_by_actor_id: 'forgedModifier',
          },
        ],
        {
          baseId: 'bseImport',
          tableId: 'tblImport',
          userId: 'usrImport',
          fieldIdMap: {},
          viewIdMap: {},
          fkMap: {},
          attachmentsFields: [],
          notNullFieldMap: new Map(),
          fieldDbNameMap: new Map([['fldText', 'fldMappedText']]),
        },
        []
      );

      expect(executedSql.some((sql) => sql.includes('"bse_data"."tbl_imported"'))).toBe(true);
      // Base import inserts records only — it must not generate per-cell record history
      // (the v1 hot path that bloated each chunk transaction and timed out on large tables).
      expect(executedSql.some((sql) => sql.toLowerCase().includes('record_history'))).toBe(false);
      expect(persistRecordCreateOperationAudit).toHaveBeenCalledWith(
        'tblImport',
        1,
        ['recImported'],
        expect.any(Function)
      );
      expect(executedSql[executedSql.length - 1]).toBe('audit-journal');
      const inserted = executedSql.find((sql) => sql.includes('insert into'))!;
      expect(inserted).not.toContain('forgedCreator');
      expect(inserted).not.toContain('forgedModifier');
      if (actorStorageVersion === 1) {
        expect(inserted).toContain('apuCurrent');
        expect(inserted).toContain('__created_by_actor_type');
        expect(inserted).toContain('__last_modified_by_actor_id');
      } else {
        expect(inserted).not.toContain('_actor_');
      }

      await dataKnex.destroy();
    }
  );

  it('drops ghost columns missing from the target table instead of aborting the insert', async () => {
    const executedSql: string[] = [];
    const dataKnex = Knex({ client: 'pg' });
    const dataPrisma = {
      $queryRawUnsafe: vi
        .fn()
        // foreign keys info
        .mockResolvedValueOnce([])
        // columnInfo: the freshly-created table only has __id + fldText, NOT the ghost column
        .mockResolvedValueOnce([{ name: '__id' }, { name: 'fldText' }]),
      $executeRawUnsafe: vi.fn(async (sql: string) => {
        executedSql.push(sql);
        return 1;
      }),
    };
    const prismaService = {
      tableMeta: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ dbTableName: 'bse_data.tbl_imported' }),
      },
      txClient: vi.fn().mockReturnValue({
        attachmentsTable: { createMany: vi.fn().mockResolvedValue(undefined) },
      }),
    };
    const dataDbClientManager = {
      dataPrismaForBase: vi.fn().mockResolvedValue(dataPrisma),
      dataKnexForBase: vi.fn().mockResolvedValue(dataKnex),
      getDataDatabaseForBase: vi.fn().mockResolvedValue({
        url: 'postgresql://user:pass@example.test:5432/data?schema=teable_internal',
      }),
    };
    const processor = Object.create(BaseImportCsvQueueProcessor.prototype) as {
      handleChunk: (
        results: Record<string, unknown>[],
        config: Record<string, unknown>,
        excludeDbFieldNames: string[]
      ) => Promise<void>;
      prismaService: typeof prismaService;
      dbProvider: {
        getForeignKeysInfo: ReturnType<typeof vi.fn>;
        columnInfo: ReturnType<typeof vi.fn>;
      };
      dataDbClientManager: typeof dataDbClientManager;
    };
    Object.assign(processor, { recordMutationPolicy: new RecordMutationPolicyService() });

    processor.prismaService = prismaService;
    processor.dbProvider = {
      getForeignKeysInfo: vi.fn().mockReturnValue('SELECT * FROM foreign_keys'),
      columnInfo: vi.fn().mockReturnValue('SELECT * FROM columns'),
    };
    processor.dataDbClientManager = dataDbClientManager;
    Object.assign(processor, {
      audit: { emitAtomic: vi.fn().mockResolvedValue(undefined) },
      cls: { get: vi.fn() },
      recordActorStorageService: {
        withTableWrite: vi.fn(async (_id, callback) => callback({ actorStorageVersion: 0 })),
      },
      eventEmitterService: {
        persistRecordCreateOperationAudit: vi.fn(async (_tableId, _count, _ids, execute) =>
          execute('audit-journal')
        ),
      },
    });

    await processor.handleChunk(
      // fldGhost is an orphan physical column dumped into the .tea CSV with no matching field
      [{ __id: 'recImported', fldText: 'Imported value', fldGhost: 'orphan value' }],
      {
        baseId: 'bseImport',
        tableId: 'tblImport',
        userId: 'usrImport',
        fieldIdMap: {},
        viewIdMap: {},
        fkMap: {},
        attachmentsFields: [],
        notNullFieldMap: new Map(),
        fieldDbNameMap: new Map([['fldText', 'fldMappedText']]),
      },
      []
    );

    const dataInsert = executedSql.find((sql) => sql.includes('"bse_data"."tbl_imported"'));
    expect(dataInsert).toBeDefined();
    expect(dataInsert).toContain('"fldText"');
    expect(dataInsert).not.toContain('fldGhost');

    await dataKnex.destroy();
  });
});

describe('Import terminal finalization', () => {
  const data = {
    path: 'owned.tea',
    baseId: 'bseTarget',
    userId: 'usrImporter',
    tableIdMap: { source: 'target' },
    fieldIdMap: {},
    viewIdMap: {},
    operationId: 'owned-operation',
    hostResourceIdMaps: { appIdMap: { source: 'newApp' } },
    structure: { tables: [] },
  };

  it('awaits host finalization and propagates listener failure while allowing retry', async () => {
    const emitter = new EventEmitter2();
    const failure = new Error('binding activation failed');
    let finish!: () => void;
    const blocked = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let fail = true;
    emitter.on(BASE_IMPORT_DATA_COMPLETE, async (completion) => {
      expect(completion).toMatchObject(data);
      expect(recomputeForTables).toHaveBeenCalled();
      await blocked;
      if (fail) throw failure;
    });
    const recomputeForTables = vi.fn();
    const importJunctionChunk = vi.fn(async () => ({ skippedCells: 0, junctions: new Set() }));
    const processor = Object.create(
      BaseImportJunctionCsvQueueProcessor.prototype
    ) as BaseImportJunctionCsvQueueProcessor;
    Object.assign(processor, {
      prismaService: { base: { findUniqueOrThrow: vi.fn(async () => ({ v2Enabled: false })) } },
      eventEmitter: emitter,
      processedJobs: new Set(),
      importJunctionChunk,
      getImportedLinks: vi.fn(async () => []),
      clearDanglingLinks: vi.fn(async () => 0),
      cls: new ClsService<IClsStore>(new AsyncLocalStorage()),
      notificationService: { sendCommonNotify: vi.fn() },
      persistedComputedBackfillService: { recomputeForTables },
      logger: { log: vi.fn(), error: vi.fn() },
    });
    let settled = false;
    const pending = processor.process({ id: 'owned-job', data } as never).finally(() => {
      settled = true;
    });
    const caught = pending.catch((error) => error);
    await new Promise((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    finish();
    expect((await caught).message).toBe('Base import relationship restoration failed');
    fail = false;
    await processor.process({ id: 'owned-job', data } as never);
    expect(importJunctionChunk).toHaveBeenCalledTimes(2);
    expect(recomputeForTables).toHaveBeenCalledTimes(2);
  });

  it('propagates junction failure without activating and clears its failed-job marker', async () => {
    const emitter = new EventEmitter2();
    const activate = vi.fn();
    emitter.on(BASE_IMPORT_DATA_COMPLETE, activate);
    const failure = new Error('junction insert failed');
    const importJunctionChunk = vi
      .fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValue({ skippedCells: 0, junctions: new Set() });
    const processor = Object.create(
      BaseImportJunctionCsvQueueProcessor.prototype
    ) as BaseImportJunctionCsvQueueProcessor;
    Object.assign(processor, {
      prismaService: { base: { findUniqueOrThrow: vi.fn(async () => ({ v2Enabled: false })) } },
      eventEmitter: emitter,
      processedJobs: new Set(),
      importJunctionChunk,
      getImportedLinks: vi.fn(async () => []),
      clearDanglingLinks: vi.fn(async () => 0),
      cls: new ClsService<IClsStore>(new AsyncLocalStorage()),
      notificationService: { sendCommonNotify: vi.fn() },
      persistedComputedBackfillService: { recomputeForTables: vi.fn() },
      logger: { log: vi.fn(), error: vi.fn() },
    });
    await expect(processor.process({ id: 'owned-job', data } as never)).rejects.toThrow(
      'Base import relationship restoration failed'
    );
    expect(activate).not.toHaveBeenCalled();
    await processor.process({ id: 'owned-job', data } as never);
    expect(activate).toHaveBeenCalledOnce();
    expect(importJunctionChunk).toHaveBeenCalledTimes(2);
  });

  it('short-circuits an owner-proved completed redelivery before any mutation', async () => {
    const emitter = new EventEmitter2();
    emitter.on(BASE_IMPORT_DATA_STATUS, () => true);
    const handleBaseImportCsv = vi.fn();
    const processor = Object.create(
      BaseImportCsvQueueProcessor.prototype
    ) as BaseImportCsvQueueProcessor;
    Object.assign(processor, { eventEmitter: emitter, handleBaseImportCsv });
    await processor.process({
      id: 'already-activated',
      data: { ...data, logId: data.operationId },
    } as never);
    expect(handleBaseImportCsv).not.toHaveBeenCalled();
  });
});

describe('Junction import persistence', () => {
  it('rejects a failed insert even when the destination has no foreign keys', async () => {
    const failure = new Error('raw junction insert failed');
    const knex = Knex({ client: 'pg' });
    const processor = Object.create(BaseImportJunctionCsvQueueProcessor.prototype) as {
      handleJunctionChunk: (baseId: string, rows: object[], tableName: string) => Promise<void>;
    };
    Object.assign(processor, {
      cls: new ClsService<IClsStore>(new AsyncLocalStorage()),
      dataDbClientManager: {
        dataPrismaForBase: async () => ({
          $queryRawUnsafe: async () => [],
          $executeRawUnsafe: async () => {
            throw failure;
          },
        }),
        dataKnexForBase: async () => knex,
      },
      dbProvider: { getForeignKeysInfo: () => 'foreign-keys' },
      logger: { error: vi.fn() },
    });
    try {
      await expect(
        processor.handleJunctionChunk(
          'bseTarget',
          [{ left: 'a', right: 'b' }],
          'base.junction_owned'
        )
      ).rejects.toBe(failure);
    } finally {
      await knex.destroy();
    }
  });

  it('synchronously drains embedded app ZIP entries before parsing junction completion', async () => {
    const archive = archiver('zip', { zlib: { level: 6 } });
    // Exported app archives are opaque ZIP bytes, not table CSV streams.
    archive.append(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xff, 0xff]), {
      name: 'apps/appOwned/version.zip',
    });
    archive.append('__id,Name\nrec1,ordinary', { name: 'tables/tblOrdinary.csv' });
    void archive.finalize();
    const processor = Object.create(BaseImportJunctionCsvQueueProcessor.prototype) as {
      readArchive: (path: string, select: () => undefined) => Promise<void>;
    };
    Object.assign(processor, {
      storageAdapter: { downloadFile: async () => archive },
    });
    await expect(processor.readArchive('owned.tea', () => undefined)).resolves.toBeUndefined();
  });
});

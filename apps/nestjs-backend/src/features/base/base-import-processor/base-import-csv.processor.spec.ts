/* eslint-disable @typescript-eslint/naming-convention */
import { AsyncLocalStorage } from 'node:async_hooks';
import { PassThrough } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import { FieldType } from '@teable/core';
import type { IBaseJson } from '@teable/openapi';
import archiver from 'archiver';
import Knex from 'knex';
import { ClsService } from 'nestjs-cls';
import type { Mock } from 'vitest';
import { vi } from 'vitest';

import { BaseImportCsvQueueProcessor } from './base-import-csv.processor';

const createCsvZipStream = (entries: Record<string, string>) => {
  const archive = archiver('zip', { zlib: { level: 0 } });
  for (const [name, content] of Object.entries(entries)) {
    archive.append(content, { name });
  }
  void archive.finalize();
  return archive;
};

describe('BaseImportCsvQueueProcessor', () => {
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
      cls: ClsService;
      prismaService: { base: { findUniqueOrThrow: ReturnType<typeof vi.fn> } };
      persistedComputedBackfillService: { recomputeForTables: ReturnType<typeof vi.fn> };
      logger: { log: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
    };

    processor.cls = new ClsService(new AsyncLocalStorage());
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
      cls: ClsService;
      storageAdapter: { downloadFile: ReturnType<typeof vi.fn> };
      notificationService: { sendCommonNotify: ReturnType<typeof vi.fn> };
      prismaService: { base: { findUniqueOrThrow: ReturnType<typeof vi.fn> } };
      persistedComputedBackfillService: { recomputeForTables: ReturnType<typeof vi.fn> };
      logger: { log: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
    };
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
    processor.cls = new ClsService(new AsyncLocalStorage());
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

  it('does not write record history when importing base records', async () => {
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

    processor.prismaService = prismaService;
    processor.dbProvider = {
      getForeignKeysInfo: vi.fn().mockReturnValue('SELECT * FROM foreign_keys'),
      columnInfo: vi.fn().mockReturnValue('SELECT * FROM columns'),
    };
    processor.dataDbClientManager = dataDbClientManager;
    Object.assign(processor, {
      audit: { emitAtomic: vi.fn().mockResolvedValue(undefined) },
      cls: { get: vi.fn() },
    });

    await processor.handleChunk(
      [{ __id: 'recImported', fldText: 'Imported value' }],
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

    await dataKnex.destroy();
  });

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

    processor.prismaService = prismaService;
    processor.dbProvider = {
      getForeignKeysInfo: vi.fn().mockReturnValue('SELECT * FROM foreign_keys'),
      columnInfo: vi.fn().mockReturnValue('SELECT * FROM columns'),
    };
    processor.dataDbClientManager = dataDbClientManager;
    Object.assign(processor, {
      audit: { emitAtomic: vi.fn().mockResolvedValue(undefined) },
      cls: { get: vi.fn() },
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

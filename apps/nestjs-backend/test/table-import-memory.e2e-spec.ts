import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import type { INestApplication } from '@nestjs/common';
import { FieldType } from '@teable/core';
import {
  createBase,
  createSpace,
  createTable,
  deleteBase,
  getSignature,
  importTableFromFile,
  inplaceImportTableFromFile,
  notify,
  SUPPORTEDTYPE,
  uploadFile,
  UploadType,
} from '@teable/openapi';
import {
  type ICsvParser,
  type IImportSourceRegistry,
  type IRealtimeEngine,
  type ITableRepository,
  getUnitOfWorkTransaction,
  RecordsBatchCreated,
  v2CoreTokens,
} from '@teable/v2-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CsvImporter } from '../src/features/import/open-api/import.class';
import { V2ContainerService } from '../src/features/v2/v2-container.service';
import { ShareDbService } from '../src/share-db/share-db.service';
import { collectActionTriggers } from './utils/action-trigger';
import { getRecords, initApp, permanentDeleteTable } from './utils/init-app';

const mib = 1024 * 1024;
const runFile = promisify(execFile);
type Format = 'csv' | 'tsv' | 'xlsx' | 'xls';
const contentTypes: Record<Format, string> = {
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
};
const columns = [
  { name: 'Name', type: FieldType.SingleLineText, sourceColumnIndex: 0 },
  { name: 'Payload', type: FieldType.LongText, sourceColumnIndex: 1 },
  { name: 'Amount', type: FieldType.Number, sourceColumnIndex: 2 },
];

const expectImportedRecords = async (tableId: string, total: number, finalAmount: number) => {
  const [first, last, pastEnd] = await Promise.all([
    getRecords(tableId, { take: 1, skip: 0 }),
    getRecords(tableId, { take: 1, skip: total - 1 }),
    getRecords(tableId, { take: 1, skip: total }),
  ]);
  expect(first.records[0].fields).toMatchObject({
    Name: 'row-00000001',
    Payload: `00000001${'x'.repeat(2040)}`,
    Amount: 1,
  });
  expect(last.records[0].fields).toMatchObject({
    Name: `row-${String(finalAmount).padStart(8, '0')}`,
    Payload: `${String(finalAmount).padStart(8, '0')}${'x'.repeat(2040)}`,
    Amount: finalAmount,
  });
  expect(pastEnd.records).toEqual([]);
};

// Explicit major collection after a new turn makes WeakRef liveness meaningful.
// No --expose-gc requirement is hidden in the command needed to run this spec.
setFlagsFromString('--expose-gc');
const collectGarbage = runInNewContext('gc') as () => void;
const retainedHeap = async () => {
  await setImmediate();
  collectGarbage();
  await setImmediate();
  collectGarbage();
  return process.memoryUsage().heapUsed;
};

const uploadSyntheticFile = async (format: Format, rowCount: number): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'teable-import-memory-'));
  const path = join(directory, `synthetic.${format}`);
  try {
    // Fixture generation is isolated from the measured server process, including
    // the high-cardinality XLS/XLSX workbook used only by the fixture encoder.
    await runFile(process.execPath, [
      fileURLToPath(
        new URL('../../../packages/v2/e2e/src/shared/importMemoryFixture.mjs', import.meta.url)
      ),
      path,
      format,
      String(rowCount),
    ]);
    const { size } = await stat(path);
    const { token, requestHeaders } = (
      await getSignature({
        type: UploadType.Import,
        contentLength: size,
        contentType: contentTypes[format],
      })
    ).data;
    await uploadFile(token, createReadStream(path), requestHeaders);
    return (await notify(token, undefined, `synthetic.${format}`)).data.presignedUrl;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

describe('T7528 product HTTP import retained memory', () => {
  let app: INestApplication;
  let cookie: string;
  let baseId: string;
  const tableIds: string[] = [];
  const previousForceV2 = process.env.FORCE_V2_ALL;

  beforeAll(async () => {
    process.env.FORCE_V2_ALL = 'true';
    const appContext = await initApp();
    app = appContext.app;
    cookie = appContext.cookie;
    const space = (await createSpace({ name: 'T7528 synthetic memory regression' })).data;
    baseId = (await createBase({ spaceId: space.id })).data.id;
  }, 120_000);

  afterAll(async () => {
    try {
      for (const tableId of tableIds) await permanentDeleteTable(baseId, tableId);
      if (baseId) await deleteBase(baseId);
      await app?.close();
    } finally {
      if (previousForceV2 === undefined) delete process.env.FORCE_V2_ALL;
      else process.env.FORCE_V2_ALL = previousForceV2;
    }
  }, 120_000);

  it.each([999, 1000, 1001])(
    'preserves bulk realtime and action-trigger behavior for %i streamed append rows',
    async (rowCount) => {
      const table = (
        await createTable(baseId, {
          name: `T7528 bulk boundary ${rowCount}`,
          fields: columns.map(({ name, type }) => ({ name, type })),
          records: [],
        })
      ).data;
      tableIds.push(table.id);
      const attachmentUrl = await uploadSyntheticFile('csv', rowCount);
      const container = await app.get(V2ContainerService).getContainerForBase(baseId);
      const realtime = container.resolve<IRealtimeEngine>(v2CoreTokens.realtimeEngine);
      const originalEnsure = realtime.ensure;
      let ensuredRecords = 0;
      realtime.ensure = async (context, docId, initial, options) => {
        if (docId.toString().startsWith(`rec_${table.id}/`)) ensuredRecords++;
        return originalEnsure.call(realtime, context, docId, initial, options);
      };
      try {
        const actions = await collectActionTriggers({
          shareDbService: app.get(ShareDbService),
          cookie,
          port: process.env.PORT!,
          tableId: table.id,
          timeoutMs: 30_000,
          act: () =>
            inplaceImportTableFromFile(baseId, table.id, {
              attachmentUrl,
              fileType: SUPPORTEDTYPE.CSV,
              insertConfig: {
                sourceWorkSheetKey: CsvImporter.DEFAULT_SHEETKEY,
                sourceColumnMap: Object.fromEntries(
                  table.fields.map((field, index) => [field.id, index])
                ),
                excludeFirstRow: true,
              },
            }),
        });
        const additions = actions.filter((action) => action.actionKey === 'addRecord');
        expect(ensuredRecords).toBe(rowCount < 1000 ? rowCount : 0);
        if (rowCount < 1000) {
          expect(additions).toContainEqual({ actionKey: 'addRecord' });
          expect(additions.every((action) => action.payload === undefined)).toBe(true);
        } else {
          const notifiedIds = new Set<string>();
          for (const action of additions) {
            expect(action.payload).toMatchObject({
              tableId: table.id,
              skipRealtime: true,
              totalRecordCount: rowCount,
              totalChunkCount: Math.ceil(rowCount / 500),
              scope: 'chunk',
            });
            for (const id of action.payload!.recordIds as string[]) notifiedIds.add(id);
          }
          expect(notifiedIds.size).toBe(rowCount);
        }
        await expectImportedRecords(table.id, rowCount, rowCount);
      } finally {
        realtime.ensure = originalEnsure;
      }
    },
    120_000
  );

  it.each([1000, 1001])(
    'POST /api/import/:baseId emits finalized bulk addRecord notifications for %i new-table rows',
    async (rowCount) => {
      const attachmentUrl = await uploadSyntheticFile('csv', rowCount);
      const container = await app.get(V2ContainerService).getContainerForBase(baseId);
      const repository = container.resolve<ITableRepository>(v2CoreTokens.tableRepository);
      const realtime = container.resolve<IRealtimeEngine>(v2CoreTokens.realtimeEngine);
      const originalReady = repository.setProvisionState;
      if (!originalReady) throw new Error('Product table repository must support provision state');
      const originalEnsure = realtime.ensure;
      const tableName = `T7528 new-table bulk ${rowCount}`;
      let notifyReady!: (tableId: string) => void;
      let releaseDelivery!: () => void;
      const ready = new Promise<string>((resolve) => {
        notifyReady = resolve;
      });
      const delivery = new Promise<void>((resolve) => {
        releaseDelivery = resolve;
      });
      let importedId: string | undefined;
      let ensuredRecords = 0;

      // The new table ID is server-generated. Subscribe after real data/metadata commit,
      // but before the transaction owner releases post-commit realtime/notification events.
      repository.setProvisionState = async (...args) => {
        const result = await originalReady.apply(repository, args);
        const [context, table, state] = args;
        if (result.isOk() && state === 'ready' && table.name().toString() === tableName) {
          const transaction = getUnitOfWorkTransaction(context, 'meta');
          if (!transaction?.afterCommit) throw new Error('Ready state must be transaction-bound');
          transaction.afterCommit(async () => {
            importedId = table.id().toString();
            tableIds.push(importedId);
            notifyReady(importedId);
            await delivery;
          });
        }
        return result;
      };
      realtime.ensure = async (context, docId, initial, options) => {
        if (importedId && docId.toString().startsWith(`rec_${importedId}/`)) ensuredRecords++;
        return originalEnsure.call(realtime, context, docId, initial, options);
      };
      const request = importTableFromFile(baseId, {
        attachmentUrl,
        fileType: SUPPORTEDTYPE.CSV,
        worksheets: {
          [CsvImporter.DEFAULT_SHEETKEY]: {
            name: tableName,
            columns,
            useFirstRowAsHeader: true,
            importData: true,
          },
        },
        tz: 'UTC',
      });
      try {
        const tableId = await Promise.race([
          ready,
          request.then(() => {
            throw new Error('Import completed without the ready-state barrier');
          }),
        ]);
        const actions = await collectActionTriggers({
          shareDbService: app.get(ShareDbService),
          cookie,
          port: process.env.PORT!,
          tableId,
          timeoutMs: 30_000,
          act: async () => {
            releaseDelivery();
            const response = await request;
            expect(response.headers['x-teable-v2']).toBe('true');
          },
        });
        expect(ensuredRecords).toBe(0);
        const additions = actions.filter((action) => action.actionKey === 'addRecord');
        const totalChunks = Math.ceil(rowCount / 500);
        expect(additions.map((action) => action.payload?.chunkIndex)).toEqual(
          Array.from({ length: totalChunks }, (_, index) => index)
        );
        const recordIds: string[] = [];
        for (const action of additions) {
          expect(action.payload).toMatchObject({
            tableId,
            skipRealtime: true,
            totalRecordCount: rowCount,
            totalChunkCount: totalChunks,
            scope: 'chunk',
            operationId: `import-csv:${tableId}`,
          });
          recordIds.push(...(action.payload!.recordIds as string[]));
        }
        const persistedIds: string[] = [];
        for (let skip = 0; skip < rowCount; skip += 500) {
          const page = await getRecords(tableId, { take: 500, skip });
          persistedIds.push(...page.records.map((record) => record.id));
        }
        expect(persistedIds).toHaveLength(rowCount);
        expect(recordIds.sort()).toEqual(persistedIds.sort());
        expect(
          additions.filter((action) => action.payload?.chunkIndex === totalChunks - 1)
        ).toHaveLength(1);
        await expectImportedRecords(tableId, rowCount, rowCount);
      } finally {
        releaseDelivery();
        await request.catch(() => undefined);
        repository.setProvisionState = originalReady;
        realtime.ensure = originalEnsure;
      }
    },
    120_000
  );

  const observeSourceImport = async (
    format: Format,
    rowCount: number,
    run: () => Promise<void>
  ) => {
    const container = await app.get(V2ContainerService).getContainerForBase(baseId);
    const registry = container.resolve<IImportSourceRegistry>(v2CoreTokens.importSourceRegistry);
    const adapterResult = registry.getAdapter(format);
    if (adapterResult.isErr()) throw new Error(adapterResult.error.message);
    const adapter = adapterResult.value;
    const originalParse = adapter.parse;
    const originalCreate = RecordsBatchCreated.create;
    let eventSnapshot: WeakRef<object> | undefined;
    let eventSnapshotAlive: boolean | undefined;
    let earlierRowAlive: boolean | undefined;
    let sampled = false;
    let peakMiB = 0;
    const baselineMiB = (await retainedHeap()) / mib;
    RecordsBatchCreated.create = (params) => {
      const event = originalCreate(params);
      // Observe a complete early snapshot, not the intentionally retained
      // 500-row type-inference sample or its shared string values.
      if (!eventSnapshot && event.records[0]) eventSnapshot = new WeakRef(event.records[0]);
      return event;
    };
    adapter.parse = async (source, options) => {
      const parsed = await originalParse.call(adapter, source, options);
      return parsed.map((result) => ({
        ...result,
        rowsAsync: (async function* () {
          let count = 0;
          let earlierRow: WeakRef<ReadonlyArray<unknown>> | undefined;
          for await (const row of result.rowsAsync ?? result.rows ?? []) {
            count++;
            // Exclude both the 500-row inference sample and the immediately
            // previous batch retained by a suspended batching generator.
            if (count === 502) earlierRow = new WeakRef(row);
            if (count === 1 || count === rowCount) {
              sampled = true;
              peakMiB = Math.max(peakMiB, (await retainedHeap()) / mib);
              if (count === rowCount) {
                earlierRowAlive = earlierRow?.deref() !== undefined;
                if (eventSnapshot) eventSnapshotAlive = eventSnapshot.deref() !== undefined;
              }
            }
            yield row;
          }
        })(),
      }));
    };
    try {
      await run();
      expect(sampled, `${format} product entry must consume the real streaming adapter`).toBe(true);
      expect(earlierRowAlive, `${format} consumed adapter rows must be released`).toBe(false);
      expect(
        eventSnapshotAlive,
        `${format} complete event snapshots must be released before commit`
      ).toBe(false);
      return { rows: rowCount, retainedMiB: peakMiB - baselineMiB };
    } finally {
      adapter.parse = originalParse;
      RecordsBatchCreated.create = originalCreate;
    }
  };

  it('POST /api/import/:baseId releases earlier batches while a 10x input is still importing', async () => {
    const attachmentUrl = await uploadSyntheticFile('csv', 20_000);
    const container = await app.get(V2ContainerService).getContainerForBase(baseId);
    const parser = container.resolve<ICsvParser>(v2CoreTokens.csvParser);
    const originalParseAsync = parser.parseAsync;
    if (!originalParseAsync) throw new Error('The product import must use an asynchronous parser');
    let earlierRow: WeakRef<Record<string, string>> | undefined;
    let earlierRowStillAlive: boolean | undefined;
    const samples: Array<{ rows: number; heapMiB: number }> = [];

    // Observe the real port's output; never replace parsing, persistence, events,
    // or computations. Avoid vi.spyOn: mock call/result logs retain object graphs.
    parser.parseAsync = async (source, options) => {
      const parsed = await originalParseAsync.call(parser, source, options);
      return parsed.map((value) => ({
        ...value,
        rowsAsync: (async function* () {
          let count = 0;
          for await (const row of value.rowsAsync ?? value.rows) {
            count++;
            // The first 500 rows are deliberately retained for type inference.
            // Observe a later completed batch, not that bounded sample.
            if (count === 1001) earlierRow = new WeakRef(row);
            if (count === 2000 || count === 20_000) {
              samples.push({ rows: count, heapMiB: (await retainedHeap()) / mib });
              if (count === 20_000) earlierRowStillAlive = earlierRow?.deref() !== undefined;
            }
            yield row;
          }
        })(),
      }));
    };

    try {
      const response = await importTableFromFile(baseId, {
        attachmentUrl,
        fileType: SUPPORTEDTYPE.CSV,
        worksheets: {
          [CsvImporter.DEFAULT_SHEETKEY]: {
            name: 'T7528 memory',
            columns: [
              { name: 'Name', type: FieldType.SingleLineText, sourceColumnIndex: 0 },
              { name: 'Payload', type: FieldType.LongText, sourceColumnIndex: 1 },
              { name: 'Amount', type: FieldType.Number, sourceColumnIndex: 2 },
            ],
            useFirstRowAsHeader: true,
            importData: true,
          },
        },
        tz: 'UTC',
      });
      tableIds.push(...response.data.map((table) => table.id));
      expect(response.headers['x-teable-v2']).toBe('true');
      expect(samples.map((sample) => sample.rows)).toEqual([2000, 20_000]);
      console.info('T7528 active product HTTP import retained heap', samples);
      expect(
        earlierRowStillAlive,
        `Consumed row 1001 is still strongly retained at row 20000; active heap samples: ${JSON.stringify(samples)}`
      ).toBe(false);
      expect(
        samples[1].heapMiB - samples[0].heapMiB,
        '10x input at fixed row width and 500-record batches must not retain the additional 36 MiB of row payloads'
      ).toBeLessThan(16);
    } finally {
      parser.parseAsync = originalParseAsync;
    }
  }, 240_000);

  it.each(['xlsx', 'xls'] as const)(
    'POST /api/import/:baseId keeps %s workbook, rows, and event snapshots bounded at 10x input',
    async (format) => {
      const measurements: Array<{ rows: number; retainedMiB: number }> = [];
      for (const rows of [2000, 20_000]) {
        const attachmentUrl = await uploadSyntheticFile(format, rows);
        measurements.push(
          await observeSourceImport(format, rows, async () => {
            const response = await importTableFromFile(baseId, {
              attachmentUrl,
              fileType: SUPPORTEDTYPE.EXCEL,
              worksheets: {
                Data: {
                  name: `T7528 ${format} ${rows}`,
                  columns,
                  useFirstRowAsHeader: true,
                  importData: true,
                },
              },
              tz: 'UTC',
            });
            tableIds.push(...response.data.map((table) => table.id));
            expect(response.headers['x-teable-v2']).toBe('true');
            await expectImportedRecords(response.data[0].id, rows, rows);
          })
        );
      }
      console.info(`T7528 product new-table ${format} retained heap`, measurements);
      expect(measurements[1].retainedMiB - measurements[0].retainedMiB).toBeLessThan(16);
    },
    360_000
  );

  // TXT is supported by the v2 registry/contract and covered in the companion
  // v2 test. The existing product analyze endpoint intentionally rejects TXT.
  it.each(['csv', 'tsv', 'xlsx', 'xls'] as const)(
    'PATCH /api/import/:baseId/:tableId keeps %s rows and event snapshots bounded at 10x input',
    async (format) => {
      const table = (
        await createTable(baseId, {
          name: `T7528 append ${format}`,
          fields: columns.map(({ name, type }) => ({ name, type })),
          records: [],
        })
      ).data;
      tableIds.push(table.id);
      const sourceColumnMap = Object.fromEntries(
        table.fields.map((field, index) => [field.id, index])
      );
      const measurements: Array<{ rows: number; retainedMiB: number }> = [];
      for (const rows of [2000, 20_000]) {
        const attachmentUrl = await uploadSyntheticFile(format, rows);
        measurements.push(
          await observeSourceImport(format, rows, async () => {
            const response = await inplaceImportTableFromFile(baseId, table.id, {
              attachmentUrl,
              fileType:
                format === 'xlsx' || format === 'xls' ? SUPPORTEDTYPE.EXCEL : SUPPORTEDTYPE.CSV,
              insertConfig: {
                sourceWorkSheetKey:
                  format === 'xlsx' || format === 'xls' ? 'Data' : CsvImporter.DEFAULT_SHEETKEY,
                sourceColumnMap,
                excludeFirstRow: true,
              },
            });
            expect(response.headers['x-teable-v2']).toBe('true');
          })
        );
      }
      await expectImportedRecords(table.id, 22_000, 20_000);
      console.info(`T7528 product append ${format} retained heap`, measurements);
      expect(measurements[1].retainedMiB - measurements[0].retainedMiB).toBeLessThan(16);
    },
    360_000
  );
});

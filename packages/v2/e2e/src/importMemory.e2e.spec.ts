import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { setImmediate } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import {
  type ICsvParser,
  type IDomainEvent,
  type IExecutionContext,
  EventHandler,
  RecordCreated,
  RecordsBatchCreated,
  ok,
  type IImportSourceRegistry,
  type ITableRecordRepository,
  type TableRecord,
  isInsertManyStreamBatch,
  isRecordCreatedEvent,
  isRecordsBatchCreatedEvent,
  v2CoreTokens,
} from '@teable/v2-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';
let observePublished: (events: ReadonlyArray<IDomainEvent>) => void = () => undefined;

class ImportMemoryEventConsumer {
  async handle(_context: IExecutionContext, event: IDomainEvent) {
    observePublished([event]);
    return ok(undefined);
  }
}
// A real post-commit consumer, not MemoryEventBus's retaining test event log.
// Registration precedes container catalog compilation just like production.
EventHandler(RecordsBatchCreated)(ImportMemoryEventConsumer);
EventHandler(RecordCreated)(ImportMemoryEventConsumer);

const mib = 1024 * 1024;
const runFile = promisify(execFile);
setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc') as () => void;
const heap = async () => {
  await setImmediate();
  gc();
  await setImmediate();
  gc();
  return process.memoryUsage().heapUsed / mib;
};
const formats = ['csv', 'tsv', 'txt', 'xlsx', 'xls'] as const;
type Format = (typeof formats)[number];
const payload = (index: number) => `${String(index).padStart(8, '0')}${'x'.repeat(2040)}`;
const name = (index: number) => `row-${String(index).padStart(8, '0')}`;

const fixtureServer = async (format: Format, rows: number, columnCount = 3) => {
  const directory = await mkdtemp(join(tmpdir(), 'teable-v2-import-memory-'));
  const path = join(directory, `synthetic.${format}`);
  try {
    await runFile(process.execPath, [
      fileURLToPath(new URL('./shared/importMemoryFixture.mjs', import.meta.url)),
      path,
      format,
      String(rows),
      String(columnCount),
    ]);
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/octet-stream' });
    void pipeline(createReadStream(path, { highWaterMark: 32 * 1024 }), response).catch(() => {
      response.destroy();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/synthetic.${format}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await rm(directory, { recursive: true, force: true });
    },
  };
};

// This is the v2 HTTP contract, not the Nest /api/import product controller.
// The companion backend table-import-memory.e2e-spec.ts covers that entrypoint.
describe('T7528 v2 HTTP import bounded retained memory', () => {
  let ctx: SharedTestContext;
  let restoreCollectors: () => void;

  const installBoundedCollectors = () => {
    const { eventBus, spyLogger } = ctx.testContainer;
    const originalRecordPublished = eventBus.recordPublished;
    const originalCapture = spyLogger.capture;
    // These two test-only collectors normally retain every payload/SQL parameter.
    // Keep real durable writes and handler dispatch; replace only their recording.
    eventBus.recordPublished = () => undefined;
    spyLogger.capture = () => undefined;
    ctx.clearLogs();
    ctx.testContainer.container.registerInstance(
      ImportMemoryEventConsumer,
      new ImportMemoryEventConsumer()
    );
    restoreCollectors = () => {
      eventBus.recordPublished = originalRecordPublished;
      spyLogger.capture = originalCapture;
    };
  };

  afterAll(() => restoreCollectors?.());

  beforeAll(async () => {
    // The lifetime proof only observes WeakRef liveness, not PGlite storage size.
    // It can establish the real HTTP red gate without a Docker/Postgres service.
    ctx = await getSharedTestContext();
    installBoundedCollectors();
  }, 120_000);

  it('imports an ambiguous multiline CSV through HTTP without splitting its quoted field', async () => {
    const note = `${`${'x'.repeat(100)},y\n`.repeat(12)}${'z'.repeat(70_000)}`;
    const result = await ctx.importCsv({
      baseId: ctx.baseId,
      tableName: 'T7528 ambiguous replay',
      csvData: `name,full;note;age\nAlice;"${note}";30\nBob;last;40\n`,
      batchSize: 500,
    });
    try {
      expect(result.totalImported).toBe(2);
      expect(result.table.fields.map((field) => field.name)).toEqual(['name,full', 'note', 'age']);
      const records = await ctx.listRecords(result.table.id);
      expect(
        records.map((record) => result.table.fields.map((field) => record.fields[field.id]))
      ).toEqual([
        ['Alice', note, 30],
        ['Bob', 'last', 40],
      ]);
    } finally {
      await ctx.deleteTable(result.table.id, { mode: 'permanent' });
    }
  }, 120_000);

  it('enforces the whole-table creation limit beyond the streaming inference window', async () => {
    const csvData = `Name,Amount\n${'Synthetic,1\n'.repeat(20_001)}`;
    let recordEvents = 0;
    observePublished = (events) => {
      for (const event of events) {
        if (isRecordCreatedEvent(event) || isRecordsBatchCreatedEvent(event)) recordEvents++;
      }
    };
    try {
      const response = await fetch(`${ctx.baseUrl}/tables/importCsv`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: ctx.baseId,
          tableName: 'T7528 total row limit',
          csvData,
          batchSize: 500,
        }),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: 'validation.limit.create_table_records_max' },
      });
      expect(recordEvents).toBe(0);
      expect(await ctx.listTables({ q: 'T7528 total row limit' })).toEqual([]);
    } finally {
      observePublished = () => undefined;
    }
  }, 120_000);

  it.each([
    { phase: 'sampling', validRows: 0 },
    { phase: 'persisting batches', validRows: 1500 },
  ])(
    'returns a CSV validation error while $phase without publishing records',
    async ({ validRows }) => {
      let recordEvents = 0;
      observePublished = (events) => {
        for (const event of events) {
          if (isRecordCreatedEvent(event) || isRecordsBatchCreatedEvent(event)) recordEvents++;
        }
      };
      try {
        const response = await fetch(`${ctx.baseUrl}/tables/importCsv`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            baseId: ctx.baseId,
            tableName: 'T7528 invalid inline CSV',
            csvData: `Name,Age\n${'Warmup,20\n'.repeat(validRows)}Alice,30,unexpected`,
            batchSize: 500,
          }),
        });
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ error: { code: 'csv.parse_error' } });
        expect(recordEvents).toBe(0);
      } finally {
        observePublished = () => undefined;
      }
    }
  );

  it('returns a CSV validation error for an append parser failure without inserting rows', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'T7528 invalid append CSV',
      fields: [{ name: 'Name', type: 'singleLineText' }],
    });
    try {
      const response = await fetch(`${ctx.baseUrl}/tables/importRecords`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fileType: 'csv',
          csvData: 'Name\n"Alice',
          sourceColumnMap: { [table.fields[0].id]: 0 },
        }),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: 'csv.parse_error' } });
      expect(await ctx.listRecords(table.id)).toEqual([]);
    } finally {
      await ctx.deleteTable(table.id, { mode: 'permanent' });
    }
  });

  it('POST /tables/importCsv releases parsed rows and computed-seed records during the HTTP request', async () => {
    const source = await fixtureServer('csv', 3001);
    const container = ctx.testContainer.container;
    const parser = container.resolve<ICsvParser>(v2CoreTokens.csvParser);
    const originalParse = parser.parseAsync;
    if (!originalParse) throw new Error('The import parser must expose parseAsync');
    const repository = container.resolve<ITableRecordRepository>(
      v2CoreTokens.tableRecordRepository
    );
    const originalInsert = repository.insertManyStream;
    let rowRef: WeakRef<Record<string, string>> | undefined;
    let recordRef: WeakRef<TableRecord> | undefined;
    let rowsAlive: boolean | undefined;
    let recordsAlive: boolean | undefined;
    let activeHeap = 0;
    let importedTableId: string | undefined;
    const baselineHeap = await heap();

    parser.parseAsync = async (input, options) => {
      const result = await originalParse.call(parser, input, options);
      return result.map((parsed) => ({
        ...parsed,
        rowsAsync: (async function* () {
          let count = 0;
          for await (const row of parsed.rowsAsync ?? parsed.rows) {
            count++;
            if (count === 1001) rowRef = new WeakRef(row);
            if (count === 3000) {
              activeHeap = await heap();
              rowsAlive = rowRef?.deref() !== undefined;
              recordsAlive = recordRef?.deref() !== undefined;
            }
            yield row;
          }
        })(),
      }));
    };
    repository.insertManyStream = (context, table, batches, options) => {
      async function* observedBatches() {
        let count = 0;
        for await (const batch of batches) {
          count++;
          const records = isInsertManyStreamBatch(batch) ? batch.records : batch;
          if (count === 3) recordRef = new WeakRef(records[0]);
          yield batch;
        }
      }
      return originalInsert.call(repository, context, table, observedBatches(), options);
    };
    try {
      const result = await ctx.importCsv({
        baseId: ctx.baseId,
        csvUrl: source.url,
        tableName: 'T7528 HTTP lifetime',
        batchSize: 500,
      });
      importedTableId = result.table.id;
      expect(result.totalImported).toBe(3001);
      console.info('T7528 active HTTP import heap MiB', { baselineHeap, activeHeap });
      expect(rowsAlive, 'Consumed CSV rows must be collectible before import completion').toBe(
        false
      );
      expect(
        recordsAlive,
        'Earlier inserted TableRecord objects must not be retained as deferred computed seeds'
      ).toBe(false);
    } finally {
      parser.parseAsync = originalParse;
      repository.insertManyStream = originalInsert;
      await source.close();
      if (importedTableId) await ctx.deleteTable(importedTableId, { mode: 'permanent' });
    }
  }, 180_000);

  it.each(formats)(
    'POST /tables/importRecords keeps %s memory bounded at 10x input, with complete events and formulas',
    async (format) => {
      restoreCollectors();
      // Heap scaling needs a separate database process, not PGlite's JS heap.
      // Uses TEABLE_V2_TEST_DATABASE_URL, PRISMA_DATABASE_URL, DATABASE_URL,
      // or the existing Testcontainers default when no URL is supplied.
      ctx = await getSharedTestContext({ dbMode: 'postgres' });
      expect(
        /^postgres(?:ql)?:\/\//.test(ctx.testContainer.connectionString),
        'Heap scaling requires a separate real PostgreSQL process'
      ).toBe(true);
      installBoundedCollectors();
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: `T7528 ${format}`,
        fields: [
          { name: 'Name', type: 'singleLineText' },
          { name: 'Payload', type: 'longText' },
          { name: 'Amount', type: 'number' },
          { name: 'Optional', type: 'number' },
        ],
      });
      const nameId = table.fields.find((field) => field.name === 'Name')!.id;
      const payloadId = table.fields.find((field) => field.name === 'Payload')!.id;
      const amountId = table.fields.find((field) => field.name === 'Amount')!.id;
      const optionalId = table.fields.find((field) => field.name === 'Optional')!.id;
      const withFormula = await ctx.createField({
        baseId: ctx.baseId,
        tableId: table.id,
        field: { name: 'Doubled', type: 'formula', options: { expression: `{${amountId}} * 2` } },
      });
      const formulaId = withFormula.fields.find((field) => field.name === 'Doubled')!.id;
      const withOptionalFormula = await ctx.createField({
        baseId: ctx.baseId,
        tableId: table.id,
        field: {
          name: 'Missing input',
          type: 'formula',
          options: { expression: `IF({${optionalId}}, 'set', 'empty')` },
        },
      });
      const optionalFormulaId = withOptionalFormula.fields.find(
        (field) => field.name === 'Missing input'
      )!.id;
      const withRecordId = await ctx.createField({
        baseId: ctx.baseId,
        tableId: table.id,
        field: { name: 'Identity', type: 'formula', options: { expression: 'RECORD_ID()' } },
      });
      const identityId = withRecordId.fields.find((field) => field.name === 'Identity')!.id;
      const sentinel = await ctx.createRecord(table.id, {
        [nameId]: 'existing untouched',
        [payloadId]: 'existing payload',
        [amountId]: -1,
        [optionalId]: 7,
      });
      await ctx.drainOutbox();
      const registry = ctx.testContainer.container.resolve<IImportSourceRegistry>(
        v2CoreTokens.importSourceRegistry
      );
      const adapterResult = registry.getAdapter(format);
      if (adapterResult.isErr()) throw new Error(adapterResult.error.message);
      const adapter = adapterResult.value;
      const originalParse = adapter.parse;
      const measurements: Array<{ rows: number; retainedMiB: number }> = [];
      let eventRecords = 0;
      let eventAmountSum = 0;
      let wrongEventPayloads = 0;
      observePublished = (events) => {
        for (const event of events) {
          const records = isRecordsBatchCreatedEvent(event)
            ? event.records
            : isRecordCreatedEvent(event)
              ? [{ fields: event.fieldValues }]
              : [];
          for (const record of records) {
            const amount = record.fields.find((field) => field.fieldId === amountId)?.value;
            if (typeof amount !== 'number') continue;
            eventRecords++;
            eventAmountSum += amount;
            if (
              record.fields.find((field) => field.fieldId === payloadId)?.value !==
                payload(amount) ||
              record.fields.find((field) => field.fieldId === nameId)?.value !== name(amount)
            ) {
              wrongEventPayloads++;
            }
          }
        }
      };

      try {
        for (const rows of [2000, 20_000]) {
          const source = await fixtureServer(format, rows);
          let earlierRow: WeakRef<ReadonlyArray<unknown>> | undefined;
          let earlierRowAlive: boolean | undefined;
          let peakHeap = 0;
          let sampled = false;
          const baseline = await heap();
          adapter.parse = async (input, options) => {
            const parsed = await originalParse.call(adapter, input, options);
            return parsed.map((result) => ({
              ...result,
              rowsAsync: (async function* () {
                let count = 0;
                for await (const row of result.rowsAsync ?? result.rows ?? []) {
                  count++;
                  // The immediately previous rowBatch remains on the generator
                  // stack while the next 500-row batch is assembled. Observe
                  // batch two, not batch three at the 2000-row checkpoint.
                  if (count === 502) earlierRow = new WeakRef(row);
                  // Include initial eager/shared-string allocation as well as
                  // objects accumulated while earlier DB batches were inserted.
                  if (count === 1 || count === rows) {
                    peakHeap = Math.max(peakHeap, await heap());
                    sampled = true;
                    if (count === rows) earlierRowAlive = earlierRow?.deref() !== undefined;
                  }
                  yield row;
                }
              })(),
            }));
          };
          try {
            const result = await ctx.importRecords({
              tableId: table.id,
              fileType: format,
              url: source.url,
              sourceColumnMap: { [nameId]: 0, [payloadId]: 1, [amountId]: 2 },
              options: { batchSize: 500, typecast: true, sheetName: 'Data' },
            });
            expect(result.totalImported).toBe(rows);
            expect(sampled, 'HTTP import must consume the instrumented real row iterator').toBe(
              true
            );
            measurements.push({ rows, retainedMiB: peakHeap - baseline });
            expect(
              earlierRowAlive,
              `${format}: consumed row is retained until import completion`
            ).toBe(false);
          } finally {
            adapter.parse = originalParse;
            await source.close();
          }
        }
        expect(eventRecords).toBe(22_000);
        expect(eventAmountSum).toBe((2000 * 2001 + 20_000 * 20_001) / 2);
        expect(wrongEventPayloads, 'Committed events must keep all 2048 payload characters').toBe(
          0
        );
        await ctx.drainOutbox();
        const first = await ctx.listRecordsWithoutDrain(table.id, {
          limit: 2,
          sort: [{ fieldId: amountId, order: 'asc' }],
        });
        const last = await ctx.listRecordsWithoutDrain(table.id, {
          limit: 1,
          sort: [{ fieldId: amountId, order: 'desc' }],
        });
        expect(first[0]).toMatchObject({
          id: sentinel.id,
          fields: {
            [nameId]: 'existing untouched',
            [payloadId]: 'existing payload',
            [optionalId]: 7,
            [formulaId]: -2,
            [optionalFormulaId]: 'set',
            [identityId]: sentinel.id,
          },
        });
        expect(first[1].fields).toMatchObject({
          [nameId]: name(1),
          [payloadId]: payload(1),
          [formulaId]: 2,
          [optionalFormulaId]: 'empty',
          [identityId]: first[1].id,
        });
        expect(last[0].fields).toMatchObject({
          [nameId]: name(20_000),
          [payloadId]: payload(20_000),
          [formulaId]: 40_000,
          [optionalFormulaId]: 'empty',
          [identityId]: last[0].id,
        });
        console.info(`T7528 ${format} active HTTP memory`, measurements);
        expect(
          measurements[1].retainedMiB - measurements[0].retainedMiB,
          `${format}: 10x file input must not retain 36 MiB of extra cell data/workbook/events`
        ).toBeLessThan(16);
      } finally {
        adapter.parse = originalParse;
        observePublished = () => undefined;
        await ctx.deleteTable(table.id, { mode: 'permanent' });
      }
    },
    300_000
  );

  it('wide 80-column POST /tables/importRecords bounds retained heap across 10x rows and preserves every field at batch boundaries', async () => {
    restoreCollectors();
    ctx = await getSharedTestContext({ dbMode: 'postgres' });
    expect(
      /^postgres(?:ql)?:\/\//.test(ctx.testContainer.connectionString),
      'Wide-row heap scaling requires a separate real PostgreSQL process'
    ).toBe(true);
    installBoundedCollectors();
    const columnCount = 80;
    const source = await fixtureServer('csv', 20_001, columnCount);
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'T7528 wide 80-column input',
      fields: [
        { name: 'Name', type: 'singleLineText' },
        { name: 'Payload', type: 'longText' },
        { name: 'Amount', type: 'number' },
        ...Array.from({ length: columnCount - 3 }, (_, index) => ({
          name: `Field_${index + 3}`,
          type: 'singleLineText' as const,
        })),
      ],
    });
    const columnNames = [
      'Name',
      'Payload',
      'Amount',
      ...Array.from({ length: columnCount - 3 }, (_, index) => `Field_${index + 3}`),
    ];
    const fieldIds = columnNames.map(
      (column) => table.fields.find((field) => field.name === column)!.id
    );
    const sourceColumnMap = Object.fromEntries(fieldIds.map((id, index) => [id, index]));
    const registry = ctx.testContainer.container.resolve<IImportSourceRegistry>(
      v2CoreTokens.importSourceRegistry
    );
    const adapterResult = registry.getAdapter('csv');
    if (adapterResult.isErr()) throw new Error(adapterResult.error.message);
    const adapter = adapterResult.value;
    const originalParse = adapter.parse;
    const samples: Array<{ rows: number; retainedMiB: number }> = [];
    let earlierRow: WeakRef<ReadonlyArray<unknown>> | undefined;
    let earlierRowAlive: boolean | undefined;
    adapter.parse = async (input, options) => {
      const parsed = await originalParse.call(adapter, input, options);
      return parsed.map((result) => ({
        ...result,
        rowsAsync: (async function* () {
          let count = 0;
          for await (const row of result.rowsAsync ?? result.rows ?? []) {
            count++;
            if (count === 502) earlierRow = new WeakRef(row);
            if (count === 2000 || count === 20_000) {
              samples.push({ rows: count, retainedMiB: await heap() });
              if (count === 20_000) earlierRowAlive = earlierRow?.deref() !== undefined;
            }
            yield row;
          }
        })(),
      }));
    };
    try {
      const result = await ctx.importRecords({
        tableId: table.id,
        fileType: 'csv',
        url: source.url,
        sourceColumnMap,
        options: { batchSize: 500, typecast: true },
      });
      expect(result.totalImported).toBe(20_001);
      expect(samples.map((sample) => sample.rows)).toEqual([2000, 20_000]);
      expect(earlierRowAlive, 'Earlier 80-cell rows must be collectible during the import').toBe(
        false
      );
      console.info('T7528 wide-row active HTTP retained heap', samples);
      expect(
        samples[1].retainedMiB - samples[0].retainedMiB,
        'At fixed 80-column width and 500-row batches, field objects and SQL parameter values must not accumulate with 10x input'
      ).toBeLessThan(16);

      const expectedFields = (row: number) =>
        Object.fromEntries(
          fieldIds.map((id, column) => [
            id,
            column === 0
              ? name(row)
              : column === 1
                ? payload(row)
                : column === 2
                  ? row
                  : `r${String(row).padStart(8, '0')}-c${String(column).padStart(3, '0')}${'y'.repeat(18)}`,
          ])
        );
      // Read only four records, including both sides of the 500-row DB batch
      // boundary. Full 80-field equality detects dropped/reordered parameters.
      const sort = [{ fieldId: fieldIds[2], order: 'asc' as const }];
      const first = await ctx.listRecordsWithoutDrain(table.id, { limit: 1, sort });
      const boundary = await ctx.listRecordsWithoutDrain(table.id, { limit: 2, offset: 499, sort });
      const last = await ctx.listRecordsWithoutDrain(table.id, { limit: 1, offset: 20_000, sort });
      const pastEnd = await ctx.listRecordsWithoutDrain(table.id, {
        limit: 1,
        offset: 20_001,
        sort,
      });
      expect(first[0].fields).toEqual(expectedFields(1));
      expect(boundary.map((record) => record.fields)).toEqual([
        expectedFields(500),
        expectedFields(501),
      ]);
      expect(last[0].fields).toEqual(expectedFields(20_001));
      expect(pastEnd).toEqual([]);
    } finally {
      adapter.parse = originalParse;
      await source.close();
      await ctx.deleteTable(table.id, { mode: 'permanent' });
    }
  }, 360_000);

  it('overlapping POST /tables/importRecords releases both consumed streams and bounds combined heap at 10x input', async () => {
    restoreCollectors();
    ctx = await getSharedTestContext({ dbMode: 'postgres' });
    expect(
      /^postgres(?:ql)?:\/\//.test(ctx.testContainer.connectionString),
      'Overlap heap scaling requires a separate real PostgreSQL process'
    ).toBe(true);
    installBoundedCollectors();
    const source = await fixtureServer('csv', 20_001);
    const targets: Array<{ id: string; nameId: string; payloadId: string; amountId: string }> = [];
    const registry = ctx.testContainer.container.resolve<IImportSourceRegistry>(
      v2CoreTokens.importSourceRegistry
    );
    const adapterResult = registry.getAdapter('csv');
    if (adapterResult.isErr()) throw new Error(adapterResult.error.message);
    const adapter = adapterResult.value;
    const originalParse = adapter.parse;
    const streams: Array<{ earlierRow?: WeakRef<ReadonlyArray<unknown>> }> = [{}, {}];
    const samples: Array<{
      rowsPerRequest: number;
      activeRequests: number;
      retainedMiB: number;
      trackedRows: boolean;
      releasedRows: boolean[];
    }> = [];
    let parseCount = 0;
    let activeRequests = 0;
    let cancelled = false;

    const checkpoint = (rowsPerRequest: number) => {
      const arrived = new Set<number>();
      let release!: () => void;
      let failure: Error | undefined;
      let timer: NodeJS.Timeout | undefined;
      const reached = new Promise<void>((resolve) => {
        release = resolve;
      });
      return {
        wait: async (streamIndex: number) => {
          arrived.add(streamIndex);
          if (!timer) {
            timer = setTimeout(() => {
              failure = new Error(
                `Both HTTP imports must reach row ${rowsPerRequest} concurrently; arrivals=${arrived.size}`
              );
              release();
            }, 90_000);
            timer.unref();
          }
          if (arrived.size === 2) {
            clearTimeout(timer);
            try {
              const retainedMiB = await heap();
              samples.push({
                rowsPerRequest,
                activeRequests,
                retainedMiB,
                trackedRows: streams.every((stream) => stream.earlierRow !== undefined),
                releasedRows: streams.map((stream) => stream.earlierRow?.deref() === undefined),
              });
            } catch (error) {
              failure = error instanceof Error ? error : new Error(String(error));
            }
            release();
          }
          await reached;
          if (failure) throw failure;
          if (cancelled) throw new Error('Overlapping import probe cancelled');
        },
        close: () => {
          clearTimeout(timer);
          release();
        },
      };
    };
    const warm = checkpoint(2000);
    const large = checkpoint(20_000);

    try {
      // Distinct target tables avoid measuring serialization on the same table.
      // Both HTTP bodies stay small: the input is served from a bounded disk stream.
      for (const label of ['left', 'right']) {
        const table = await ctx.createTable({
          baseId: ctx.baseId,
          name: `T7528 overlap ${label}`,
          fields: [
            { name: 'Name', type: 'singleLineText' },
            { name: 'Payload', type: 'longText' },
            { name: 'Amount', type: 'number' },
          ],
        });
        targets.push({
          id: table.id,
          nameId: table.fields.find((field) => field.name === 'Name')!.id,
          payloadId: table.fields.find((field) => field.name === 'Payload')!.id,
          amountId: table.fields.find((field) => field.name === 'Amount')!.id,
        });
      }
      adapter.parse = async (input, options) => {
        const streamIndex = parseCount++;
        if (streamIndex > 1) throw new Error('Expected exactly two independent import streams');
        const parsed = await originalParse.call(adapter, input, options);
        return parsed.map((result) => ({
          ...result,
          rowsAsync: (async function* () {
            let count = 0;
            for await (const row of result.rowsAsync ?? result.rows ?? []) {
              count++;
              if (count === 502) streams[streamIndex].earlierRow = new WeakRef(row);
              // Neither request may pass a checkpoint until both are actively
              // consuming their source. Promise.all alone would not prove overlap.
              if (count === 2000) await warm.wait(streamIndex);
              if (count === 20_000) await large.wait(streamIndex);
              yield row;
            }
          })(),
        }));
      };
      const results = await Promise.allSettled(
        targets.map((target) => {
          activeRequests++;
          return ctx
            .importRecords({
              tableId: target.id,
              fileType: 'csv',
              url: source.url,
              sourceColumnMap: {
                [target.nameId]: 0,
                [target.payloadId]: 1,
                [target.amountId]: 2,
              },
              options: { batchSize: 500, typecast: true },
            })
            .finally(() => {
              activeRequests--;
            });
        })
      );
      for (const result of results) {
        if (result.status === 'rejected') throw result.reason;
        expect(result.value.totalImported).toBe(20_001);
      }
      expect(parseCount).toBe(2);
      expect(samples.map((sample) => sample.rowsPerRequest)).toEqual([2000, 20_000]);
      expect(
        samples.map((sample) => sample.activeRequests),
        'Both transactions must remain active at both barriers'
      ).toEqual([2, 2]);
      expect(samples.every((sample) => sample.trackedRows)).toBe(true);
      expect(
        samples[1].releasedRows,
        'Each request must release its own earlier consumed row'
      ).toEqual([true, true]);
      console.info('T7528 overlapping HTTP imports combined retained heap', samples);
      expect(
        samples[1].retainedMiB - samples[0].retainedMiB,
        'Two active 10x streams must not retain the additional 72 MiB of consumed row payloads'
      ).toBeLessThan(32);

      // Validate every final row, with bounded pages rather than retaining either
      // imported table in the HTTP test client. Ordered amounts detect duplicates
      // or omissions, and full payload equality catches snapshot truncation.
      for (const target of targets) {
        for (let offset = 0; offset < 20_001; offset += 500) {
          const records = await ctx.listRecordsWithoutDrain(target.id, {
            limit: 500,
            offset,
            sort: [{ fieldId: target.amountId, order: 'asc' }],
          });
          expect(records).toHaveLength(Math.min(500, 20_001 - offset));
          for (let index = 0; index < records.length; index++) {
            const amount = offset + index + 1;
            expect(records[index].fields).toMatchObject({
              [target.nameId]: name(amount),
              [target.payloadId]: payload(amount),
              [target.amountId]: amount,
            });
          }
        }
        expect(await ctx.listRecordsWithoutDrain(target.id, { limit: 1, offset: 20_001 })).toEqual(
          []
        );
      }
    } finally {
      cancelled = true;
      warm.close();
      large.close();
      adapter.parse = originalParse;
      await source.close();
      for (const target of targets) await ctx.deleteTable(target.id, { mode: 'permanent' });
    }
  }, 360_000);

  it.each(formats)(
    'rolls back %s earlier persisted batches and publishes no record events when a later row exceeds the cap',
    async (format) => {
      const source = await fixtureServer(format, 1501);
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'T7528 rollback',
        fields: [{ name: 'Name', type: 'singleLineText' }],
      });
      let recordEvents = 0;
      observePublished = (events) => {
        for (const event of events) {
          if (isRecordCreatedEvent(event) || isRecordsBatchCreatedEvent(event)) recordEvents++;
        }
      };
      try {
        const response = await fetch(`${ctx.baseUrl}/tables/importRecords`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            tableId: table.id,
            fileType: format,
            url: source.url,
            sourceColumnMap: { [table.fields[0].id]: 0 },
            options: { batchSize: 500, maxRowCount: 1000, sheetName: 'Data' },
          }),
        });
        expect(response.ok).toBe(false);
        expect(await response.text()).toContain('1000');
        expect(await ctx.listRecords(table.id)).toEqual([]);
        expect(recordEvents, 'No imported record event may escape a rolled-back transaction').toBe(
          0
        );
      } finally {
        observePublished = () => undefined;
        await source.close();
        await ctx.deleteTable(table.id, { mode: 'permanent' });
      }
    },
    180_000
  );
});

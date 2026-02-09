/* eslint-disable @typescript-eslint/naming-convention */
/**
 * Benchmark: CreateRecordsCommand vs CreateRecordsStreamCommand
 *
 * Compares heap memory usage and execution time.
 * Both now use internal batching for DB inserts, the difference is:
 * - Non-streaming: builds ALL domain records first, then batch inserts
 * - Streaming: builds records in batches via Generator, inserts each batch immediately
 *
 * Run with: pnpm -C packages/v2/test-node test-unit -- --run CreateRecordsStream.bench
 */
import {
  createV2NodeTestContainer,
  type IV2NodeTestContainer,
} from '@teable/v2-container-node-test';
import type {
  CreateRecordsResult,
  CreateRecordsStreamResult,
  CreateTableResult,
  ICommandBus,
} from '@teable/v2-core';
import {
  ActorId,
  CreateRecordsCommand,
  CreateRecordsStreamCommand,
  CreateTableCommand,
  v2CoreTokens,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type DynamicDb = V1TeableDatabase & Record<string, Record<string, unknown>>;

interface BenchmarkResult {
  recordCount: number;
  fieldCount: number;
  batchSize?: number;
  // Time metrics (ms)
  dataGenTime: number;
  executionTime: number;
  totalTime: number;
  // Memory metrics (bytes)
  heapBefore: number;
  heapAfterDataGen: number;
  heapPeak: number;
  heapAfterExec: number;
  heapDelta: number;
}

describe('CreateRecordsStream benchmark', () => {
  // Test parameters - larger dataset to see memory difference
  const RECORD_COUNT = 20_000;
  const FIELD_COUNT = 20;
  const BATCH_SIZE = 500;

  // Formatting helpers
  const formatMB = (bytes: number) => (bytes / 1024 / 1024).toFixed(2);
  const formatMs = (ms: number) => ms.toFixed(0);

  // Force GC if available
  const gc = () => {
    if (global.gc) {
      global.gc();
    }
  };

  const createContext = () => {
    const actorIdResult = ActorId.create('system');
    return { actorId: actorIdResult._unsafeUnwrap() };
  };

  let testContainer: IV2NodeTestContainer;

  beforeAll(async () => {
    testContainer = await createV2NodeTestContainer();
  }, 60_000);

  afterAll(async () => {
    await testContainer?.dispose();
  });

  const createBenchmarkTable = async (
    commandBus: ICommandBus,
    baseId: string,
    tableName: string,
    fieldCount: number
  ): Promise<CreateTableResult> => {
    const fields: Array<{ type: 'singleLineText'; name: string; isPrimary?: boolean }> = [];
    fields.push({ type: 'singleLineText', name: 'Primary', isPrimary: true });
    for (let i = 1; i < fieldCount; i++) {
      fields.push({ type: 'singleLineText', name: `Field_${i}` });
    }

    const command = CreateTableCommand.create({
      baseId,
      name: tableName,
      fields,
      views: [{ type: 'grid' }],
    })._unsafeUnwrap();

    const result = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      createContext(),
      command
    );
    return result._unsafeUnwrap();
  };

  const generateRecords = (
    fieldIds: string[],
    count: number
  ): Array<{ fields: Record<string, string> }> => {
    const records: Array<{ fields: Record<string, string> }> = [];
    for (let i = 0; i < count; i++) {
      const fields: Record<string, string> = {};
      for (let j = 0; j < fieldIds.length; j++) {
        fields[fieldIds[j]] = `Value_${i}_${j}`;
      }
      records.push({ fields });
    }
    return records;
  };

  const printReport = (label: string, result: BenchmarkResult) => {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`📊 ${label}`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`   Config: ${result.recordCount} records × ${result.fieldCount} fields`);
    if (result.batchSize) {
      console.log(
        `   Batch size: ${result.batchSize} (${Math.ceil(result.recordCount / result.batchSize)} batches)`
      );
    }
    console.log(`${'─'.repeat(60)}`);
    console.log(`   ⏱️  TIME:`);
    console.log(`      Data generation:  ${formatMs(result.dataGenTime)} ms`);
    console.log(`      Command execution: ${formatMs(result.executionTime)} ms`);
    console.log(`      Total:            ${formatMs(result.totalTime)} ms`);
    console.log(`${'─'.repeat(60)}`);
    console.log(`   💾 MEMORY (heap):`);
    console.log(`      Before:           ${formatMB(result.heapBefore)} MB`);
    console.log(
      `      After data gen:   ${formatMB(result.heapAfterDataGen)} MB (+${formatMB(result.heapAfterDataGen - result.heapBefore)} MB)`
    );
    console.log(
      `      Peak:             ${formatMB(result.heapPeak)} MB (+${formatMB(result.heapPeak - result.heapBefore)} MB)`
    );
    console.log(`      After execution:  ${formatMB(result.heapAfterExec)} MB`);
    console.log(
      `      Delta:            ${result.heapDelta >= 0 ? '+' : ''}${formatMB(result.heapDelta)} MB`
    );
    console.log(`${'═'.repeat(60)}\n`);
  };

  it.skip('Non-streaming (CreateRecordsCommand) - builds all records first', async () => {
    const { container, baseId, db: rawDb } = testContainer;
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const db = rawDb as unknown as Kysely<DynamicDb>;

    const { table } = await createBenchmarkTable(
      commandBus,
      baseId.toString(),
      `Bench_NonStream_${Date.now()}`,
      FIELD_COUNT
    );
    const tableId = table.id().toString();
    const fieldIds = table.getFields().map((f) => f.id().toString());

    gc();
    const heapBefore = process.memoryUsage().heapUsed;
    let heapPeak = heapBefore;
    const startTime = performance.now();

    // Generate all records
    const records = generateRecords(fieldIds, RECORD_COUNT);
    const heapAfterDataGen = process.memoryUsage().heapUsed;
    heapPeak = Math.max(heapPeak, heapAfterDataGen);
    const genTime = performance.now();

    // Execute command
    const command = CreateRecordsCommand.create({ tableId, records })._unsafeUnwrap();
    const result = await commandBus.execute<CreateRecordsCommand, CreateRecordsResult>(
      createContext(),
      command
    );

    const endTime = performance.now();
    heapPeak = Math.max(heapPeak, process.memoryUsage().heapUsed);
    gc();
    const heapAfterExec = process.memoryUsage().heapUsed;

    if (result.isErr()) {
      console.error('CreateRecordsCommand failed:', result.error);
    }
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().records.length).toBe(RECORD_COUNT);

    // Verify in DB
    const dbTableName = table.dbTableName()._unsafeUnwrap().value()._unsafeUnwrap();
    const rowCount = await (db as unknown as Kysely<Record<string, Record<string, unknown>>>)
      .selectFrom(dbTableName)
      .select(db.fn.count('__id').as('count'))
      .executeTakeFirst();
    expect(Number(rowCount?.count)).toBe(RECORD_COUNT);

    printReport('Non-streaming (CreateRecordsCommand)', {
      recordCount: RECORD_COUNT,
      fieldCount: FIELD_COUNT,
      dataGenTime: genTime - startTime,
      executionTime: endTime - genTime,
      totalTime: endTime - startTime,
      heapBefore,
      heapAfterDataGen,
      heapPeak,
      heapAfterExec,
      heapDelta: heapAfterExec - heapBefore,
    });
  });

  it.skip('Streaming (CreateRecordsStreamCommand) - builds records in batches', async () => {
    const { container, baseId, db: rawDb } = testContainer;
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const db = rawDb as unknown as Kysely<DynamicDb>;

    const { table } = await createBenchmarkTable(
      commandBus,
      baseId.toString(),
      `Bench_Stream_${Date.now()}`,
      FIELD_COUNT
    );
    const tableId = table.id().toString();
    const fieldIds = table.getFields().map((f) => f.id().toString());

    gc();
    const heapBefore = process.memoryUsage().heapUsed;
    let heapPeak = heapBefore;
    const startTime = performance.now();

    // Generate records (same as non-streaming for fair comparison of input)
    const records = generateRecords(fieldIds, RECORD_COUNT);
    const heapAfterDataGen = process.memoryUsage().heapUsed;
    heapPeak = Math.max(heapPeak, heapAfterDataGen);
    const genTime = performance.now();

    // Execute stream command
    const command = CreateRecordsStreamCommand.create({
      tableId,
      records,
      batchSize: BATCH_SIZE,
    })._unsafeUnwrap();
    const result = await commandBus.execute<CreateRecordsStreamCommand, CreateRecordsStreamResult>(
      createContext(),
      command
    );

    const endTime = performance.now();
    heapPeak = Math.max(heapPeak, process.memoryUsage().heapUsed);
    gc();
    const heapAfterExec = process.memoryUsage().heapUsed;

    if (result.isErr()) {
      console.error('CreateRecordsStreamCommand failed:', result.error);
    }
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().totalCreated).toBe(RECORD_COUNT);

    // Verify in DB
    const dbTableName = table.dbTableName()._unsafeUnwrap().value()._unsafeUnwrap();
    const rowCount = await (db as unknown as Kysely<Record<string, Record<string, unknown>>>)
      .selectFrom(dbTableName)
      .select(db.fn.count('__id').as('count'))
      .executeTakeFirst();
    expect(Number(rowCount?.count)).toBe(RECORD_COUNT);

    printReport('Streaming (CreateRecordsStreamCommand)', {
      recordCount: RECORD_COUNT,
      fieldCount: FIELD_COUNT,
      batchSize: BATCH_SIZE,
      dataGenTime: genTime - startTime,
      executionTime: endTime - genTime,
      totalTime: endTime - startTime,
      heapBefore,
      heapAfterDataGen,
      heapPeak,
      heapAfterExec,
      heapDelta: heapAfterExec - heapBefore,
    });
  });

  it.skip('📊 Comparison Summary', async () => {
    const { container, baseId } = testContainer;
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);

    const results: { nonStreaming: BenchmarkResult; streaming: BenchmarkResult } = {
      nonStreaming: {} as BenchmarkResult,
      streaming: {} as BenchmarkResult,
    };

    // Test non-streaming
    {
      const { table } = await createBenchmarkTable(
        commandBus,
        baseId.toString(),
        `Bench_Compare_NonStream_${Date.now()}`,
        FIELD_COUNT
      );
      const fieldIds = table.getFields().map((f) => f.id().toString());

      // Aggressive GC before measurement
      gc();
      await new Promise((r) => setTimeout(r, 100));
      gc();
      const heapBefore = process.memoryUsage().heapUsed;
      let heapPeak = heapBefore;
      const start = performance.now();

      const records = generateRecords(fieldIds, RECORD_COUNT);
      const heapAfterDataGen = process.memoryUsage().heapUsed;
      heapPeak = Math.max(heapPeak, heapAfterDataGen);
      const genTime = performance.now();

      const command = CreateRecordsCommand.create({
        tableId: table.id().toString(),
        records,
      })._unsafeUnwrap();

      await commandBus.execute<CreateRecordsCommand, CreateRecordsResult>(createContext(), command);

      const endTime = performance.now();
      heapPeak = Math.max(heapPeak, process.memoryUsage().heapUsed);
      gc();
      const heapAfterExec = process.memoryUsage().heapUsed;

      results.nonStreaming = {
        recordCount: RECORD_COUNT,
        fieldCount: FIELD_COUNT,
        dataGenTime: genTime - start,
        executionTime: endTime - genTime,
        totalTime: endTime - start,
        heapBefore,
        heapAfterDataGen,
        heapPeak,
        heapAfterExec,
        heapDelta: heapAfterExec - heapBefore,
      };
    }

    // Aggressive GC and wait to let heap settle
    gc();
    await new Promise((r) => setTimeout(r, 100));
    gc();
    await new Promise((r) => setTimeout(r, 100));
    gc();

    // Test streaming
    {
      const { table } = await createBenchmarkTable(
        commandBus,
        baseId.toString(),
        `Bench_Compare_Stream_${Date.now()}`,
        FIELD_COUNT
      );
      const fieldIds = table.getFields().map((f) => f.id().toString());

      // Aggressive GC before measurement
      gc();
      await new Promise((r) => setTimeout(r, 100));
      gc();
      const heapBefore = process.memoryUsage().heapUsed;
      let heapPeak = heapBefore;
      const start = performance.now();

      const records = generateRecords(fieldIds, RECORD_COUNT);
      const heapAfterDataGen = process.memoryUsage().heapUsed;
      heapPeak = Math.max(heapPeak, heapAfterDataGen);
      const genTime = performance.now();

      const command = CreateRecordsStreamCommand.create({
        tableId: table.id().toString(),
        records,
        batchSize: BATCH_SIZE,
      })._unsafeUnwrap();

      await commandBus.execute<CreateRecordsStreamCommand, CreateRecordsStreamResult>(
        createContext(),
        command
      );

      const endTime = performance.now();
      heapPeak = Math.max(heapPeak, process.memoryUsage().heapUsed);
      gc();
      const heapAfterExec = process.memoryUsage().heapUsed;

      results.streaming = {
        recordCount: RECORD_COUNT,
        fieldCount: FIELD_COUNT,
        batchSize: BATCH_SIZE,
        dataGenTime: genTime - start,
        executionTime: endTime - genTime,
        totalTime: endTime - start,
        heapBefore,
        heapAfterDataGen,
        heapPeak,
        heapAfterExec,
        heapDelta: heapAfterExec - heapBefore,
      };
    }

    // Print comparison
    console.log(`\n${'═'.repeat(70)}`);
    console.log('📊 BENCHMARK COMPARISON SUMMARY');
    console.log(`${'═'.repeat(70)}`);
    console.log(`   Config: ${RECORD_COUNT} records × ${FIELD_COUNT} fields`);
    console.log(`${'═'.repeat(70)}`);
    console.log('');
    console.log(`   ${''.padEnd(25)} | Non-streaming | Streaming (batch=${BATCH_SIZE})`);
    console.log(`   ${'─'.repeat(25)}-+-${'─'.repeat(14)}-+-${'─'.repeat(20)}`);
    console.log(
      `   ${'Total time'.padEnd(25)} | ${formatMs(results.nonStreaming.totalTime).padStart(10)} ms | ${formatMs(results.streaming.totalTime).padStart(10)} ms`
    );
    console.log(
      `   ${'Execution time'.padEnd(25)} | ${formatMs(results.nonStreaming.executionTime).padStart(10)} ms | ${formatMs(results.streaming.executionTime).padStart(10)} ms`
    );
    console.log(
      `   ${'Peak heap'.padEnd(25)} | ${formatMB(results.nonStreaming.heapPeak).padStart(10)} MB | ${formatMB(results.streaming.heapPeak).padStart(10)} MB`
    );
    console.log(
      `   ${'Peak heap delta'.padEnd(25)} | ${formatMB(results.nonStreaming.heapPeak - results.nonStreaming.heapBefore).padStart(10)} MB | ${formatMB(results.streaming.heapPeak - results.streaming.heapBefore).padStart(10)} MB`
    );
    console.log(
      `   ${'Final heap delta'.padEnd(25)} | ${formatMB(results.nonStreaming.heapDelta).padStart(10)} MB | ${formatMB(results.streaming.heapDelta).padStart(10)} MB`
    );
    console.log('');

    const timeDiff =
      ((results.streaming.totalTime - results.nonStreaming.totalTime) /
        results.nonStreaming.totalTime) *
      100;
    const peakMemDiff =
      ((results.streaming.heapPeak -
        results.streaming.heapBefore -
        (results.nonStreaming.heapPeak - results.nonStreaming.heapBefore)) /
        (results.nonStreaming.heapPeak - results.nonStreaming.heapBefore)) *
      100;

    console.log(
      `   Time: ${timeDiff >= 0 ? '+' : ''}${timeDiff.toFixed(1)}% ${timeDiff >= 0 ? '(streaming slower)' : '(streaming faster)'}`
    );
    console.log(
      `   Peak memory: ${peakMemDiff >= 0 ? '+' : ''}${peakMemDiff.toFixed(1)}% ${peakMemDiff >= 0 ? '(streaming uses more)' : '(streaming uses less)'}`
    );
    console.log(`${'═'.repeat(70)}\n`);

    expect(results.nonStreaming.totalTime).toBeGreaterThan(0);
    expect(results.streaming.totalTime).toBeGreaterThan(0);
  });
});

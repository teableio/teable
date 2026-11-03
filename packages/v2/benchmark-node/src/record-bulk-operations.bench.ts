import { deepStrictEqual, strictEqual } from 'node:assert';
import { writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import {
  BaseId,
  FieldId,
  FieldName,
  RecordId,
  recordToFieldValues,
  Table,
  TableName,
  type TableRecord,
} from '@teable/v2-core';
import { beforeAll, bench, describe } from 'vitest';

import { Table as SourceTable } from '../../core/src/domain/table/Table';

if (Table !== SourceTable)
  throw new Error('Core workspace dependency resolves outside this checkout');

const benchOptions = { time: 1_000, warmupTime: 250, throws: true };

type InputRow = { id: RecordId; fieldValues: ReadonlyMap<string, unknown> };
type UpdateRow = { recordId: RecordId; fieldValues: ReadonlyMap<string, unknown> };
type Scenario = {
  label: string;
  table: Table;
  records: ReadonlyArray<InputRow>;
  streamRows: ReadonlyArray<ReadonlyMap<string, unknown>>;
  updates: ReadonlyArray<UpdateRow>;
  clears: ReadonlyArray<UpdateRow>;
  upsertCreates: ReadonlyArray<InputRow>;
  upsertUpdates: ReadonlyArray<UpdateRow>;
  typecast: boolean;
};
type Operation = { label: string; run: (scenario: Scenario) => void | Promise<void> };

// Retain the same final records for every operation; validation is outside timed callbacks.
let sink: ReadonlyArray<TableRecord> = [];

const paddedId = (prefix: 'fld' | 'rec', value: number): string =>
  `${prefix}${value.toString(36).padStart(16, '0')}`;

const buildScenario = (params: {
  label: string;
  fieldCount: number;
  populatedFieldCount: number;
  updatedFieldCount: number;
  recordCount: number;
  typecast?: boolean;
}): Scenario => {
  const builder = Table.builder()
    .withBaseId(BaseId.create('bse0000000000000001')._unsafeUnwrap())
    .withName(TableName.create(`Bulk operations ${params.label}`)._unsafeUnwrap());
  const fieldIds: string[] = [];
  for (let index = 0; index < params.fieldCount; index += 1) {
    const fieldId = FieldId.create(paddedId('fld', index))._unsafeUnwrap();
    const fieldBuilder = builder
      .field()
      .singleLineText()
      .withId(fieldId)
      .withName(FieldName.create(`Field ${index}`)._unsafeUnwrap());
    if (index === 0) fieldBuilder.primary();
    fieldBuilder.done();
    fieldIds.push(fieldId.toString());
  }
  builder.view().defaultGrid().done();
  const table = builder.build()._unsafeUnwrap();
  table.pullDomainEvents();
  const populated = fieldIds.slice(0, params.populatedFieldCount);
  const updated = fieldIds.slice(0, params.updatedFieldCount);
  const records = Array.from({ length: params.recordCount }, (_, recordIndex) => ({
    id: RecordId.create(paddedId('rec', recordIndex))._unsafeUnwrap(),
    fieldValues: new Map<string, unknown>(
      populated.map((fieldId, fieldIndex) => [fieldId, `row-${recordIndex}-field-${fieldIndex}`])
    ),
  }));
  const updates = records.map((record, index) => ({
    recordId: record.id,
    fieldValues: new Map<string, unknown>(
      updated.map((fieldId, fieldIndex) => [fieldId, `updated-${index}-${fieldIndex}`])
    ),
  }));
  const clears = records.map((record) => ({
    recordId: record.id,
    fieldValues: new Map<string, unknown>(updated.map((fieldId) => [fieldId, null])),
  }));
  return {
    label: params.label,
    table,
    records,
    updates,
    clears,
    streamRows: records.map(({ fieldValues }) => fieldValues),
    upsertCreates: records.filter((_, index) => index % 2 === 0),
    upsertUpdates: updates.filter((_, index) => index % 2 !== 0),
    typecast: params.typecast ?? false,
  };
};

const scenarios = [
  buildScenario({
    label: '500x10 update5 strict',
    fieldCount: 10,
    populatedFieldCount: 10,
    updatedFieldCount: 5,
    recordCount: 500,
  }),
  buildScenario({
    label: '50x100 update50 strict',
    fieldCount: 100,
    populatedFieldCount: 100,
    updatedFieldCount: 50,
    recordCount: 50,
  }),
  buildScenario({
    label: '10x500 update100 strict',
    fieldCount: 500,
    populatedFieldCount: 500,
    updatedFieldCount: 100,
    recordCount: 10,
  }),
  buildScenario({
    label: '100x10-of-500 update5 strict',
    fieldCount: 500,
    populatedFieldCount: 10,
    updatedFieldCount: 5,
    recordCount: 100,
  }),
  buildScenario({
    label: '50x100 update50 typecast',
    fieldCount: 100,
    populatedFieldCount: 100,
    updatedFieldCount: 50,
    recordCount: 50,
    typecast: true,
  }),
];

const create = (scenario: Scenario): void => {
  const result = scenario.table.createRecords(scenario.records, {
    typecast: scenario.typecast,
    emitRecordCreatedEvents: false,
  });
  if (result.isErr()) throw result.error;
  sink = result.value.records;
};
const validatedCreate = (scenario: Scenario): void => {
  const result = scenario.table.createRecords(scenario.records, {
    valuesAreValidated: true,
    emitRecordCreatedEvents: false,
  });
  if (result.isErr()) throw result.error;
  sink = result.value.records;
};
const createStream = (scenario: Scenario): void => {
  const output: TableRecord[] = [];
  for (const batch of scenario.table.createRecordsStream(scenario.streamRows, {
    typecast: scenario.typecast,
    emitRecordCreatedEvents: false,
  })) {
    if (batch.isErr()) throw batch.error;
    output.push(...batch.value);
  }
  sink = output;
};
const createStreamAsync = async (scenario: Scenario): Promise<void> => {
  const output: TableRecord[] = [];
  const source = (async function* () {
    yield* scenario.streamRows;
  })();
  for await (const batch of scenario.table.createRecordsStreamAsync(source, {
    typecast: scenario.typecast,
    emitRecordCreatedEvents: false,
  })) {
    if (batch.isErr()) throw batch.error;
    output.push(...batch.value);
  }
  sink = output;
};
const updateStream = (scenario: Scenario): void => {
  const output: TableRecord[] = [];
  for (const batch of scenario.table.updateRecordsStream(scenario.updates, {
    typecast: scenario.typecast,
  })) {
    if (batch.isErr()) throw batch.error;
    output.push(...batch.value.map((row) => row.record));
  }
  sink = output;
};
const clearStream = (scenario: Scenario): void => {
  const output: TableRecord[] = [];
  for (const batch of scenario.table.updateRecordsStream(scenario.clears, {
    typecast: scenario.typecast,
  })) {
    if (batch.isErr()) throw batch.error;
    output.push(...batch.value.map((row) => row.record));
  }
  sink = output;
};
const splitUpsertPreparation = (scenario: Scenario): void => {
  const created = scenario.table.createRecords(scenario.upsertCreates, {
    typecast: scenario.typecast,
    emitRecordCreatedEvents: false,
  });
  if (created.isErr()) throw created.error;
  const output = [...created.value.records];
  for (const batch of scenario.table.updateRecordsStream(scenario.upsertUpdates, {
    typecast: scenario.typecast,
  })) {
    if (batch.isErr()) throw batch.error;
    output.push(...batch.value.map((row) => row.record));
  }
  sink = output;
};

const operations: ReadonlyArray<Operation> = [
  { label: 'create', run: create },
  { label: 'validated create (duplicate/restore primitive)', run: validatedCreate },
  { label: 'sync create stream', run: createStream },
  { label: 'async create stream', run: createStreamAsync },
  { label: 'update stream', run: updateStream },
  { label: 'clear-value stream primitive', run: clearStream },
  { label: '50/50 upsert preparation primitives', run: splitUpsertPreparation },
];

const verifyOutput = (scenario: Scenario, operation: Operation): void => {
  strictEqual(sink.length, scenario.records.length);
  for (const [outputIndex, record] of sink.entries()) {
    const generatedIds = operation.run === createStream || operation.run === createStreamAsync;
    const index = generatedIds
      ? outputIndex
      : scenario.records.findIndex((input) => input.id.equals(record.id()));
    let values = scenario.records[index]!.fieldValues;
    if (operation.run === clearStream) values = scenario.clears[index]!.fieldValues;
    else if (
      operation.run === updateStream ||
      (operation.run === splitUpsertPreparation && index % 2 !== 0)
    ) {
      values = scenario.updates[index]!.fieldValues;
    }
    deepStrictEqual(
      recordToFieldValues(record),
      [...values].map(([fieldId, value]) => ({ fieldId, value }))
    );
  }
};

const profileOperation = async (scenario: Scenario, operation: Operation, gc: () => void) => {
  const profiles = [];
  for (let warmup = 0; warmup < 3; warmup += 1) await operation.run(scenario);
  for (let round = 0; round < 5; round += 1) {
    sink = [];
    gc();
    const heapBefore = process.memoryUsage().heapUsed;
    const cpuBefore = process.cpuUsage();
    const start = performance.now();
    await operation.run(scenario);
    const elapsedMs = performance.now() - start;
    const cpu = process.cpuUsage(cpuBefore);
    const heapAfter = process.memoryUsage().heapUsed;
    gc();
    const retainedWithResult = process.memoryUsage().heapUsed;
    strictEqual(sink.length, scenario.records.length);
    profiles.push({
      scenario: scenario.label,
      operation: operation.label,
      round,
      elapsedMs,
      rowsPerSecond: (scenario.records.length * 1_000) / elapsedMs,
      userCpuMs: cpu.user / 1_000,
      systemCpuMs: cpu.system / 1_000,
      heapBefore,
      heapAfter,
      retainedWithResult,
    });
  }
  return profiles;
};

beforeAll(async () => {
  for (const scenario of scenarios) {
    for (const operation of operations) {
      await operation.run(scenario);
      verifyOutput(scenario, operation);
    }
  }
  if (process.env.RECORD_BULK_PROFILE !== '1') return;
  const gc = (globalThis as typeof globalThis & { gc?: () => void }).gc;
  if (!gc) throw new Error('Heap profiles require node --expose-gc and --pool=threads');
  const profiles = [];
  for (const scenario of scenarios) {
    for (const operation of operations) {
      profiles.push(...(await profileOperation(scenario, operation, gc)));
    }
  }
  const report = {
    node: process.version,
    cpu: cpus()[0]?.model,
    source: new URL('../../core/src/index.ts', import.meta.url).pathname,
    scope:
      'Domain primitives only; no import parsing, paste selection, upsert matching, permissions, SQL or end-to-end API timing. Explicit-GC profile snapshots are not peak memory or total allocations.',
    profiles,
  };
  const output = process.env.RECORD_BULK_REPORT;
  if (output) writeFileSync(output, JSON.stringify(report, null, 2));
  else console.log(JSON.stringify(report));
});

for (const scenario of scenarios) {
  describe(`Bulk operations: ${scenario.label}`, () => {
    for (const operation of operations) {
      bench(operation.label, () => operation.run(scenario), benchOptions);
    }
  });
}

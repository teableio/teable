import { deepStrictEqual } from 'node:assert';
import { writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import {
  BaseId,
  FieldId,
  FieldName,
  type ICellValueSpec,
  RecordId,
  RecordMutationSpecBuilder,
  recordToFieldValues,
  Table,
  type TableId,
  TableName,
  TableRecord,
} from '@teable/v2-core';
import { beforeAll, bench, describe } from 'vitest';

import type { CreateRecordsMethodResult } from '../../core/src/domain/table/methods/records/createRecords';
import { materializeRecordSpec } from '../../core/src/domain/table/records/RecordSpecMaterializer';
import { Table as SourceTable } from '../../core/src/domain/table/Table';

// Copied node_modules may still link the primary checkout. Never compare different source graphs.
if (Table !== SourceTable)
  throw new Error('Core workspace dependency does not resolve to this checkout');

const benchOptions = { time: 1_000, warmupTime: 250, throws: true };

type Scenario = {
  label: string;
  table: Table;
  records: ReadonlyArray<{ id: RecordId; fieldValues: ReadonlyMap<string, unknown> }>;
  typecast: boolean;
  mutations: ReadonlyArray<{ id: RecordId; spec: ICellValueSpec }>;
};

type BenchmarkOutput = ReadonlyArray<TableRecord> | CreateRecordsMethodResult;

type Profile = {
  label: string;
  round: number;
  elapsedMs: number;
  userCpuMs: number;
  systemCpuMs: number;
  rowsPerSecond: number;
  heapBefore: number;
  heapAfterCreate: number;
  heapRetainedWithResult: number;
  heapAfterRelease: number;
};

let sink: BenchmarkOutput | undefined;

const paddedId = (prefix: 'fld' | 'rec', value: number): string =>
  `${prefix}${value.toString(36).padStart(16, '0')}`;

const buildScenario = (params: {
  label: string;
  fieldCount: number;
  populatedFieldCount: number;
  recordCount: number;
  typecast?: boolean;
}): Scenario => {
  const builder = Table.builder()
    .withBaseId(BaseId.create('bse0000000000000001')._unsafeUnwrap())
    .withName(TableName.create(`Record materialization ${params.label}`)._unsafeUnwrap());
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
  const records = Array.from({ length: params.recordCount }, (_, recordIndex) => ({
    id: RecordId.create(paddedId('rec', recordIndex))._unsafeUnwrap(),
    fieldValues: new Map<string, unknown>(
      fieldIds
        .slice(0, params.populatedFieldCount)
        .map((fieldId, fieldIndex) => [fieldId, `row-${recordIndex}-field-${fieldIndex}`])
    ),
  }));
  const fieldsById = new Map(
    table.getEditableFields().map((field) => [field.id().toString(), field])
  );
  const typecast = params.typecast ?? false;
  const mutations = records.map(({ id, fieldValues }) => {
    const specBuilder = RecordMutationSpecBuilder.create().withTypecast(typecast);
    for (const [fieldId, value] of fieldValues) {
      const field = fieldsById.get(fieldId);
      if (!field) throw new Error(`Missing benchmark field: ${fieldId}`);
      specBuilder.set(field, value);
    }
    const spec = specBuilder.build();
    if (spec.isErr()) throw spec.error;
    return { id, spec: spec.value };
  });
  return { label: params.label, table, records, typecast, mutations };
};

const scenarios = [
  buildScenario({
    label: 'dense 500x10 strict',
    fieldCount: 10,
    populatedFieldCount: 10,
    recordCount: 500,
  }),
  buildScenario({
    label: 'dense 50x100 strict',
    fieldCount: 100,
    populatedFieldCount: 100,
    recordCount: 50,
  }),
  buildScenario({
    label: 'dense 10x500 strict',
    fieldCount: 500,
    populatedFieldCount: 500,
    recordCount: 10,
  }),
  buildScenario({
    label: 'sparse 100x10-of-500 strict',
    fieldCount: 500,
    populatedFieldCount: 10,
    recordCount: 100,
  }),
  buildScenario({
    label: 'dense 50x100 typecast',
    fieldCount: 100,
    populatedFieldCount: 100,
    recordCount: 50,
    typecast: true,
  }),
];

const materializeSequentially = (scenario: Scenario): ReadonlyArray<TableRecord> =>
  scenario.mutations.map(({ id, spec }) => {
    const empty = TableRecord.create({ id, tableId: scenario.table.id(), fieldValues: [] });
    if (empty.isErr()) throw empty.error;
    const result = spec.mutate(empty.value);
    if (result.isErr()) throw result.error;
    return result.value;
  });

const materializeInOnePass = (scenario: Scenario): ReadonlyArray<TableRecord> =>
  scenario.mutations.map(({ id, spec }) => {
    const result = materializeRecordSpec({ id, tableId: scenario.table.id(), spec });
    if (result.isErr()) throw result.error;
    return result.value;
  });

type ReapplyScenario = {
  label: string;
  tableId: TableId;
  rows: ReadonlyArray<{ base: TableRecord; spec: ICellValueSpec }>;
};

const reapplyScenarios: ReadonlyArray<ReapplyScenario> = scenarios.flatMap((scenario) => {
  const bases = materializeInOnePass(scenario);
  const fieldById = new Map(
    scenario.table.getEditableFields().map((field) => [field.id().toString(), field])
  );
  const populatedCount = scenario.records[0]?.fieldValues.size ?? 0;
  const counts = populatedCount > 10 ? [10, populatedCount] : [populatedCount];
  return counts.map((assignmentCount) => {
    const rows = scenario.records.map(({ fieldValues }, index) => {
      const specBuilder = RecordMutationSpecBuilder.create().withTypecast(scenario.typecast);
      let assignmentIndex = 0;
      for (const fieldId of fieldValues.keys()) {
        const field = fieldById.get(fieldId);
        if (!field) throw new Error(`Missing benchmark field: ${fieldId}`);
        specBuilder.set(field, `reapply-${index}-${assignmentIndex}`);
        assignmentIndex += 1;
        if (assignmentIndex === assignmentCount) break;
      }
      const spec = specBuilder.build();
      if (spec.isErr()) throw spec.error;
      return { base: bases[index]!, spec: spec.value };
    });
    return {
      label: `${scenario.label}; assignments=${assignmentCount}`,
      tableId: scenario.table.id(),
      rows,
    };
  });
});

const emptyRecord = (id: RecordId, tableId: TableId): TableRecord => {
  const result = TableRecord.create({ id, tableId, fieldValues: [] });
  if (result.isErr()) throw result.error;
  return result.value;
};

const legacyUpdate = (scenario: ReapplyScenario): ReadonlyArray<TableRecord> =>
  scenario.rows.map(({ base, spec }) => {
    const result = spec.mutate(emptyRecord(base.id(), scenario.tableId));
    if (result.isErr()) throw result.error;
    return result.value;
  });

const dodUpdate = (scenario: ReapplyScenario): ReadonlyArray<TableRecord> =>
  scenario.rows.map(({ base, spec }) => {
    const result = materializeRecordSpec({
      id: base.id(),
      tableId: scenario.tableId,
      spec,
    });
    if (result.isErr()) throw result.error;
    return result.value;
  });

const legacyMerge = (scenario: ReapplyScenario): ReadonlyArray<TableRecord> =>
  scenario.rows.map(({ base, spec }) => {
    const result = spec.mutate(base);
    if (result.isErr()) throw result.error;
    return result.value;
  });

const dodMerge = (scenario: ReapplyScenario): ReadonlyArray<TableRecord> =>
  scenario.rows.map(({ base, spec }) => {
    const result = materializeRecordSpec({
      id: base.id(),
      tableId: scenario.tableId,
      spec,
      baseFields: base.fields().entries(),
    });
    if (result.isErr()) throw result.error;
    return result.value;
  });

const createRecords = (scenario: Scenario): CreateRecordsMethodResult => {
  const result = scenario.table.createRecords(scenario.records, {
    typecast: scenario.typecast,
    emitRecordCreatedEvents: false,
  });
  if (result.isErr()) throw result.error;
  return result.value;
};

const profileOperation = (
  scenario: Scenario,
  label: string,
  round: number,
  run: (input: Scenario) => BenchmarkOutput,
  gc: () => void
): Profile => {
  sink = undefined;
  gc();
  const heapBefore = process.memoryUsage().heapUsed;
  const cpuBefore = process.cpuUsage();
  const startedAt = performance.now();
  sink = run(scenario);
  const elapsedMs = performance.now() - startedAt;
  const cpu = process.cpuUsage(cpuBefore);
  const heapAfterCreate = process.memoryUsage().heapUsed;
  gc();
  const heapRetainedWithResult = process.memoryUsage().heapUsed;
  if (!sink) throw new Error('Benchmark output was not retained');
  sink = undefined;
  gc();
  return {
    label,
    round,
    elapsedMs,
    userCpuMs: cpu.user / 1_000,
    systemCpuMs: cpu.system / 1_000,
    rowsPerSecond: (scenario.records.length * 1_000) / elapsedMs,
    heapBefore,
    heapAfterCreate,
    heapRetainedWithResult,
    heapAfterRelease: process.memoryUsage().heapUsed,
  };
};

const profileScenario = (scenario: Scenario, gc: () => void): Profile[] => {
  const profiles: Profile[] = [];
  for (let warmup = 0; warmup < 5; warmup += 1) {
    sink = materializeSequentially(scenario);
    sink = materializeInOnePass(scenario);
    sink = createRecords(scenario);
  }
  for (let round = 0; round < 5; round += 1) {
    // Alternate order to reduce systematic first/second-position bias.
    const algorithms =
      round % 2 === 0
        ? ([
            ['legacy', materializeSequentially],
            ['dod', materializeInOnePass],
          ] as const)
        : ([
            ['dod', materializeInOnePass],
            ['legacy', materializeSequentially],
          ] as const);
    for (const [mode, run] of algorithms) {
      profiles.push(profileOperation(scenario, `${mode}: ${scenario.label}`, round, run, gc));
    }
    profiles.push(
      profileOperation(scenario, `createRecords: ${scenario.label}`, round, createRecords, gc)
    );
  }
  return profiles;
};

beforeAll(() => {
  for (const scenario of scenarios) {
    const expected = materializeSequentially(scenario).map(recordToFieldValues);
    deepStrictEqual(materializeInOnePass(scenario).map(recordToFieldValues), expected);
    deepStrictEqual(createRecords(scenario).records.map(recordToFieldValues), expected);
  }
  for (const scenario of reapplyScenarios) {
    deepStrictEqual(
      dodUpdate(scenario).map(recordToFieldValues),
      legacyUpdate(scenario).map(recordToFieldValues)
    );
    deepStrictEqual(
      dodMerge(scenario).map(recordToFieldValues),
      legacyMerge(scenario).map(recordToFieldValues)
    );
  }
  if (process.env.RECORD_MATERIALIZATION_HEAP !== '1') return;
  const gc = (globalThis as typeof globalThis & { gc?: () => void }).gc;
  if (!gc) throw new Error('Heap profiles require node --expose-gc and --pool=threads');
  const profiles = scenarios.flatMap((scenario) => profileScenario(scenario, gc));
  const report = {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpu: cpus()[0]?.model,
    source: new URL('../../core/src/index.ts', import.meta.url).pathname,
    scope:
      'In-memory only; event emission disabled. Explicit-GC profiles cover creation only: legacy sequential versus single-pass materialization, and full-core Table.createRecords except fixture generation. Update and reapply pairs are timed only in the separate TinyBench loops. Raw benchmark JSON is generated by the documented command and is not committed. No database, HTTP or permissions timing. Heap snapshots are not peak heap or total allocated bytes.',
    profiles,
  };
  const outputPath = process.env.RECORD_MATERIALIZATION_REPORT;
  if (outputPath) writeFileSync(outputPath, JSON.stringify(report, null, 2));
  else console.log(`T8282_PROFILE=${JSON.stringify(report)}`);
});

for (const scenario of scenarios) {
  describe(`Record materialization: ${scenario.label}`, () => {
    bench(
      'legacy sequential',
      () => {
        sink = materializeSequentially(scenario);
      },
      benchOptions
    );
    bench(
      'DOD single-pass',
      () => {
        sink = materializeInOnePass(scenario);
      },
      benchOptions
    );
    bench(
      'Table.createRecords',
      () => {
        sink = createRecords(scenario);
      },
      benchOptions
    );
  });
}

for (const scenario of reapplyScenarios) {
  describe(`Update and reapply: ${scenario.label}`, () => {
    bench(
      'legacy update materialization',
      () => {
        sink = legacyUpdate(scenario);
      },
      benchOptions
    );
    bench(
      'DOD update materialization',
      () => {
        sink = dodUpdate(scenario);
      },
      benchOptions
    );
    bench(
      'legacy reapply merge',
      () => {
        sink = legacyMerge(scenario);
      },
      benchOptions
    );
    bench(
      'DOD reapply merge',
      () => {
        sink = dodMerge(scenario);
      },
      benchOptions
    );
  });
}

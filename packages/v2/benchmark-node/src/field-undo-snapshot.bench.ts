import { deepStrictEqual, strictEqual } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import {
  ActorId,
  BaseId,
  DbFieldName,
  type DomainError,
  FieldId,
  FieldName,
  FieldUndoRedoSnapshotService,
  type IExecutionContext,
  type ISpecification,
  type ITableRecordConditionSpecVisitor,
  type ITableRecordQueryOptions,
  type ITableRecordQueryRepository,
  type ITableRecordQueryStreamOptions,
  ok,
  type RecordId,
  type Result,
  Table,
  TableId,
  type TableRecord,
  type TableRecordReadModel,
  TableName,
  type UndoRedoFieldSnapshot,
  ViewId,
  ViewName,
} from '@teable/v2-core';
import { beforeAll, bench, describe } from 'vitest';

import { FieldUndoRedoSnapshotService as SourceFieldUndoRedoSnapshotService } from '../../core/src/application/services/FieldUndoRedoSnapshotService';
import { DefaultTableMapper } from '../../core/src/ports/mappers/defaults/DefaultTableMapper';

if (FieldUndoRedoSnapshotService !== SourceFieldUndoRedoSnapshotService) {
  throw new Error('Core workspace dependency does not resolve to this checkout');
}

const collectSourceProvenance = () => {
  const root = new URL('../../../../../', import.meta.url);
  const expectedHead = process.env.FIELD_UNDO_SNAPSHOT_EXPECTED_HEAD;
  if (!expectedHead || !/^[a-f0-9]{40}$/.test(expectedHead)) {
    throw new Error('Profile mode requires FIELD_UNDO_SNAPSHOT_EXPECTED_HEAD as a full commit SHA');
  }
  const git = (args: string[]) =>
    execFileSync('git', ['-C', fileURLToPath(root), ...args], { encoding: 'utf8' }).trim();
  const measuredSourceHead = git(['rev-parse', 'HEAD']);
  if (measuredSourceHead !== expectedHead) {
    throw new Error(
      `Unexpected benchmark source head: expected ${expectedHead}, got ${measuredSourceHead}`
    );
  }
  const sourcePaths = [
    'community/packages/v2/benchmark-node/src/field-undo-snapshot.bench.ts',
    'community/packages/v2/core/src/application/services/FieldUndoRedoSnapshotService.ts',
    'community/packages/v2/core/src/ports/mappers/defaults/DefaultTableMapper.ts',
  ];
  if (
    git(['diff', '--name-only', 'HEAD', '--', 'community/packages/v2/core/src', sourcePaths[0]!])
  ) {
    throw new Error('Profile mode requires committed core and benchmark sources');
  }
  return {
    measuredSourceHead,
    sourceSha256: Object.fromEntries(
      sourcePaths.map((path) => [
        path,
        createHash('sha256')
          .update(readFileSync(new URL(path, root)))
          .digest('hex'),
      ])
    ),
  };
};

const benchOptions = { time: 1_000, warmupTime: 250, throws: true };
const context: IExecutionContext = {
  actorId: ActorId.create('field-undo-snapshot-benchmark')._unsafeUnwrap(),
};

const paddedId = (prefix: 'fld' | 'rec' | 'tbl' | 'viw', value: number): string =>
  `${prefix}${value.toString(36).padStart(16, '0')}`;

type SourceRecord = {
  readonly id: string;
  readonly fields: Readonly<Record<string, unknown>>;
  readonly version: number;
};

class BenchmarkRecordQueryRepository implements ITableRecordQueryRepository {
  calls = 0;
  projectionWidths: number[] = [];

  constructor(private readonly rows: ReadonlyArray<SourceRecord>) {}

  reset(): void {
    this.calls = 0;
    this.projectionWidths = [];
  }

  async find(
    _context: IExecutionContext,
    _table: Table,
    _spec?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>,
    options?: ITableRecordQueryOptions
  ) {
    this.calls += 1;
    const projection = options?.projectionFieldIds?.map((fieldId) => fieldId.toString()) ?? [];
    this.projectionWidths.push(projection.length);
    const records = this.rows.map((row): TableRecordReadModel => ({
      id: row.id,
      version: row.version,
      fields: Object.fromEntries(
        projection.map((fieldId) => [fieldId, row.fields[fieldId] ?? null])
      ),
    }));
    return ok({ records, total: records.length });
  }

  async findOne(
    _context: IExecutionContext,
    _table: Table,
    _recordId: RecordId
  ): Promise<Result<TableRecordReadModel, DomainError>> {
    throw new Error('findOne is not used by the field undo snapshot benchmark');
  }

  findStream(
    _context: IExecutionContext,
    _table: Table,
    _spec?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>,
    _options?: ITableRecordQueryStreamOptions
  ): AsyncIterable<Result<TableRecordReadModel, DomainError>> {
    return {
      [Symbol.asyncIterator](): AsyncIterator<Result<TableRecordReadModel, DomainError>> {
        return {
          next: async () => {
            throw new Error('findStream is not used by the field undo snapshot benchmark');
          },
        };
      },
    };
  }
}

class CountingTableMapper extends DefaultTableMapper {
  calls = 0;

  reset(): void {
    this.calls = 0;
  }

  override toDTO(table: Table) {
    this.calls += 1;
    return super.toDTO(table);
  }
}

type Scenario = {
  readonly label: string;
  readonly table: Table;
  readonly fieldIds: ReadonlyArray<FieldId>;
  readonly viewCount: number;
  readonly mapper: CountingTableMapper;
  readonly repository: BenchmarkRecordQueryRepository;
  readonly service: FieldUndoRedoSnapshotService;
};

type RunResult = {
  readonly snapshots: ReadonlyArray<UndoRedoFieldSnapshot>;
  readonly mapperCalls: number;
  readonly queryCalls: number;
  readonly projectionWidths: ReadonlyArray<number>;
  readonly orderedFieldIdArrayCount: number;
};

type Profile = {
  readonly scenario: string;
  readonly mode: 'sequential-capture' | 'captureMany';
  readonly round: number;
  readonly elapsedMs: number;
  readonly snapshotsPerSecond: number;
  readonly userCpuMs: number;
  readonly systemCpuMs: number;
  readonly heapBefore: number;
  readonly heapAfter: number;
  readonly retainedWithResult: number;
  readonly heapAfterRelease: number;
  readonly mapperCalls: number;
  readonly queryCalls: number;
  readonly projectionWidths: ReadonlyArray<number>;
  readonly orderedFieldIdArrayCount: number;
};

const buildScenario = (params: {
  label: string;
  fieldCount: number;
  snapshotCount: number;
  viewCount: number;
  recordCount: number;
}): Scenario => {
  const builder = Table.builder()
    .withId(TableId.create(paddedId('tbl', params.fieldCount))._unsafeUnwrap())
    .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create(`Undo snapshot ${params.label}`)._unsafeUnwrap());
  const fieldIds: FieldId[] = [];
  for (let index = 0; index < params.fieldCount; index += 1) {
    const fieldId = FieldId.create(paddedId('fld', index))._unsafeUnwrap();
    const fieldBuilder = builder
      .field()
      .singleLineText()
      .withId(fieldId)
      .withName(FieldName.create(`Field ${index}`)._unsafeUnwrap());
    if (index === 0) fieldBuilder.primary();
    fieldBuilder.done();
    fieldIds.push(fieldId);
  }
  for (let index = 0; index < params.viewCount; index += 1) {
    builder
      .view()
      .grid()
      .withId(ViewId.create(paddedId('viw', index))._unsafeUnwrap())
      .withName(ViewName.create(`Grid ${index}`)._unsafeUnwrap())
      .done();
  }
  const table = builder.build()._unsafeUnwrap();
  for (const field of table.getFields()) {
    DbFieldName.rehydrate(field.id().toString())
      .andThen((dbFieldName) => field.setDbFieldName(dbFieldName))
      ._unsafeUnwrap();
  }
  table.pullDomainEvents();
  const rows = Array.from({ length: params.recordCount }, (_, recordIndex): SourceRecord => ({
    id: paddedId('rec', recordIndex),
    version: 1,
    fields: Object.fromEntries(
      fieldIds.map((fieldId, fieldIndex) => [
        fieldId.toString(),
        `row-${recordIndex}-field-${fieldIndex}`,
      ])
    ),
  }));
  const mapper = new CountingTableMapper();
  const repository = new BenchmarkRecordQueryRepository(rows);
  return {
    label: params.label,
    table,
    fieldIds: fieldIds.slice(-params.snapshotCount),
    viewCount: params.viewCount,
    mapper,
    repository,
    service: new FieldUndoRedoSnapshotService(mapper, repository),
  };
};

const scenarios = [
  buildScenario({
    label: '100 fields, 20 snapshots, 1 view, metadata only',
    fieldCount: 100,
    snapshotCount: 20,
    viewCount: 1,
    recordCount: 0,
  }),
  buildScenario({
    label: '500 fields, 100 snapshots, 1 view, metadata only',
    fieldCount: 500,
    snapshotCount: 100,
    viewCount: 1,
    recordCount: 0,
  }),
  buildScenario({
    label: '500 fields, 100 snapshots, 4 views, metadata only',
    fieldCount: 500,
    snapshotCount: 100,
    viewCount: 4,
    recordCount: 0,
  }),
  buildScenario({
    label: '100 fields, 20 snapshots, 1 view, 100 records',
    fieldCount: 100,
    snapshotCount: 20,
    viewCount: 1,
    recordCount: 100,
  }),
];

let sink: RunResult | undefined;

const countOrderedFieldIdArrays = (snapshots: ReadonlyArray<UndoRedoFieldSnapshot>): number => {
  const arrays = new Set<ReadonlyArray<string>>();
  for (const snapshot of snapshots) {
    for (const view of snapshot.views) {
      if (view.orderedFieldIds) arrays.add(view.orderedFieldIds);
    }
  }
  return arrays.size;
};

const runSequential = async (scenario: Scenario): Promise<RunResult> => {
  scenario.mapper.reset();
  scenario.repository.reset();
  const snapshots: UndoRedoFieldSnapshot[] = [];
  for (const fieldId of scenario.fieldIds) {
    snapshots.push(
      (await scenario.service.capture(context, scenario.table, fieldId))._unsafeUnwrap()
    );
  }
  return {
    snapshots,
    mapperCalls: scenario.mapper.calls,
    queryCalls: scenario.repository.calls,
    projectionWidths: scenario.repository.projectionWidths,
    orderedFieldIdArrayCount: countOrderedFieldIdArrays(snapshots),
  };
};

const runBatch = async (scenario: Scenario): Promise<RunResult> => {
  scenario.mapper.reset();
  scenario.repository.reset();
  const snapshots = (
    await scenario.service.captureMany(context, scenario.table, scenario.fieldIds)
  )._unsafeUnwrap();
  return {
    snapshots,
    mapperCalls: scenario.mapper.calls,
    queryCalls: scenario.repository.calls,
    projectionWidths: scenario.repository.projectionWidths,
    orderedFieldIdArrayCount: countOrderedFieldIdArrays(snapshots),
  };
};

const verifyScenario = async (scenario: Scenario): Promise<void> => {
  const sequential = await runSequential(scenario);
  const batch = await runBatch(scenario);
  deepStrictEqual(batch.snapshots, sequential.snapshots);
  strictEqual(sequential.mapperCalls, scenario.fieldIds.length);
  strictEqual(batch.mapperCalls, 1);
  strictEqual(sequential.queryCalls, scenario.fieldIds.length);
  strictEqual(batch.queryCalls, 1);
  strictEqual(sequential.orderedFieldIdArrayCount, scenario.fieldIds.length * scenario.viewCount);
  strictEqual(batch.orderedFieldIdArrayCount, scenario.viewCount);
  deepStrictEqual(
    sequential.projectionWidths,
    scenario.fieldIds.map(() => 1)
  );
  deepStrictEqual(batch.projectionWidths, [scenario.fieldIds.length]);
};

const profileOperation = async (
  scenario: Scenario,
  mode: Profile['mode'],
  round: number,
  run: (scenario: Scenario) => Promise<RunResult>,
  gc: () => void
): Promise<Profile> => {
  sink = undefined;
  gc();
  const heapBefore = process.memoryUsage().heapUsed;
  const cpuBefore = process.cpuUsage();
  const start = performance.now();
  sink = await run(scenario);
  const elapsedMs = performance.now() - start;
  const cpu = process.cpuUsage(cpuBefore);
  const heapAfter = process.memoryUsage().heapUsed;
  const { mapperCalls, queryCalls, projectionWidths, orderedFieldIdArrayCount } = sink;
  // Let the async capture promise and temporary locals leave the current turn before GC.
  await nextTurn();
  gc();
  const retainedWithResult = process.memoryUsage().heapUsed;
  sink = undefined;
  await nextTurn();
  gc();
  return {
    scenario: scenario.label,
    mode,
    round,
    elapsedMs,
    snapshotsPerSecond: (scenario.fieldIds.length * 1_000) / elapsedMs,
    userCpuMs: cpu.user / 1_000,
    systemCpuMs: cpu.system / 1_000,
    heapBefore,
    heapAfter,
    retainedWithResult,
    heapAfterRelease: process.memoryUsage().heapUsed,
    mapperCalls,
    queryCalls,
    projectionWidths,
    orderedFieldIdArrayCount,
  };
};

const profileScenario = async (scenario: Scenario, gc: () => void): Promise<Profile[]> => {
  const profiles: Profile[] = [];
  for (let warmup = 0; warmup < 3; warmup += 1) {
    sink = await runSequential(scenario);
    sink = await runBatch(scenario);
  }
  for (let round = 0; round < 5; round += 1) {
    const algorithms =
      round % 2 === 0
        ? ([
            ['sequential-capture', runSequential],
            ['captureMany', runBatch],
          ] as const)
        : ([
            ['captureMany', runBatch],
            ['sequential-capture', runSequential],
          ] as const);
    for (const [mode, run] of algorithms) {
      profiles.push(await profileOperation(scenario, mode, round, run, gc));
    }
  }
  return profiles;
};

beforeAll(async () => {
  for (const scenario of scenarios) await verifyScenario(scenario);
  if (process.env.FIELD_UNDO_SNAPSHOT_PROFILE !== '1') return;
  const provenance = collectSourceProvenance();
  const gc = (globalThis as typeof globalThis & { gc?: () => void }).gc;
  if (!gc) throw new Error('Heap profiles require node --expose-gc and --pool=threads');
  const profiles: Profile[] = [];
  for (const scenario of scenarios) {
    profiles.push(...(await profileScenario(scenario, gc)));
  }
  const report = {
    issue: 'T8294',
    case: 'Y3764',
    baselineRef: '000edffa9e9f0cfebe4c7c1ca178cf7ba2f9610a',
    ...provenance,
    node: process.version,
    cpu: cpus()[0]?.model,
    source: new URL(
      '../../core/src/application/services/FieldUndoRedoSnapshotService.ts',
      import.meta.url
    ).pathname,
    scope:
      'In-memory FieldUndoRedoSnapshotService with the real DefaultTableMapper and deterministic repository rows. No PostgreSQL, HTTP, command persistence, permissions or serialization timing. Heap snapshots are not peak memory or total allocations.',
    algorithms:
      'sequential-capture is the pre-T8294 CreateFieldsHandler loop over capture(); captureMany is the candidate one-call path. Pair order alternates by round.',
    profiles,
  };
  const output = process.env.FIELD_UNDO_SNAPSHOT_REPORT;
  if (output) writeFileSync(output, JSON.stringify(report, null, 2));
  else console.log(`T8294_PROFILE=${JSON.stringify(report)}`);
});

for (const scenario of scenarios) {
  describe(`Field undo snapshot: ${scenario.label}`, () => {
    bench(
      'sequential capture',
      async () => {
        sink = await runSequential(scenario);
      },
      benchOptions
    );
    bench(
      'captureMany',
      async () => {
        sink = await runBatch(scenario);
      },
      benchOptions
    );
  });
}

import { deepStrictEqual, strictEqual } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, resolve, sep } from 'node:path';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import {
  createV2NodeTestContainer,
  type IV2NodeTestContainer,
} from '@teable/v2-container-node-test';
import {
  ActorId,
  BaseId,
  CreateRecordsCommand,
  type CreateRecordsResult,
  CreateTableCommand,
  type CreateTableResult,
  DbFieldName,
  DeleteTableCommand,
  type DeleteTableResult,
  FieldId,
  FieldKeyType,
  FieldName,
  type ICommandBus,
  recordToFieldValues,
  Table,
  TableName,
  UpsertRecordsCommand,
  type UpsertRecordsResult,
  v2CoreTokens,
} from '@teable/v2-core';
import { beforeAll, bench, describe } from 'vitest';

import {
  RecordBatchCreationService,
  type IRecordBatchCreationInput,
} from '../../core/src/application/services/RecordBatchCreationService';
import { CreateRecordsCommand as SourceCreateRecordsCommand } from '../../core/src/commands/CreateRecordsCommand';
import { UpsertRecordsCommand as SourceUpsertRecordsCommand } from '../../core/src/commands/UpsertRecordsCommand';
import { Table as SourceTable } from '../../core/src/domain/table/Table';
import { benchmarkTableDataSafetyLimits } from './benchmarkTableDataSafetyLimits';

// Measure the actual private pure method, not a copied algorithm. It reads only its input,
// so the benchmark invokes the prototype without unrelated service dependencies. PostgreSQL
// below measures a fully constructed service through the real command container.
type NormalizedRows = ReadonlyArray<ReadonlyMap<string, unknown>>;
type Normalizer = {
  resolveFieldValues(input: IRecordBatchCreationInput): { _unsafeUnwrap(): NormalizedRows };
};
if (
  Table !== SourceTable ||
  CreateRecordsCommand !== SourceCreateRecordsCommand ||
  UpsertRecordsCommand !== SourceUpsertRecordsCommand
) {
  throw new Error('Core workspace dependency resolves outside this checkout');
}
const normalizer = RecordBatchCreationService.prototype as unknown as Normalizer;
const context = { actorId: ActorId.create('t8307-benchmark')._unsafeUnwrap() };
const root = realpathSync(fileURLToPath(new URL('../../../../../', import.meta.url)));
const sourceFiles = [
  'community/packages/v2/core/src/application/services/RecordBatchCreationService.ts',
  'community/packages/v2/core/src/application/services/FieldKeyResolverService.ts',
  'community/packages/v2/core/src/application/services/RecordUpsertService.ts',
  'community/packages/v2/core/src/commands/CreateRecordsHandler.ts',
  'community/packages/v2/core/src/commands/UpsertRecordsHandler.ts',
  'community/packages/v2/benchmark-node/src/record-key-normalization.bench.ts',
];
const digest = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const shapes = [
  { label: 'singleton', fields: 8, populated: 8, rows: 1 },
  { label: 'narrow', fields: 8, populated: 8, rows: 128 },
  { label: 'dense-wide', fields: 200, populated: 200, rows: 32 },
  { label: 'sparse-wide', fields: 200, populated: 4, rows: 128 },
] as const;
type Shape = (typeof shapes)[number];
type Scenario = {
  label: string;
  shape: Shape;
  mode: FieldKeyType;
  input: IRecordBatchCreationInput;
};
const modes = [FieldKeyType.Id, FieldKeyType.Name, FieldKeyType.DbFieldName];
// Id is the current production service input. Name/dbFieldName are supported synthetic
// direct-service cases, not evidence of a production endpoint rebuilding name indexes.
const buildTable = (shape: Shape): Table => {
  const builder = Table.builder()
    .withBaseId(BaseId.create('bse0000000000000001')._unsafeUnwrap())
    .withName(TableName.create(`Key normalization ${shape.label}`)._unsafeUnwrap());
  for (let index = 0; index < shape.fields; index += 1) {
    const field = index === 1 ? builder.field().checkbox() : builder.field().singleLineText();
    field
      .withId(FieldId.create(`fld${index.toString(36).padStart(16, '0')}`)._unsafeUnwrap())
      .withName(FieldName.create(`Field ${index}`)._unsafeUnwrap());
    if (index === 0) field.primary();
    field.done();
  }
  builder.view().defaultGrid().done();
  const table = builder.build()._unsafeUnwrap();
  for (const [index, field] of table.getFields().entries()) {
    field.setDbFieldName(DbFieldName.rehydrate(`column_${index}`)._unsafeUnwrap())._unsafeUnwrap();
  }
  table.pullDomainEvents();
  return table;
};
const cell = (row: number, column: number): unknown =>
  column === 1 ? [false, null, true][row % 3] : `row-${row}-field-${column}`;
const prepare = (shape: Shape, mode: FieldKeyType, table: Table): Scenario => {
  const fields = table.getFields();
  const keys = fields.map((field) => {
    if (mode === FieldKeyType.Id) return field.id().toString();
    if (mode === FieldKeyType.Name) return field.name().toString();
    return field.dbFieldName()._unsafeUnwrap().value()._unsafeUnwrap();
  });
  return {
    label: `${shape.label}/${mode}`,
    shape,
    mode,
    input: {
      table,
      recordsFieldValues: Array.from(
        { length: shape.rows },
        (_, row) =>
          new Map(keys.slice(0, shape.populated).map((key, column) => [key, cell(row, column)]))
      ),
      fieldKeyType: mode,
      typecast: false,
      isTransactionBound: false,
    },
  };
};
const scenarios = shapes.flatMap((shape) => {
  const table = buildTable(shape);
  return modes.map((mode) => prepare(shape, mode, table));
});
const normalize = (scenario: Scenario) =>
  normalizer.resolveFieldValues(scenario.input)._unsafeUnwrap();
// Canonical positions exclude randomly generated table/record/field IDs from semantic digests.
const snapshot = (scenario: Scenario, rows: ReadonlyArray<ReadonlyMap<string, unknown>>) => {
  const positions = new Map(
    scenario.input.table.getFields().map((field, index) => [field.id().toString(), index])
  );
  return rows.map((row) => [...row].map(([id, value]) => [positions.get(id), value]));
};
const verify = (
  scenario: Scenario,
  rows: ReadonlyArray<ReadonlyMap<string, unknown>>,
  command: boolean
): string => {
  const actual = snapshot(scenario, rows);
  const expected = Array.from({ length: scenario.shape.rows }, (_, row) =>
    Array.from({ length: scenario.shape.populated }, (_, column) => {
      const value = cell(row, column);
      return [
        column,
        column === 1 && value === false && (command || scenario.mode !== FieldKeyType.Id)
          ? null
          : value,
      ];
    })
  );
  deepStrictEqual(actual, expected);
  return digest(actual);
};
let sink: unknown;
const pgEnabled = process.env.RECORD_KEY_PG === '1';
const pgControl = process.env.RECORD_KEY_PG_COMMAND === 'create';
const output = process.env.RECORD_KEY_REPORT;
const profiling = Boolean(output) || pgEnabled;
const requireReport = (): string => {
  if (!output) throw new Error('RECORD_KEY_PG=1 requires RECORD_KEY_REPORT=/tmp/...json');
  const path = resolve(output);
  const temporaryRoot = realpathSync('/tmp');
  const directory = realpathSync(dirname(path));
  if (directory !== temporaryRoot && !directory.startsWith(`${temporaryRoot}${sep}`)) {
    throw new Error('RECORD_KEY_REPORT must be under /tmp');
  }
  return path;
};
const provenance = () => {
  const expected = process.env.RECORD_KEY_CHECKOUT;
  if (!expected || realpathSync(expected) !== root) {
    throw new Error('Profiles require RECORD_KEY_CHECKOUT pointing to this exact checkout');
  }
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  strictEqual(realpathSync(git('rev-parse', '--show-toplevel')), root);
  return {
    checkout: root,
    variant: process.env.RECORD_KEY_VARIANT ?? 'unspecified',
    head: git('rev-parse', 'HEAD'),
    baselineRef: 'd538df9c835173e5f34bf53cc7f6a19908f39bff',
    loadedSourceIdentity:
      'package Table/CreateRecordsCommand/UpsertRecordsCommand === checkout source; PG container service checked when enabled; normalization invokes checkout prototype',
    sourceSha256: Object.fromEntries(
      sourceFiles.map((path) => [
        path,
        createHash('sha256')
          .update(readFileSync(resolve(root, path)))
          .digest('hex'),
      ])
    ),
  };
};
const measure = async (
  scenario: Scenario,
  round: number,
  run: () => unknown | Promise<unknown>,
  semantics: () => string,
  gc: () => void
) => {
  sink = undefined;
  gc();
  const heapBefore = process.memoryUsage().heapUsed;
  const cpuBefore = process.cpuUsage();
  const start = performance.now();
  sink = run();
  if (sink instanceof Promise) sink = await sink;
  const elapsedMs = performance.now() - start;
  const cpu = process.cpuUsage(cpuBefore);
  const heapOperationEnd = process.memoryUsage().heapUsed;
  await nextTurn();
  gc();
  const heapRetainedWithResult = process.memoryUsage().heapUsed;
  const semanticDigest = semantics();
  sink = undefined;
  await nextTurn();
  gc();
  return {
    scenario: scenario.label,
    round,
    elapsedMs,
    rowsPerSecond: (scenario.shape.rows * 1_000) / elapsedMs,
    userCpuMs: cpu.user / 1_000,
    systemCpuMs: cpu.system / 1_000,
    heapBefore,
    heapOperationEnd,
    heapRetainedWithResult,
    heapAfterRelease: process.memoryUsage().heapUsed,
    semanticDigest,
  };
};
const profileNormalization = async (gc: () => void) => {
  const profiles = [];
  for (const scenario of scenarios) normalize(scenario);
  for (let round = 0; round < 5; round += 1) {
    for (const scenario of round % 2 ? [...scenarios].reverse() : scenarios) {
      profiles.push(
        await measure(
          scenario,
          round,
          () => normalize(scenario),
          () => verify(scenario, sink as NormalizedRows, false),
          gc
        )
      );
    }
  }
  return profiles;
};
const disposePg = async (test: IV2NodeTestContainer, tableIds: ReadonlyArray<string>) => {
  const bus = test.container.resolve<ICommandBus>(v2CoreTokens.commandBus);
  try {
    for (const tableId of tableIds) {
      (
        await bus.execute<DeleteTableCommand, DeleteTableResult>(
          context,
          DeleteTableCommand.create({
            baseId: test.baseId.toString(),
            tableId,
            mode: 'permanent',
          })._unsafeUnwrap()
        )
      )._unsafeUnwrap();
    }
  } finally {
    await test.dispose();
  }
};

const profilePg = async (gc: () => void) => {
  const inherited = ['TEABLE_V2_TEST_DATABASE_URL', 'PRISMA_DATABASE_URL', 'DATABASE_URL'].filter(
    (name) => process.env[name]
  );
  if (inherited.length)
    throw new Error(`Refusing inherited database URLs: ${inherited.join(', ')}`);
  let test: IV2NodeTestContainer | undefined;
  const tableIds: string[] = [];
  try {
    test = await createV2NodeTestContainer({
      tableDataSafetyLimits: benchmarkTableDataSafetyLimits,
    });
    if (test.connectionString.startsWith('pglite:') || test.connectionString === 'memory://') {
      throw new Error('RECORD_KEY_PG requires isolated real PostgreSQL');
    }
    if (
      !(
        test.container.resolve(v2CoreTokens.recordBatchCreationService) instanceof
        RecordBatchCreationService
      )
    ) {
      throw new Error('PostgreSQL container service resolves outside this checkout');
    }
    const bus = test.container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const baseId = test.baseId.toString();
    const version = await test.dataDb
      .selectNoFrom((eb) => eb.fn<string>('version', []).as('version'))
      .executeTakeFirstOrThrow();
    const fixtures = [];
    // One warmup and three measured commands, each on a fresh empty table. All preparation,
    // including command parsing, completes before any measured command executes.
    for (let round = -1; round < 3; round += 1) {
      for (const original of scenarios) {
        const created = (
          await bus.execute<CreateTableCommand, CreateTableResult>(
            context,
            CreateTableCommand.create({
              baseId,
              name: `T8307 ${round} ${original.label}`,
              fields: Array.from({ length: original.shape.fields }, (_, index) => ({
                name: `Field ${index}`,
                type: index === 1 ? ('checkbox' as const) : ('singleLineText' as const),
                ...(index === 0 ? { isPrimary: true, unique: true } : {}),
              })),
              views: [{ type: 'grid' }],
            })._unsafeUnwrap()
          )
        )._unsafeUnwrap();
        tableIds.push(created.table.id().toString());
        const scenario = prepare(original.shape, original.mode, created.table);
        const input = {
          tableId: created.table.id().toString(),
          fieldKeyType: scenario.mode,
          typecast: false,
          records: scenario.input.recordsFieldValues.map((fields) => ({
            fields: Object.fromEntries(fields),
          })),
        };
        const command = pgControl
          ? CreateRecordsCommand.create(input)._unsafeUnwrap()
          : UpsertRecordsCommand.create({
              ...input,
              matchField: created.table.getFields()[0]!.id().toString(),
              onConflict: 'error',
            })._unsafeUnwrap();
        fixtures.push({ round, scenario, command });
      }
    }
    const profiles = [];
    for (const { round, scenario, command } of fixtures) {
      const run = async () =>
        command instanceof CreateRecordsCommand
          ? (
              await bus.execute<CreateRecordsCommand, CreateRecordsResult>(context, command)
            )._unsafeUnwrap()
          : (
              await bus.execute<UpsertRecordsCommand, UpsertRecordsResult>(context, command)
            )._unsafeUnwrap();
      const semantics = () => {
        const result = sink as CreateRecordsResult | UpsertRecordsResult;
        const records =
          'records' in result
            ? result.records
            : result.results.map((row, index) => {
                strictEqual(row.status, 'created');
                strictEqual(row.index, index);
                if (!row.record) throw new Error('Upsert insert result omitted record');
                return row.record;
              });
        if ('summary' in result)
          deepStrictEqual(result.summary, {
            requested: scenario.shape.rows,
            created: scenario.shape.rows,
            updated: 0,
            unchanged: 0,
            skipped: 0,
          });
        return verify(
          scenario,
          records.map(
            (record) =>
              new Map(recordToFieldValues(record).map(({ fieldId, value }) => [fieldId, value]))
          ),
          true
        );
      };
      if (round < 0) {
        sink = await run();
        semantics();
        sink = undefined;
      } else {
        profiles.push(await measure(scenario, round, run, semantics, gc));
      }
    }
    return {
      database: { kind: 'isolated PostgreSQL testcontainer', version: version.version },
      profiles,
    };
  } finally {
    if (test) await disposePg(test, tableIds);
  }
};

beforeAll(async () => {
  for (const scenario of scenarios) verify(scenario, normalize(scenario), false);
  if (!profiling) return;
  const reportPath = requireReport();
  const source = provenance();
  const gc = (globalThis as typeof globalThis & { gc?: () => void }).gc;
  if (!gc) throw new Error('Profiles require node --expose-gc and Vitest --pool=threads');
  const measured = pgEnabled ? await profilePg(gc) : { profiles: await profileNormalization(gc) };
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        issue: 'T8307',
        case: 'Y3770',
        ...source,
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        cpu: cpus()[0]?.model,
        reportPath,
        operation: pgEnabled
          ? pgControl
            ? 'CreateRecordsCommand (unaffected control)'
            : 'UpsertRecordsCommand (insert-only)'
          : 'resolveFieldValues',
        productionBoundary:
          'RecordUpsertService and PasteLinkAutoResolveService pass Id to the service. Name/dbFieldName direct-service scenarios are synthetic. Upsert command input modes resolve before the service; service input is always Id. CreateRecordsHandler has its own normalization pipeline and is an unaffected control, not the changed path.',
        fixtures: shapes,
        modes,
        typecast: false,
        fixtureDigest: digest(
          scenarios.map((scenario) => ({
            label: scenario.label,
            rows: [...scenario.input.recordsFieldValues].map((row) => [...row]),
          }))
        ),
        scope: pgEnabled
          ? 'Wall time covers awaited real commandBus.execute, including table load, normalization, upsert match query (upsert mode), validation, plugins, materialization, PG persistence and awaited side effects/event publication. All tables start empty. Excludes fixture/table/command preparation, cleanup and explicit outbox drain. Node CPU excludes PostgreSQL server CPU. No endpoint speedup is implied.'
          : 'Actual private RecordBatchCreationService.resolveFieldValues invoked on its prototype, including Object/Map conversions. The method reads only its input; no service lifecycle is measured. Id is the production-caller case; name/dbFieldName are synthetic supported modes. Excludes typecasting, plugins, materialization, repositories and SQL; no copied algorithm or measured mocks.',
        memorySemantics:
          'heapOperationEnd is an immediate snapshot, not peak heap or total allocations. Retained snapshots follow an async turn and explicit GC with output held, then released. Prepared fixtures (and PG container when enabled) remain live. CPU is process-wide Node user/system CPU.',
        profileRounds: pgEnabled ? 3 : 5,
        ...measured,
      },
      null,
      2
    )
  );
  console.log(`T8307 report: ${reportPath}`);
}, 900_000);

if (profiling) {
  describe('T8307 profile driver', () => {
    bench(
      'profile written by beforeAll',
      () => {
        strictEqual(Boolean(output), true);
      },
      {
        iterations: 1,
        time: 1,
        warmupIterations: 0,
        warmupTime: 0,
        throws: true,
      }
    );
  });
} else {
  for (const scenario of scenarios) {
    describe(`Record key normalization ${scenario.label}`, () => {
      bench(
        'actual resolveFieldValues',
        () => {
          sink = normalize(scenario);
        },
        {
          iterations: 3,
          time: 100,
          warmupIterations: 1,
          warmupTime: 25,
          throws: true,
        }
      );
    });
  }
}

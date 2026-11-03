import { deepStrictEqual, strictEqual } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import {
  createV2NodeTestContainer,
  type IV2NodeTestContainer,
} from '@teable/v2-container-node-test';
import {
  ActorId,
  BaseId,
  CellValueMultiplicity,
  CellValueType,
  CreateFieldsCommand,
  type CreateFieldsResult,
  CreateTableCommand,
  type CreateTableResult,
  DeleteTableCommand,
  type DeleteTableResult,
  type Field,
  FieldId,
  FieldName,
  FormulaExpression,
  FormulaField,
  type ICommandBus,
  type ICreateFieldsCommandInput,
  type IExecutionContext,
  NumberField,
  Table,
  TableId,
  type TableUpdateResult,
  TableName,
  v2CoreTokens,
  ViewId,
  ViewName,
} from '@teable/v2-core';
import { beforeAll, bench, describe } from 'vitest';

import { CreateFieldsCommand as SourceCreateFieldsCommand } from '../../core/src/commands/CreateFieldsCommand';
import { SingleLineTextField } from '../../core/src/domain/table/fields/types/SingleLineTextField';
import { Table as SourceTable } from '../../core/src/domain/table/Table';
import { benchmarkTableDataSafetyLimits } from './benchmarkTableDataSafetyLimits';

if (Table !== SourceTable || CreateFieldsCommand !== SourceCreateFieldsCommand) {
  throw new Error('Core workspace dependency does not resolve to this checkout');
}

const issue = 'T8299';
const acceptanceCase = 'Y3766';
const baselineProductionRef = '4bfaf12c9c510b515269e81061aee4ce909c834b';
const benchOptions = {
  time: 1_000,
  warmupTime: 250,
  iterations: 10,
  warmupIterations: 3,
  throws: true,
};
const context: IExecutionContext = {
  actorId: ActorId.create('t8299-field-metadata-benchmark')._unsafeUnwrap(),
};

type Variant = 'baseline' | 'candidate';
type ScenarioMode = 'neutral' | 'dependency-chain';
type Scenario = {
  readonly label: string;
  readonly existingFieldCount: number;
  readonly addCount: number;
  readonly viewCount: number;
  readonly mode: ScenarioMode;
  readonly table: Table;
};
type SemanticSnapshot = {
  readonly fields: ReadonlyArray<{
    readonly name: string;
    readonly type: string;
    readonly dependencies: ReadonlyArray<string>;
    readonly dependents: ReadonlyArray<string>;
  }>;
  readonly views: ReadonlyArray<{
    readonly name: string;
    readonly type: string;
    readonly orderedFields: ReadonlyArray<string>;
  }>;
};
type Profile = {
  readonly scenario: string;
  readonly round: number;
  readonly elapsedMs: number;
  readonly operationsPerSecond: number;
  readonly fieldsPerSecond: number;
  readonly userCpuMs: number;
  readonly systemCpuMs: number;
  readonly heapBefore: number;
  readonly heapAfter: number;
  readonly retainedWithResult: number;
  readonly heapAfterRelease: number;
  readonly resultingFieldCount: number;
  readonly resultingViewCount: number;
  readonly semanticFingerprint: string;
};
type CommandProfile = Profile & {
  readonly createdFieldCount: number;
  readonly eventCount: number;
};
type Provenance = {
  readonly variant: Variant;
  readonly measuredSourceHead: string;
  readonly coreSourceTreeSha256: string;
  readonly sourceSha256: Readonly<Record<string, string>>;
};
type AddedFields = ReadonlyArray<Field>;

type PgFixture = {
  readonly tableId: string;
  readonly command: CreateFieldsCommand;
};

const scenarios = [
  {
    label: '1 existing + 1 add, 1 view',
    existingFieldCount: 1,
    addCount: 1,
    viewCount: 1,
    mode: 'neutral',
  },
  {
    label: '100 existing + 20 add, 1 view',
    existingFieldCount: 100,
    addCount: 20,
    viewCount: 1,
    mode: 'neutral',
  },
  {
    label: '400 existing + 100 add, 1 view',
    existingFieldCount: 400,
    addCount: 100,
    viewCount: 1,
    mode: 'neutral',
  },
  {
    label: '100 existing + 20 add, 4 views',
    existingFieldCount: 100,
    addCount: 20,
    viewCount: 4,
    mode: 'neutral',
  },
  {
    label: '20 existing + 20 dependent add, 2 views',
    existingFieldCount: 20,
    addCount: 20,
    viewCount: 2,
    mode: 'dependency-chain',
  },
] as const satisfies ReadonlyArray<Omit<Scenario, 'table'>>;

const paddedId = (prefix: 'fld' | 'tbl' | 'viw', value: number): string =>
  `${prefix}${value.toString(36).padStart(16, '0')}`;

const buildTable = (definition: (typeof scenarios)[number], scenarioIndex: number): Table => {
  const builder = Table.builder()
    .withId(TableId.create(paddedId('tbl', scenarioIndex + 1))._unsafeUnwrap())
    .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create(`T8299 ${definition.label}`)._unsafeUnwrap());
  for (let index = 0; index < definition.existingFieldCount; index += 1) {
    const fieldBuilder = builder
      .field()
      .singleLineText()
      .withId(FieldId.create(paddedId('fld', scenarioIndex * 10_000 + index + 1))._unsafeUnwrap())
      .withName(FieldName.create(`Existing ${index}`)._unsafeUnwrap());
    if (index === 0) fieldBuilder.primary();
    fieldBuilder.done();
  }
  for (let index = 0; index < definition.viewCount; index += 1) {
    builder
      .view()
      .grid()
      .withId(ViewId.create(paddedId('viw', scenarioIndex * 100 + index + 1))._unsafeUnwrap())
      .withName(ViewName.create(`View ${index}`)._unsafeUnwrap())
      .done();
  }
  return builder.build()._unsafeUnwrap();
};

const preparedScenarios: ReadonlyArray<Scenario> = scenarios.map((definition, index) => ({
  ...definition,
  table: buildTable(definition, index),
}));

const createAddedFields = (scenario: Scenario, seed: number): AddedFields => {
  const start = 1_000_000 + seed * 1_000;
  if (scenario.mode === 'neutral') {
    return Array.from({ length: scenario.addCount }, (_, index) =>
      SingleLineTextField.create({
        id: FieldId.create(paddedId('fld', start + index))._unsafeUnwrap(),
        name: FieldName.create(`Added ${index}`)._unsafeUnwrap(),
      })._unsafeUnwrap()
    );
  }

  const fields: Field[] = [];
  const sourceId = FieldId.create(paddedId('fld', start))._unsafeUnwrap();
  fields.push(
    NumberField.create({
      id: sourceId,
      name: FieldName.create('Added 0')._unsafeUnwrap(),
    })._unsafeUnwrap()
  );
  let dependencyId = sourceId;
  for (let index = 1; index < scenario.addCount; index += 1) {
    const id = FieldId.create(paddedId('fld', start + index))._unsafeUnwrap();
    fields.push(
      FormulaField.create({
        id,
        name: FieldName.create(`Added ${index}`)._unsafeUnwrap(),
        expression: FormulaExpression.create(`{${dependencyId.toString()}} + 1`)._unsafeUnwrap(),
        resultType: {
          cellValueType: CellValueType.number(),
          isMultipleCellValue: CellValueMultiplicity.single(),
        },
      })._unsafeUnwrap()
    );
    dependencyId = id;
  }
  return fields;
};

const runMetadataUpdate = (scenario: Scenario, fields: AddedFields) =>
  scenario.table.update((mutator) => mutator.addFields(fields))._unsafeUnwrap();

const semanticSnapshot = (table: Table): SemanticSnapshot => {
  const fields = table.getFields();
  const nameById = new Map(fields.map((field) => [field.id().toString(), field.name().toString()]));
  return {
    fields: fields.map((field) => ({
      name: field.name().toString(),
      type: field.type().toString(),
      dependencies: field.dependencies().map((id) => nameById.get(id.toString()) ?? '<external>'),
      dependents: field.dependents().map((id) => nameById.get(id.toString()) ?? '<external>'),
    })),
    views: table.views().map((view) => ({
      name: view.name().toString(),
      type: view.type().toString(),
      orderedFields: table
        .getOrderedVisibleFieldIds(view.id().toString())
        ._unsafeUnwrap()
        .map((fieldId) => nameById.get(fieldId.toString()) ?? '<missing>'),
    })),
  };
};

const expectedSemanticSnapshot = (scenario: Scenario): SemanticSnapshot => {
  const existingNames = Array.from(
    { length: scenario.existingFieldCount },
    (_, index) => `Existing ${index}`
  );
  const addedNames = Array.from({ length: scenario.addCount }, (_, index) => `Added ${index}`);
  const allNames = [...existingNames, ...addedNames];
  return {
    fields: allNames.map((name, index) => {
      const addedIndex = index - scenario.existingFieldCount;
      const isDependency = scenario.mode === 'dependency-chain' && addedIndex >= 0;
      const dependencies = isDependency && addedIndex > 0 ? [`Added ${addedIndex - 1}`] : [];
      const dependents =
        isDependency && addedIndex >= 0 && addedIndex < scenario.addCount - 1
          ? [`Added ${addedIndex + 1}`]
          : [];
      return {
        name,
        type: isDependency ? (addedIndex === 0 ? 'number' : 'formula') : 'singleLineText',
        dependencies,
        dependents,
      };
    }),
    views: Array.from({ length: scenario.viewCount }, (_, index) => ({
      name: `View ${index}`,
      type: 'grid',
      orderedFields: allNames,
    })),
  };
};

const fingerprint = (snapshot: SemanticSnapshot): string =>
  createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');

const verifyMetadataScenario = (scenario: Scenario, seed: number): void => {
  const result = runMetadataUpdate(scenario, createAddedFields(scenario, seed));
  deepStrictEqual(semanticSnapshot(result.table), expectedSemanticSnapshot(scenario));
};

const collectSourceProvenance = (): Provenance => {
  const root = new URL('../../../../../', import.meta.url);
  const expectedHead = process.env.T8299_EXPECTED_HEAD;
  if (!expectedHead || !/^[a-f0-9]{40}$/.test(expectedHead)) {
    throw new Error('T8299 benchmark requires T8299_EXPECTED_HEAD as a full commit SHA');
  }
  const variant = process.env.T8299_VARIANT;
  if (variant !== 'baseline' && variant !== 'candidate') {
    throw new Error('T8299 benchmark requires T8299_VARIANT=baseline or candidate');
  }
  const git = (args: string[]) =>
    execFileSync('git', ['-C', fileURLToPath(root), ...args], { encoding: 'utf8' }).trim();
  const measuredSourceHead = git(['rev-parse', 'HEAD']);
  if (measuredSourceHead !== expectedHead) {
    throw new Error(`Unexpected source head: expected ${expectedHead}, got ${measuredSourceHead}`);
  }
  const benchmarkPath = 'community/packages/v2/benchmark-node/src/t8299-field-metadata.bench.ts';
  const corePath = 'community/packages/v2/core/src';
  const schemaVisitorPath =
    'community/packages/v2/adapter-table-repository-postgres/src/schema/visitors/TableSchemaUpdateVisitor.ts';
  const sourcePaths = [
    benchmarkPath,
    'community/packages/v2/core/src/domain/table/Table.ts',
    'community/packages/v2/core/src/domain/table/TableMutator.ts',
    'community/packages/v2/core/src/domain/table/resolveFormulaFields.ts',
    'community/packages/v2/core/src/domain/table/fields/types/SingleLineTextField.ts',
    'community/packages/v2/core/src/domain/table/specs/TableAddFieldsSpec.ts',
    'community/packages/v2/core/src/domain/table/specs/TableUpdateViewColumnMetaSpec.ts',
    'community/packages/v2/core/src/commands/CreateFieldsCommand.ts',
    'community/packages/v2/core/src/commands/CreateFieldsHandler.ts',
    schemaVisitorPath,
  ];
  const productionPaths = [
    corePath,
    schemaVisitorPath,
    ':(exclude)**/*.spec.ts',
    ':(exclude)**/*.test.ts',
    ':(exclude)**/*.md',
  ];
  const dirty = git([
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
    '--',
    benchmarkPath,
    ...productionPaths,
  ]);
  if (dirty) {
    throw new Error(`T8299 profile requires clean benchmark and production sources:\n${dirty}`);
  }
  if (variant === 'baseline') {
    const changedProduction = git([
      'diff',
      '--name-only',
      baselineProductionRef,
      'HEAD',
      '--',
      ...productionPaths,
    ]);
    if (changedProduction) {
      throw new Error(
        `Baseline production sources differ from ${baselineProductionRef}:\n${changedProduction}`
      );
    }
  }
  return {
    coreSourceTreeSha256: createHash('sha256')
      .update(git(['ls-tree', '-r', '--full-tree', 'HEAD', '--', corePath]))
      .digest('hex'),
    variant,
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

let metadataSink: TableUpdateResult | undefined;
let tinyFields: AddedFields | undefined;
let tinySeed = 50_000;

const requireGc = (): (() => void) => {
  const gc = (globalThis as typeof globalThis & { gc?: () => void }).gc;
  if (!gc) {
    throw new Error('T8299 raw profiles require node --expose-gc and --pool=threads');
  }
  return gc;
};

const profileMetadataOperation = async (
  scenario: Scenario,
  round: number,
  seed: number,
  gc: () => void
): Promise<Profile> => {
  let fields: AddedFields | undefined = createAddedFields(scenario, seed);
  metadataSink = undefined;
  gc();
  const heapBefore = process.memoryUsage().heapUsed;
  const cpuBefore = process.cpuUsage();
  const start = performance.now();
  metadataSink = runMetadataUpdate(scenario, fields);
  const elapsedMs = performance.now() - start;
  const cpu = process.cpuUsage(cpuBefore);
  const heapAfter = process.memoryUsage().heapUsed;
  fields = undefined;
  await nextTurn();
  gc();
  const retainedWithResult = process.memoryUsage().heapUsed;
  let snapshot: SemanticSnapshot | undefined = semanticSnapshot(metadataSink.table);
  deepStrictEqual(snapshot, expectedSemanticSnapshot(scenario));
  const resultingFieldCount = metadataSink.table.getFields().length;
  const resultingViewCount = metadataSink.table.views().length;
  const semanticFingerprint = fingerprint(snapshot);
  snapshot = undefined;
  metadataSink = undefined;
  await nextTurn();
  gc();
  return {
    scenario: scenario.label,
    round,
    elapsedMs,
    operationsPerSecond: 1_000 / elapsedMs,
    fieldsPerSecond: (scenario.addCount * 1_000) / elapsedMs,
    userCpuMs: cpu.user / 1_000,
    systemCpuMs: cpu.system / 1_000,
    heapBefore,
    heapAfter,
    retainedWithResult,
    heapAfterRelease: process.memoryUsage().heapUsed,
    resultingFieldCount,
    resultingViewCount,
    semanticFingerprint,
  };
};

const profileMetadata = async (gc: () => void): Promise<ReadonlyArray<Profile>> => {
  for (const [index, scenario] of preparedScenarios.entries()) {
    for (let warmup = 0; warmup < 2; warmup += 1) {
      metadataSink = runMetadataUpdate(
        scenario,
        createAddedFields(scenario, 60_000 + index * 10 + warmup)
      );
    }
    metadataSink = undefined;
  }
  const profiles: Profile[] = [];
  for (let round = 0; round < 5; round += 1) {
    const ordered = round % 2 === 0 ? preparedScenarios : [...preparedScenarios].reverse();
    for (const [index, scenario] of ordered.entries()) {
      profiles.push(
        await profileMetadataOperation(scenario, round, 70_000 + round * 100 + index, gc)
      );
    }
  }
  return profiles;
};

const commandFields = (scenario: Scenario): ICreateFieldsCommandInput['fields'] => {
  if (scenario.mode === 'neutral') {
    return Array.from({ length: scenario.addCount }, (_, index) => ({
      id: FieldId.generate()._unsafeUnwrap().toString(),
      name: `Added ${index}`,
      type: 'singleLineText' as const,
    }));
  }
  const ids = Array.from({ length: scenario.addCount }, () =>
    FieldId.generate()._unsafeUnwrap().toString()
  );
  return ids.map((id, index) =>
    index === 0
      ? { id, name: 'Added 0', type: 'number' as const }
      : {
          id,
          name: `Added ${index}`,
          type: 'formula' as const,
          options: { expression: `{${ids[index - 1]!}} + 1` },
        }
  );
};

const createPgFixture = async (
  commandBus: ICommandBus,
  baseId: string,
  scenario: Scenario,
  fixtureIndex: number
): Promise<PgFixture> => {
  const createResult = await commandBus.execute<CreateTableCommand, CreateTableResult>(
    context,
    CreateTableCommand.create({
      baseId,
      name: `T8299_${fixtureIndex}_${scenario.existingFieldCount}_${scenario.addCount}`,
      fields: Array.from({ length: scenario.existingFieldCount }, (_, index) => ({
        name: `Existing ${index}`,
        type: 'singleLineText' as const,
        ...(index === 0 ? { isPrimary: true } : {}),
      })),
      views: Array.from({ length: scenario.viewCount }, (_, index) => ({
        name: `View ${index}`,
        type: 'grid' as const,
      })),
    })._unsafeUnwrap()
  );
  const table = createResult._unsafeUnwrap().table;
  return {
    tableId: table.id().toString(),
    command: CreateFieldsCommand.create({
      baseId,
      tableId: table.id().toString(),
      fields: commandFields(scenario),
    })._unsafeUnwrap(),
  };
};

let commandSink: CreateFieldsResult | undefined;

const executeCommandFixture = async (
  commandBus: ICommandBus,
  scenario: Scenario,
  fixture: PgFixture
): Promise<CreateFieldsResult> => {
  const result = await commandBus.execute<CreateFieldsCommand, CreateFieldsResult>(
    context,
    fixture.command
  );
  const value = result._unsafeUnwrap();
  deepStrictEqual(semanticSnapshot(value.table), expectedSemanticSnapshot(scenario));
  strictEqual(value.fields.length, scenario.addCount);
  return value;
};

const profileCommandOperation = async (
  commandBus: ICommandBus,
  scenario: Scenario,
  round: number,
  initialFixture: PgFixture,
  gc: () => void
): Promise<CommandProfile> => {
  let fixture: PgFixture | undefined = initialFixture;
  commandSink = undefined;
  gc();
  const heapBefore = process.memoryUsage().heapUsed;
  const cpuBefore = process.cpuUsage();
  const start = performance.now();
  commandSink = (
    await commandBus.execute<CreateFieldsCommand, CreateFieldsResult>(context, fixture.command)
  )._unsafeUnwrap();
  const elapsedMs = performance.now() - start;
  const cpu = process.cpuUsage(cpuBefore);
  const heapAfter = process.memoryUsage().heapUsed;
  fixture = undefined;
  await nextTurn();
  gc();
  const retainedWithResult = process.memoryUsage().heapUsed;
  let snapshot: SemanticSnapshot | undefined = semanticSnapshot(commandSink.table);
  deepStrictEqual(snapshot, expectedSemanticSnapshot(scenario));
  strictEqual(commandSink.fields.length, scenario.addCount);
  const createdFieldCount = commandSink.fields.length;
  const eventCount = commandSink.events.length;
  const resultingFieldCount = commandSink.table.getFields().length;
  const resultingViewCount = commandSink.table.views().length;
  const semanticFingerprint = fingerprint(snapshot);
  snapshot = undefined;
  commandSink = undefined;
  await nextTurn();
  gc();
  return {
    scenario: scenario.label,
    round,
    elapsedMs,
    operationsPerSecond: 1_000 / elapsedMs,
    fieldsPerSecond: (scenario.addCount * 1_000) / elapsedMs,
    userCpuMs: cpu.user / 1_000,
    systemCpuMs: cpu.system / 1_000,
    heapBefore,
    heapAfter,
    retainedWithResult,
    heapAfterRelease: process.memoryUsage().heapUsed,
    resultingFieldCount,
    resultingViewCount,
    semanticFingerprint,
    createdFieldCount,
    eventCount,
  };
};

const deletePgFixtures = async (
  commandBus: ICommandBus,
  baseId: string,
  tableIds: string[]
): Promise<void> => {
  while (tableIds.length) {
    const tableId = tableIds.pop()!;
    (
      await commandBus.execute<DeleteTableCommand, DeleteTableResult>(
        context,
        DeleteTableCommand.create({ baseId, tableId, mode: 'permanent' })._unsafeUnwrap()
      )
    )._unsafeUnwrap();
  }
};

const assertIsolatedRealPg = (): void => {
  const inherited = ['TEABLE_V2_TEST_DATABASE_URL', 'PRISMA_DATABASE_URL', 'DATABASE_URL'].filter(
    (name) => process.env[name]
  );
  if (inherited.length) {
    throw new Error(
      `T8299 PG profile requires database URL variables unset so createV2NodeTestContainer starts isolated PostgreSQL: ${inherited.join(', ')}`
    );
  }
};

const preparePgFixtures = async (
  commandBus: ICommandBus,
  baseId: string,
  tableIds: string[]
): Promise<Map<string, PgFixture[]>> => {
  const fixtures = new Map<string, PgFixture[]>();
  let fixtureIndex = 0;
  for (const scenario of preparedScenarios) {
    const scenarioFixtures: PgFixture[] = [];
    for (let index = 0; index < 4; index += 1) {
      const fixture = await createPgFixture(commandBus, baseId, scenario, fixtureIndex++);
      tableIds.push(fixture.tableId);
      scenarioFixtures.push(fixture);
    }
    fixtures.set(scenario.label, scenarioFixtures);
  }
  return fixtures;
};

const measurePgFixtures = async (
  commandBus: ICommandBus,
  fixtures: Map<string, PgFixture[]>,
  gc: () => void
): Promise<CommandProfile[]> => {
  for (const scenario of preparedScenarios) {
    const warmup = fixtures.get(scenario.label)!.shift()!;
    commandSink = await executeCommandFixture(commandBus, scenario, warmup);
    commandSink = undefined;
  }
  const profiles: CommandProfile[] = [];
  for (let round = 0; round < 3; round += 1) {
    const ordered = round % 2 === 0 ? preparedScenarios : [...preparedScenarios].reverse();
    for (const scenario of ordered) {
      const fixture = fixtures.get(scenario.label)!.shift();
      if (!fixture) throw new Error(`Missing prepared PG fixture for ${scenario.label}`);
      profiles.push(await profileCommandOperation(commandBus, scenario, round, fixture, gc));
    }
  }
  return profiles;
};

const profilePgCommands = async (provenance: Provenance, gc: () => void): Promise<void> => {
  assertIsolatedRealPg();
  const output = process.env.T8299_PG_REPORT;
  if (!output) throw new Error('T8299_PG_PROFILE=1 requires T8299_PG_REPORT');
  let testContainer: IV2NodeTestContainer | undefined;
  const tableIds: string[] = [];
  try {
    testContainer = await createV2NodeTestContainer({
      tableDataSafetyLimits: benchmarkTableDataSafetyLimits,
    });
    if (
      testContainer.connectionString.startsWith('pglite://') ||
      testContainer.connectionString === 'memory://'
    ) {
      throw new Error('T8299 command performance profile refuses PGlite');
    }
    const commandBus = testContainer.container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const baseId = testContainer.baseId.toString();
    const pgVersionResult = await testContainer.dataDb
      .selectNoFrom((eb) => eb.fn<string>('version', []).as('serverVersion'))
      .executeTakeFirst();
    const pgVersion = pgVersionResult?.serverVersion;
    if (!pgVersion) throw new Error('Unable to read PostgreSQL server version');
    const fixtures = await preparePgFixtures(commandBus, baseId, tableIds);
    const profiles = await measurePgFixtures(commandBus, fixtures, gc);

    await deletePgFixtures(commandBus, baseId, tableIds);
    writeFileSync(
      output,
      JSON.stringify(
        {
          issue,
          case: acceptanceCase,
          baselineProductionRef,
          ...provenance,
          node: process.version,
          cpu: cpus()[0]?.model,
          database: { kind: 'isolated PostgreSQL testcontainer', version: pgVersion },
          rounds: 3,
          scope:
            'CreateFieldsCommand inputs and fresh tables are prepared before timing; permanent table cleanup is after all measurements. Wall time is commandBus.execute and includes awaited table load, field planning, Table.update(addFields), PostgreSQL network/lock/DDL waits, schema and metadata persistence, awaited field side effects, and awaited event publication. Process CPU is Node/JavaScript and native client CPU only, not PostgreSQL container CPU. The context has no windowId, so undo snapshot capture is excluded. No explicit computed/event outbox drain or other background-idle wait is included.',
          profiles,
        },
        null,
        2
      )
    );
  } finally {
    if (testContainer && tableIds.length) {
      const commandBus = testContainer.container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      await deletePgFixtures(commandBus, testContainer.baseId.toString(), tableIds);
    }
    await testContainer?.dispose();
  }
};

beforeAll(async () => {
  for (const [index, scenario] of preparedScenarios.entries()) {
    verifyMetadataScenario(scenario, 40_000 + index);
  }
  if (process.env.T8299_PROFILE !== '1' && process.env.T8299_PG_PROFILE !== '1') return;
  const provenance = collectSourceProvenance();
  console.log(
    `T8299_PROVENANCE=${JSON.stringify({
      issue,
      case: acceptanceCase,
      baselineProductionRef,
      ...provenance,
    })}`
  );

  if (process.env.T8299_PROFILE === '1') {
    const output = process.env.T8299_METADATA_REPORT;
    if (!output) throw new Error('T8299_PROFILE=1 requires T8299_METADATA_REPORT');
    const profiles = await profileMetadata(requireGc());
    writeFileSync(
      output,
      JSON.stringify(
        {
          issue,
          case: acceptanceCase,
          baselineProductionRef,
          ...provenance,
          node: process.version,
          cpu: cpus()[0]?.model,
          rounds: 5,
          source: new URL('../../core/src/domain/table/Table.ts', import.meta.url).pathname,
          scope:
            'In-memory Table.update(mutator.addFields) only. Base tables and fresh Field objects are prepared before timing, so heapBefore includes the prepared input fields. The standalone input reference is released before retainedWithResult is sampled; the output table remains held. No command parsing, repositories, PostgreSQL, permissions, plugins, serialization, event publication, or cleanup is timed. Process CPU and wall time cover the synchronous metadata update. heapAfter is immediate post-operation heap; retainedWithResult is explicit-GC heap after an async turn while the output remains held; heapAfterRelease follows output release and another async-turn GC. These are not peak heap or total allocation counts.',
          profiles,
        },
        null,
        2
      )
    );
  }

  if (process.env.T8299_PG_PROFILE === '1') {
    await profilePgCommands(provenance, requireGc());
  }
}, 900_000);

const pgOnly = process.env.T8299_PG_ONLY === '1';
if (pgOnly) {
  describe('T8299 isolated PostgreSQL profile', () => {
    bench(
      'profile driver',
      () => {
        strictEqual(process.env.T8299_PG_PROFILE, '1');
      },
      { iterations: 1, time: 1, warmupIterations: 0, warmupTime: 0, throws: true }
    );
  });
} else {
  for (const [index, scenario] of preparedScenarios.entries()) {
    describe(`T8299 Table field metadata: ${scenario.label}`, () => {
      bench(
        'Table.update(mutator.addFields)',
        () => {
          if (!tinyFields) throw new Error('TinyBench setup did not prepare fields');
          metadataSink = runMetadataUpdate(scenario, tinyFields);
        },
        {
          ...benchOptions,
          setup: () => {
            tinyFields = createAddedFields(scenario, tinySeed++ + index * 100_000);
          },
          teardown: () => {
            tinyFields = undefined;
            metadataSink = undefined;
          },
        }
      );
    });
  }
}

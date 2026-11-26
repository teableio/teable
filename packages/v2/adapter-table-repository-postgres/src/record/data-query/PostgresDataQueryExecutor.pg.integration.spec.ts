import { Session } from 'node:inspector/promises';

import { createV2PostgresDb } from '@teable/v2-adapter-db-postgres-pg';
import {
  ActorId,
  BaseId,
  buildRecordConditionSpec,
  DbFieldName,
  DefaultTableMapper,
  FieldId,
  FieldName,
  LookupField,
  NoopLogger,
  RecordQueryPluginRunner,
  Table,
  TableId,
  TableName,
  type ITablePersistenceDTO,
  type ITracer,
} from '@teable/v2-core';
import {
  dataQueryCompositionSource,
  DataQueryDefinition,
  DataQueryService,
  prepareDataQueryComposition,
  QueryExecutionService,
  type DataQueryComposition,
  type DataQueryResult,
} from '@teable/v2-data-query';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { CompiledQuery, sql, type Kysely, type Transaction, type TransactionBuilder } from 'kysely';
import { ok, type Result } from 'neverthrow';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresDataQueryExecutor } from './PostgresDataQueryExecutor';
import { registerTopNPostgresCases } from './PostgresDataQueryTopN.pg.integration.cases';

registerTopNPostgresCases();

// PGlite cannot interrupt a running statement; use an actual server for cancellation.
const describePg = process.env.TEABLE_V2_RUN_PG_INTEGRATION === '1' ? describe : describe.skip;
const baseId = BaseId.create(`bse${'s'.repeat(16)}`)._unsafeUnwrap();
const titleId = FieldId.create(`fld${'t'.repeat(16)}`)._unsafeUnwrap();
const context = { actorId: ActorId.create('query-budget-actor')._unsafeUnwrap() };

function requireOk<T, E extends { message: string }>(result: Result<T, E>): T {
  if (result.isErr()) throw new Error(result.error.message, { cause: result.error });
  return result.value;
}

const tableFor = (seed: string) => {
  const builder = Table.builder()
    .withId(TableId.create(`tbl${seed.repeat(16)}`)._unsafeUnwrap())
    .withBaseId(baseId)
    .withName(TableName.create('Query budget')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withId(titleId)
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  builder.view().defaultGrid().done();
  const table = builder.build()._unsafeUnwrap();
  table
    .getField((field) => field.id().equals(titleId))
    ._unsafeUnwrap()
    .setDbFieldName(DbFieldName.rehydrate('Title')._unsafeUnwrap())
    ._unsafeUnwrap();
  return table;
};

const boundFor = (table: Table) =>
  DataQueryDefinition.create({
    version: 1,
    kind: 'records',
    tableId: table.id().toString(),
    select: [{ fieldId: titleId.toString(), alias: 'title' }],
    page: { limit: 10 },
  })
    ._unsafeUnwrap()
    .bind({})
    ._unsafeUnwrap();

const withDeadline = async <T>(operation: Promise<T>): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Data query failed to cancel within 10 seconds')),
          10_000
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

const sampleDataQuery = async (execute: () => Promise<unknown>) => {
  const executorSamplesMs: number[] = [];
  for (let sample = 0; sample < 3; sample++) {
    const started = performance.now();
    await execute();
    executorSamplesMs.push(performance.now() - started);
  }
  return {
    executorSamplesMs,
    executorMedianMs: [...executorSamplesMs].sort((left, right) => left - right)[1],
  };
};

type CursorRowsQuery = {
  compiled: CompiledQuery<unknown>;
  returnedRows: number;
};

// Only the separate diagnostic pass uses these observers. Acceptance timings stay uninstrumented.
type SetupStatementKind = 'isolation' | 'readOnly' | 'settings';
type SetupStep = {
  readonly pattern: RegExp;
  readonly kind: SetupStatementKind;
  readonly required: boolean;
};
// V6 opens with both SETs before settings. V7 sets isolation/read-only on BEGIN
// and needs only the timeout/precision select, with no physical-type probe.
const cursorSetupSequence: readonly SetupStep[] = [
  { pattern: /^select set_config\('statement_timeout'/, kind: 'settings', required: true },
];
const offsetSetupSequence: readonly SetupStep[] = [
  {
    pattern: /^set transaction isolation level repeatable read/,
    kind: 'isolation',
    required: true,
  },
  { pattern: /^set transaction read only/, kind: 'readOnly', required: true },
  { pattern: /^select set_config\('statement_timeout'/, kind: 'settings', required: true },
];
// A setup-shaped statement past the sequence means the transaction opened with the wrong shape.
const straySetup =
  /^(?:set transaction\b|select set_config\('statement_timeout'|select pg_typeof\()/;

const createCursorPhaseRecorder = (db: Kysely<V1TeableDatabase>) => {
  const empty = () => ({
    bindMs: 0,
    executeMs: 0,
    compileMs: 0,
    setupMs: 0,
    rowsMs: 0,
    countMs: 0,
    acquireBeginMs: 0,
    commitReleaseMs: 0,
    preReadMs: 0,
    transactionResidualMs: 0,
    postReadMs: 0,
  });
  let phases = empty();
  let readStarted = 0;
  let readEnded = 0;
  let transactionMs = 0;
  let statements = 0;
  let setupStatements = 0;
  let setupIndex = 0;
  let setupSteps: readonly SetupStep[] = offsetSetupSequence;
  let invalid = false;
  let rowsQueries: CursorRowsQuery[] = [];
  let countStatements = 0;
  let extraFloatDigits: number | undefined;
  const tracer: ITracer = {
    startSpan(name) {
      const started = performance.now();
      if (name === 'teable.dataQuery.database.readOnly') readStarted = started;
      return {
        setAttribute() {},
        setAttributes() {},
        recordError() {
          invalid = true;
        },
        end() {
          const ended = performance.now();
          if (name === 'teable.dataQuery.compile') phases.compileMs += ended - started;
          if (name === 'teable.dataQuery.database.readOnly') readEnded = ended;
        },
      };
    },
    withSpan: (_span, callback) => callback(),
    getActiveSpan: () => undefined,
  };
  // Classify the leading statements by what actually executed: setup statements in the
  // allowed order, then row statements and at most one trailing count.
  const classifySetup = (sqlText: string): SetupStatementKind | 'rows' | 'invalid' => {
    for (;;) {
      if (setupIndex === setupSteps.length) return 'rows';
      const step = setupSteps[setupIndex];
      if (step.pattern.test(sqlText)) {
        setupIndex++;
        setupStatements++;
        return step.kind;
      }
      if (step.required) return 'invalid';
      setupIndex++;
    }
  };
  // Kysely's transaction builder is immutable: setIsolationLevel/setAccessMode return a new
  // builder, so the wrapper has to follow whichever builder is actually executed.
  const observeTransactionBuilder = (
    transactionBuilder: TransactionBuilder<V1TeableDatabase>
  ): TransactionBuilder<V1TeableDatabase> =>
    new Proxy(transactionBuilder, {
      get(builder, member) {
        if (member === 'execute') {
          return async (
            callback: (transaction: Transaction<V1TeableDatabase>) => Promise<unknown>
          ) => {
            const started = performance.now();
            let callbackEnded = started;
            try {
              return await builder.execute(async (transaction) => {
                const entered = performance.now();
                phases.acquireBeginMs += entered - started;
                const recordingTransaction = new Proxy(transaction, {
                  get(connection, key) {
                    if (key === 'executeQuery') {
                      return async (compiled: CompiledQuery<unknown>) => {
                        statements++;
                        const kind = classifySetup(compiled.sql);
                        const isSetup = kind !== 'rows' && kind !== 'invalid';
                        if (kind === 'invalid') invalid = true;
                        else if (kind === 'rows' && straySetup.test(compiled.sql)) invalid = true;
                        const isCount =
                          !isSetup && /^select count\(\*\) as "?total"? from\b/i.test(compiled.sql);
                        const phase = isSetup ? 'setupMs' : isCount ? 'countMs' : 'rowsMs';
                        if (isCount) countStatements++;
                        else if (!isSetup && countStatements > 0) invalid = true;
                        const queryStarted = performance.now();
                        try {
                          const result = await connection.executeQuery(compiled);
                          if (!isSetup && !isCount) {
                            rowsQueries.push({ compiled, returnedRows: result.rows.length });
                          }
                          if (kind === 'settings') {
                            const settings = result.rows[0] as
                              | { extra_float_digits?: number }
                              | undefined;
                            if (typeof settings?.extra_float_digits === 'number') {
                              extraFloatDigits = settings.extra_float_digits;
                            }
                          }
                          return result;
                        } finally {
                          phases[phase] += performance.now() - queryStarted;
                        }
                      };
                    }
                    const value = Reflect.get(connection, key, connection);
                    return typeof value === 'function' ? value.bind(connection) : value;
                  },
                });
                try {
                  return await callback(recordingTransaction);
                } finally {
                  callbackEnded = performance.now();
                  transactionMs += callbackEnded - entered;
                }
              });
            } finally {
              phases.commitReleaseMs += performance.now() - callbackEnded;
            }
          };
        }
        const value = Reflect.get(builder, member, builder);
        if (typeof value !== 'function') return value;
        if (member === 'setIsolationLevel' || member === 'setAccessMode')
          return (...args: unknown[]) => observeTransactionBuilder(value.apply(builder, args));
        return value.bind(builder);
      },
    });
  const recordingDb = new Proxy(db, {
    get(target, property) {
      if (property === 'transaction') return () => observeTransactionBuilder(target.transaction());
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const executor = new PostgresDataQueryExecutor(recordingDb, {
    cursorSigningKey: 'test-cursor-signing-key',
  });
  return {
    empty,
    async execute(table: Table, query: Parameters<PostgresDataQueryExecutor['execute']>[2]) {
      phases = empty();
      readStarted = readEnded = transactionMs = 0;
      statements = setupStatements = setupIndex = 0;
      setupSteps = query.cursor !== undefined ? cursorSetupSequence : offsetSetupSequence;
      invalid = false;
      rowsQueries = [];
      countStatements = 0;
      extraFloatDigits = undefined;
      const started = performance.now();
      const result = await executor.execute({ ...context, tracer }, table, query, {});
      const ended = performance.now();
      phases.executeMs = ended - started;
      phases.preReadMs = readStarted - started - (query.cursor ? 0 : phases.compileMs);
      phases.transactionResidualMs =
        transactionMs -
        phases.setupMs -
        phases.rowsMs -
        phases.countMs -
        (query.cursor ? phases.compileMs : 0);
      phases.postReadMs = ended - readEnded;
      const value = result._unsafeUnwrap();
      expect(invalid).toBe(false);
      expect(rowsQueries.length).toBeGreaterThanOrEqual(1);
      expect(rowsQueries.length).toBeLessThanOrEqual(2);
      expect(countStatements).toBe(query.includeTotal ? 1 : 0);
      if (query.cursor !== undefined) {
        // BEGIN carries isolation/read-only; native keys need no type probe.
        expect(setupStatements).toBe(1);
      } else {
        expect(setupStatements).toBe(3);
      }
      expect(statements).toBe(setupStatements + rowsQueries.length + countStatements);
      const hasNextCursor =
        value.page && 'nextCursor' in value.page && typeof value.page.nextCursor === 'string';
      expect(rowsQueries.reduce((sum, stage) => sum + stage.returnedRows, 0)).toBe(
        value.rows.length + (hasNextCursor ? 1 : 0)
      );
      expect(readStarted).toBeGreaterThan(started);
      expect(readEnded).toBeGreaterThan(readStarted);
      return { result: value, phases, rowsQueries, extraFloatDigits };
    },
  };
};

const explainCursorPage = async (
  db: Kysely<V1TeableDatabase>,
  physicalName: string,
  compile: (normalization: 'sql' | 'driver') => CompiledQuery<unknown> | readonly CursorRowsQuery[],
  compareNullTail?: CompiledQuery<unknown>
) => {
  type PlanTiming = {
    'Actual Loops': number;
    'Actual Rows': number;
    'Actual Startup Time': number;
    'Actual Total Time': number;
    'Shared Hit Blocks'?: number;
    'Shared Read Blocks'?: number;
    'Temp Read Blocks'?: number;
    'Temp Written Blocks'?: number;
  };
  type PlanNode = PlanTiming & {
    'Node Type': string;
    'Parent Relationship'?: string;
    'Subplan Name'?: string;
    'Plan Rows': number;
    'Startup Cost': number;
    'Total Cost': number;
    'Rows Removed by Filter'?: number;
    'Rows Removed by Index Recheck'?: number;
    'Relation Name'?: string;
    'Index Name'?: string;
    'Scan Direction'?: string;
    'Index Cond'?: string;
    Filter?: string;
    'Sort Key'?: string[];
    'Workers Planned'?: number;
    'Workers Launched'?: number;
    'Sort Method'?: string;
    'Sort Space Used'?: number;
    'Sort Space Type'?: string;
    Workers?: (PlanTiming & { 'Worker Number': number })[];
    Plans?: PlanNode[];
  };
  type Explain = {
    Plan: PlanNode;
    'Planning Time': number;
    'Execution Time': number;
    JIT?: { Functions: number; Timing?: { Total: number } };
  };
  type MeasuredPlan = {
    planningMs: number;
    plan: Record<string, unknown>;
    executionMs: number;
    jitFunctions: number;
    jitMs: number;
    normalizationLoops: number;
    scannedRows: number;
    executedScans: PlanNode[];
  };
  // Keep predicate/order structure for diagnosing native seek plans, but redact
  // literal cursor values before recording any EXPLAIN expression.
  const redactPlanExpression = (expression: string) =>
    expression.replace(/'(?:''|[^'])*'/g, "'?'").replace(/\b\d+(?:\.\d+)?\b/g, '?');
  const safePlan = (node: PlanNode): Record<string, unknown> => ({
    node: node['Node Type'],
    relationship: node['Parent Relationship'],
    subplan: node['Subplan Name'],
    relation: node['Relation Name'],
    index: node['Index Name'],
    scanDirection: node['Scan Direction'],
    indexCondition: node['Index Cond'] && redactPlanExpression(node['Index Cond']),
    filter: node.Filter && redactPlanExpression(node.Filter),
    sortKeys: node['Sort Key']?.map(redactPlanExpression),
    estimatedRows: node['Plan Rows'],
    startupCost: node['Startup Cost'],
    totalCost: node['Total Cost'],
    loops: node['Actual Loops'],
    rows: node['Actual Rows'],
    startupMs: node['Actual Startup Time'],
    totalMs: node['Actual Total Time'],
    filtered: node['Rows Removed by Filter'],
    rechecked: node['Rows Removed by Index Recheck'],
    sharedHitBlocks: node['Shared Hit Blocks'],
    sharedReadBlocks: node['Shared Read Blocks'],
    tempReadBlocks: node['Temp Read Blocks'],
    tempWrittenBlocks: node['Temp Written Blocks'],
    workersPlanned: node['Workers Planned'],
    workersLaunched: node['Workers Launched'],
    workers: node.Workers?.map((worker) => ({
      worker: worker['Worker Number'],
      loops: worker['Actual Loops'],
      rows: worker['Actual Rows'],
      startupMs: worker['Actual Startup Time'],
      totalMs: worker['Actual Total Time'],
    })),
    sortMethod: node['Sort Method'],
    sortSpaceUsed: node['Sort Space Used'],
    sortSpaceType: node['Sort Space Type'],
    plans: node.Plans?.map(safePlan),
  });
  const measurePlan = (observation: Explain): MeasuredPlan => {
    const nodes: PlanNode[] = [];
    const pending = [observation.Plan];
    while (pending.length) {
      const node = pending.pop()!;
      nodes.push(node);
      pending.push(...(node.Plans ?? []));
    }
    const scans = nodes.filter((node) => node['Relation Name'] === physicalName);
    return {
      planningMs: observation['Planning Time'],
      plan: safePlan(observation.Plan),
      executionMs: observation['Execution Time'],
      jitFunctions: observation.JIT?.Functions ?? 0,
      jitMs: observation.JIT?.Timing?.Total ?? 0,
      normalizationLoops: nodes
        .filter((node) => node['Node Type'] === 'Recursive Union')
        .reduce((sum, node) => sum + node['Actual Loops'], 0),
      scannedRows: scans.reduce(
        (sum, node) =>
          sum +
          node['Actual Loops'] *
            (node['Actual Rows'] +
              (node['Rows Removed by Filter'] ?? 0) +
              (node['Rows Removed by Index Recheck'] ?? 0)),
        0
      ),
      executedScans: scans.filter((node) => node['Actual Loops'] > 0),
    };
  };
  const summarizeSamples = (samples: Omit<MeasuredPlan, 'plan' | 'executedScans'>[]) => {
    const executionSamplesMs = samples.map((sample) => sample.executionMs);
    return {
      planningSamplesMs: samples.map((sample) => sample.planningMs),
      executionSamplesMs,
      executionMs: [...executionSamplesMs].sort((left, right) => left - right)[1],
      jitFunctions: Math.max(...samples.map((sample) => sample.jitFunctions)),
      jitMs: Math.max(...samples.map((sample) => sample.jitMs)),
      normalizationLoops: Math.max(...samples.map((sample) => sample.normalizationLoops)),
      scannedRows: Math.max(...samples.map((sample) => sample.scannedRows)),
    };
  };
  return db.transaction().execute(async (transaction) => {
    await sql`set transaction isolation level repeatable read`.execute(transaction);
    await sql`set transaction read only`.execute(transaction);
    const settings = await sql<{ extra_float_digits: number }>`select
      current_setting('extra_float_digits')::integer as extra_float_digits`.execute(transaction);
    const extraFloatDigits = settings.rows[0].extra_float_digits;
    const publicNormalization =
      Number.isInteger(extraFloatDigits) && extraFloatDigits > 0 && extraFloatDigits <= 3
        ? 'driver'
        : 'sql';
    // Select the same mode as execute(), on the connection that executes the plan.
    expect(publicNormalization).toBe('driver');
    const compiled = compile(publicNormalization);
    const rowsQueries = 'sql' in compiled ? [{ compiled, returnedRows: undefined }] : compiled;
    const stageSamples: MeasuredPlan[][] = rowsQueries.map(() => []);
    for (let sample = 0; sample < 3; sample++) {
      for (const [stage, { compiled }] of rowsQueries.entries()) {
        const explained = await transaction.executeQuery<{ 'QUERY PLAN': Explain[] }>({
          ...compiled,
          sql: `explain (analyze, buffers, verbose, format json) ${compiled.sql}`,
        });
        stageSamples[stage].push(measurePlan(explained.rows[0]['QUERY PLAN'][0]));
      }
    }
    // Page bounds apply to the sum of every executed stage in the same sample.
    const samples = Array.from({ length: 3 }, (_, sample) => {
      const stages = stageSamples.map((stage) => stage[sample]);
      return {
        planningMs: stages.reduce((sum, stage) => sum + stage.planningMs, 0),
        executionMs: stages.reduce((sum, stage) => sum + stage.executionMs, 0),
        jitFunctions: stages.reduce((sum, stage) => sum + stage.jitFunctions, 0),
        jitMs: stages.reduce((sum, stage) => sum + stage.jitMs, 0),
        normalizationLoops: stages.reduce((sum, stage) => sum + stage.normalizationLoops, 0),
        scannedRows: stages.reduce((sum, stage) => sum + stage.scannedRows, 0),
      };
    });
    let nullTailComparison;
    if (compareNullTail) {
      const explained = await transaction.executeQuery<{ 'QUERY PLAN': Explain[] }>({
        ...compareNullTail,
        sql: `explain (analyze, buffers, verbose, format json) ${compareNullTail.sql}`,
      });
      const comparison = measurePlan(explained.rows[0]['QUERY PLAN'][0]);
      nullTailComparison = {
        planningMs: comparison.planningMs,
        executionMs: comparison.executionMs,
        plan: comparison.plan,
        scannedRows: comparison.scannedRows,
      };
    }
    return {
      extraFloatDigits,
      nullTailComparison,
      ...summarizeSamples(samples),
      plans: samples.map((_, sample) => stageSamples.map((stage) => stage[sample].plan)),
      stages: stageSamples.map((samples, stage) => ({
        stage: stage + 1,
        returnedRows: rowsQueries[stage].returnedRows,
        sqlChars: rowsQueries[stage].compiled.sql.length,
        ...summarizeSamples(samples),
        plans: samples.map((sample) => sample.plan),
      })),
      publicNormalization,
      executedScans: stageSamples.flatMap((samples) =>
        samples.flatMap((sample) => sample.executedScans)
      ),
    };
  });
};

describePg('PostgresDataQueryExecutor transaction isolation (Postgres)', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let db: Kysely<V1TeableDatabase>;
  let holder: Kysely<V1TeableDatabase>;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(
      process.env.TEABLE_V2_TEST_PG_IMAGE ?? 'postgres:16-alpine'
    ).start();
    const config = { pg: { connectionString: container.getConnectionUri(), pool: { max: 1 } } };
    db = await createV2PostgresDb<V1TeableDatabase>(config);
    holder = await createV2PostgresDb<V1TeableDatabase>(config);
    await sql`create schema ${sql.id(baseId.toString())}`.execute(db);
  });

  afterAll(async () => {
    await holder?.destroy();
    await db?.destroy();
    await container?.stop();
  });

  it.each([1, 2] as const)('enforces the shared metric group limit for v%s', async (version) => {
    const table = tableFor(version === 1 ? 'm' : 'n');
    const physical = sql.id(baseId.toString(), table.id().toString());
    await sql`create table ${physical} (__id text primary key, "Title" text)`.execute(db);
    await sql`insert into ${physical} select i::text, lpad(i::text, 3, '0')
      from generate_series(1, 100) as g(i)`.execute(db);
    const service = new QueryExecutionService(
      new DataQueryService(
        { findOne: async () => ok(table) },
        new RecordQueryPluginRunner([], new NoopLogger()),
        new PostgresDataQueryExecutor(db)
      )
    );
    const title = { fieldId: titleId.toString(), alias: 'title' };
    const source = dataQueryCompositionSource({
      kind: 'records',
      tableId: table.id().toString(),
      // An explicit root source exercises the relation executor with the same records.
      ...(version === 1
        ? { version, select: [title] }
        : { version, select: [{ ...title, source: 'root' }] }),
    })._unsafeUnwrap();
    const request = { definition: source.definition };
    const { outputs } = (await service.validate(context, request))._unsafeUnwrap();
    const prepare = (definition: DataQueryComposition) =>
      prepareDataQueryComposition(definition, outputs, source);
    const aggregate: DataQueryComposition = {
      kind: 'composition',
      source: { id: `qlb${'1'.repeat(16)}`, revision: 1 },
      metrics: [{ alias: 'records', statistic: 'count' }],
    };
    const shared = { ...aggregate, metricDimensions: ['title'] };
    const metric = prepare(shared)._unsafeUnwrap();
    const runMetric = (parameters: Record<string, unknown>) => {
      const { composition } = metric.bind(parameters)._unsafeUnwrap();
      return service.executeComposition(context, request, composition);
    };
    expect((await runMetric({ groupBy: ['title'] }))._unsafeUnwrap().rows).toEqual(
      Array.from({ length: 100 }, (_, i) => ({ title: String(i + 1).padStart(3, '0'), records: 1 }))
    );

    await sql`insert into ${physical} values ('101', '101')`.execute(db);
    expect((await runMetric({ groupBy: ['title'] }))._unsafeUnwrapErr()).toMatchObject({
      code: 'data_query.metric_group_limit_exceeded',
      message: expect.stringMatching(/100 groups.*narrow the filters/i),
    });
    const narrowed = await runMetric({ groupBy: ['title'], where_title: '101' });
    expect(narrowed._unsafeUnwrap().rows).toEqual([{ title: '101', records: 1 }]);
    expect((await runMetric({}))._unsafeUnwrap().rows).toEqual([{ title: null, records: 101 }]);
    expect((await service.execute(context, request))._unsafeUnwrap().rows).toHaveLength(100);

    const capped = prepare({ ...shared, page: { limit: 5 } })._unsafeUnwrap();
    const groups = capped.bind({ groupBy: ['title'] })._unsafeUnwrap().composition;
    const overCap = await service.executeComposition(context, request, groups);
    expect(overCap._unsafeUnwrapErr().message).toMatch(/limit of 5 groups/);

    const page = { limit: 1, offset: 1, includeTotal: true };
    const sampled = prepare({ ...shared, page });
    expect(sampled._unsafeUnwrapErr().message).toMatch(/remove the page offset/i);
    const paged = prepare({ ...aggregate, groupBy: ['title'], page })._unsafeUnwrap();
    const { composition } = paged.bind()._unsafeUnwrap();
    const result = await service.executeComposition(context, request, composition);
    expect(result._unsafeUnwrap()).toEqual({
      rows: [{ title: '002', records: 1 }],
      page: { limit: 1, offset: 1, total: 101 },
    });
  });

  it.each(['root', 'relation'] as const)(
    'compares calendar months before pagination on the %s executor',
    async (mode) => {
      const physicalName = `month_comparison_${mode}`;
      const physical = sql.id(baseId.toString(), physicalName);
      const suffix = mode === 'root' ? '1' : '2';
      const dateId = `fld${'d'.repeat(16)}`;
      const amountId = `fld${'a'.repeat(16)}`;
      const receiptId = `fld${'r'.repeat(16)}`;
      const refundId = `fld${'f'.repeat(16)}`;
      const storedNetId = `fld${'n'.repeat(16)}`;
      const statusId = `fld${'s'.repeat(16)}`;
      const table = requireOk(
        new DefaultTableMapper().toDomain({
          id: `tbl${suffix.repeat(16)}`,
          baseId: baseId.toString(),
          name: 'Monthly sales',
          dbTableName: `${baseId.toString()}.${physicalName}`,
          primaryFieldId: titleId.toString(),
          fields: [
            {
              id: titleId.toString(),
              name: 'Region',
              type: 'singleLineText',
              dbFieldName: 'region',
              isPrimary: true,
            },
            {
              id: dateId,
              name: 'Sold at',
              type: 'date',
              dbFieldName: 'sold_at',
              dbFieldType: 'DATETIME',
            },
            {
              id: amountId,
              name: 'Amount',
              type: 'number',
              dbFieldName: 'amount',
              dbFieldType: 'NUMERIC',
            },
            {
              id: receiptId,
              name: 'Receipt',
              type: 'number',
              dbFieldName: 'receipt',
              dbFieldType: 'REAL',
            },
            {
              id: refundId,
              name: 'Refund',
              type: 'number',
              dbFieldName: 'refund',
              dbFieldType: 'REAL',
            },
            {
              id: storedNetId,
              name: 'Stored net',
              type: 'formula',
              dbFieldName: 'stored_net',
              dbFieldType: 'REAL',
              options: { expression: `{${receiptId}} - {${refundId}}` },
              cellValueType: 'number',
              isMultipleCellValue: false,
            },
            { id: statusId, name: 'Status', type: 'singleLineText', dbFieldName: 'status' },
          ],
          views: [{ id: `viw${suffix.repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} }],
        })
      );
      await sql`create table ${physical} (
        __id text primary key, region text, sold_at timestamptz, amount numeric, status text,
        receipt double precision, refund double precision,
        stored_net double precision generated always as (receipt - refund) stored
      )`.execute(db);
      await sql`insert into ${physical} (__id, region, sold_at, amount, status) values
        ('a', 'north', '2026-01-01T07:59:59Z', 130, 'active'),
        ('b', 'north', '2025-12-01T08:00:00Z', 10, 'active'),
        ('c', 'north', '2026-01-01T08:00:00Z', 40, 'active'),
        ('d', 'north', '2026-02-01T07:59:59Z', 20, 'active'),
        ('e', 'north', '2025-12-01T07:59:59Z', 999, 'active'),
        ('f', 'north', '2026-02-01T08:00:00Z', 999, 'active'),
        ('g', 'north', null, 999, 'active'),
        ('h', 'north', '2025-12-25T00:00:00Z', 999, 'inactive'),
        ('i', 'north', '2026-01-25T00:00:00Z', 999, 'inactive'),
        ('j', 'zero', '2025-12-25T00:00:00Z', 0, 'active'),
        ('k', 'zero', '2026-01-25T00:00:00Z', 40, 'active'),
        ('l', 'nulls', '2025-12-25T00:00:00Z', null, 'active'),
        ('m', 'nulls', '2026-01-25T00:00:00Z', 40, 'active'),
        ('n', 'missing', '2026-01-25T00:00:00Z', 40, 'active'),
        ('o', 'precise', '2025-12-25T00:00:00Z', 9007199254740993.1234567890123456789, 'active'),
        ('p', 'precise', '2026-01-25T00:00:00Z', 9007199254740993.1234567890123456790, 'active'),
        ('bc1', 'legacy', '2025-12-15 00:00:00+00 BC', 10, 'active'),
        ('bc2', 'legacy', '2026-01-15 00:00:00+00 BC', 40, 'active')
      `.execute(db);
      await sql`insert into ${physical} (__id, region, sold_at, receipt, status) values
        ('r1', 'receipts', '2025-12-02T00:00:00Z', 0.1, 'active'),
        ('r2', 'receipts', '2025-12-03T00:00:00Z', 0.2, 'active'),
        ('r3', 'receipts', '2025-12-04T00:00:00Z', -0.3, 'active'),
        ('r4', 'receipts', '2026-01-02T00:00:00Z', 40, 'active'),
        ('r5', 'roundTrip', '2026-01-02T00:00:00Z', 0.30000000000000004, 'active')`.execute(db);
      await sql`insert into ${physical} (__id, region, sold_at, receipt, refund, status) values
        ('net1', 'net', '2025-12-02T00:00:00Z', 0.30, 0.10, 'active'),
        ('net2', 'net', '2025-12-03T00:00:00Z', 0, 0.20, 'active'),
        ('net3', 'net', '2026-01-02T00:00:00Z', 45, 5, 'active'),
        ('net4', 'filteredNet', '2025-12-02T00:00:00Z', 0.30, 0.10, 'active'),
        ('net5', 'filteredNet', '2026-01-02T00:00:00Z', 0.40, 0.30, 'active'),
        ('tiny1', 'tinyNet', '2025-12-02T00:00:00Z', 0.00000000000000000001, 0, 'active'),
        ('tiny2', 'tinyNet', '2026-01-02T00:00:00Z', 0.00000000000000000002, 0, 'active')`.execute(
        db
      );
      await sql`insert into ${physical} (__id, region, sold_at, amount, status)
        select 'background-' || n, 'north', '2000-01-01T00:00:00Z'::timestamptz
          + n * interval '1 hour', 1000, 'active'
        from generate_series(1, 20000) as fixture(n)`.execute(db);
      const dateIndex = `${physicalName}_sold_at_idx`;
      await sql`create index ${sql.id(dateIndex)} on ${physical} (sold_at)`.execute(db);
      await sql`analyze ${physical}`.execute(db);
      const comparisons: CompiledQuery[] = [];
      const recordingDb = db.withPlugin({
        transformQuery({ node, queryId }) {
          const compiled = db.getExecutor().compileQuery(node, queryId);
          if (compiled.sql.includes('as "changeRate"')) comparisons.push(compiled);
          return node;
        },
        transformResult: ({ result }) => Promise.resolve(result),
      });
      const maskedActor = requireOk(ActorId.create('masked-calendar-reader'));
      const visibleWhen = requireOk(
        buildRecordConditionSpec(table, {
          fieldId: titleId.toString(),
          operator: 'is',
          value: 'zero',
        })
      );
      const service = new QueryExecutionService(
        new DataQueryService(
          { findOne: async () => ok(table) },
          new RecordQueryPluginRunner(
            [
              {
                name: 'mask-calendar-for-reader',
                supports: () => true,
                scope: ({ executionContext }) =>
                  ok(
                    executionContext.actorId.equals(maskedActor)
                      ? { fieldMasks: [{ fieldId: dateId, visibleWhen }] }
                      : undefined
                  ),
              },
            ],
            new NoopLogger()
          ),
          new PostgresDataQueryExecutor(recordingDb)
        )
      );
      const source = requireOk(
        dataQueryCompositionSource({
          version: 3,
          kind: 'records',
          tableId: table.id().toString(),
          page: { limit: 1, includeTotal: true },
          select: [
            {
              fieldId: dateId,
              alias: 'month',
              bucket: { kind: 'dateTrunc', unit: 'month', timeZone: 'America/Los_Angeles' },
              ...(mode === 'relation' ? { source: 'root' } : {}),
            },
            { fieldId: titleId.toString(), alias: 'region' },
            { fieldId: dateId, alias: 'soldAt' },
            { fieldId: amountId, alias: 'amount' },
            { fieldId: amountId, alias: '__teable_composition_decimal_metric' },
            { fieldId: receiptId, alias: 'receipt' },
            {
              alias: 'storedNet',
              expr: {
                type: 'formula',
                formula: '{stored}',
                references: { stored: { type: 'field', fieldId: storedNetId } },
              },
            },
            {
              alias: 'netRevenue',
              expr: {
                type: 'formula',
                formula: '{gross} - {refund}',
                references: {
                  gross: { type: 'field', fieldId: receiptId },
                  refund: { type: 'field', fieldId: refundId },
                },
              },
            },
            { fieldId: statusId, alias: 'status' },
          ],
        })
      );
      const request = { definition: source.definition };
      const { outputs } = requireOk(await service.validate(context, request));
      type Metric = NonNullable<DataQueryComposition['metrics']>[number];
      const metricFor = (statistic: Metric['statistic'], input: string) =>
        requireOk(
          prepareDataQueryComposition(
            {
              kind: 'composition',
              source: { id: `qlb${'1'.repeat(16)}`, revision: 1 },
              metricDimensions: ['month', 'region', 'soldAt'],
              metrics: [{ alias: 'current', statistic, ...(input ? { input } : {}) }],
              filter: [{ alias: 'status', operator: 'eq', value: 'active' }],
              page: { limit: 1, includeTotal: true },
            },
            outputs,
            source
          )
        );
      const run = async (
        statistic: Metric['statistic'],
        region: string,
        input = 'amount',
        soldAt?: string
      ) => {
        const { composition } = requireOk(
          metricFor(statistic, input).bind({
            compareMonth: '2026-01',
            compareDimension: 'month',
            where_region: region,
            ...(soldAt === undefined ? {} : { where_soldAt: soldAt }),
          })
        );
        const result = requireOk(await service.executeComposition(context, request, composition));
        expect(result.page).toBeUndefined();
        expect(result.rows).toHaveLength(1);
        const [row] = result.rows;
        expect(Object.keys(row)).toHaveLength(6);
        expect(row).toMatchObject({ currentMonth: '2026-01', previousMonth: '2025-12' });
        return row;
      };

      const sum = await run('sum', 'north');
      expect(sum).toMatchObject({ current: '60', previous: '140', difference: '-80' });
      expect(Number(sum.changeRate)).toBeCloseTo(-4 / 7);
      expect(comparisons).toHaveLength(1);
      const [compiled] = comparisons;
      const plan = await db.executeQuery<{ 'QUERY PLAN': string }>({
        ...compiled,
        sql: `explain (analyze, format text) ${compiled.sql}`,
      });
      const planText = plan.rows.map((row) => row['QUERY PLAN']).join('\n');
      expect(planText).toContain(dateIndex);
      expect(planText).toMatch(/Index Cond:.*sold_at.*>=.*sold_at.*</);
      expect(planText).not.toContain(`Seq Scan on ${physicalName}`);

      const { composition: maskedComposition } = requireOk(
        metricFor('sum', 'amount').bind({
          compareMonth: '2026-01',
          compareDimension: 'month',
          where_region: 'north',
        })
      );
      const masked = requireOk(
        await service.executeComposition({ actorId: maskedActor }, request, maskedComposition)
      );
      expect(masked.rows).toEqual([
        {
          currentMonth: '2026-01',
          previousMonth: '2025-12',
          current: null,
          previous: null,
          difference: null,
          changeRate: null,
        },
      ]);
      expect(comparisons[1].sql).not.toMatch(/"sold_at"(?:::timestamptz)?\s*(?:>=|<)/);

      expect(await run('sum', 'north', 'amount', '2026-01-01T08:00:00Z')).toMatchObject({
        current: '40',
        previous: null,
        difference: null,
        changeRate: null,
      });
      expect(await run('sum', 'north', 'amount', '2026-01-01T07:59:59Z')).toMatchObject({
        current: null,
        previous: '130',
        difference: null,
        changeRate: null,
      });
      expect(await run('average', 'north')).toMatchObject({
        current: expect.stringMatching(/^30(?:\.0+)?$/),
        previous: expect.stringMatching(/^70(?:\.0+)?$/),
      });
      expect(await run('min', 'north')).toMatchObject({ current: '20', previous: '10' });
      expect(await run('max', 'north')).toMatchObject({ current: '40', previous: '130' });
      expect(await run('sum', 'zero')).toMatchObject({
        current: '40',
        previous: '0',
        difference: '40',
        changeRate: null,
      });
      for (const statistic of ['sum', 'average'] as const) {
        expect(await run(statistic, 'receipts', 'receipt')).toMatchObject({
          current: expect.stringMatching(/^40(?:\.0+)?$/),
          previous: expect.stringMatching(/^0(?:\.0+)?$/),
          difference: expect.stringMatching(/^40(?:\.0+)?$/),
          changeRate: null,
        });
        expect(await run(statistic, 'net', 'netRevenue')).toMatchObject({
          current: expect.stringMatching(/^40(?:\.0+)?$/),
          previous: expect.stringMatching(/^0(?:\.0+)?$/),
          difference: expect.stringMatching(/^40(?:\.0+)?$/),
          changeRate: null,
        });
      }
      expect(await run('sum', 'roundTrip', 'receipt')).toMatchObject({
        current: '0.30000000000000004',
        previous: null,
      });
      const tiny = await run('sum', 'tinyNet', 'netRevenue');
      expect(tiny.previous).toBe('0.00000000000000000001');
      expect(tiny.difference).toBe('0.00000000000000000001');
      expect(Number(tiny.changeRate)).toBe(1);
      // Referencing a stored numeric Formula reads its persisted value, including its residue.
      const stored = await run('sum', 'net', 'storedNet');
      expect(stored.previous).toBe('-0.00000000000000002');
      expect(stored.current).toBe('40');
      expect(stored.changeRate).toBeDefined();
      expect(Number(stored.changeRate)).toBeLessThan(0);
      for (const statistic of ['sum', 'average'] as const) {
        const { composition } = requireOk(
          metricFor(statistic, 'netRevenue').bind({
            groupBy: ['month'],
            where_region: 'net',
            where_month: '2025-12-01',
          })
        );
        const result = requireOk(await service.executeComposition(context, request, composition));
        expect(result.rows).toEqual([
          { month: '2025-12-01', region: null, soldAt: null, current: 0 },
        ]);
      }
      const filteredNet = requireOk(
        prepareDataQueryComposition(
          {
            kind: 'composition',
            source: { id: `qlb${'1'.repeat(16)}`, revision: 1 },
            metricDimensions: ['month', 'region', 'netRevenue'],
            metrics: [{ alias: 'current', statistic: 'sum', input: 'netRevenue' }],
            filter: [{ alias: 'netRevenue', operator: 'lt', value: 0.2 }],
          },
          outputs,
          source
        )
      );
      const filteredGroup = requireOk(
        filteredNet.bind({
          groupBy: ['netRevenue'],
          where_region: 'filteredNet',
          where_month: '2025-12-01',
        })
      );
      const groupedResult = requireOk(
        await service.executeComposition(context, request, filteredGroup.composition)
      );
      expect(groupedResult.rows).toEqual([
        { month: null, region: null, netRevenue: 0.3 - 0.1, current: 0.2 },
      ]);
      const filteredComparison = requireOk(
        filteredNet.bind({
          compareMonth: '2026-01',
          compareDimension: 'month',
          where_region: 'filteredNet',
        })
      );
      const filteredResult = requireOk(
        await service.executeComposition(context, request, filteredComparison.composition)
      );
      expect(filteredResult.rows).toHaveLength(1);
      expect(filteredResult.rows[0]).toMatchObject({
        current: '0.1',
        previous: '0.2',
        difference: '-0.1',
      });
      expect(Number(filteredResult.rows[0].changeRate)).toBe(-0.5);
      expect(await run('sum', 'nulls')).toMatchObject({
        current: '40',
        previous: null,
        difference: null,
        changeRate: null,
      });
      expect(await run('count', 'nulls')).toMatchObject({
        current: '1',
        previous: '0',
        difference: '1',
        changeRate: null,
      });
      expect(await run('count', 'nulls', '')).toMatchObject({
        current: '1',
        previous: '1',
        difference: '0',
      });
      expect(await run('count', 'missing')).toMatchObject({
        current: '1',
        previous: null,
        difference: null,
        changeRate: null,
      });
      expect(await run('count', 'empty', '')).toMatchObject({
        current: null,
        previous: null,
        difference: null,
        changeRate: null,
      });
      expect(await run('sum', 'precise')).toMatchObject({
        current: '9007199254740993.1234567890123456790',
        previous: '9007199254740993.1234567890123456789',
        difference: '0.0000000000000000001',
      });
      expect(await run('sum', 'legacy')).toMatchObject({
        current: '40',
        previous: '10',
        difference: '30',
      });
    }
  );

  it.each(['createdBy', 'lastModifiedBy'] as const)(
    'aggregates historical %s TEXT identities without a JSON cast failure',
    async (fieldType) => {
      const userId = `fld${'u'.repeat(16)}`;
      const physicalName = `historical_${fieldType}`;
      const dto: ITablePersistenceDTO = {
        id: `tbl${'u'.repeat(16)}`,
        baseId: baseId.toString(),
        name: 'Historical system users',
        dbTableName: `${baseId.toString()}.${physicalName}`,
        primaryFieldId: titleId.toString(),
        fields: [
          {
            id: titleId.toString(),
            name: 'Title',
            type: 'singleLineText',
            dbFieldName: 'title',
            isPrimary: true,
          },
          { id: userId, name: 'System user', type: fieldType, dbFieldName: 'system_user' },
        ],
        views: [{ id: `viw${'u'.repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} }],
      };
      const table = new DefaultTableMapper().toDomain(dto)._unsafeUnwrap();
      const physical = sql.id(baseId.toString(), physicalName);
      await sql`create table ${physical} (__id text, title text, "system_user" text)`.execute(db);
      await sql`insert into ${physical} values
        ('a', 'First', 'user-a'), ('b', 'Second', 'user-a'),
        ('c', 'Third', 'user-b'), ('d', 'Empty', null)`.execute(db);
      const query = DataQueryDefinition.create({
        version: 1,
        kind: 'aggregate',
        tableId: dto.id,
        aggregates: [
          { fieldId: userId, alias: 'unique', statisticFunc: 'unique' },
          { fieldId: userId, alias: 'percentUnique', statisticFunc: 'percentUnique' },
          { fieldId: userId, alias: 'count', statisticFunc: 'count' },
        ],
      })
        ._unsafeUnwrap()
        .bind({})
        ._unsafeUnwrap();
      const executor = new PostgresDataQueryExecutor(db);
      expect((await executor.execute(context, table, query, {}))._unsafeUnwrap().rows).toEqual([
        { unique: 2, percentUnique: 50, count: 4 },
      ]);
      const visibleWhen = buildRecordConditionSpec(table, {
        fieldId: titleId.toString(),
        operator: 'is',
        value: 'First',
      })._unsafeUnwrap();
      expect(
        (
          await executor.execute(context, table, query, {
            fieldMasks: [{ fieldId: userId, visibleWhen }],
          })
        )._unsafeUnwrap().rows
      ).toEqual([{ unique: 1, percentUnique: 25, count: 4 }]);
      await sql`alter table ${physical} alter column "system_user" type jsonb using
        case when "system_user" is null then null else jsonb_build_object('id', "system_user", 'name', 'Original') end`.execute(
        db
      );
      await sql`update ${physical} set "system_user" = jsonb_build_object('id', 'user-a', 'name', 'Renamed') where __id = 'b'`.execute(
        db
      );
      expect((await executor.execute(context, table, query, {}))._unsafeUnwrap().rows).toEqual([
        { unique: 2, percentUnique: 50, count: 4 },
      ]);
    }
  );

  it.each(['lookup', 'rollup'] as const)(
    'reads a three-table lookup to %s using the foreign owner',
    async (innerKind) => {
      const mapper = new DefaultTableMapper();
      const ids = ['d', 'e', 'f'].map((seed) => `tbl${seed.repeat(16)}`);
      const primary = ['d', 'e', 'f'].map((seed) => `fld${seed.repeat(16)}`);
      const links = ['g', 'h'].map((seed) => `fld${seed.repeat(16)}`);
      const lookups = ['i', 'j'].map((seed) => `fld${seed.repeat(16)}`);
      const dtos: ITablePersistenceDTO[] = ids.map((id, index) => ({
        id,
        baseId: baseId.toString(),
        name: `Nested ${index}`,
        dbTableName: `${baseId.toString()}.nested_${innerKind}_${index}`,
        primaryFieldId: primary[index],
        fields: [
          {
            id: primary[index],
            name: 'Value',
            type: 'number',
            dbFieldName: 'value',
            isPrimary: true,
            options: { formatting: { type: 'decimal', precision: 0 } },
          },
        ],
        views: [
          { id: `viw${String(index).repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} },
        ],
      }));
      for (const index of [0, 1]) {
        dtos[index].fields = [
          ...dtos[index].fields,
          {
            id: links[index],
            name: 'Relation',
            type: 'link',
            dbFieldName: 'relation',
            options: {
              relationship: 'manyMany',
              foreignTableId: ids[index + 1],
              lookupFieldId: primary[index + 1],
              fkHostTableName: 'junction',
              selfKeyName: '__self',
              foreignKeyName: '__foreign',
            },
          },
        ];
        const config = {
          linkFieldId: links[index],
          foreignTableId: ids[index + 1],
          lookupFieldId: index === 0 ? lookups[1] : primary[2],
        };
        dtos[index].fields = [
          ...dtos[index].fields,
          index === 1 && innerKind === 'rollup'
            ? {
                id: lookups[index],
                name: 'Total',
                type: 'rollup',
                dbFieldName: 'nested',
                config,
                options: { expression: 'sum({values})' },
                cellValueType: 'number',
                isMultipleCellValue: false,
              }
            : {
                id: lookups[index],
                name: 'Lookup',
                type: 'number',
                dbFieldName: 'nested',
                isLookup: true,
                lookupOptions: config,
                options: { formatting: { type: 'decimal', precision: 0 } },
                cellValueType: 'number',
                isMultipleCellValue: true,
              },
        ];
      }
      const tables = dtos.map((dto) => mapper.toDomain(dto)._unsafeUnwrap());
      for (const index of [1, 0]) {
        const field = tables[index]
          .getField((candidate) => candidate.id().toString() === lookups[index])
          ._unsafeUnwrap();
        if (field instanceof LookupField) {
          field
            .validateForeignTables({ hostTable: tables[index], foreignTables: tables })
            ._unsafeUnwrap();
        }
      }
      const physical = sql.id(baseId.toString(), `nested_${innerKind}_0`);
      await sql`create table ${physical} (__id text, value double precision, relation jsonb, nested jsonb)`.execute(
        db
      );
      await sql`insert into ${physical} values ('a', 1, null, '[2,3]'::jsonb)`.execute(db);
      const query = DataQueryDefinition.create({
        version: 1,
        kind: 'records',
        tableId: ids[0],
        select: [{ fieldId: lookups[0], alias: 'nested' }],
      })
        ._unsafeUnwrap()
        .bind({})
        ._unsafeUnwrap();
      const executor = new PostgresDataQueryExecutor(db);
      expect((await executor.execute(context, tables[0], query, {}))._unsafeUnwrap().rows).toEqual([
        { nested: [2, 3] },
      ]);
    }
  );
  it.each([false, true])(
    'continues V7 records with distinct=%s and totals independent of keyset (Postgres)',
    async (distinct) => {
      const table = tableFor(distinct ? 'v' : 'w');
      const physical = sql.id(baseId.toString(), table.id().toString());
      await sql`create table ${physical} (__id text primary key, "Title" text)`.execute(db);
      await sql`insert into ${physical} values ('a',null),('b','same'),('c','same'),('d','tail')`.execute(
        db
      );
      const input = DataQueryDefinition.create({
        version: 7,
        kind: 'records',
        tableId: table.id().toString(),
        ...(distinct ? { distinct: true } : {}),
        select: [{ fieldId: titleId.toString(), alias: 'title' }],
        sort: [{ alias: 'title', order: 'asc', nulls: 'first' }],
        parameters: { cursor: { type: 'string' } },
        page: { limit: 1, after: { type: 'parameter', name: 'cursor' }, includeTotal: true },
      })._unsafeUnwrap();
      const executor = new PostgresDataQueryExecutor(db, {
        cursorSigningKey: 'test-cursor-signing-key',
      });
      const seen: unknown[] = [];
      let cursor: string | undefined;
      const count = distinct ? 3 : 4;
      for (let index = 0; index < count; index++) {
        const bound = input.bind(cursor ? { cursor } : {});
        if (bound.isErr()) throw new Error(`bind: ${JSON.stringify(bound.error)}`);
        const result = await executor.execute(context, table, bound.value, {});
        if (result.isErr()) throw new Error(`execute: ${JSON.stringify(result.error)}`);
        seen.push(...result.value.rows);
        expect(result.value.page?.total).toBe(count);
        expect(result.value.page).not.toHaveProperty('offset');
        cursor =
          result.value.page && 'nextCursor' in result.value.page
            ? (result.value.page.nextCursor ?? undefined)
            : undefined;
        expect(cursor).toEqual(index === count - 1 ? undefined : expect.any(String));
      }
      expect(seen).toEqual(
        distinct
          ? [{ title: null }, { title: 'same' }, { title: 'tail' }]
          : [{ title: null }, { title: 'same' }, { title: 'same' }, { title: 'tail' }]
      );
    }
  );

  it.each([20_000, 100_000])(
    'bounds V7 public finalization and deep-page index work at %i rows (Postgres)',
    async (size) => {
      const payloadId = `fld${'p'.repeat(16)}`;
      const physicalName = `cursor_work_${size}`;
      const physical = sql.id(baseId.toString(), physicalName);
      const table = new DefaultTableMapper()
        .toDomain({
          id: `tbl${(size === 20_000 ? 'p' : 'q').repeat(16)}`,
          baseId: baseId.toString(),
          name: 'Cursor executed work',
          dbTableName: `${baseId.toString()}.${physicalName}`,
          primaryFieldId: titleId.toString(),
          fields: [
            {
              id: titleId.toString(),
              name: 'Title',
              type: 'singleLineText',
              dbFieldName: 'title',
              dbFieldType: 'TEXT',
              isPrimary: true,
            },
            { id: payloadId, name: 'Payload', type: 'attachment', dbFieldName: 'payload' },
          ],
          views: [{ id: `viw${'p'.repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} }],
        })
        ._unsafeUnwrap();
      await sql`create table ${physical} (__id text collate "C" primary key, title text collate "C", payload jsonb)`.execute(
        db
      );
      await sql`create index ${sql.id(`${physicalName}_order`)} on ${physical} (title asc nulls first, __id asc)`.execute(
        db
      );
      const executor = new PostgresDataQueryExecutor(db, {
        cursorSigningKey: 'test-cursor-signing-key',
      });
      const select = [
        { fieldId: titleId.toString(), alias: 'title' },
        { fieldId: payloadId, alias: 'payload' },
      ];
      const input = DataQueryDefinition.create({
        version: 7,
        kind: 'records',
        tableId: table.id().toString(),
        select,
        sort: [{ alias: 'title', order: 'asc', nulls: 'first' }],
        parameters: { cursor: { type: 'string' } },
        page: { limit: 10, after: { type: 'parameter', name: 'cursor' }, includeTotal: true },
      })._unsafeUnwrap();
      // Obtain a real continuation in the middle of the eventual key space.
      // Rows inserted before that key must not add scan/finalization work.
      const middle = size / 2;
      await sql`insert into ${physical}
        select lpad(n::text, 7, '0'), lpad((n / 2)::text, 7, '0'),
          jsonb_build_array(jsonb_build_object('n', n::numeric + 9007199254740992, 'items', jsonb_build_array(1, 2, null)))
        from generate_series(${middle - 9}::integer, ${middle + 1}::integer) as fixture(n)`.execute(
        db
      );
      const anchor = (
        await executor.execute(context, table, input.bind({})._unsafeUnwrap(), {})
      )._unsafeUnwrap();
      const after = anchor.page && 'nextCursor' in anchor.page ? anchor.page.nextCursor : null;
      expect(after).toEqual(expect.any(String));
      await sql`insert into ${physical}
        select lpad(n::text, 7, '0'), lpad((n / 2)::text, 7, '0'),
          jsonb_build_array(jsonb_build_object('n', n::numeric + 9007199254740992, 'items', jsonb_build_array(1, 2, null)))
        from generate_series(1, ${size}::integer) as fixture(n)
        where n not between ${middle - 9} and ${middle + 1}`.execute(db);
      await sql`analyze ${physical}`.execute(db);
      const firstQuery = input.bind({})._unsafeUnwrap();
      const nextQuery = input.bind({ cursor: after })._unsafeUnwrap();
      const first = (await executor.execute(context, table, firstQuery, {}))._unsafeUnwrap();
      const next = (await executor.execute(context, table, nextQuery, {}))._unsafeUnwrap();
      expect(first.rows).toHaveLength(10);
      expect(next.rows).toHaveLength(10);
      expect(first.page?.total).toBe(size);
      expect(next.page?.total).toBe(size);
      expect(next.rows[0]).toEqual({
        title: String(Math.floor((middle + 1) / 2)).padStart(7, '0'),
        payload: [{ n: Number(BigInt(middle + 1) + 9007199254740992n), items: [1, 2, null] }],
      });
      const baseline = DataQueryDefinition.create({
        version: 6,
        kind: 'records',
        tableId: table.id().toString(),
        select,
        sort: [{ alias: 'title', order: 'asc', nulls: 'first' }],
        page: { limit: 10, offset: middle, includeTotal: true },
      })
        ._unsafeUnwrap()
        .bind({})
        ._unsafeUnwrap();
      expect((await executor.execute(context, table, baseline, {}))._unsafeUnwrap().rows).toEqual(
        next.rows
      );
      for (const [phase, version, query] of [
        ['first', 7, firstQuery],
        ['continuation', 7, nextQuery],
        ['offset', 6, baseline],
      ] as const) {
        const executorTiming = await sampleDataQuery(async () =>
          (await executor.execute(context, table, query, {}))._unsafeUnwrap()
        );
        const observation = await explainCursorPage(db, physicalName, (normalization) =>
          executor.compile(context, table, query, {}, undefined, {}, normalization)._unsafeUnwrap()
        );
        const { executedScans, ...diagnostic } = observation;
        process.stdout.write(
          `${JSON.stringify({
            diagnostic: 'cursor-performance',
            rows: size,
            version,
            phase,
            ...executorTiming,
            includeTotal: true,
            sqlTiming: 'rows-only',
            ...diagnostic,
            publicNormalization: version === 7 ? diagnostic.publicNormalization : 'sql',
          })}\n`
        );
        if (version !== 7) continue;
        // Every sample must avoid recursive public JSON normalization and JIT.
        expect(observation.normalizationLoops).toBe(0);
        expect(observation.jitFunctions).toBe(0);
        expect(executedScans.some((node) => node['Node Type'] === 'Index Scan')).toBe(true);
        expect(observation.scannedRows).toBeLessThanOrEqual(12);
      }
    }
  );

  it.each(['numeric', 'real', 'double precision'] as const)(
    'matches V6 %s specials, precise ties and non-C text/ID collation (Postgres)',
    async (physicalType) => {
      const amountId = `fld${'n'.repeat(16)}`;
      const physicalName = 'cursor_native_collation';
      const physical = sql.id(baseId.toString(), physicalName);
      const collation = sql.id(baseId.toString(), 'cursor_en');
      await sql`create collation if not exists ${collation} (provider = icu, locale = 'en', deterministic = true)`.execute(
        db
      );
      await sql`drop table if exists ${physical}`.execute(db);
      await sql`create table ${physical} (__id text collate ${collation} primary key,
        title text collate ${collation}, amount ${sql.raw(physicalType)})`.execute(db);
      const table = new DefaultTableMapper()
        .toDomain({
          id: `tbl${'c'.repeat(16)}`,
          baseId: baseId.toString(),
          name: 'Native collation',
          dbTableName: `${baseId.toString()}.${physicalName}`,
          primaryFieldId: titleId.toString(),
          fields: [
            {
              id: titleId.toString(),
              name: 'Title',
              type: 'singleLineText',
              dbFieldName: 'title',
              dbFieldType: 'TEXT',
              isPrimary: true,
            },
            {
              id: amountId,
              name: 'Amount',
              type: 'number',
              dbFieldName: 'amount',
              dbFieldType: 'REAL',
            },
          ],
          views: [{ id: `viw${'c'.repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} }],
        })
        ._unsafeUnwrap();
      for (const [id, title, amount] of [
        ['é', 'é', '1'],
        ['Z', 'é', '1'],
        ['a', 'é', '1'],
        ['A', 'é', '1'],
        ['f1', 'é', '1.0000000000000002'],
        ['f2', 'é', '1.0000001192092896'],
        ['f3', 'ä', '9007199254740993'],
        ['f4', 'A', '9007199254740992'],
        ['n1', 'Z', '-Infinity'],
        ['n2', 'a', 'Infinity'],
        ['n3', 'ä', 'NaN'],
        ['n4', null, null],
        ['n5', 'A', 'NaN'],
      ]) {
        await sql`insert into ${physical} values (${id},${title},${amount}::${sql.raw(physicalType)})`.execute(
          db
        );
      }
      const nativeIds = (
        await sql<{ id: string }>`select __id as id from ${physical} order by __id`.execute(db)
      ).rows;
      const binaryIds = (
        await sql<{
          id: string;
        }>`select __id as id from ${physical} order by __id collate "C"`.execute(db)
      ).rows;
      expect(nativeIds).not.toEqual(binaryIds);
      const executor = new PostgresDataQueryExecutor(db, {
        cursorSigningKey: 'test-cursor-signing-key',
      });
      const select = [
        { system: 'id', alias: 'id' },
        { fieldId: amountId, alias: 'amount' },
        { fieldId: titleId.toString(), alias: 'title' },
      ];
      const previous = await sql<{
        value: string;
      }>`select current_setting('extra_float_digits') as value`.execute(db);
      try {
        for (const precision of [0, 3]) {
          await sql`select set_config('extra_float_digits', ${String(precision)}, false)`.execute(
            db
          );
          for (const order of ['asc', 'desc'] as const) {
            for (const nulls of ['first', 'last'] as const) {
              for (const sort of [
                [
                  { alias: 'amount', order, nulls },
                  { alias: 'title', order, nulls },
                ],
                [
                  { fieldId: titleId.toString(), order, nulls },
                  { fieldId: amountId, order, nulls },
                ],
                [{ system: 'id', order, nulls }],
              ]) {
                const definition = {
                  kind: 'records',
                  tableId: table.id().toString(),
                  select,
                  sort,
                };
                const v6 = DataQueryDefinition.create({
                  ...definition,
                  version: 6,
                  page: { limit: 100 },
                })
                  ._unsafeUnwrap()
                  .bind({})
                  ._unsafeUnwrap();
                const expected = (await executor.execute(context, table, v6, {}))._unsafeUnwrap()
                  .rows;
                const input = DataQueryDefinition.create({
                  ...definition,
                  version: 7,
                  parameters: { cursor: { type: 'string' } },
                  page: {
                    limit: 2,
                    after: { type: 'parameter', name: 'cursor' },
                    includeTotal: true,
                  },
                })._unsafeUnwrap();
                const seen: Record<string, unknown>[] = [];
                let after: string | undefined;
                for (let page = 0; page < Math.ceil(expected.length / 2); page++) {
                  const result = (
                    await executor.execute(
                      context,
                      table,
                      input.bind(after ? { cursor: after } : {})._unsafeUnwrap(),
                      {}
                    )
                  )._unsafeUnwrap();
                  seen.push(...result.rows);
                  expect(result.page?.total).toBe(expected.length);
                  after =
                    result.page && 'nextCursor' in result.page
                      ? (result.page.nextCursor ?? undefined)
                      : undefined;
                }
                // V6 exposes driver floats here; its HTTP JSON response maps infinities and NaN to null.
                expect(seen).toEqual(
                  expected.map((row) =>
                    typeof row.amount === 'number' && !Number.isFinite(row.amount)
                      ? { ...row, amount: null }
                      : row
                  )
                );
                expect(after).toBeUndefined();
              }
            }
          }
        }
      } finally {
        await sql`select set_config('extra_float_digits', ${previous.rows[0].value}, false)`.execute(
          db
        );
      }
    },
    120_000
  );

  it.each(
    [false, true].flatMap((nullCategory) =>
      (['asc', 'desc'] as const).flatMap((direction) =>
        (['first', 'last'] as const).map((nulls) => ({ nullCategory, direction, nulls }))
      )
    )
  )(
    'seeks a 100k dense category suffix ($nullCategory/$direction/$nulls) with native index bounds',
    async ({ nullCategory, direction, nulls }) => {
      const amountId = `fld${'n'.repeat(16)}`;
      const secondaryId = `fld${'e'.repeat(16)}`;
      const physicalName = `cursor_dense_${nullCategory ? 'null' : 'equal'}_${direction}_${nulls}`;
      const physical = sql.id(baseId.toString(), physicalName);
      const secondaryDirection = direction === 'asc' ? 'desc' : 'asc';
      const table = new DefaultTableMapper()
        .toDomain({
          id: `tbl${'d'.repeat(16)}`,
          baseId: baseId.toString(),
          name: 'Dense native suffix',
          dbTableName: `${baseId.toString()}.${physicalName}`,
          primaryFieldId: titleId.toString(),
          fields: [
            {
              id: titleId.toString(),
              name: 'Category',
              type: 'singleLineText',
              dbFieldName: 'title',
              dbFieldType: 'TEXT',
              isPrimary: true,
            },
            {
              id: amountId,
              name: 'Amount',
              type: 'number',
              dbFieldName: 'amount',
              dbFieldType: 'NUMERIC',
            },
            {
              id: secondaryId,
              name: 'Secondary',
              type: 'number',
              dbFieldName: 'secondary',
              dbFieldType: 'NUMERIC',
            },
          ],
          views: [{ id: `viw${'d'.repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} }],
        })
        ._unsafeUnwrap();
      await sql`create table ${physical} (__id text collate "C" primary key,
        title text collate "C", amount numeric, secondary numeric)`.execute(db);
      await sql`create index ${sql.id(`${physicalName}_order`)} on ${physical}
        (title asc nulls first, amount ${sql.raw(direction)} nulls ${sql.raw(nulls)},
          secondary ${sql.raw(secondaryDirection)} nulls first, __id asc)`.execute(db);
      const populate = () =>
        sql`insert into ${physical}
        select lpad(n::text, 7, '0'), ${nullCategory ? null : 'same'},
          case when n % 7 = 0 then null else n / 10 end,
          case when n % 3 = 0 then null else n % 10 end
        from generate_series(1, 100000) as fixture(n) on conflict (__id) do nothing`.execute(db);
      await populate();
      const select = [
        { system: 'id', alias: 'id' },
        { fieldId: titleId.toString(), alias: 'category' },
        { fieldId: amountId, alias: 'amount' },
        { fieldId: secondaryId, alias: 'secondary' },
      ];
      const sort = [
        { alias: 'category', order: 'asc', nulls: 'first' },
        { alias: 'amount', order: direction, nulls },
        { alias: 'secondary', order: secondaryDirection, nulls: 'first' },
      ];
      const definition = { kind: 'records', tableId: table.id().toString(), select, sort };
      const executor = new PostgresDataQueryExecutor(db, {
        cursorSigningKey: 'test-cursor-signing-key',
      });
      const v6 = (offset: number) =>
        DataQueryDefinition.create({
          ...definition,
          version: 6,
          page: { limit: 10, offset, includeTotal: true },
        })
          ._unsafeUnwrap()
          .bind({})
          ._unsafeUnwrap();
      const preceding = (await executor.execute(context, table, v6(49990), {}))._unsafeUnwrap();
      const expected = (await executor.execute(context, table, v6(50000), {}))._unsafeUnwrap();
      const seed = [...preceding.rows, expected.rows[0]].map(({ id }) => String(id));
      await sql`delete from ${physical} where not (__id = any(${seed}::text[]))`.execute(db);
      const input = DataQueryDefinition.create({
        ...definition,
        version: 7,
        parameters: { cursor: { type: 'string' } },
        page: { limit: 10, after: { type: 'parameter', name: 'cursor' }, includeTotal: true },
      })._unsafeUnwrap();
      const anchor = (
        await executor.execute(context, table, input.bind({})._unsafeUnwrap(), {})
      )._unsafeUnwrap();
      expect(anchor.rows).toEqual(preceding.rows);
      const after = anchor.page && 'nextCursor' in anchor.page ? anchor.page.nextCursor : null;
      expect(after).toEqual(expect.any(String));
      await populate();
      await sql`analyze ${physical}`.execute(db);
      const query = input.bind({ cursor: after })._unsafeUnwrap();
      const measured = await createCursorPhaseRecorder(db).execute(table, query);
      expect(measured.result.rows).toEqual(expected.rows);
      expect(measured.result.page?.total).toBe(100000);
      const observation = await explainCursorPage(db, physicalName, () => measured.rowsQueries);
      const planDiagnostic = JSON.stringify({
        nullCategory,
        direction,
        nulls,
        stages: observation.stages,
      });
      expect(observation.scannedRows, planDiagnostic).toBeLessThanOrEqual(8 * 11);
      expect(observation.jitFunctions, planDiagnostic).toBe(0);
      expect(observation.normalizationLoops, planDiagnostic).toBe(0);
      expect(observation.executedScans.length, planDiagnostic).toBeGreaterThan(0);
      const orderIndex = `${physicalName}_order`;
      for (const scan of observation.executedScans) {
        if (scan['Node Type'] === 'Bitmap Heap Scan') {
          const children = scan.Plans ?? [];
          expect(children, planDiagnostic).toHaveLength(1);
          const bitmap = children[0]!;
          expect(bitmap['Node Type'], planDiagnostic).toBe('Bitmap Index Scan');
          expect(bitmap['Index Name'], planDiagnostic).toBe(orderIndex);
          expect(bitmap['Index Cond'], planDiagnostic).toBeTruthy();
          expect(
            bitmap['Actual Rows'] * bitmap['Actual Loops'],
            planDiagnostic
          ).toBeLessThanOrEqual(11);
        } else {
          expect(['Index Scan', 'Index Only Scan'], planDiagnostic).toContain(scan['Node Type']);
          expect(scan['Index Name'], planDiagnostic).toBe(orderIndex);
        }
      }
      process.stdout.write(
        `${JSON.stringify({
          diagnostic: 'cursor-dense-prefix',
          nullCategory,
          direction,
          nulls,
          scannedRows: observation.scannedRows,
          planningMs: observation.planningMs,
          sqlChars: measured.rowsQueries.reduce((sum, row) => sum + row.compiled.sql.length, 0),
        })}\n`
      );
    },
    120_000
  );

  it('plans and executes 256 mixed nullable cursor keys without expanding seek relations per key', async () => {
    const physicalName = 'cursor_wide_suffix';
    const physical = sql.id(baseId.toString(), physicalName);
    const columns = Array.from({ length: 256 }, (_, index) => ({
      id: `fld${String(index).padStart(16, '0')}`,
      name: `Key ${index}`,
      type: 'number' as const,
      dbFieldName: `k${index}`,
      dbFieldType: 'NUMERIC',
    }));
    const table = new DefaultTableMapper()
      .toDomain({
        id: `tbl${'w'.repeat(16)}`,
        baseId: baseId.toString(),
        name: 'Wide native suffix',
        dbTableName: `${baseId.toString()}.${physicalName}`,
        primaryFieldId: titleId.toString(),
        fields: [
          {
            id: titleId.toString(),
            name: 'Title',
            type: 'singleLineText',
            dbFieldName: 'title',
            dbFieldType: 'TEXT',
            isPrimary: true,
          },
          ...columns,
        ],
        views: [{ id: `viw${'w'.repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} }],
      })
      ._unsafeUnwrap();
    await sql`create table ${physical} (__id text primary key, title text,
      ${sql.join(columns.map((column) => sql`${sql.id(column.dbFieldName)} numeric`))})`.execute(
      db
    );
    await sql`insert into ${physical} select n::text, 'same',
      ${sql.join(
        columns.map((_, index) =>
          index < 255
            ? index % 5 === 0
              ? sql`null::numeric`
              : sql`${index}::numeric`
            : sql`n::numeric`
        )
      )} from generate_series(1, 7) as fixture(n)`.execute(db);
    const select = [{ system: 'id', alias: 'id' }];
    const sort = columns.map((column, index) => ({
      fieldId: column.id,
      order: index % 2 ? 'desc' : 'asc',
      nulls: index % 3 ? 'first' : 'last',
    }));
    const definition = { kind: 'records', tableId: table.id().toString(), select, sort };
    const executor = new PostgresDataQueryExecutor(db, {
      cursorSigningKey: 'test-cursor-signing-key',
    });
    const v6 = DataQueryDefinition.create({
      ...definition,
      version: 6,
      page: { limit: 2, offset: 2 },
    })
      ._unsafeUnwrap()
      .bind({})
      ._unsafeUnwrap();
    const expected = (await executor.execute(context, table, v6, {}))._unsafeUnwrap().rows;
    const input = DataQueryDefinition.create({
      ...definition,
      version: 7,
      parameters: { cursor: { type: 'string' } },
      page: { limit: 2, after: { type: 'parameter', name: 'cursor' } },
    })._unsafeUnwrap();
    const anchor = (
      await executor.execute(context, table, input.bind({})._unsafeUnwrap(), {})
    )._unsafeUnwrap();
    const after = anchor.page && 'nextCursor' in anchor.page ? anchor.page.nextCursor : null;
    const query = input.bind({ cursor: after })._unsafeUnwrap();
    const compiled = executor.compile(context, table, query, {})._unsafeUnwrap();
    expect(compiled.sql.length).toBeLessThan(2_000_000);
    const result = (await executor.execute(context, table, query, {}))._unsafeUnwrap();
    expect(result.rows).toEqual(expected);
    await db.executeQuery({ ...compiled, sql: `explain (format json) ${compiled.sql}` });
  }, 120_000);

  it.each(
    [20_000, 100_000].flatMap((size) =>
      (['numeric', 'double precision'] as const).flatMap((physicalType) =>
        (['asc', 'desc'] as const).map((direction) => ({ size, physicalType, direction }))
      )
    )
  )(
    'bounds REAL-family $physicalType $direction first/deep/tie pages at $size rows (Postgres)',
    async ({ size, physicalType, direction }) => {
      const amountId = `fld${'n'.repeat(16)}`;
      const payloadId = `fld${'p'.repeat(16)}`;
      const suffix = `${physicalType === 'numeric' ? 'n' : 'f'}${size === 20_000 ? 's' : 'l'}${direction === 'asc' ? 'a' : 'd'}`;
      const physicalName = `cursor_numeric_${suffix}`;
      const physical = sql.id(baseId.toString(), physicalName);
      const table = new DefaultTableMapper()
        .toDomain({
          id: `tbl${suffix.padEnd(16, 'x')}`,
          baseId: baseId.toString(),
          name: 'Cursor native numeric work',
          dbTableName: `${baseId.toString()}.${physicalName}`,
          primaryFieldId: titleId.toString(),
          fields: [
            {
              id: titleId.toString(),
              name: 'Title',
              type: 'singleLineText',
              dbFieldName: 'title',
              dbFieldType: 'TEXT',
              isPrimary: true,
            },
            {
              id: amountId,
              name: 'Amount',
              type: 'number',
              dbFieldName: 'amount',
              dbFieldType: 'REAL',
            },
            { id: payloadId, name: 'Payload', type: 'attachment', dbFieldName: 'payload' },
          ],
          views: [{ id: `viw${'n'.repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} }],
        })
        ._unsafeUnwrap();
      await sql`create table ${physical} (__id text collate "C" primary key, title text, amount ${sql.raw(physicalType)}, payload jsonb)`.execute(
        db
      );
      await sql`create index ${sql.id(`${physicalName}_order`)} on ${physical} (amount ${sql.raw(direction)} nulls first, __id asc)`.execute(
        db
      );
      const executor = new PostgresDataQueryExecutor(db, {
        cursorSigningKey: 'test-cursor-signing-key',
      });
      const input = DataQueryDefinition.create({
        version: 7,
        kind: 'records',
        tableId: table.id().toString(),
        select: [
          { system: 'id', alias: 'id' },
          { fieldId: amountId, alias: 'amount' },
          { fieldId: payloadId, alias: 'payload' },
        ],
        sort: [{ alias: 'amount', order: direction, nulls: 'first' }],
        parameters: { cursor: { type: 'string' } },
        page: { limit: 10, after: { type: 'parameter', name: 'cursor' }, includeTotal: true },
      })._unsafeUnwrap();
      const middle = size / 2;
      const start = direction === 'asc' ? middle - 9 : middle;
      const end = start + 10;
      const step = physicalType === 'numeric' ? 1 : 2;
      await sql`insert into ${physical}
        select 'finite-' || lpad(n::text, 7, '0'), n::text,
          9007199254740992::numeric + (n / 2)::numeric * ${step},
          jsonb_build_array(jsonb_build_object('n', n::numeric + 9007199254740992, 'items', jsonb_build_array(1, 2, null)))
        from generate_series(${start}::integer, ${end}::integer) as fixture(n)`.execute(db);
      const finiteAnchor = (
        await executor.execute(context, table, input.bind({})._unsafeUnwrap(), {})
      )._unsafeUnwrap();
      const finiteAfter =
        finiteAnchor.page && 'nextCursor' in finiteAnchor.page
          ? finiteAnchor.page.nextCursor
          : null;
      expect(finiteAnchor.rows.at(-1)?.id).toBe(`finite-${String(middle).padStart(7, '0')}`);
      expect(finiteAfter).toEqual(expect.any(String));
      const cluster = size / 5;
      const nullMiddle = cluster / 2;
      await sql`insert into ${physical}
        select 'null-' || lpad(n::text, 7, '0'), n::text, null,
          '[{"n":1.0000000000000000001}]'::jsonb
        from generate_series(${nullMiddle - 9}::integer, ${nullMiddle + 1}::integer) as fixture(n)`.execute(
        db
      );
      const nullAnchor = (
        await executor.execute(context, table, input.bind({})._unsafeUnwrap(), {})
      )._unsafeUnwrap();
      const nullAfter =
        nullAnchor.page && 'nextCursor' in nullAnchor.page ? nullAnchor.page.nextCursor : null;
      expect(nullAnchor.rows.at(-1)?.id).toBe(`null-${String(nullMiddle).padStart(7, '0')}`);
      expect(nullAfter).toEqual(expect.any(String));
      await sql`insert into ${physical}
        select 'finite-' || lpad(n::text, 7, '0'), n::text,
          9007199254740992::numeric + (n / 2)::numeric * ${step},
          jsonb_build_array(jsonb_build_object('n', n::numeric + 9007199254740992, 'items', jsonb_build_array(1, 2, null)))
        from generate_series(1, ${size}::integer) as fixture(n)
        where n not between ${start} and ${end}`.execute(db);
      await sql`insert into ${physical}
        select 'null-' || lpad(n::text, 7, '0'), n::text, null,
          '[{"n":1.0000000000000000001}]'::jsonb
        from generate_series(1, ${cluster}::integer) as fixture(n)
        where n not between ${nullMiddle - 9} and ${nullMiddle + 1}`.execute(db);
      for (const [prefix, special] of [
        ['neg', '-Infinity'],
        ['pos', 'Infinity'],
        ['nan', 'NaN'],
      ]) {
        await sql`insert into ${physical}
          select ${prefix} || '-' || lpad(n::text, 7, '0'), n::text,
            ${special}::${sql.raw(physicalType)}, '[{"n":1.0000000000000000001}]'::jsonb
          from generate_series(1, ${cluster}::integer) as fixture(n)`.execute(db);
      }
      await sql`analyze ${physical}`.execute(db);
      for (const [phase, parameters] of [
        ['first', {}],
        ['finite-continuation', { cursor: finiteAfter }],
        ['null-tie-continuation', { cursor: nullAfter }],
      ] as const) {
        const query = input.bind(parameters)._unsafeUnwrap();
        const result = (await executor.execute(context, table, query, {}))._unsafeUnwrap();
        expect(result.rows).toHaveLength(10);
        expect(result.page?.total).toBe(size + 4 * cluster);
        if (phase === 'first') {
          expect(result.rows[0].id).toBe('null-0000001');
          expect(result.rows[0].amount).toBeNull();
        } else if (phase === 'finite-continuation') {
          expect(result.rows[0].id).toBe(`finite-${String(middle + 1).padStart(7, '0')}`);
          const expected = 9007199254740992n + BigInt(Math.floor((middle + 1) / 2) * step);
          expect(result.rows[0].amount).toBe(
            physicalType === 'numeric' ? String(expected) : Number(expected)
          );
        } else {
          expect(result.rows[0].id).toBe(`null-${String(nullMiddle + 1).padStart(7, '0')}`);
          expect(result.rows[0].amount).toBeNull();
        }
        const anchorId =
          phase === 'finite-continuation'
            ? `finite-${String(middle).padStart(7, '0')}`
            : `null-${String(nullMiddle).padStart(7, '0')}`;
        const offset =
          phase === 'first'
            ? 0
            : Number(
                (
                  await sql<{ ordinal: string }>`
          select ordinal from (select __id,
            row_number() over (order by amount ${sql.raw(direction)} nulls first, __id asc) as ordinal
            from ${physical}) as ordered where __id = ${anchorId}`.execute(db)
                ).rows[0].ordinal
              );
        const v6 = DataQueryDefinition.create({
          version: 6,
          kind: 'records',
          tableId: table.id().toString(),
          select: [
            { system: 'id', alias: 'id' },
            { fieldId: amountId, alias: 'amount' },
            { fieldId: payloadId, alias: 'payload' },
          ],
          sort: [{ alias: 'amount', order: direction, nulls: 'first' }],
          page: { limit: 10, offset, includeTotal: true },
        })
          ._unsafeUnwrap()
          .bind({})
          ._unsafeUnwrap();
        expect(result.rows).toEqual(
          (await executor.execute(context, table, v6, {}))._unsafeUnwrap().rows
        );
        const executorTiming = await sampleDataQuery(async () =>
          (await executor.execute(context, table, query, {}))._unsafeUnwrap()
        );
        const observation = await explainCursorPage(db, physicalName, (normalization) =>
          executor.compile(context, table, query, {}, undefined, {}, normalization)._unsafeUnwrap()
        );
        const { executedScans, ...diagnostic } = observation;
        process.stdout.write(
          `${JSON.stringify({
            diagnostic: 'cursor-numeric-performance',
            rows: size,
            physicalType,
            direction,
            phase,
            version: 7,
            ...executorTiming,
            includeTotal: true,
            sqlTiming: 'rows-only',
            ...diagnostic,
            scanWork:
              phase === 'null-tie-continuation'
                ? executedScans.map((node) => ({
                    node: node['Node Type'],
                    index: node['Index Name'],
                    loops: node['Actual Loops'],
                    rows: node['Actual Rows'],
                    filtered: node['Rows Removed by Filter'] ?? 0,
                    rechecked: node['Rows Removed by Index Recheck'] ?? 0,
                  }))
                : undefined,
          })}\n`
        );
        // Native equal, strict and NULL seeks each expose at most limit+1 rows.
        // Dense earlier clusters must be excluded by index conditions.
        expect(observation.normalizationLoops).toBe(0);
        expect(observation.jitFunctions).toBe(0);
        expect(observation.scannedRows).toBeLessThanOrEqual(3 * 11);
        expect(executedScans.length).toBeGreaterThan(0);
        expect(
          executedScans.every((node) =>
            ['Index Scan', 'Index Only Scan'].includes(node['Node Type'])
          )
        ).toBe(true);
      }
    },
    120_000
  );

  it.each(
    [20_000, 100_000].flatMap((size) =>
      (['text', 'number'] as const).flatMap((kind) =>
        (['asc', 'desc'] as const).flatMap((direction) =>
          (['first', 'last'] as const).map((nulls) => ({ size, kind, direction, nulls }))
        )
      )
    )
  )(
    'compares page-100 $kind $direction nulls-$nulls first/middle/last latency at $size rows (Postgres)',
    async ({ size, kind, direction, nulls }) => {
      const amountId = `fld${'n'.repeat(16)}`;
      const payloadId = `fld${'p'.repeat(16)}`;
      const code = size === 20_000 ? 'latencys' : 'latencyl';
      const physicalName = `cursor_latency_${code}`;
      const physical = sql.id(baseId.toString(), physicalName);
      const table = new DefaultTableMapper()
        .toDomain({
          id: `tbl${code.padEnd(16, 'x')}`,
          baseId: baseId.toString(),
          name: 'Cursor latency acceptance',
          dbTableName: `${baseId.toString()}.${physicalName}`,
          primaryFieldId: titleId.toString(),
          fields: [
            {
              id: titleId.toString(),
              name: 'Title',
              type: 'singleLineText',
              dbFieldName: 'title',
              dbFieldType: 'TEXT',
              isPrimary: true,
            },
            {
              id: amountId,
              name: 'Amount',
              type: 'number',
              dbFieldName: 'amount',
              dbFieldType: 'REAL',
            },
            { id: payloadId, name: 'Payload', type: 'attachment', dbFieldName: 'payload' },
          ],
          views: [{ id: `viw${code.padEnd(16, 'x')}`, name: 'Grid', type: 'grid', columnMeta: {} }],
        })
        ._unsafeUnwrap();
      // The eight sequential sort cases reuse this physical fixture and its indexes.
      await sql`create table if not exists ${physical} (
        __id text collate "C" primary key, title text collate "C", amount numeric, payload jsonb
      )`.execute(db);
      await sql`truncate ${physical}`.execute(db);
      const column = kind === 'text' ? 'title' : 'amount';
      await sql`create index if not exists ${sql.id(`${physicalName}_${kind}_${direction}_${nulls}_order`)} on ${physical}
        (${sql.id(column)} ${sql.raw(direction)} nulls ${sql.raw(nulls)}, __id asc)`.execute(db);
      const executor = new PostgresDataQueryExecutor(db, {
        cursorSigningKey: 'test-cursor-signing-key',
      });
      const select = [
        { system: 'id' as const, alias: 'id' },
        { fieldId: kind === 'text' ? titleId.toString() : amountId, alias: 'value' },
        { fieldId: payloadId, alias: 'payload' },
      ];
      const sort = [{ alias: 'value', order: direction, nulls }];
      const cursorInput = (includeTotal: boolean) =>
        DataQueryDefinition.create({
          version: 7,
          kind: 'records',
          tableId: table.id().toString(),
          select,
          sort,
          parameters: { cursor: { type: 'string' } },
          page: { limit: 100, after: { type: 'parameter', name: 'cursor' }, includeTotal },
        })._unsafeUnwrap();
      const offsetQuery = (offset: number, includeTotal: boolean) =>
        DataQueryDefinition.create({
          version: 6,
          kind: 'records',
          tableId: table.id().toString(),
          select,
          sort,
          page: { limit: 100, offset, includeTotal },
        })
          ._unsafeUnwrap()
          .bind({})
          ._unsafeUnwrap();
      const groupFor = (n: number) => Math.floor((n - 1) / 2);
      const ordered = Array.from({ length: size }, (_, index) => index + 1).sort((left, right) => {
        const leftGroup = groupFor(left);
        const rightGroup = groupFor(right);
        const leftNull = leftGroup % 5 === 0;
        const rightNull = rightGroup % 5 === 0;
        if (leftNull !== rightNull) return leftNull === (nulls === 'first') ? -1 : 1;
        if (!leftNull && leftGroup !== rightGroup) {
          return direction === 'asc' ? leftGroup - rightGroup : rightGroup - leftGroup;
        }
        return left - right;
      });
      const expectedRows = (ordinals: number[]) =>
        ordinals.map((n) => ({
          id: String(n).padStart(7, '0'),
          value:
            groupFor(n) % 5 === 0
              ? null
              : kind === 'text'
                ? String(groupFor(n)).padStart(7, '0')
                : String(9007199254740992n + BigInt(groupFor(n)) * 2n),
          payload: [{ n: Number(BigInt(n) + 9007199254740992n), items: [1, 2, null] }],
        }));
      const middle = size / 2;
      // Two sparse preceding pages produce authentic signed boundary cursors.
      // The extra final row makes both preceding pages advertise continuation.
      const seed = [
        ...ordered.slice(middle - 100, middle),
        ...ordered.slice(size - 200, size - 99),
      ];
      const insertRows = (remaining: boolean) =>
        sql`insert into ${physical}
        select lpad(n::text, 7, '0'),
          case when ((n - 1) / 2) % 5 = 0 then null else lpad(((n - 1) / 2)::text, 7, '0') end,
          case when ((n - 1) / 2) % 5 = 0 then null else 9007199254740992::numeric + ((n - 1) / 2)::numeric * 2 end,
          jsonb_build_array(jsonb_build_object('n', n::numeric + 9007199254740992, 'items', jsonb_build_array(1, 2, null)))
        from generate_series(1, ${size}::integer) as fixture(n)
        where ${remaining ? sql`not` : sql``} (n = any(${seed}::integer[]))`.execute(db);
      await insertRows(false);
      const input = cursorInput(true);
      const middleAnchor = (
        await executor.execute(context, table, input.bind({})._unsafeUnwrap(), {})
      )._unsafeUnwrap();
      const middleAfter =
        middleAnchor.page && 'nextCursor' in middleAnchor.page
          ? middleAnchor.page.nextCursor
          : null;
      expect(middleAfter).toEqual(expect.any(String));
      const lastAnchor = (
        await executor.execute(
          context,
          table,
          input.bind({ cursor: middleAfter })._unsafeUnwrap(),
          {}
        )
      )._unsafeUnwrap();
      const lastAfter =
        lastAnchor.page && 'nextCursor' in lastAnchor.page ? lastAnchor.page.nextCursor : null;
      expect(lastAfter).toEqual(expect.any(String));
      await insertRows(true);
      await sql`analyze ${physical}`.execute(db);
      for (const [phase, offset, after] of [
        ['first', 0, undefined],
        ['middle', middle, middleAfter],
        ['last', size - 100, lastAfter],
      ] as const) {
        const cursorQuery = input.bind(after ? { cursor: after } : {})._unsafeUnwrap();
        const expected = expectedRows(ordered.slice(offset, offset + 100));
        for (const [version, query] of [
          [7, cursorQuery],
          [6, offsetQuery(offset, true)],
        ] as const) {
          const results: DataQueryResult[] = [];
          const executorTiming = await sampleDataQuery(async () => {
            results.push((await executor.execute(context, table, query, {}))._unsafeUnwrap());
          });
          for (const result of results) {
            expect(result.rows).toEqual(expected);
            expect(result.page?.total).toBe(size);
            if (version === 7) {
              expect(result.page).not.toHaveProperty('offset');
              expect(
                result.page && 'nextCursor' in result.page ? result.page.nextCursor : null
              ).toEqual(phase === 'last' ? null : expect.any(String));
            }
          }
          // Capture separately so statement observation cannot change acceptance timings.
          const executed = await createCursorPhaseRecorder(db).execute(table, query);
          expect(executed.result.rows).toEqual(expected);
          expect(executed.result.page?.total).toBe(size);
          const observation = await explainCursorPage(
            db,
            physicalName,
            () => executed.rowsQueries,
            version === 7 && nulls === 'last' && phase === 'last'
              ? sql`select __id, ${sql.id(column)}, payload from ${physical}
                  where ${sql.id(column)} is null
                    and __id > ${String(ordered[offset - 1]).padStart(7, '0')} collate "C"
                  order by ${sql.id(column)} ${kind === 'text' ? sql`collate "C"` : sql``}
                    ${sql.raw(direction)} nulls last, __id collate "C" asc limit 101`.compile(db)
              : undefined
          );
          const { executedScans, ...diagnostic } = observation;
          process.stdout.write(
            `${JSON.stringify({
              diagnostic: 'cursor-page-100-latency',
              rows: size,
              kind,
              physicalType: kind === 'text' ? 'text' : 'numeric',
              direction,
              nulls,
              phase,
              offset,
              limit: 100,
              includeTotal: true,
              version,
              ...executorTiming,
              sqlTiming: 'rows-only',
              sqlSource: 'executed-statement',
              sqlChars: executed.rowsQueries.reduce(
                (sum, stage) => sum + stage.compiled.sql.length,
                0
              ),
              ...diagnostic,
              publicNormalization: version === 7 ? diagnostic.publicNormalization : 'sql',
            })}\n`
          );
          if (version === 7) {
            expect(observation.extraFloatDigits).toBe(executed.extraFloatDigits);
            expect(observation.normalizationLoops).toBe(0);
            expect(observation.jitFunctions).toBe(0);
            if (observation.nullTailComparison) {
              // PostgreSQL can prefer the short primary-key suffix over the NULL bucket.
              // Match native query work and bound it by the fixture's remaining ID range.
              expect(observation.scannedRows).toBeLessThanOrEqual(
                observation.nullTailComparison.scannedRows
              );
              expect(observation.nullTailComparison.scannedRows).toBeLessThanOrEqual(
                size - ordered[offset - 1]
              );
            } else {
              expect(observation.scannedRows).toBeLessThanOrEqual(3 * 101);
            }
            expect(executedScans.length).toBeGreaterThan(0);
            expect(
              executedScans.every((node) =>
                ['Index Scan', 'Index Only Scan'].includes(node['Node Type'])
              )
            ).toBe(true);
          }
        }
      }
      if (size !== 20_000) return;
      const traversal = cursorInput(false);
      const expected = expectedRows(ordered);
      const timings: { version: 6 | 7; elapsedMs: number; pages: number; rowCount: number }[] = [];
      for (const version of [7, 6] as const) {
        const seen: Record<string, unknown>[] = [];
        let after: string | undefined;
        let pages = 0;
        const started = performance.now();
        do {
          const query =
            version === 7
              ? traversal.bind(after ? { cursor: after } : {})._unsafeUnwrap()
              : offsetQuery(pages * 100, false);
          const result = (await executor.execute(context, table, query, {}))._unsafeUnwrap();
          seen.push(...result.rows);
          pages++;
          after =
            result.page && 'nextCursor' in result.page
              ? (result.page.nextCursor ?? undefined)
              : undefined;
          // Bound an unexpected cursor cycle so failed traversal cannot run indefinitely.
          if (pages > size / 100)
            throw new Error('Cursor traversal exceeded the fixture page count');
        } while (version === 7 ? after !== undefined : pages * 100 < size);
        const elapsedMs = performance.now() - started;
        expect(pages).toBe(size / 100);
        expect(seen).toEqual(expected);
        expect(new Set(seen.map((row) => row.id)).size).toBe(size);
        expect(after).toBeUndefined();
        timings.push({ version, elapsedMs, pages, rowCount: seen.length });
      }
      process.stdout.write(
        `${JSON.stringify({
          diagnostic: 'cursor-full-traversal-latency',
          rows: size,
          kind,
          physicalType: kind === 'text' ? 'text' : 'numeric',
          direction,
          nulls,
          limit: 100,
          includeTotal: false,
          timings,
        })}\n`
      );
      const recorder = createCursorPhaseRecorder(db);
      for (const version of [7, 6] as const) {
        const sums = recorder.empty();
        const sampleExecution =
          (kind === 'text' && direction === 'asc' && nulls === 'first') ||
          (kind === 'number' && direction === 'desc' && nulls === 'last');
        const observedQueries: {
          offset: number;
          rowsQueries: CursorRowsQuery[];
          extraFloatDigits: number | undefined;
        }[] = [];
        const seen: Record<string, unknown>[] = [];
        let after: string | undefined;
        let pages = 0;
        const profiler = sampleExecution ? new Session() : undefined;
        try {
          if (profiler) {
            profiler.connect();
            await profiler.post('Profiler.enable');
            await profiler.post('Profiler.setSamplingInterval', { interval: 100 });
            await profiler.post('Profiler.start');
          }
          do {
            const bindStarted = performance.now();
            const query =
              version === 7
                ? traversal.bind(after ? { cursor: after } : {})._unsafeUnwrap()
                : offsetQuery(pages * 100, false);
            const bindMs = performance.now() - bindStarted;
            const measured = await recorder.execute(table, query);
            if (
              sampleExecution &&
              (pages === 0 || pages === size / 200 || pages === size / 100 - 1)
            ) {
              observedQueries.push({
                offset: pages * 100,
                rowsQueries: measured.rowsQueries,
                extraFloatDigits: measured.extraFloatDigits,
              });
            }
            measured.phases.bindMs = bindMs;
            for (const key of Object.keys(sums) as (keyof typeof sums)[]) {
              sums[key] += measured.phases[key];
            }
            seen.push(...measured.result.rows);
            pages++;
            after =
              measured.result.page && 'nextCursor' in measured.result.page
                ? (measured.result.page.nextCursor ?? undefined)
                : undefined;
            if (pages > size / 100)
              throw new Error('Instrumented cursor traversal exceeded the fixture page count');
          } while (version === 7 ? after !== undefined : pages * 100 < size);
          if (profiler) {
            const { profile } = await profiler.post('Profiler.stop');
            process.stdout.write(
              `${JSON.stringify({
                diagnostic: 'cursor-full-traversal-cpu',
                rows: size,
                kind,
                direction,
                nulls,
                version,
                pages,
                observerOverhead: true,
                samplingIntervalUs: 100,
                sampleCount: profile.samples?.length ?? 0,
                durationUs: profile.endTime - profile.startTime,
                functions: profile.nodes
                  .filter((node) => node.hitCount)
                  .sort((left, right) => (right.hitCount ?? 0) - (left.hitCount ?? 0))
                  .slice(0, 40)
                  .map((node) => ({
                    name: node.callFrame.functionName,
                    file: node.callFrame.url.split('/').slice(-5).join('/'),
                    line: node.callFrame.lineNumber + 1,
                    column: node.callFrame.columnNumber + 1,
                    selfSamples: node.hitCount,
                  })),
              })}\n`
            );
          }
        } finally {
          profiler?.disconnect();
        }
        expect(pages).toBe(size / 100);
        expect(seen).toEqual(expected);
        expect(new Set(seen.map((row) => row.id)).size).toBe(size);
        expect(after).toBeUndefined();
        process.stdout.write(
          `${JSON.stringify({
            diagnostic: 'cursor-full-traversal-phases',
            rows: size,
            kind,
            direction,
            nulls,
            version,
            pages,
            includeTotal: false,
            observerOverhead: true,
            cpuProfileEnabled: sampleExecution,
            sums,
          })}\n`
        );
        for (const observed of observedQueries) {
          const observation = await explainCursorPage(db, physicalName, () => observed.rowsQueries);
          if (version === 7) {
            expect(observation.extraFloatDigits).toBe(observed.extraFloatDigits);
          }
          process.stdout.write(
            `${JSON.stringify({
              diagnostic: 'cursor-executed-page-plan',
              rows: size,
              kind,
              direction,
              nulls,
              version,
              offset: observed.offset,
              limit: 100,
              includeTotal: false,
              sqlChars: observed.rowsQueries.reduce(
                (sum, stage) => sum + stage.compiled.sql.length,
                0
              ),
              ...observation,
              executedScans: undefined,
            })}\n`
          );
        }
      }
    },
    300_000
  );

  it.each(
    (['snapshot', 'failure'] as const).flatMap((mode) =>
      (['number', 'text'] as const).map((kind) => ({ mode, kind }))
    )
  )(
    'preserves whole-request semantics across a $kind cursor remainder: $mode',
    async ({ mode, kind }) => {
      const amountId = `fld${'n'.repeat(16)}`;
      const physicalName = `cursor_stage_${mode}_${kind}`;
      const physical = sql.id(baseId.toString(), physicalName);
      const table = new DefaultTableMapper()
        .toDomain({
          id: `tbl${`${mode}${kind}`.padEnd(16, 'x')}`,
          baseId: baseId.toString(),
          name: 'Cursor stage isolation',
          dbTableName: `${baseId.toString()}.${physicalName}`,
          primaryFieldId: titleId.toString(),
          fields: [
            {
              id: titleId.toString(),
              name: 'Title',
              type: 'singleLineText',
              dbFieldName: 'title',
              dbFieldType: 'TEXT',
              isPrimary: true,
            },
            {
              id: amountId,
              name: 'Amount',
              type: 'number',
              dbFieldName: 'amount',
              dbFieldType: 'REAL',
            },
          ],
          views: [
            {
              id: `viw${`${mode}${kind}`.padEnd(16, 'x')}`,
              name: 'Grid',
              type: 'grid',
              columnMeta: {},
            },
          ],
        })
        ._unsafeUnwrap();
      await sql`create table ${physical} (__id text primary key, title text, amount numeric)`.execute(
        db
      );
      await sql`insert into ${physical} values
        ('record-null-a', null, null), ('record-null-b', null, null),
        ('record-null', null, null), ('record-one', 'One', 1)`.execute(db);
      const options = { cursorSigningKey: 'test-cursor-signing-key' };
      const definition = DataQueryDefinition.create({
        version: 7,
        kind: 'records',
        tableId: table.id().toString(),
        select: [
          { system: 'id', alias: 'id' },
          { fieldId: amountId, alias: 'amount' },
        ],
        sort: [
          {
            fieldId: kind === 'text' ? titleId.toString() : amountId,
            order: 'asc',
            nulls: 'first',
          },
        ],
        parameters: { cursor: { type: 'string' } },
        page: { limit: 2, after: { type: 'parameter', name: 'cursor' }, includeTotal: true },
      })._unsafeUnwrap();
      const first = (
        await new PostgresDataQueryExecutor(db, options).execute(
          context,
          table,
          definition.bind({})._unsafeUnwrap(),
          {}
        )
      )._unsafeUnwrap();
      expect(first.rows.map((row) => row.id)).toEqual(['record-null', 'record-null-a']);
      const after = first.page && 'nextCursor' in first.page ? first.page.nextCursor : null;
      expect(after).toEqual(expect.any(String));
      const query = definition.bind({ cursor: after })._unsafeUnwrap();
      let rowStatements = 0;
      let inserted = false;
      // Kysely's transaction builder is immutable: setIsolationLevel/setAccessMode return a new
      // builder, so keep observing whichever builder is actually executed.
      const observeTransactionBuilder = (
        transactionBuilder: TransactionBuilder<V1TeableDatabase>
      ): TransactionBuilder<V1TeableDatabase> =>
        new Proxy(transactionBuilder, {
          get(builder, member) {
            if (member === 'execute') {
              return (callback: (transaction: Transaction<V1TeableDatabase>) => Promise<unknown>) =>
                builder.execute((transaction) =>
                  callback(
                    new Proxy(transaction, {
                      get(connection, key) {
                        if (key === 'executeQuery') {
                          return async (compiled: CompiledQuery<unknown>) => {
                            const rows = compiled.sql.startsWith('with "__dq_cursor_candidates"');
                            if (rows && ++rowStatements === 2 && mode === 'failure') {
                              await connection.executeQuery(sql`select 1 / 0`.compile(db));
                            }
                            const result = await connection.executeQuery(compiled);
                            if (rows && rowStatements === 1 && mode === 'snapshot') {
                              await sql`insert into ${physical} values ('record-two', 'Two', 2)`.execute(
                                holder
                              );
                              inserted = true;
                            }
                            return result;
                          };
                        }
                        const value = Reflect.get(connection, key, connection);
                        return typeof value === 'function' ? value.bind(connection) : value;
                      },
                    })
                  )
                );
            }
            const value = Reflect.get(builder, member, builder);
            if (typeof value !== 'function') return value;
            if (member === 'setIsolationLevel' || member === 'setAccessMode')
              return (...args: unknown[]) => observeTransactionBuilder(value.apply(builder, args));
            return value.bind(builder);
          },
        });
      const observedDb = new Proxy(db, {
        get(target, property) {
          if (property === 'transaction')
            return () => observeTransactionBuilder(target.transaction());
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      const result = await new PostgresDataQueryExecutor(observedDb, options).execute(
        context,
        table,
        query,
        {}
      );
      if (mode === 'failure') {
        expect(result._unsafeUnwrapErr()).toMatchObject({
          code: 'data_query.expression_division_by_zero',
        });
      } else {
        expect(inserted).toBe(true);
        expect(result._unsafeUnwrap()).toEqual({
          rows: [
            { id: 'record-null-b', amount: null },
            { id: 'record-one', amount: '1' },
          ],
          page: { limit: 2, total: 4, nextCursor: null },
        });
      }
      const next = (
        await new PostgresDataQueryExecutor(db, options).execute(context, table, query, {})
      )._unsafeUnwrap();
      expect(next.rows).toEqual([
        { id: 'record-null-b', amount: null },
        { id: 'record-one', amount: '1' },
      ]);
      expect(next.page?.total).toBe(mode === 'snapshot' ? 5 : 4);
    }
  );

  it('bounds concat subplans for aggregate and sort over 100k rows', async () => {
    const table = tableFor('c');
    const physical = sql.id(baseId.toString(), table.id().toString());
    await sql`create table ${physical} ("__id" text primary key, "Title" text)`.execute(db);
    await sql`insert into ${physical}
      select i::text, lpad(i::text, 6, '0') from generate_series(1, 100000) as rows(i)`.execute(db);
    await sql`analyze ${physical}`.execute(db);

    await db.transaction().execute(async (transaction) => {
      await sql`set local statement_timeout = '4s'`.execute(transaction);
      const executor = new PostgresDataQueryExecutor(transaction);
      for (const kind of ['aggregate', 'records'] as const) {
        const explain = async (parts: number) => {
          const concat = Array.from({ length: parts }, () => '{title}').join(' & ');
          const expr = {
            type: 'formula',
            formula: kind === 'aggregate' ? `LEN(${concat})` : concat,
            references: { title: { type: 'field', fieldId: titleId.toString() } },
          } as const;
          const query = DataQueryDefinition.create({
            tableId: table.id().toString(),
            ...(kind === 'aggregate'
              ? {
                  kind,
                  version: 4,
                  aggregates: [{ alias: 'value', statisticFunc: 'sum', expr }],
                }
              : {
                  kind,
                  version: 3,
                  select: [{ alias: 'value', expr }],
                  sort: [{ alias: 'value', order: 'desc' }],
                  page: { limit: 2 },
                }),
          })
            ._unsafeUnwrap()
            .bind({})
            ._unsafeUnwrap();
          const compiled = executor.compile(context, table, query, {})._unsafeUnwrap();
          const result = await transaction.executeQuery<{
            'QUERY PLAN': [{ Plan: unknown; 'Execution Time': number }];
          }>(
            CompiledQuery.raw(`EXPLAIN (ANALYZE, TIMING OFF, FORMAT JSON) ${compiled.sql}`, [
              ...compiled.parameters,
            ])
          );
          const [report] = result.rows[0]['QUERY PLAN'];
          const subplans = JSON.stringify(report.Plan).match(/"Subplan Name":/g)?.length ?? 0;
          console.info(
            `concat ${kind} (${parts} parts): ${report['Execution Time']} ms, ${subplans} subplans`
          );
          return subplans;
        };
        const short = await explain(9);
        expect(await explain(55)).toBe(short);
      }
    });
  }, 25_000);

  it('cancels a blocked query and returns the connection to a usable session', async () => {
    const table = tableFor('a');
    const physical = sql.id(baseId.toString(), table.id().toString());
    await sql`create table ${physical} ("__id" text primary key, "Title" text)`.execute(db);
    await sql`insert into ${physical} values ('record-a', 'Visible')`.execute(db);
    const executor = new PostgresDataQueryExecutor(db, { statementTimeoutMs: 100 });
    const query = boundFor(table);
    let signalLocked!: () => void;
    let releaseLock!: () => void;
    const locked = new Promise<void>((resolve) => {
      signalLocked = resolve;
    });
    const released = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const blocker = holder.transaction().execute(async (transaction) => {
      await sql`lock table ${physical} in access exclusive mode`.execute(transaction);
      signalLocked();
      await released;
    });
    await Promise.race([locked, blocker]);
    try {
      const result = await withDeadline(executor.execute(context, table, query, {}));
      expect(result._unsafeUnwrapErr()).toMatchObject({
        code: 'data_query.timeout',
        details: { sqlState: '57014' },
      });
    } finally {
      releaseLock();
      await blocker;
    }
    expect((await executor.execute(context, table, query, {}))._unsafeUnwrap().rows).toEqual([
      { title: 'Visible' },
    ]);
    await sql`insert into ${physical} values ('record-b', 'Writable after read')`.execute(db);
    expect((await executor.execute(context, table, query, {}))._unsafeUnwrap().rows).toEqual([
      { title: 'Visible' },
      { title: 'Writable after read' },
    ]);
  });

  it('blocks a mutating function hidden behind a database view', async () => {
    const table = tableFor('b');
    const physical = sql.id(baseId.toString(), table.id().toString());
    await sql`create sequence data_query_side_effect`.execute(db);
    await sql`create view ${physical} as select 'record-a'::text as "__id", nextval('data_query_side_effect')::text as "Title"`.execute(
      db
    );
    const executor = new PostgresDataQueryExecutor(db);
    const result = await executor.execute(context, table, boundFor(table), {});
    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: 'data_query.execution_failed',
      details: { sqlState: '25006' },
    });
    const state = await sql<{
      is_called: boolean;
    }>`select is_called from data_query_side_effect`.execute(db);
    expect(state.rows).toEqual([{ is_called: false }]);
  });
});

/* eslint-disable @typescript-eslint/naming-convention */
import {
  createV2NodeTestContainer,
  type IV2NodeTestContainer,
} from '@teable/v2-container-node-test';
import {
  ActorId,
  CreateFieldCommand,
  CreateRecordCommand,
  CreateRecordsCommand,
  CreateTableCommand,
  DeleteFieldCommand,
  FieldId,
  RecordSearch,
  TableByIdSpec,
  TableId,
  UpdateFieldCommand,
  v2CoreTokens,
  type CreateFieldResult,
  type CreateRecordResult,
  type CreateRecordsResult,
  type CreateTableResult,
  type DeleteFieldResult,
  type DomainError,
  type ICommandBus,
  type IExecutionContext,
  type ITableRecordQueryRepository,
  type ITableRepository,
  type Table,
  type UpdateFieldResult,
} from '@teable/v2-core';
import {
  registerV2TableOps,
  resolveTableSearchAccessPath,
  RunTableQueryRemediationTaskCommand,
  RunTableQueryRemediationTaskHandler,
  TableQueryRemediationTask,
  v2TableOpsTokens,
  type TableQueryRemediationTaskRepository,
  type TableSearchVectorReconciler,
  type TableSearchVectorStatusReader,
} from '@teable/v2-table-query-ops';
import { PostgresQueryCompiler, sql, type Kysely } from 'kysely';
import type { Result } from 'neverthrow';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { PostgresTableQueryRemediationExecutor } from './executor';
import { getTablePhysicalName, quoteIdentifier } from './helpers';
import { registerV2TableOpsPostgresAdapter } from './register';
import type { TableQueryOpsDatabase } from './schema';
import {
  PostgresTableSearchVectorAdvisor,
  PostgresTableSearchVectorExecutor,
  PostgresTableSearchVectorReconciler,
  type SearchGenerationExecutionState,
} from './searchVector';
import { PostgresTableSearchAccessPathMetadataPublisher } from './searchVectorMetadata';
import type { UnknownPostgresDatabase } from './types';

type SearchVectorConfig = {
  candidate_key: string;
  generated_column_name: string;
  index_name: string;
  field_ids: unknown;
  search_scope: string;
  field_db_names: unknown;
  status: string;
  semantics: string;
  access_path: string;
  provider: 'pg_bigm' | 'pg_trgm';
  operator_class: 'gin_bigm_ops' | 'gin_trgm_ops';
};

type SearchVectorPhysicalState = {
  expression: string;
  generated: string;
  index_valid: boolean;
};

const context: IExecutionContext = {
  actorId: ActorId.create('system')._unsafeUnwrap(),
  requestId: 'search-vector-schema-lifecycle-e2e',
};

const asStringArray = (value: unknown): string[] => {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === 'string')
    : [];
};

const expectOk = <T>(result: Result<T, DomainError>): T => {
  expect(result.isErr() ? result.error : undefined).toBeUndefined();
  return result._unsafeUnwrap();
};

// Needs a real Postgres (env-provided URL or the search CI flag). Without the
// gate, plain `pnpm test-unit` on a machine with no Docker and no database
// URL fails while booting testcontainers.
const hasTestDatabaseUrl = Boolean(
  process.env.TEABLE_V2_TEST_DATABASE_URL ??
  process.env.PRISMA_DATABASE_URL ??
  process.env.DATABASE_URL
);
const describeWithDb =
  process.env.TEABLE_V2_RUN_SEARCH_VECTOR_PG_INTEGRATION === '1' || hasTestDatabaseUrl
    ? describe
    : describe.skip;

describeWithDb('generated substring search document schema lifecycle (db)', () => {
  let testContainer: IV2NodeTestContainer;
  let commandBus: ICommandBus;
  let tableRepository: ITableRepository;
  let recordQueryRepository: ITableRecordQueryRepository;
  let taskRepository: TableQueryRemediationTaskRepository;
  let reconciler: TableSearchVectorReconciler;
  let statusReader: TableSearchVectorStatusReader;
  let db: Kysely<UnknownPostgresDatabase>;
  const recoveryTaskIds: string[] = [];

  const interruptGeneration = async (
    attempts: number,
    replacement = false,
    provider: SearchVectorConfig['provider'] = 'pg_trgm'
  ) => {
    const { table } = await createTable();
    const title = fieldByName(table, 'Title');
    const score = fieldByName(table, 'Score');
    await createSemanticRecords(table, title.id().toString(), score.id().toString());
    if (replacement)
      expectOk(
        await reconciler.reconcile(context, {
          table,
          mode: 'create',
          provider,
          validationMode: 'real_ddl',
          requirePlanImprovement: false,
          allowLargeTableRewrite: true,
        })
      );
    const meta = testContainer.metaDb as unknown as Kysely<TableQueryOpsDatabase>;
    const analysis = await new PostgresTableSearchVectorAdvisor(db).analyze(context, {
      table,
      provider,
      maxRecommendations: 1,
    });
    const task = expectOk(
      TableQueryRemediationTask.createQueued({
        tableId: table.id().toString(),
        baseId: table.baseId().toString(),
        kind: replacement ? 'rebuild_search_access_path' : 'create_search_access_path',
        now: new Date(),
        payload: {
          trigger: 'admin_search_access_path',
          executionMode: 'manual',
          mode: replacement ? 'rebuild' : 'create',
          provider,
          expectedDefinitionKey: analysis.recommendations[0].candidateKey,
          validationMode: 'real_ddl',
          allowLargeTableRewrite: true,
        },
      })
    );
    recoveryTaskIds.push(task.snapshot().id);
    expectOk(await taskRepository.save(context, task));
    const interruptedMeta = meta.withPlugin({
      transformQuery(args) {
        const compiled = new PostgresQueryCompiler().compileQuery(args.node, args.queryId);
        if (
          compiled.parameters.some(
            (value) => typeof value === 'string' && value.includes('"phase":"index_ready"')
          )
        )
          throw new Error('worker fails after physical index creation');
        return args.node;
      },
      async transformResult(args) {
        return args.result;
      },
    }) as unknown as Kysely<UnknownPostgresDatabase>;
    const executor = new PostgresTableQueryRemediationExecutor(
      interruptedMeta,
      db,
      tableRepository,
      new PostgresTableSearchVectorReconciler(interruptedMeta, db)
    );
    const handler = new RunTableQueryRemediationTaskHandler(
      taskRepository,
      executor,
      testContainer.container.resolve(v2TableOpsTokens.decisionPolicy),
      testContainer.container.resolve(v2TableOpsTokens.decisionLogRepository),
      { now: () => new Date() }
    );
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const failed = expectOk(
        await handler.handle(
          context,
          new RunTableQueryRemediationTaskCommand(task.snapshot().id, false, 'failing-worker')
        )
      );
      expect(failed.snapshot()).toMatchObject({
        status: 'failed',
        attempts: attempt,
        lastError: expect.stringContaining('worker fails after physical index creation'),
      });
    }
    const journal = (
      await meta
        .selectFrom('table_query_remediation_task')
        .select('execution_state')
        .where('id', '=', task.snapshot().id)
        .executeTakeFirstOrThrow()
    ).execution_state as SearchGenerationExecutionState;
    return { table, task, journal, meta };
  };
  const abandonGeneration = async () => {
    const result = await interruptGeneration(1);
    await result.meta
      .updateTable('table_query_remediation_task')
      .set({ attempts: 3 })
      .where('id', '=', result.task.snapshot().id)
      .execute();
    return result;
  };

  const runTask = async (taskId: string, worker = 'recovery-worker') => {
    const executor = new PostgresTableQueryRemediationExecutor(
      testContainer.metaDb as unknown as Kysely<UnknownPostgresDatabase>,
      db,
      tableRepository,
      reconciler
    );
    return expectOk(
      await new RunTableQueryRemediationTaskHandler(
        taskRepository,
        executor,
        testContainer.container.resolve(v2TableOpsTokens.decisionPolicy),
        testContainer.container.resolve(v2TableOpsTokens.decisionLogRepository),
        { now: () => new Date() }
      ).handle(context, new RunTableQueryRemediationTaskCommand(taskId, true, worker))
    );
  };

  const generationPresence = async (table: Table, journal: SearchGenerationExecutionState) => {
    const physical = expectOk(getTablePhysicalName(table));
    const tableSql = `${quoteIdentifier(physical.schema)}.${quoteIdentifier(physical.tableName)}`;
    return (
      await sql<{ column_present: boolean; index_present: boolean }>`SELECT
      EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass(${tableSql})
        AND attname = ${journal.generatedColumnName} AND NOT attisdropped) AS column_present,
      to_regclass(${`${quoteIdentifier(physical.schema)}.${quoteIdentifier(journal.indexName)}`}) IS NOT NULL AS index_present
    `.execute(db)
    ).rows[0];
  };

  const legacyGeneration = async (provider: SearchVectorConfig['provider'] = 'pg_trgm') => {
    const interrupted = await interruptGeneration(1, false, provider);
    const { table, journal, task, meta } = interrupted;
    const candidate = (
      await new PostgresTableSearchVectorAdvisor(db).analyze(context, {
        table,
        provider,
        maxRecommendations: 1,
      })
    ).recommendations[0];
    const physical = expectOk(getTablePhysicalName(table));
    const tableSql = `${quoteIdentifier(physical.schema)}.${quoteIdentifier(physical.tableName)}`;
    await sql
      .raw(
        `ALTER TABLE ${tableSql} RENAME COLUMN ${quoteIdentifier(journal.generatedColumnName)} TO ${quoteIdentifier(candidate.generatedColumnName)}`
      )
      .execute(db);
    await sql
      .raw(
        `ALTER INDEX ${quoteIdentifier(physical.schema)}.${quoteIdentifier(journal.indexName)} RENAME TO ${quoteIdentifier(candidate.indexName)}`
      )
      .execute(db);
    await meta
      .updateTable('table_query_remediation_task')
      .set({
        status: 'running',
        execution_state: null,
        locked_by: 'legacy-owner',
        locked_at: new Date(),
      })
      .where('id', '=', task.snapshot().id)
      .execute();
    return {
      ...interrupted,
      tableSql,
      physical,
      candidate,
      journal: {
        ...journal,
        generatedColumnName: candidate.generatedColumnName,
        indexName: candidate.indexName,
      },
    };
  };

  beforeAll(async () => {
    testContainer = await createV2NodeTestContainer();
    registerV2TableOps(testContainer.container);
    await registerV2TableOpsPostgresAdapter(testContainer.container, { ensureSchema: true });

    commandBus = testContainer.container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    tableRepository = testContainer.container.resolve<ITableRepository>(
      v2CoreTokens.tableRepository
    );
    recordQueryRepository = testContainer.container.resolve<ITableRecordQueryRepository>(
      v2CoreTokens.tableRecordQueryRepository
    );
    reconciler = testContainer.container.resolve<TableSearchVectorReconciler>(
      v2TableOpsTokens.searchVectorReconciler
    );
    taskRepository = testContainer.container.resolve<TableQueryRemediationTaskRepository>(
      v2TableOpsTokens.taskRepository
    );
    statusReader = testContainer.container.resolve<TableSearchVectorStatusReader>(
      v2TableOpsTokens.searchVectorStatusReader
    );
    db = testContainer.dataDb as unknown as Kysely<UnknownPostgresDatabase>;
    await sql.raw('CREATE EXTENSION IF NOT EXISTS pg_trgm').execute(db);
  }, 120_000);

  afterEach(async () => {
    if (!recoveryTaskIds.length) return;
    await (testContainer.metaDb as unknown as Kysely<TableQueryOpsDatabase>)
      .deleteFrom('table_query_remediation_task')
      .where('id', 'in', recoveryTaskIds.splice(0))
      .execute();
  });

  afterAll(async () => {
    await testContainer?.dispose();
  });

  it('samples a single field rather than a cross-field document prefix', async () => {
    const { table } = await createTable();
    const title = fieldByName(table, 'Title');
    const score = fieldByName(table, 'Score');
    (
      await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
        context,
        CreateRecordCommand.create({
          tableId: table.id().toString(),
          fields: { [title.id().toString()]: 'abc', [score.id().toString()]: 'xyz' },
        })._unsafeUnwrap()
      )
    )._unsafeUnwrap();
    const statements: { sql: string; parameters: readonly unknown[] }[] = [];
    const observedDb = db.withPlugin({
      transformQuery(args) {
        const compiled = new PostgresQueryCompiler().compileQuery(args.node, args.queryId);
        statements.push({ sql: compiled.sql, parameters: compiled.parameters });
        return args.node;
      },
      async transformResult(args) {
        return args.result;
      },
    });
    const observedReconciler = new PostgresTableSearchVectorReconciler(
      testContainer.metaDb as unknown as Kysely<UnknownPostgresDatabase>,
      observedDb
    );
    const result = (
      await observedReconciler.reconcile(context, {
        table,
        mode: 'create',
        provider: 'pg_trgm',
        validationMode: 'real_ddl',
        requirePlanImprovement: false,
        allowLargeTableRewrite: true,
      })
    )._unsafeUnwrap();
    const baseline = statements.find(
      (statement) =>
        statement.sql.includes('EXPLAIN (FORMAT JSON)') && statement.sql.includes('ILIKE')
    );
    const pattern = baseline?.parameters.find((value) => typeof value === 'string');
    expect(pattern).toMatch(/^%(abc|xyz)%$/);
    const physical = getTablePhysicalName(table)._unsafeUnwrap();
    const tableSql = `${quoteIdentifier(physical.schema)}.${quoteIdentifier(physical.tableName)}`;
    const titleSql = quoteIdentifier(title.dbFieldName()._unsafeUnwrap().value()._unsafeUnwrap());
    const scoreSql = quoteIdentifier(score.dbFieldName()._unsafeUnwrap().value()._unsafeUnwrap());
    const matches = await sql<{ count: number }>`
      SELECT count(*)::int AS count FROM ${sql.raw(tableSql)}
      WHERE ${sql.raw(titleSql)} ILIKE ${String(pattern)}
         OR ${sql.raw(scoreSql)} ILIKE ${String(pattern)}
    `.execute(db);
    expect(matches.rows[0]?.count).toBe(1);
    expect(result).toMatchObject({
      status: 'ready',
      planEvidence: { explainMethod: 'real_index', semanticsCompatible: true },
    });
  }, 120_000);

  it('validates omitted probes with real DDL without returning sampled content', async () => {
    const { table } = await createTable();
    const title = fieldByName(table, 'Title');
    const score = fieldByName(table, 'Score');
    await createSemanticRecords(table, title.id().toString(), score.id().toString());
    const input = {
      table,
      mode: 'create' as const,
      provider: 'pg_trgm' as const,
      validationMode: 'real_ddl' as const,
      requirePlanImprovement: false,
      allowLargeTableRewrite: true,
    };

    const result = (await reconciler.reconcile(context, input))._unsafeUnwrap();

    expect(result).toMatchObject({
      status: 'ready',
      planEvidence: {
        explainStatus: 'validated',
        explainMethod: 'real_index',
        semanticsCompatible: true,
      },
    });
    expect(input).not.toHaveProperty('searchProbe');
    expect(JSON.stringify(result)).not.toContain('lifecycleunique');
    await expectReadyConfig(table);
  }, 120_000);

  it.each(['empty', 'blank'] as const)(
    'keeps real-DDL exact validation for %s search documents without claiming performance',
    async (state) => {
      const { table } = await createTable();
      const title = fieldByName(table, 'Title');
      if (state === 'blank') {
        (
          await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
            context,
            CreateRecordCommand.create({
              tableId: table.id().toString(),
              fields: { [title.id().toString()]: '' },
            })._unsafeUnwrap()
          )
        )._unsafeUnwrap();
      }

      const result = (
        await reconciler.reconcile(context, {
          table,
          mode: 'create',
          provider: 'pg_trgm',
          validationMode: 'real_ddl',
          allowLargeTableRewrite: true,
        })
      )._unsafeUnwrap();

      expect(result).toMatchObject({
        status: 'ready',
        planEvidence: {
          explainStatus: 'validated',
          explainMethod: 'real_index',
          explainReason: 'real_ddl_empty_search_exact_results_validated_performance_not_measured',
          semanticsCompatible: true,
        },
      });
      await expectReadyConfig(table);
    },
    120_000
  );

  it('does not publish a plan-only path when nonblank text cannot supply a valid probe', async () => {
    const { table } = await createTable();
    const title = fieldByName(table, 'Title');
    (
      await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
        context,
        CreateRecordCommand.create({
          tableId: table.id().toString(),
          fields: { [title.id().toString()]: 'ab' },
        })._unsafeUnwrap()
      )
    )._unsafeUnwrap();
    const result = await reconciler.reconcile(context, {
      table,
      fieldIds: [title.id().toString()],
      mode: 'create',
      provider: 'pg_trgm',
      validationMode: 'real_ddl',
      allowLargeTableRewrite: true,
    });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.message).toContain('No validation sample meets');
    expect(
      (await statusReader.read(context, table.id().toString()))._unsafeUnwrap()
    ).not.toMatchObject({
      state: 'ready',
    });
  }, 120_000);

  it('keeps the configured search field contract until an explicit rebuild', async () => {
    const created = await createTable();
    let table = created.table;
    const titleField = fieldByName(table, 'Title');
    const scoreField = fieldByName(table, 'Score');

    await createSemanticRecords(table, titleField.id().toString(), scoreField.id().toString());
    await insertPlannerFiller(table, titleField, scoreField, 30_000);

    const initial = await reconciler.reconcile(context, {
      table,
      mode: 'create',
      provider: 'pg_trgm',
      languageConfig: 'simple',
      searchProbe: 'lifecycleunique',
      validationMode: 'real_ddl',
      allowLargeTableRewrite: true,
    });
    expect(
      initial.isOk(),
      initial.isErr() ? JSON.stringify(initial.error) : 'initial reconciliation result missing'
    ).toBe(true);
    expect(initial._unsafeUnwrap()).toMatchObject({ action: 'created', status: 'ready' });
    expect((await statusReader.read(context, table.id().toString()))._unsafeUnwrap()).toMatchObject(
      {
        state: 'ready',
        configured: true,
        languageConfig: 'simple',
        coveredFieldCount: 2,
      }
    );
    expect((await searchUsingRuntime(table, 'lifecycleunique')).searchAccessPath?.used).toBe(
      'generated_text'
    );

    let config = await expectReadyConfig(table);
    expect(await searchTotal(table, config, 'lifecycleunique')).toBe(1);

    const regionFieldId = FieldId.mustGenerate().toString();
    const addRegion = CreateFieldCommand.create({
      baseId: table.baseId().toString(),
      tableId: table.id().toString(),
      field: { id: regionFieldId, type: 'singleLineText', name: 'Region' },
    })._unsafeUnwrap();
    const addRegionResult = await commandBus.execute<CreateFieldCommand, CreateFieldResult>(
      context,
      addRegion
    );
    table = addRegionResult._unsafeUnwrap().table;
    const createRegionRecord = await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
      context,
      CreateRecordCommand.create({
        tableId: table.id().toString(),
        fields: {
          [titleField.id().toString()]: 'Regional order',
          [scoreField.id().toString()]: '88',
          [regionFieldId]: 'SingaporeWest',
        },
      })._unsafeUnwrap()
    );
    createRegionRecord._unsafeUnwrap();

    const addCheckboxResult = await commandBus.execute<CreateFieldCommand, CreateFieldResult>(
      context,
      CreateFieldCommand.create({
        baseId: table.baseId().toString(),
        tableId: table.id().toString(),
        field: { type: 'checkbox', name: 'Reviewed' },
      })._unsafeUnwrap()
    );
    table = addCheckboxResult._unsafeUnwrap().table;

    expect((await statusReader.read(context, table.id().toString()))._unsafeUnwrap()).toMatchObject(
      {
        state: 'ready',
        configured: true,
        coveredFieldCount: 2,
      }
    );
    config = await expectReadyConfig(table);
    expect(asStringArray(config.field_ids)).not.toContain(regionFieldId);
    // The document does not cover Region, but coverage only prefilters: the value keeps matching
    // through the plain predicate, so turning acceleration on never hides a field.
    expect(await searchTotalAcrossAllFields(table, config, 'SingaporeWest')).toBe(1);
    expect((await searchUsingRuntime(table, 'SingaporeWest')).total).toBe(1);
    expect((await searchUsingRuntime(table, 'lifecycleunique')).total).toBe(1);
    expect(await searchTotalWithDefaultPath(table, 'SingaporeWest')).toBe(1);

    // An unrelated edit may queue repair but must not enroll the new Region
    // field, nor force usable title coverage onto a table-wide fallback.
    const renamed = await commandBus.execute<UpdateFieldCommand, UpdateFieldResult>(
      context,
      UpdateFieldCommand.create({
        tableId: table.id().toString(),
        fieldId: titleField.id().toString(),
        field: { name: 'Order title' },
      })._unsafeUnwrap()
    );
    table = renamed._unsafeUnwrap().table;
    await expectPendingConfig(table);
    const pendingSearch = await searchUsingRuntime(table, 'lifecycleunique');
    expect(pendingSearch.total).toBe(1);
    expect(pendingSearch.searchAccessPath?.used).toBe('generated_text');
    await runPendingMaintenance();
    expect((await searchUsingRuntime(table, 'SingaporeWest')).total).toBe(1);

    const rebuilt = await reconciler.reconcile(context, {
      table,
      mode: 'rebuild',
      provider: 'pg_trgm',
      languageConfig: 'simple',
      searchProbe: 'SingaporeWest',
      validationMode: 'real_ddl',
      allowLargeTableRewrite: true,
    });
    expect(rebuilt._unsafeUnwrap()).toMatchObject({ action: 'rebuilt', status: 'ready' });

    config = await expectReadyConfig(table);
    expect(asStringArray(config.field_ids)).toContain(regionFieldId);
    expect(await searchTotalAcrossAllFields(table, config, 'SingaporeWest')).toBe(1);

    const convertScore = UpdateFieldCommand.create({
      tableId: table.id().toString(),
      fieldId: scoreField.id().toString(),
      field: { type: 'number' },
    })._unsafeUnwrap();
    const convertResult = await commandBus.execute<UpdateFieldCommand, UpdateFieldResult>(
      context,
      convertScore
    );
    table = convertResult._unsafeUnwrap().table;

    await expectPendingConfig(table);
    expect(await searchTotalWithDefaultPath(table, 'lifecycleunique')).toBe(1);
    const convertedSearch = await searchUsingRuntime(table, 'lifecycleunique');
    expect(convertedSearch.total).toBe(1);
    expect(convertedSearch.searchAccessPath).toMatchObject({
      used: 'default',
    });
    await runPendingMaintenance();

    config = await expectReadyConfig(table);
    // Conversion retains the canonical rounded-number search projection.
    expect(asStringArray(config.field_ids)).toContain(scoreField.id().toString());
    expect(await searchTotal(table, config, 'lifecycleunique')).toBe(1);
    // The 30,000 planner filler rows repeat scores 0–99: 300 also match 88,
    // in addition to the regional order. Both search paths must retain them.
    const numericSearchTotal = await searchTotal(table, config, '88.00');
    expect(numericSearchTotal).toBe(301);
    expect(numericSearchTotal).toBe(await searchTotalWithDefaultPath(table, '88.00'));

    const deleteRegion = DeleteFieldCommand.create({
      baseId: table.baseId().toString(),
      tableId: table.id().toString(),
      fieldId: regionFieldId,
    })._unsafeUnwrap();
    const deleteResult = await commandBus.execute<DeleteFieldCommand, DeleteFieldResult>(
      context,
      deleteRegion
    );
    deleteResult._unsafeUnwrap();
    table = await loadTable(table.id().toString());

    await expectPendingConfig(table);
    expect(await searchTotalWithDefaultPath(table, 'lifecycleunique')).toBe(1);
    expect((await searchUsingRuntime(table, 'lifecycleunique')).total).toBe(1);
    expect((await searchUsingRuntime(table, 'SingaporeWest')).total).toBe(0);
    await runPendingMaintenance();

    config = await expectReadyConfig(table);
    expect(asStringArray(config.field_ids)).not.toContain(regionFieldId);
    expect(await searchTotal(table, config, 'SingaporeWest')).toBe(0);
    expect(await searchTotal(table, config, 'lifecycleunique')).toBe(1);

    // Table-level kill switch: drop removes the managed objects, disables the
    // config, and search keeps working through the default ILIKE path.
    const dropResult = await reconciler.reconcile(context, { table, mode: 'drop' });
    expect(dropResult._unsafeUnwrap()).toMatchObject({ action: 'dropped', status: 'disabled' });
    expect((await statusReader.read(context, table.id().toString()))._unsafeUnwrap()).toMatchObject(
      {
        state: 'disabled',
        configured: false,
      }
    );
    const physicalAfterDrop = getTablePhysicalName(table)._unsafeUnwrap();
    const droppedState = await sql<{ column_exists: boolean; index_exists: boolean }>`
      SELECT
        EXISTS (
          SELECT 1
          FROM pg_attribute a
          JOIN pg_class c ON c.oid = a.attrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = ${physicalAfterDrop.schema}
            AND c.relname = ${physicalAfterDrop.tableName}
            AND a.attname = ${config.generated_column_name}
            AND NOT a.attisdropped
        ) AS column_exists,
        to_regclass(${`${quoteIdentifier(physicalAfterDrop.schema)}.${quoteIdentifier(config.index_name)}`}) IS NOT NULL AS index_exists
    `.execute(db);
    expect(droppedState.rows[0]).toEqual({ column_exists: false, index_exists: false });
    expect(await searchTotalWithDefaultPath(table, 'lifecycleunique')).toBe(1);
    expect((await searchUsingRuntime(table, 'lifecycleunique')).searchAccessPath?.used).toBe(
      'default'
    );
  }, 120_000);
  it('prefers ready bigm over stale trgm and retains selected coverage when physical indexes disappear', async (test) => {
    const publisher = new PostgresTableSearchAccessPathMetadataPublisher(
      testContainer.metaDb as unknown as Kysely<UnknownPostgresDatabase>,
      db,
      tableRepository
    );
    const available = await sql<{ available: boolean }>`
      SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_bigm') AS available
    `.execute(db);
    if (!available.rows[0]?.available) test.skip();
    await sql.raw('CREATE EXTENSION IF NOT EXISTS pg_bigm').execute(db);
    let table = (await createTable()).table;
    const title = fieldByName(table, 'Title');
    const score = fieldByName(table, 'Score');
    await createSemanticRecords(table, title.id().toString(), score.id().toString());
    await insertPlannerFiller(table, title, score, 30_000);
    (
      await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
        context,
        CreateRecordCommand.create({
          tableId: table.id().toString(),
          fields: {
            [title.id().toString()]: 'Other order',
            [score.id().toString()]: 'privatevalue',
          },
        })._unsafeUnwrap()
      )
    )._unsafeUnwrap();
    (
      await reconciler.reconcile(context, {
        table,
        mode: 'create',
        provider: 'pg_trgm',
        searchProbe: 'lifecycleunique',
        validationMode: 'real_ddl',
        allowLargeTableRewrite: true,
      })
    )._unsafeUnwrap();
    const trgm = await expectReadyConfig(table);
    expect((await searchUsingRuntime(table, 'privatevalue')).total).toBe(1);
    // Model metadata drift while the old physical document still exists. Only
    // Score's projection changes; Title remains usable before any rebuild.
    await sql`
      UPDATE field SET type = 'longText' WHERE id = ${score.id().toString()}
    `.execute(testContainer.metaDb as unknown as Kysely<TableQueryOpsDatabase>);
    table = await loadTable(table.id().toString());
    const drifted = await searchUsingRuntime(table, 'lifecycleunique');
    expect(drifted.total).toBe(1);
    expect(drifted.searchAccessPath?.used).toBe('generated_text');
    // Score left the published coverage when its projection drifted, so it is served by the plain
    // predicate: the document prefilters the covered fields and never narrows the result set.
    expect((await searchUsingRuntime(table, 'privatevalue')).total).toBe(1);
    await sql`
      UPDATE field SET deleted_time = now() WHERE id = ${score.id().toString()}
    `.execute(testContainer.metaDb as unknown as Kysely<TableQueryOpsDatabase>);
    table = await loadTable(table.id().toString());
    expect((await searchUsingRuntime(table, 'lifecycleunique')).total).toBe(1);
    expect((await searchUsingRuntime(table, 'privatevalue')).total).toBe(0);
    const bigmResult = await reconciler.reconcile(context, {
      table,
      mode: 'rebuild',
      provider: 'pg_bigm',
      fieldIds: [title.id().toString()],
      searchProbe: 'lifecycleunique',
      validationMode: 'real_ddl',
      allowLargeTableRewrite: true,
    });
    expect(bigmResult.isOk(), bigmResult.isErr() ? JSON.stringify(bigmResult.error) : '').toBe(
      true
    );
    const bigm = bigmResult._unsafeUnwrap();
    await sql`
      UPDATE table_query_search_vector_config
      SET last_modified_time = now() + interval '1 minute'
      WHERE table_id = ${table.id().toString()} AND provider = 'pg_trgm'
    `.execute(testContainer.metaDb as unknown as Kysely<TableQueryOpsDatabase>);
    expect(resolveTableSearchAccessPath(await loadTable(table.id().toString()))).toMatchObject({
      kind: 'generated_text',
      provider: 'pg_bigm',
      indexUsable: true,
    });
    expect((await searchUsingRuntime(table, 'lifecycleunique')).total).toBe(1);
    expect((await searchUsingRuntime(table, 'privatevalue')).total).toBe(0);

    const physical = getTablePhysicalName(table)._unsafeUnwrap();
    await sql
      .raw(`DROP INDEX ${quoteIdentifier(physical.schema)}.${quoteIdentifier(bigm.indexName)}`)
      .execute(db);
    (await publisher.refresh(context, table.id().toString()))._unsafeUnwrap();
    expect(resolveTableSearchAccessPath(await loadTable(table.id().toString()))).toMatchObject({
      kind: 'generated_text',
      provider: 'pg_trgm',
      indexUsable: true,
    });
    expect((await searchUsingRuntime(table, 'lifecycleunique')).total).toBe(1);
    expect((await searchUsingRuntime(table, 'privatevalue')).total).toBe(0);

    // Model an interrupted concurrent index build in this disposable test DB.
    await sql`
      UPDATE pg_index SET indisvalid = false
      WHERE indexrelid = to_regclass(${`${quoteIdentifier(physical.schema)}.${quoteIdentifier(trgm.index_name)}`})
    `.execute(db);
    (await publisher.refresh(context, table.id().toString()))._unsafeUnwrap();
    expect(resolveTableSearchAccessPath(await loadTable(table.id().toString()))).toMatchObject({
      kind: 'generated_text',
      indexUsable: false,
    });
    expect((await searchUsingRuntime(table, 'lifecycleunique')).total).toBe(1);
    expect((await searchUsingRuntime(table, 'privatevalue')).total).toBe(0);
  }, 120_000);

  it('uses a compatible document without source dependency entries and still rejects projection drift', async () => {
    let table = (await createTable()).table;
    const title = fieldByName(table, 'Title');
    const score = fieldByName(table, 'Score');
    await createSemanticRecords(table, title.id().toString(), score.id().toString());
    (
      await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
        context,
        CreateRecordCommand.create({
          tableId: table.id().toString(),
          fields: {
            [title.id().toString()]: 'unrelated item',
            [score.id().toString()]: 'projectiononlyunique',
          },
        })._unsafeUnwrap()
      )
    )._unsafeUnwrap();
    await insertPlannerFiller(table, title, score, 30_000);
    (
      await reconciler.reconcile(context, {
        table,
        mode: 'create',
        provider: 'pg_trgm',
        searchProbe: 'lifecycleunique',
        validationMode: 'real_ddl',
        allowLargeTableRewrite: true,
      })
    )._unsafeUnwrap();
    const config = await expectReadyConfig(table);
    const physical = getTablePhysicalName(table)._unsafeUnwrap();
    const tableSql = `${quoteIdentifier(physical.schema)}.${quoteIdentifier(physical.tableName)}`;

    // Reproduce the observed catalog shape in this disposable database: the
    // real generated expression and GIN remain, but only the self-dependency exists.
    await sql`
      DELETE FROM pg_depend dependency
      USING pg_attrdef definition
      WHERE dependency.classid = 'pg_attrdef'::regclass
        AND dependency.objid = definition.oid
        AND definition.adrelid = to_regclass(${tableSql})
        AND definition.adnum = (
          SELECT attnum FROM pg_attribute
          WHERE attrelid = definition.adrelid AND attname = ${config.generated_column_name}
        )
        AND dependency.refclassid = 'pg_class'::regclass
        AND dependency.refobjid = definition.adrelid
        AND dependency.refobjsubid > 0
        AND dependency.refobjsubid <> definition.adnum
    `.execute(db);
    const publisher = new PostgresTableSearchAccessPathMetadataPublisher(
      testContainer.metaDb as unknown as Kysely<UnknownPostgresDatabase>,
      db,
      tableRepository
    );
    (await publisher.refresh(context, table.id().toString()))._unsafeUnwrap();

    const indexed = await searchUsingRuntime(table, 'lifecycleunique');
    expect(indexed.total).toBe(1);
    expect(indexed.searchAccessPath?.used).toBe('generated_text');
    expect((await searchUsingRuntime(table, 'projectiononlyunique')).total).toBe(1);

    // Without a matching marker, physical projections must still prove coverage.
    await sql
      .raw(`COMMENT ON COLUMN ${tableSql}.${quoteIdentifier(config.generated_column_name)} IS NULL`)
      .execute(db);
    (await publisher.refresh(context, table.id().toString()))._unsafeUnwrap();
    const unmarked = await searchUsingRuntime(table, 'lifecycleunique');
    expect(unmarked.total).toBe(1);
    expect(unmarked.searchAccessPath?.used).toBe('generated_text');

    await sql`
      UPDATE field SET type = 'longText' WHERE id = ${score.id().toString()}
    `.execute(testContainer.metaDb as unknown as Kysely<TableQueryOpsDatabase>);
    table = await loadTable(table.id().toString());
    const drifted = resolveTableSearchAccessPath(table);
    expect(drifted).toMatchObject({ kind: 'generated_text', indexUsable: true });
    expect(
      drifted?.kind === 'generated_text'
        ? drifted.coveredFieldIds.map((fieldId) => fieldId.toString())
        : []
    ).toEqual([title.id().toString()]);
    expect((await searchUsingRuntime(table, 'lifecycleunique')).total).toBe(1);
    // The drifted field is no longer part of the published coverage, so it is served by the plain
    // predicate: the document is not trusted for it, and its values stay findable.
    expect((await searchUsingRuntime(table, 'projectiononlyunique')).total).toBe(1);
  }, 120_000);

  it('preserves the serving path when same-definition rebuild validation fails', async () => {
    const created = await createTable();
    const table = created.table;
    const titleField = fieldByName(table, 'Title');
    const scoreField = fieldByName(table, 'Score');
    await createSemanticRecords(table, titleField.id().toString(), scoreField.id().toString());
    await insertPlannerFiller(table, titleField, scoreField, 30_000);

    const initial = await reconciler.reconcile(context, {
      table,
      mode: 'create',
      provider: 'pg_trgm',
      languageConfig: 'simple',
      searchProbe: 'lifecycleunique',
      validationMode: 'real_ddl',
      allowLargeTableRewrite: true,
    });
    expect(
      initial.isOk(),
      initial.isErr() ? JSON.stringify(initial.error) : 'initial reconciliation result missing'
    ).toBe(true);
    const config = await expectReadyConfig(table);

    const failedRebuild = await reconciler.reconcile(context, {
      table,
      mode: 'rebuild',
      provider: 'pg_trgm',
      languageConfig: 'simple',
      searchProbe: 'ordinary',
      validationMode: 'real_ddl',
      allowLargeTableRewrite: true,
    });
    expect(failedRebuild.isErr()).toBe(true);

    const physical = getTablePhysicalName(table)._unsafeUnwrap();
    const objectState = await sql<{ column_exists: boolean; index_exists: boolean }>`
      SELECT
        EXISTS (
          SELECT 1
          FROM pg_attribute a
          JOIN pg_class c ON c.oid = a.attrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = ${physical.schema}
            AND c.relname = ${physical.tableName}
            AND a.attname = ${config.generated_column_name}
            AND NOT a.attisdropped
        ) AS column_exists,
        to_regclass(${`${quoteIdentifier(physical.schema)}.${quoteIdentifier(config.index_name)}`}) IS NOT NULL AS index_exists
    `.execute(db);
    expect(objectState.rows[0]).toEqual({ column_exists: true, index_exists: true });

    const latestConfig = await sql<{ status: string }>`
      SELECT status
      FROM table_query_search_vector_config
      WHERE table_id = ${table.id().toString()}
      ORDER BY last_modified_time DESC NULLS LAST, created_time DESC
      LIMIT 1
    `.execute(testContainer.metaDb as unknown as Kysely<TableQueryOpsDatabase>);
    expect(latestConfig.rows[0]?.status).toBe('ready');
    const search = await searchUsingRuntime(table, 'lifecycleunique');
    expect(search.total).toBe(1);
    expect(search.searchAccessPath?.used).toBe('generated_text');
  }, 120_000);

  for (const [provider, crash] of [
    ['pg_trgm', 'prepared'],
    ['pg_trgm', 'column_ready'],
    ['pg_trgm', 'index_ready'],
    ['pg_trgm', 'validated'],
    ['pg_trgm', 'publication'],
    ['pg_bigm', 'column_ready'],
    ['pg_bigm', 'publication'],
  ] as const) {
    it(`recovers manual ${provider} rebuild after ${crash} without another rewrite or publication`, async (test) => {
      if (provider === 'pg_bigm') {
        const installed = await sql<{
          installed: boolean;
        }>`SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_bigm') AS installed`.execute(
          db
        );
        if (!installed.rows[0]?.installed) test.skip();
      }
      const { table } = await createTable();
      const title = fieldByName(table, 'Title');
      const score = fieldByName(table, 'Score');
      await createSemanticRecords(table, title.id().toString(), score.id().toString());
      expectOk(
        await reconciler.reconcile(context, {
          table,
          mode: 'create',
          provider,
          validationMode: 'real_ddl',
          requirePlanImprovement: false,
          allowLargeTableRewrite: true,
        })
      );
      const original = await expectReadyConfig(table, provider);
      const meta = testContainer.metaDb as unknown as Kysely<TableQueryOpsDatabase>;
      const task = expectOk(
        TableQueryRemediationTask.createQueued({
          tableId: table.id().toString(),
          baseId: table.baseId().toString(),
          kind: 'rebuild_search_access_path',
          now: new Date(),
          payload: {
            trigger: 'admin_search_access_path',
            executionMode: 'manual',
            mode: 'rebuild',
            provider,
            expectedDefinitionKey: original.candidate_key,
            validationMode: 'real_ddl',
            allowLargeTableRewrite: true,
          },
        })
      );
      recoveryTaskIds.push(task.snapshot().id);
      expectOk(await taskRepository.save(context, task));
      const running = expectOk(
        await taskRepository.save(context, expectOk(task.start('departed', new Date())))
      );
      const statements: string[] = [];
      const publications = new Set<unknown>();
      let armed = true;
      const observedMeta = meta.withPlugin({
        transformQuery(args) {
          const compiled = new PostgresQueryCompiler().compileQuery(args.node, args.queryId);
          if (compiled.sql.includes('WITH published AS')) publications.add(args.queryId);
          const phase = compiled.parameters.find(
            (value) => typeof value === 'string' && value.includes('"kind":"search_generation"')
          );
          if (armed && typeof phase === 'string' && JSON.parse(phase).phase === crash) {
            armed = false;
            throw new Error('simulated worker death');
          }
          return args.node;
        },
        async transformResult(args) {
          if (armed && crash === 'publication' && publications.has(args.queryId)) {
            armed = false;
            throw new Error('simulated worker death after publication');
          }
          return args.result;
        },
      });
      const observedData = db.withPlugin({
        transformQuery(args) {
          statements.push(new PostgresQueryCompiler().compileQuery(args.node, args.queryId).sql);
          return args.node;
        },
        async transformResult(args) {
          return args.result;
        },
      });
      const interrupted = new PostgresTableQueryRemediationExecutor(
        observedMeta as unknown as Kysely<UnknownPostgresDatabase>,
        observedData,
        tableRepository,
        new PostgresTableSearchVectorReconciler(
          observedMeta as unknown as Kysely<UnknownPostgresDatabase>,
          observedData
        )
      );
      const failed = await interrupted.execute(context, {
        task: running,
        allowManualIndexExecution: false,
      });
      expect(failed.isErr() ? failed.error : undefined).toMatchObject({
        message: expect.stringContaining('simulated worker death'),
      });
      expect(armed).toBe(false);
      expect(
        expectOk(await taskRepository.findById(context, task.snapshot().id)).snapshot().status
      ).toBe('running');
      const firstJournal = (
        await meta
          .selectFrom('table_query_remediation_task')
          .select('execution_state')
          .where('id', '=', task.snapshot().id)
          .executeTakeFirstOrThrow()
      ).execution_state as SearchGenerationExecutionState | null;
      if (crash === 'prepared') {
        expect(firstJournal).toBeNull();
      } else {
        expect(firstJournal).not.toBeNull();
        expect(firstJournal?.generatedColumnName).not.toBe(original.generated_column_name);
      }
      if (crash !== 'publication') {
        expect((await expectReadyConfig(table, provider)).generated_column_name).toBe(
          original.generated_column_name
        );
        expect((await searchUsingRuntime(table, 'lifecycleunique')).total).toBe(1);
      }
      if (crash === 'index_ready') {
        if (!firstJournal) throw new Error('Interrupted index build did not persist its journal');
        const physical = expectOk(getTablePhysicalName(table));
        await sql`UPDATE pg_index SET indisvalid = false WHERE indexrelid = to_regclass(${`${quoteIdentifier(physical.schema)}.${quoteIdentifier(firstJournal.indexName)}`})`.execute(
          db
        );
        const invalid = await sql<{ valid: boolean }>`SELECT indisvalid AS valid FROM pg_index
        WHERE indexrelid = to_regclass(${`${quoteIdentifier(physical.schema)}.${quoteIdentifier(firstJournal.indexName)}`})`.execute(
          db
        );
        expect(invalid.rows[0]?.valid).toBe(false);
      }
      const versionBefore = await sql<{
        version: number;
      }>`SELECT version FROM table_meta WHERE id = ${table.id().toString()}`.execute(meta);
      await meta
        .updateTable('table_query_remediation_task')
        .set({ locked_at: new Date(Date.now() - 120_000) })
        .where('id', '=', task.snapshot().id)
        .execute();
      const claimed = expectOk(
        await taskRepository.claimNextAccepted(context, {
          scope: 'manual_search',
          workerId: 'replacement',
          now: new Date(),
          allowedKinds: [],
          allowManualIndexExecution: false,
          allowPolicyIndexExecution: false,
        })
      );
      expect(claimed?.snapshot().id).toBe(task.snapshot().id);
      const handler = new RunTableQueryRemediationTaskHandler(
        taskRepository,
        interrupted,
        testContainer.container.resolve(v2TableOpsTokens.decisionPolicy),
        testContainer.container.resolve(v2TableOpsTokens.decisionLogRepository),
        { now: () => new Date() }
      );
      const completed = expectOk(
        await handler.handle(
          context,
          new RunTableQueryRemediationTaskCommand(task.snapshot().id, false, 'replacement')
        )
      );
      expect(completed.snapshot()).toMatchObject({
        status: 'succeeded',
        attempts: 1,
        payload: task.snapshot().payload,
        lastError: undefined,
      });
      expect(completed.snapshot().result).toMatchObject({
        status: 'ready',
        planEvidence: { semanticsCompatible: true },
      });
      const finalJournal = (
        await meta
          .selectFrom('table_query_remediation_task')
          .select('execution_state')
          .where('id', '=', task.snapshot().id)
          .executeTakeFirstOrThrow()
      ).execution_state as SearchGenerationExecutionState;
      expect(finalJournal.phase).toBe('published');
      if (firstJournal)
        expect(finalJournal.generatedColumnName).toBe(firstJournal.generatedColumnName);
      const final = await expectReadyConfig(table, provider);
      expect(final.generated_column_name).toBe(finalJournal.generatedColumnName);
      expect(final.index_name).toBe(finalJournal.indexName);
      expect(final.generated_column_name).not.toBe(original.generated_column_name);
      expect(statements.filter((statement) => statement.includes('ADD COLUMN'))).toHaveLength(1);
      expect(
        statements.filter((statement) => statement.includes('CREATE INDEX CONCURRENTLY'))
      ).toHaveLength(crash === 'index_ready' ? 2 : 1);
      const versionAfter = await sql<{
        version: number;
      }>`SELECT version FROM table_meta WHERE id = ${table.id().toString()}`.execute(meta);
      expect(Number(versionAfter.rows[0].version) - Number(versionBefore.rows[0].version)).toBe(
        crash === 'publication' ? 0 : 1
      );
      expect((await searchUsingRuntime(table, 'lifecycleunique')).total).toBe(1);
      const physical = expectOk(getTablePhysicalName(table));
      const retained = await sql<{
        present: boolean;
      }>`SELECT to_regclass(${`${quoteIdentifier(physical.schema)}.${quoteIdentifier(original.index_name)}`}) IS NOT NULL AS present`.execute(
        db
      );
      expect(retained.rows[0]?.present).toBe(true);
    }, 120_000);
  }

  it('automatically reclaims the final failed attempt and a later create has one document', async () => {
    const { table, task, journal } = await interruptGeneration(3);
    expect(
      expectOk(await taskRepository.findById(context, task.snapshot().id)).snapshot()
    ).toMatchObject({ status: 'failed', attempts: 3, maxAttempts: 3 });
    expect(await generationPresence(table, journal)).toEqual({
      column_present: false,
      index_present: false,
    });
    expectOk(
      await reconciler.reconcile(context, {
        table,
        mode: 'create',
        provider: 'pg_trgm',
        validationMode: 'real_ddl',
        requirePlanImprovement: false,
        allowLargeTableRewrite: true,
      })
    );
    const physical = expectOk(getTablePhysicalName(table));
    const columns = await sql<{ count: number }>`SELECT count(*)::int AS count FROM pg_attribute
      WHERE attrelid = to_regclass(${`${quoteIdentifier(physical.schema)}.${quoteIdentifier(physical.tableName)}`})
        AND attgenerated = 's' AND NOT attisdropped AND attname LIKE '__tqops_search_%'
    `.execute(db);
    expect(columns.rows[0].count).toBe(1);
    expect((await searchUsingRuntime(table, 'lifecycleunique')).total).toBe(1);
  }, 120_000);

  it.each(['early_reconcile', 'pretry_version', 'direct_target'] as const)(
    'terminalizes %s once and reclaims only the unpublished replacement',
    async (failure) => {
      const { table, task, journal, meta } = await interruptGeneration(1, true);
      const serving = await expectReadyConfig(table);
      const before = (
        await sql<{ search_index: unknown }>`SELECT search_index FROM table_meta
        WHERE id = ${table.id().toString()}`.execute(meta)
      ).rows[0].search_index;
      const expectedIds = (await searchUsingRuntime(table, 'lifecycleunique')).records.map(
        (r) => r.id
      );
      const physical = expectOk(getTablePhysicalName(table));
      const indexSql = `${quoteIdentifier(physical.schema)}.${quoteIdentifier(journal.indexName)}`;
      await sql`UPDATE pg_index SET indisvalid = false WHERE indexrelid = to_regclass(${indexSql})`.execute(
        db
      );
      if (failure === 'early_reconcile') {
        expectOk(
          await commandBus.execute<CreateFieldCommand, CreateFieldResult>(
            context,
            expectOk(
              CreateFieldCommand.create({
                baseId: table.baseId().toString(),
                tableId: table.id().toString(),
                field: { type: 'singleLineText', name: 'Later field' },
              })
            )
          )
        );
      } else if (failure === 'pretry_version') {
        await sql`UPDATE table_meta SET version = version + 1 WHERE id = ${table.id().toString()}`.execute(
          meta
        );
      } else {
        const target = JSON.parse(journal.targetDefinition);
        await meta
          .updateTable('table_query_remediation_task')
          .set({
            payload: JSON.stringify({
              ...target,
              languageConfig: 'simple',
              generatedColumnName: journal.generatedColumnName,
              indexName: journal.indexName,
              rebuild: true,
              fields: target.fields.slice(0, 1),
            }),
          })
          .where('id', '=', task.snapshot().id)
          .execute();
      }
      const failed = await runTask(task.snapshot().id);
      expect(failed.snapshot()).toMatchObject({ status: 'failed', attempts: 2, maxAttempts: 2 });
      expect(failed.snapshot().lastError).not.toContain('cleanup failed');
      expect(await generationPresence(table, journal)).toEqual({
        column_present: false,
        index_present: false,
      });
      expect((await searchUsingRuntime(table, 'lifecycleunique')).records.map((r) => r.id)).toEqual(
        expectedIds
      );
      expect(
        await generationPresence(table, {
          ...journal,
          generatedColumnName: serving.generated_column_name,
          indexName: serving.index_name,
        })
      ).toEqual({ column_present: true, index_present: true });
      if (failure !== 'early_reconcile')
        expect(
          (
            await sql<{ search_index: unknown }>`SELECT search_index FROM table_meta
          WHERE id = ${table.id().toString()}`.execute(meta)
          ).rows[0].search_index
        ).toEqual(before);
      expect(failed.start('again', new Date()).isErr()).toBe(true);
    },
    120_000
  );

  it.each([
    'foreign_index',
    'extra_index',
    'column_only_foreign_index',
    'changed_expression',
    'lost_owner',
  ] as const)(
    'retains and reports unsafe cleanup for %s',
    async (collision) => {
      const { table, task, journal, meta } = await interruptGeneration(1);
      const physical = expectOk(getTablePhysicalName(table));
      const tableSql = `${quoteIdentifier(physical.schema)}.${quoteIdentifier(physical.tableName)}`;
      const indexSql = `${quoteIdentifier(physical.schema)}.${quoteIdentifier(journal.indexName)}`;
      if (collision === 'foreign_index') {
        await sql.raw(`DROP INDEX ${indexSql}`).execute(db);
        await sql
          .raw(`CREATE INDEX ${quoteIdentifier(journal.indexName)} ON ${tableSql} (__id)`)
          .execute(db);
        await sql`UPDATE pg_index SET indisvalid = false WHERE indexrelid = to_regclass(${indexSql})`.execute(
          db
        );
      }
      const extraIndex = `user_document_${table.id().toString()}`;
      if (collision === 'extra_index' || collision === 'column_only_foreign_index')
        await sql
          .raw(
            `CREATE INDEX ${quoteIdentifier(extraIndex)} ON ${tableSql} (${quoteIdentifier(journal.generatedColumnName)})`
          )
          .execute(db);
      if (collision === 'column_only_foreign_index')
        await sql.raw(`DROP INDEX ${indexSql}`).execute(db);
      if (collision === 'changed_expression') {
        const marker = (
          await sql<{ marker: string }>`SELECT col_description(attrelid, attnum) AS marker
          FROM pg_attribute WHERE attrelid = to_regclass(${tableSql}) AND attname = ${journal.generatedColumnName}`.execute(
            db
          )
        ).rows[0].marker;
        await sql.raw(`DROP INDEX ${indexSql}`).execute(db);
        await sql
          .raw(
            `ALTER TABLE ${tableSql} DROP COLUMN ${quoteIdentifier(journal.generatedColumnName)}`
          )
          .execute(db);
        await sql
          .raw(
            `ALTER TABLE ${tableSql} ADD COLUMN ${quoteIdentifier(journal.generatedColumnName)} text GENERATED ALWAYS AS ('foreign'::text) STORED`
          )
          .execute(db);
        await sql`COMMENT ON COLUMN ${sql.raw(tableSql)}.${sql.id(journal.generatedColumnName)} IS ${sql.lit(marker)}`.execute(
          db
        );
        await sql
          .raw(
            `CREATE INDEX ${quoteIdentifier(journal.indexName)} ON ${tableSql} USING gin (${quoteIdentifier(journal.generatedColumnName)} gin_trgm_ops)`
          )
          .execute(db);
      }
      if (collision === 'lost_owner') {
        const running = expectOk(
          await taskRepository.save(
            context,
            expectOk(
              expectOk(await taskRepository.findById(context, task.snapshot().id)).start(
                'departed',
                new Date()
              )
            )
          )
        );
        await meta
          .updateTable('table_query_remediation_task')
          .set({ locked_by: 'live-owner' })
          .where('id', '=', task.snapshot().id)
          .execute();
        await expect(
          new PostgresTableSearchVectorExecutor(
            meta as unknown as Kysely<UnknownPostgresDatabase>,
            db
          ).reclaimFailedTask(table.id().toString(), {
            taskId: task.snapshot().id,
            workerId: 'departed',
            lockedAt: running.snapshot().lockedAt!,
          })
        ).rejects.toThrow('ownership was lost');
      } else {
        await sql`UPDATE table_meta SET version = version + 1 WHERE id = ${table.id().toString()}`.execute(
          meta
        );
        const failed = await runTask(task.snapshot().id);
        expect(failed.snapshot()).toMatchObject({
          status: 'failed',
          attempts: 2,
          maxAttempts: 2,
          lastError: expect.stringContaining('cleanup failed'),
        });
        expect(failed.snapshot().lastError).toContain('Table changed');
      }
      expect(await generationPresence(table, journal)).toEqual({
        column_present: true,
        index_present: collision !== 'column_only_foreign_index',
      });
      if (collision === 'extra_index' || collision === 'column_only_foreign_index')
        expect(
          (
            await sql<{
              present: boolean;
            }>`SELECT to_regclass(${`${quoteIdentifier(physical.schema)}.${quoteIdentifier(extraIndex)}`}) IS NOT NULL AS present`.execute(
              db
            )
          ).rows[0].present
        ).toBe(true);
    },
    120_000
  );

  for (const [provider, phase] of [
    ['pg_trgm', 'column_only'],
    ['pg_trgm', 'invalid_index'],
    ['pg_trgm', 'valid_index'],
    ['pg_bigm', 'column_only'],
    ['pg_bigm', 'invalid_index'],
    ['pg_bigm', 'valid_index'],
  ] as const) {
    it(`adopts the pre-upgrade no-journal ${provider} ${phase} canonical generation without a second document`, async (test) => {
      if (provider === 'pg_bigm') {
        const installed = await sql<{ present: boolean }>`SELECT EXISTS (
          SELECT 1 FROM pg_extension WHERE extname = 'pg_bigm') AS present`.execute(db);
        if (!installed.rows[0]?.present) test.skip();
      }
      const { table, task, journal, meta, physical, tableSql } = await legacyGeneration(provider);
      const indexSql = `${quoteIdentifier(physical.schema)}.${quoteIdentifier(journal.indexName)}`;
      const columnIdentity = (
        await sql<{ attnum: number }>`SELECT attnum FROM pg_attribute
        WHERE attrelid = to_regclass(${tableSql}) AND attname = ${journal.generatedColumnName}`.execute(
          db
        )
      ).rows[0].attnum;
      if (phase === 'column_only') await sql.raw(`DROP INDEX ${indexSql}`).execute(db);
      if (phase === 'invalid_index')
        await sql`UPDATE pg_index SET indisvalid = false WHERE indexrelid = to_regclass(${indexSql})`.execute(
          db
        );
      const completed = await runTask(task.snapshot().id, 'legacy-owner');
      expect(completed.snapshot()).toMatchObject({ status: 'succeeded', attempts: 1 });
      const adopted = (
        await meta
          .selectFrom('table_query_remediation_task')
          .select('execution_state')
          .where('id', '=', task.snapshot().id)
          .executeTakeFirstOrThrow()
      ).execution_state as SearchGenerationExecutionState;
      expect(adopted).toMatchObject({
        generatedColumnName: journal.generatedColumnName,
        indexName: journal.indexName,
        phase: 'published',
      });
      const columns = await sql<{ attnum: number }>`SELECT attnum FROM pg_attribute
        WHERE attrelid = to_regclass(${tableSql}) AND attgenerated = 's' AND NOT attisdropped
          AND attname LIKE '__tqops_search_%'`.execute(db);
      expect(columns.rows).toEqual([{ attnum: columnIdentity }]);
      expect((await searchUsingRuntime(table, 'lifecycleunique')).total).toBe(1);
      expectOk(await reconciler.reconcile(context, { table, mode: 'drop' }));
      expect(await generationPresence(table, journal)).toEqual({
        column_present: false,
        index_present: false,
      });
    }, 120_000);
  }

  it.each(['column_only', 'invalid_index', 'valid_index'] as const)(
    'reclaims legacy admin no-journal %s after a field was added before adoption',
    async (phase) => {
      const { table, task, journal, meta, physical, tableSql } = await legacyGeneration();
      const indexSql = `${quoteIdentifier(physical.schema)}.${quoteIdentifier(journal.indexName)}`;
      if (phase === 'column_only') await sql.raw(`DROP INDEX ${indexSql}`).execute(db);
      if (phase === 'invalid_index')
        await sql`UPDATE pg_index SET indisvalid = false WHERE indexrelid = to_regclass(${indexSql})`.execute(
          db
        );
      expect(task.snapshot().payload).not.toHaveProperty('fields');
      expect(task.snapshot().payload).not.toHaveProperty('candidateKey');
      expectOk(
        await commandBus.execute<CreateFieldCommand, CreateFieldResult>(
          context,
          expectOk(
            CreateFieldCommand.create({
              baseId: table.baseId().toString(),
              tableId: table.id().toString(),
              field: { type: 'singleLineText', name: 'Added before legacy adoption' },
            })
          )
        )
      );
      const before = await meta
        .selectFrom('table_query_remediation_task')
        .select('execution_state')
        .where('id', '=', task.snapshot().id)
        .executeTakeFirstOrThrow();
      expect(before.execution_state).toBeNull();
      const failed = await runTask(task.snapshot().id, 'legacy-owner');
      expect(failed.snapshot()).toMatchObject({ status: 'failed', attempts: 1, maxAttempts: 1 });
      expect(failed.snapshot().lastError).not.toContain('cleanup failed');
      const adopted = (
        await meta
          .selectFrom('table_query_remediation_task')
          .select('execution_state')
          .where('id', '=', task.snapshot().id)
          .executeTakeFirstOrThrow()
      ).execution_state as SearchGenerationExecutionState;
      expect(adopted).toMatchObject({
        generatedColumnName: journal.generatedColumnName,
        indexName: journal.indexName,
      });
      const approved = JSON.parse(adopted.targetDefinition);
      expect(approved.fields.map((field: { fieldId: string }) => field.fieldId)).toEqual(
        table.getFields().map((field) => field.id().toString())
      );
      expect(await generationPresence(table, journal)).toEqual({
        column_present: false,
        index_present: false,
      });
      const current = await loadTable(table.id().toString());
      expectOk(
        await reconciler.reconcile(context, {
          table: current,
          mode: 'create',
          provider: 'pg_trgm',
          validationMode: 'real_ddl',
          requirePlanImprovement: false,
          allowLargeTableRewrite: true,
        })
      );
      const columns = await sql<{ count: number }>`SELECT count(*)::int AS count FROM pg_attribute
        WHERE attrelid = to_regclass(${tableSql}) AND attgenerated = 's'
          AND NOT attisdropped AND attname LIKE '__tqops_search_%'`.execute(db);
      expect(columns.rows[0].count).toBe(1);
      expect((await searchUsingRuntime(current, 'lifecycleunique')).total).toBe(1);
    },
    120_000
  );

  it.each(['column_only', 'both_absent'] as const)(
    'preserves a foreign index created after %s cleanup inspection',
    async (presence) => {
      const { table, task, journal, meta } = await abandonGeneration();
      const physical = expectOk(getTablePhysicalName(table));
      const tableSql = `${quoteIdentifier(physical.schema)}.${quoteIdentifier(physical.tableName)}`;
      const indexSql = `${quoteIdentifier(physical.schema)}.${quoteIdentifier(journal.indexName)}`;
      const other = (await createTable()).table;
      const otherPhysical = expectOk(getTablePhysicalName(other));
      const otherSql = `${quoteIdentifier(otherPhysical.schema)}.${quoteIdentifier(otherPhysical.tableName)}`;
      await sql.raw(`DROP INDEX ${indexSql}`).execute(db);
      if (presence === 'both_absent')
        await sql
          .raw(
            `ALTER TABLE ${tableSql} DROP COLUMN ${quoteIdentifier(journal.generatedColumnName)}`
          )
          .execute(db);
      const inspections = new Set<unknown>();
      let foreignOid: string | undefined;
      const racingData = db.withPlugin({
        transformQuery(args) {
          const compiled = new PostgresQueryCompiler().compileQuery(args.node, args.queryId);
          if (compiled.sql.includes('AS foreign_dependents')) inspections.add(args.queryId);
          return args.node;
        },
        async transformResult(args) {
          if (!foreignOid && inspections.has(args.queryId)) {
            await sql
              .raw(`CREATE INDEX ${quoteIdentifier(journal.indexName)} ON ${otherSql} (__id)`)
              .execute(db);
            foreignOid = (
              await sql<{
                oid: string;
              }>`SELECT to_regclass(${indexSql})::oid::text AS oid`.execute(db)
            ).rows[0].oid;
          }
          return args.result;
        },
      });
      await new PostgresTableSearchVectorExecutor(
        meta as unknown as Kysely<UnknownPostgresDatabase>,
        racingData
      ).drop(table.id().toString());
      expect(foreignOid).toBeDefined();
      const after = await sql<{ oid: string; table_oid: string }>`SELECT indexrelid::text AS oid,
        indrelid::text AS table_oid FROM pg_index WHERE indexrelid = to_regclass(${indexSql})`.execute(
        db
      );
      const identity = (
        await sql<{ oid: string }>`SELECT to_regclass(${otherSql})::oid::text AS oid`.execute(db)
      ).rows[0].oid;
      expect(after.rows).toEqual([{ oid: foreignOid, table_oid: identity }]);
      expect(await generationPresence(table, journal)).toEqual({
        column_present: false,
        index_present: true,
      });
      const persisted = expectOk(await taskRepository.findById(context, task.snapshot().id));
      expect(persisted.snapshot().attempts).toBe(3);
    },
    120_000
  );

  it('uses the transaction metadata executor on a shared reserved connection for adoption and reclamation', async () => {
    const { table, task, journal, candidate } = await legacyGeneration();
    // One Kysely instance takes withPhysicalLocks' shared-session branch.
    // statement_timeout cannot detect a JS-side connection re-entry deadlock;
    // the short test timeout is the regression boundary for that cycle.
    const shared = new PostgresTableSearchVectorExecutor(db, db);
    const running = expectOk(await taskRepository.findById(context, task.snapshot().id)).snapshot();
    await shared.adoptLegacyAdminGeneration({
      table,
      mode: 'create',
      provider: 'pg_trgm',
      expectedDefinitionKey: candidate.candidateKey,
      execution: {
        taskId: running.id,
        workerId: running.lockedBy!,
        lockedAt: running.lockedAt!,
      },
    });
    await shared.reclaimFailedTask(table.id().toString(), {
      taskId: running.id,
      workerId: running.lockedBy!,
      lockedAt: running.lockedAt!,
    });
    expect(await generationPresence(table, journal)).toEqual({
      column_present: false,
      index_present: false,
    });
  }, 15_000);

  it.each([false, true])(
    'requires explicit approved fields when legacy source dependencies are unavailable: %s',
    async (explicitFields) => {
      const { table, task, journal, candidate, tableSql, meta } = await legacyGeneration();
      if (explicitFields) {
        await meta
          .updateTable('table_query_remediation_task')
          .set({
            payload: JSON.stringify({
              trigger: 'admin_search_access_path',
              executionMode: 'manual',
              mode: 'create',
              provider: 'pg_trgm',
              expectedDefinitionKey: candidate.candidateKey,
              fieldIds: table.getFields().map((field) => field.id().toString()),
              validationMode: 'real_ddl',
              allowLargeTableRewrite: true,
            }),
          })
          .where('id', '=', task.snapshot().id)
          .execute();
      }
      await sql`DELETE FROM pg_depend dependency USING pg_attrdef definition
        WHERE dependency.classid = 'pg_attrdef'::regclass AND dependency.objid = definition.oid
          AND definition.adrelid = to_regclass(${tableSql})
          AND definition.adnum = (SELECT attnum FROM pg_attribute
            WHERE attrelid = definition.adrelid AND attname = ${journal.generatedColumnName})
          AND dependency.refclassid = 'pg_class'::regclass
          AND dependency.refobjid = definition.adrelid AND dependency.refobjsubid > 0
          AND dependency.refobjsubid <> definition.adnum`.execute(db);
      expectOk(
        await commandBus.execute<CreateFieldCommand, CreateFieldResult>(
          context,
          expectOk(
            CreateFieldCommand.create({
              baseId: table.baseId().toString(),
              tableId: table.id().toString(),
              field: { type: 'singleLineText', name: 'Outside approved legacy fields' },
            })
          )
        )
      );
      const completed = await runTask(task.snapshot().id, 'legacy-owner');
      if (explicitFields) {
        expect(completed.snapshot()).toMatchObject({ status: 'succeeded', attempts: 1 });
        const config = await expectReadyConfig(table);
        expect(config.generated_column_name).toBe(journal.generatedColumnName);
        expect(asStringArray(config.field_ids)).toEqual(
          table.getFields().map((field) => field.id().toString())
        );
      } else {
        expect(completed.snapshot()).toMatchObject({
          status: 'failed',
          attempts: 1,
          maxAttempts: 1,
        });
        expect(completed.snapshot().lastError).toContain('cleanup failed');
        const stored = await meta
          .selectFrom('table_query_remediation_task')
          .select('execution_state')
          .where('id', '=', task.snapshot().id)
          .executeTakeFirstOrThrow();
        expect(stored.execution_state).toBeNull();
      }
      expect(await generationPresence(table, journal)).toEqual({
        column_present: true,
        index_present: true,
      });
    },
    120_000
  );

  it.each(['config_write_rollback', 'committed_acknowledgement_lost'] as const)(
    'preserves truthful serving metadata on terminal %s publication failure',
    async (failure) => {
      const { table, task, journal, meta } = await interruptGeneration(1, true);
      const old = await expectReadyConfig(table);
      const oldServing = (
        await sql<{ search_index: unknown; version: number }>`SELECT search_index, version
          FROM table_meta WHERE id = ${table.id().toString()}`.execute(meta)
      ).rows[0];
      const expectedIds = (await searchUsingRuntime(table, 'lifecycleunique')).records.map(
        (record) => record.id
      );
      await meta
        .updateTable('table_query_remediation_task')
        .set({ max_attempts: 2 })
        .where('id', '=', task.snapshot().id)
        .execute();
      const triggerName = `tqops_fail_${table.id().toString()}`;
      const functionSql = `public.${quoteIdentifier(triggerName)}`;
      let acknowledgementLost = false;
      const publications = new Set<unknown>();
      const failingMeta = meta.withPlugin({
        transformQuery(args) {
          const compiled = new PostgresQueryCompiler().compileQuery(args.node, args.queryId);
          if (compiled.sql.includes('WITH published AS')) publications.add(args.queryId);
          return args.node;
        },
        async transformResult(args) {
          if (failure === 'committed_acknowledgement_lost' && publications.has(args.queryId)) {
            acknowledgementLost = true;
            throw new Error('publication acknowledgement lost after commit');
          }
          return args.result;
        },
      }) as unknown as Kysely<UnknownPostgresDatabase>;
      try {
        if (failure === 'config_write_rollback') {
          // An actual PostgreSQL AFTER trigger fails after the config row is
          // written, inside the same statement as the serving snapshot update.
          await sql
            .raw(`CREATE FUNCTION ${functionSql}() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
              IF NEW.table_id = '${table.id().toString()}' AND
                NEW.generated_column_name = '${journal.generatedColumnName}' THEN
                RAISE EXCEPTION 'publication config write rolled back';
              END IF;
              RETURN NEW;
            END $$`)
            .execute(meta);
          await sql
            .raw(`CREATE TRIGGER ${quoteIdentifier(triggerName)} AFTER INSERT OR UPDATE
              ON table_query_search_vector_config FOR EACH ROW EXECUTE FUNCTION ${functionSql}()`)
            .execute(meta);
        }
        const executor = new PostgresTableQueryRemediationExecutor(
          failingMeta,
          db,
          tableRepository,
          new PostgresTableSearchVectorReconciler(failingMeta, db)
        );
        const failed = expectOk(
          await new RunTableQueryRemediationTaskHandler(
            taskRepository,
            executor,
            testContainer.container.resolve(v2TableOpsTokens.decisionPolicy),
            testContainer.container.resolve(v2TableOpsTokens.decisionLogRepository),
            { now: () => new Date() }
          ).handle(
            context,
            new RunTableQueryRemediationTaskCommand(task.snapshot().id, true, 'publication-worker')
          )
        );
        expect(failed.snapshot()).toMatchObject({ status: 'failed', attempts: 2, maxAttempts: 2 });
        expect(failed.snapshot().lastError).not.toContain('cleanup failed');
        const serving = (
          await sql<{ search_index: unknown; version: number }>`SELECT search_index, version
            FROM table_meta WHERE id = ${table.id().toString()}`.execute(meta)
        ).rows[0];
        if (failure === 'config_write_rollback') {
          expect(failed.snapshot().lastError).toContain('publication config write rolled back');
          expect(serving).toEqual(oldServing);
          expect((await expectReadyConfig(table)).generated_column_name).toBe(
            old.generated_column_name
          );
          expect(await generationPresence(table, journal)).toEqual({
            column_present: false,
            index_present: false,
          });
          const references = await sql<{ count: number }>`SELECT count(*)::int AS count
            FROM table_query_search_vector_config WHERE generated_column_name = ${journal.generatedColumnName}
              OR index_name = ${journal.indexName}`.execute(meta);
          expect(references.rows[0].count).toBe(0);
        } else {
          expect(acknowledgementLost).toBe(true);
          expect(failed.snapshot().lastError).toContain(
            'publication acknowledgement lost after commit'
          );
          expect((await expectReadyConfig(table)).generated_column_name).toBe(
            journal.generatedColumnName
          );
          expect(serving.search_index).toMatchObject({
            generatedColumnName: journal.generatedColumnName,
            indexName: journal.indexName,
          });
          expect(await generationPresence(table, journal)).toEqual({
            column_present: true,
            index_present: true,
          });
        }
        expect(
          await generationPresence(table, {
            ...journal,
            generatedColumnName: old.generated_column_name,
            indexName: old.index_name,
          })
        ).toEqual({ column_present: true, index_present: true });
        const actualIds = (await searchUsingRuntime(table, 'lifecycleunique')).records.map(
          (record) => record.id
        );
        expect(actualIds).toEqual(expectedIds);
      } finally {
        if (failure === 'config_write_rollback') {
          await sql
            .raw(
              `DROP TRIGGER IF EXISTS ${quoteIdentifier(triggerName)} ON table_query_search_vector_config`
            )
            .execute(meta);
          await sql.raw(`DROP FUNCTION IF EXISTS ${functionSql}()`).execute(meta);
        }
      }
    },
    120_000
  );

  it.each(['automatic', 'explicit'] as const)(
    'reclaims an adopted unpublished canonical generation through %s cleanup',
    async (mode) => {
      const { table, task, journal, meta, physical } = await legacyGeneration();
      const interruptedMeta = meta.withPlugin({
        transformQuery(args) {
          const compiled = new PostgresQueryCompiler().compileQuery(args.node, args.queryId);
          if (
            compiled.parameters.some(
              (value) => typeof value === 'string' && value.includes('"phase":"column_ready"')
            )
          )
            throw new Error('interrupted adopted generation');
          return args.node;
        },
        async transformResult(args) {
          return args.result;
        },
      }) as unknown as Kysely<UnknownPostgresDatabase>;
      const running = expectOk(await taskRepository.findById(context, task.snapshot().id));
      const result = await new PostgresTableQueryRemediationExecutor(
        interruptedMeta,
        db,
        tableRepository,
        new PostgresTableSearchVectorReconciler(interruptedMeta, db)
      ).execute(context, { task: running, allowManualIndexExecution: false });
      expect(result.isErr()).toBe(true);
      const adopted = (
        await meta
          .selectFrom('table_query_remediation_task')
          .select('execution_state')
          .where('id', '=', task.snapshot().id)
          .executeTakeFirstOrThrow()
      ).execution_state as SearchGenerationExecutionState;
      expect(adopted.generatedColumnName).toBe(journal.generatedColumnName);
      await sql`UPDATE pg_index SET indisvalid = false WHERE indexrelid = to_regclass(${`${quoteIdentifier(physical.schema)}.${quoteIdentifier(journal.indexName)}`})`.execute(
        db
      );
      await sql`UPDATE table_meta SET version = version + 1 WHERE id = ${table.id().toString()}`.execute(
        meta
      );
      if (mode === 'automatic') {
        const failed = await runTask(task.snapshot().id, 'legacy-owner');
        expect(failed.snapshot()).toMatchObject({ status: 'failed', attempts: 1, maxAttempts: 1 });
      } else {
        await meta
          .updateTable('table_query_remediation_task')
          .set({ status: 'failed', max_attempts: 1, locked_by: null, locked_at: null })
          .where('id', '=', task.snapshot().id)
          .execute();
        expectOk(await reconciler.reconcile(context, { table, mode: 'drop' }));
      }
      expect(await generationPresence(table, journal)).toEqual({
        column_present: false,
        index_present: false,
      });
    },
    120_000
  );

  it.each(['marker', 'foreign_index', 'definition'] as const)(
    'refuses a pre-upgrade canonical %s collision instead of making a duplicate',
    async (collision) => {
      const { table, task, journal, meta, physical, tableSql } = await legacyGeneration();
      const indexSql = `${quoteIdentifier(physical.schema)}.${quoteIdentifier(journal.indexName)}`;
      if (collision === 'marker')
        await sql
          .raw(
            `COMMENT ON COLUMN ${tableSql}.${quoteIdentifier(journal.generatedColumnName)} IS NULL`
          )
          .execute(db);
      if (collision === 'foreign_index') {
        await sql.raw(`DROP INDEX ${indexSql}`).execute(db);
        await sql
          .raw(`CREATE INDEX ${quoteIdentifier(journal.indexName)} ON ${tableSql} (__id)`)
          .execute(db);
      }
      if (collision === 'definition') {
        const marker = (
          await sql<{ marker: string }>`SELECT col_description(attrelid, attnum) AS marker
          FROM pg_attribute WHERE attrelid = to_regclass(${tableSql}) AND attname = ${journal.generatedColumnName}`.execute(
            db
          )
        ).rows[0].marker;
        await sql.raw(`DROP INDEX ${indexSql}`).execute(db);
        await sql
          .raw(
            `ALTER TABLE ${tableSql} DROP COLUMN ${quoteIdentifier(journal.generatedColumnName)}`
          )
          .execute(db);
        await sql
          .raw(
            `ALTER TABLE ${tableSql} ADD COLUMN ${quoteIdentifier(journal.generatedColumnName)} text GENERATED ALWAYS AS ('foreign'::text) STORED`
          )
          .execute(db);
        await sql`COMMENT ON COLUMN ${sql.raw(tableSql)}.${sql.id(journal.generatedColumnName)} IS ${sql.lit(marker)}`.execute(
          db
        );
        await sql
          .raw(
            `CREATE INDEX ${quoteIdentifier(journal.indexName)} ON ${tableSql} USING gin (${quoteIdentifier(journal.generatedColumnName)} gin_trgm_ops)`
          )
          .execute(db);
      }
      const failed = await runTask(task.snapshot().id, 'legacy-owner');
      expect(failed.snapshot()).toMatchObject({
        status: 'failed',
        attempts: 1,
        maxAttempts: 1,
        lastError: expect.stringContaining('refusing an unreachable duplicate'),
      });
      expect(await generationPresence(table, journal)).toEqual({
        column_present: true,
        index_present: true,
      });
      expect(
        (
          await meta
            .selectFrom('table_query_remediation_task')
            .select('execution_state')
            .where('id', '=', task.snapshot().id)
            .executeTakeFirstOrThrow()
        ).execution_state
      ).toBeNull();
      const columns = await sql<{ count: number }>`SELECT count(*)::int AS count FROM pg_attribute
        WHERE attrelid = to_regclass(${tableSql}) AND attgenerated = 's' AND NOT attisdropped
          AND attname LIKE '__tqops_search_%'`.execute(db);
      expect(columns.rows[0].count).toBe(1);
    },
    120_000
  );

  it.each(['failed', 'cancelled', 'retryable', 'reserved'] as const)(
    'explicit drop reclaims only safe unpublished generations in %s state',
    async (state) => {
      const { table, task, journal, meta } =
        state === 'failed' ? await abandonGeneration() : await interruptGeneration(1);
      if (state === 'cancelled')
        expectOk(
          await taskRepository.cancelQueued(context, {
            taskId: task.snapshot().id,
            tableId: table.id().toString(),
            now: new Date(),
          })
        );
      if (state === 'reserved')
        await meta
          .updateTable('table_query_remediation_task')
          .set({
            status: 'failed',
            attempts: 3,
            locked_by: 'reserved-worker',
            locked_at: new Date(),
          })
          .where('id', '=', task.snapshot().id)
          .execute();
      const physical = expectOk(getTablePhysicalName(table));
      const tableSql = `${quoteIdentifier(physical.schema)}.${quoteIdentifier(physical.tableName)}`;
      await sql.raw(`ALTER TABLE ${tableSql} ADD COLUMN user_notes text`).execute(db);
      const unrelatedIndex = `user_index_${table.id().toString()}`;
      await sql
        .raw(`CREATE INDEX ${quoteIdentifier(unrelatedIndex)} ON ${tableSql} (user_notes)`)
        .execute(db);
      const inventory = async () =>
        (
          await sql<{
            column_present: boolean;
            index_present: boolean;
            user_index_present: boolean;
          }>`
        SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass(${tableSql})
          AND attname = ${journal.generatedColumnName} AND NOT attisdropped) AS column_present,
          to_regclass(${`${quoteIdentifier(physical.schema)}.${quoteIdentifier(journal.indexName)}`}) IS NOT NULL AS index_present,
          to_regclass(${`${quoteIdentifier(physical.schema)}.${quoteIdentifier(unrelatedIndex)}`}) IS NOT NULL AS user_index_present
      `.execute(db)
        ).rows[0];
      expect(await inventory()).toEqual({
        column_present: true,
        index_present: true,
        user_index_present: true,
      });
      expectOk(
        await reconciler.reconcile(context, {
          table,
          mode: 'drop',
          expectedDefinitionKey: 'not-approved-for-reclaim',
        })
      );
      expect(await inventory()).toEqual({
        column_present: true,
        index_present: true,
        user_index_present: true,
      });
      expectOk(await reconciler.reconcile(context, { table, mode: 'drop' }));
      const retained = state === 'retryable' || state === 'reserved';
      expect(await inventory()).toEqual({
        column_present: retained,
        index_present: retained,
        user_index_present: true,
      });
      expect((await searchUsingRuntime(table, 'lifecycleunique')).total).toBe(1);
    },
    120_000
  );

  it.each(['table_identity', 'index_identity', 'column_marker', 'managed_names'] as const)(
    'does not reclaim journal objects with changed %s',
    async (changed) => {
      const { table, task, journal, meta } = await abandonGeneration();
      const physical = expectOk(getTablePhysicalName(table));
      const tableSql = `${quoteIdentifier(physical.schema)}.${quoteIdentifier(physical.tableName)}`;
      const indexSql = `${quoteIdentifier(physical.schema)}.${quoteIdentifier(journal.indexName)}`;
      if (changed === 'table_identity')
        await meta
          .updateTable('table_query_remediation_task')
          .set({ execution_state: JSON.stringify({ ...journal, tableOid: '0' }) })
          .where('id', '=', task.snapshot().id)
          .execute();
      if (changed === 'index_identity') {
        const other = (await createTable()).table;
        const otherPhysical = expectOk(getTablePhysicalName(other));
        const otherSql = `${quoteIdentifier(otherPhysical.schema)}.${quoteIdentifier(otherPhysical.tableName)}`;
        await sql.raw(`DROP INDEX ${indexSql}`).execute(db);
        await sql
          .raw(`CREATE INDEX ${quoteIdentifier(journal.indexName)} ON ${otherSql} (__id)`)
          .execute(db);
      }
      if (changed === 'column_marker')
        await sql
          .raw(
            `COMMENT ON COLUMN ${tableSql}.${quoteIdentifier(journal.generatedColumnName)} IS NULL`
          )
          .execute(db);
      if (changed === 'managed_names') {
        await sql.raw(`ALTER TABLE ${tableSql} ADD COLUMN user_notes text`).execute(db);
        await meta
          .updateTable('table_query_remediation_task')
          .set({
            execution_state: JSON.stringify({ ...journal, generatedColumnName: 'user_notes' }),
          })
          .where('id', '=', task.snapshot().id)
          .execute();
      }
      expectOk(await reconciler.reconcile(context, { table, mode: 'drop' }));
      const remaining = await sql<{ column_present: boolean; index_present: boolean }>`SELECT
        EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass(${tableSql})
          AND attname = ${journal.generatedColumnName} AND NOT attisdropped) AS column_present,
        to_regclass(${indexSql}) IS NOT NULL AS index_present`.execute(db);
      expect(remaining.rows[0]).toEqual({ column_present: true, index_present: true });
      if (changed === 'managed_names') {
        const userColumn = await sql<{ present: boolean }>`SELECT EXISTS (SELECT 1 FROM pg_attribute
          WHERE attrelid = to_regclass(${tableSql}) AND attname = 'user_notes' AND NOT attisdropped) AS present`.execute(
          db
        );
        expect(userColumn.rows[0]?.present).toBe(true);
      }
    },
    120_000
  );

  it('preserves another table index that reuses an interrupted generation name', async () => {
    const { table, task, journal, meta } = await interruptGeneration(1);
    const physical = expectOk(getTablePhysicalName(table));
    const other = (await createTable()).table;
    const otherPhysical = expectOk(getTablePhysicalName(other));
    const otherSql = `${quoteIdentifier(otherPhysical.schema)}.${quoteIdentifier(otherPhysical.tableName)}`;
    const indexSql = `${quoteIdentifier(physical.schema)}.${quoteIdentifier(journal.indexName)}`;
    await sql.raw(`DROP INDEX ${indexSql}`).execute(db);
    await sql
      .raw(`CREATE INDEX ${quoteIdentifier(journal.indexName)} ON ${otherSql} (__id)`)
      .execute(db);
    const before = await sql<{
      oid: string;
    }>`SELECT to_regclass(${indexSql})::oid::text AS oid`.execute(db);
    await sql`UPDATE pg_index SET indisvalid = false WHERE indexrelid = to_regclass(${indexSql})`.execute(
      db
    );
    const executor = new PostgresTableQueryRemediationExecutor(
      meta as unknown as Kysely<UnknownPostgresDatabase>,
      db,
      tableRepository,
      reconciler
    );
    const handler = new RunTableQueryRemediationTaskHandler(
      taskRepository,
      executor,
      testContainer.container.resolve(v2TableOpsTokens.decisionPolicy),
      testContainer.container.resolve(v2TableOpsTokens.decisionLogRepository),
      { now: () => new Date() }
    );
    const failed = expectOk(
      await handler.handle(
        context,
        new RunTableQueryRemediationTaskCommand(task.snapshot().id, false, 'collision-retry')
      )
    );
    expect(failed.snapshot()).toMatchObject({
      status: 'failed',
      attempts: 2,
      lastError: expect.stringContaining('incompatible physical object'),
    });
    const after = await sql<{ oid: string; table_oid: string; valid: boolean }>`
      SELECT i.indexrelid::text AS oid, i.indrelid::text AS table_oid, i.indisvalid AS valid
      FROM pg_index i WHERE i.indexrelid = to_regclass(${indexSql})
    `.execute(db);
    const otherIdentity = await sql<{
      oid: string;
    }>`SELECT to_regclass(${otherSql})::oid::text AS oid`.execute(db);
    expect(after.rows).toEqual([
      {
        oid: before.rows[0].oid,
        table_oid: otherIdentity.rows[0].oid,
        valid: false,
      },
    ]);
    expect((await searchUsingRuntime(table, 'lifecycleunique')).total).toBe(1);
  }, 120_000);

  it('analyzes and maintains a task-created serving generation without another heap rewrite', async () => {
    const { table } = await createTable();
    const title = fieldByName(table, 'Title');
    const score = fieldByName(table, 'Score');
    await createSemanticRecords(table, title.id().toString(), score.id().toString());
    const reviewedDefinitionKey = (
      await new PostgresTableSearchVectorAdvisor(db).analyze(context, {
        table,
        provider: 'pg_trgm',
        maxRecommendations: 1,
      })
    ).recommendations[0].candidateKey;
    const task = expectOk(
      TableQueryRemediationTask.createQueued({
        tableId: table.id().toString(),
        baseId: table.baseId().toString(),
        kind: 'create_search_access_path',
        now: new Date(),
        payload: {
          trigger: 'admin_search_access_path',
          executionMode: 'manual',
          mode: 'create',
          provider: 'pg_trgm',
          expectedDefinitionKey: reviewedDefinitionKey,
          validationMode: 'real_ddl',
          allowLargeTableRewrite: true,
        },
      })
    );
    recoveryTaskIds.push(task.snapshot().id);
    expectOk(await taskRepository.save(context, task));
    const meta = testContainer.metaDb as unknown as Kysely<UnknownPostgresDatabase>;
    const statements: string[] = [];
    const data = db.withPlugin({
      transformQuery(args) {
        statements.push(new PostgresQueryCompiler().compileQuery(args.node, args.queryId).sql);
        return args.node;
      },
      async transformResult(args) {
        return args.result;
      },
    });
    const observedReconciler = new PostgresTableSearchVectorReconciler(meta, data);
    const executor = new PostgresTableQueryRemediationExecutor(
      meta,
      data,
      tableRepository,
      observedReconciler
    );
    const handler = new RunTableQueryRemediationTaskHandler(
      taskRepository,
      executor,
      testContainer.container.resolve(v2TableOpsTokens.decisionPolicy),
      testContainer.container.resolve(v2TableOpsTokens.decisionLogRepository),
      { now: () => new Date() }
    );
    const completed = expectOk(
      await handler.handle(
        context,
        new RunTableQueryRemediationTaskCommand(task.snapshot().id, false, 'creating-worker')
      )
    );
    expect(completed.snapshot().status).toBe('succeeded');
    const config = await expectReadyConfig(table);
    const physical = expectOk(getTablePhysicalName(table));
    const tableSql = `${quoteIdentifier(physical.schema)}.${quoteIdentifier(physical.tableName)}`;
    const heap = async () =>
      (
        await sql<{
          file: string;
        }>`SELECT pg_relation_filenode(to_regclass(${tableSql}))::text AS file`.execute(db)
      ).rows[0]?.file;
    const originalHeap = await heap();
    const freshTable = await loadTable(table.id().toString());
    const analysis = await new PostgresTableSearchVectorAdvisor(data).analyze(context, {
      table: freshTable,
      provider: 'pg_trgm',
      maxRecommendations: 1,
    });
    expect(analysis.inventory.state).toBe('ready');
    expect(analysis.recommendations[0]).toMatchObject({
      generatedColumnName: config.generated_column_name,
      indexName: config.index_name,
      nextAction: 'no_index_change',
    });
    const maintained = expectOk(await observedReconciler.maintainAfterSchemaChange(context, table));
    expect(maintained).toMatchObject({
      action: 'verified',
      generatedColumnName: config.generated_column_name,
      indexName: config.index_name,
      status: 'ready',
    });
    expect(await heap()).toBe(originalHeap);
    expect(statements.filter((statement) => statement.includes('ADD COLUMN'))).toHaveLength(1);
    expect(
      statements.filter((statement) => statement.includes('CREATE INDEX CONCURRENTLY'))
    ).toHaveLength(1);
    expectOk(
      await observedReconciler.reconcile(context, {
        table,
        mode: 'drop',
        expectedDefinitionKey: config.candidate_key,
      })
    );
    expect((await expectReadyConfig(table)).generated_column_name).toBe(
      config.generated_column_name
    );
    expect((await searchUsingRuntime(table, 'lifecycleunique')).total).toBe(1);
  }, 120_000);

  it('stops waiting for the data lock when its pinned metadata session is lost', async () => {
    const { table, task, meta } = await interruptGeneration(1);
    const tableId = table.id().toString();
    const locked = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const holder = db.connection().execute(async (data) => {
      const acquired = await sql<{ acquired: boolean }>`SELECT pg_try_advisory_lock(
        hashtext('teable.table_query_ops.search_vector.data'), hashtext(${tableId})) AS acquired`.execute(
        data
      );
      expect(acquired.rows[0]?.acquired).toBe(true);
      locked.resolve();
      try {
        await release.promise;
      } finally {
        await sql`SELECT pg_advisory_unlock(hashtext('teable.table_query_ops.search_vector.data'), hashtext(${tableId}))`.execute(
          data
        );
      }
    });
    await locked.promise;
    let waiting = false;
    let settled = false;
    const waits = new Set<unknown>();
    const data = db.withPlugin({
      transformQuery(args) {
        const compiled = new PostgresQueryCompiler().compileQuery(args.node, args.queryId);
        if (
          compiled.sql.includes('pg_try_advisory_lock') &&
          compiled.parameters.includes('teable.table_query_ops.search_vector.data')
        )
          waits.add(args.queryId);
        return args.node;
      },
      async transformResult(args) {
        if (waits.has(args.queryId) && args.result.rows.some((row) => row.acquired === false))
          waiting = true;
        return args.result;
      },
    });
    const failed = expectOk(await taskRepository.findById(context, task.snapshot().id));
    const running = expectOk(
      await taskRepository.save(context, expectOk(failed.start('waiting-worker', new Date())))
    );
    const metadata = meta as unknown as Kysely<UnknownPostgresDatabase>;
    const executor = new PostgresTableQueryRemediationExecutor(
      metadata,
      data,
      tableRepository,
      new PostgresTableSearchVectorReconciler(metadata, data)
    );
    const execution = executor
      .execute(context, { task: running, allowManualIndexExecution: false })
      .then((result) => {
        settled = true;
        return result;
      });
    try {
      await expect.poll(() => waiting).toBe(true);
      const owner = await sql<{ pid: number }>`SELECT pid FROM pg_locks
        WHERE locktype = 'advisory' AND granted AND objsubid = 2
          AND classid = hashtext('teable.table_query_ops.search_vector')::oid
          AND objid = hashtext(${tableId})::oid`.execute(meta);
      expect(owner.rows).toHaveLength(1);
      await sql`SELECT pg_terminate_backend(${owner.rows[0].pid})`.execute(meta);
      await expect.poll(() => settled).toBe(true);
      expect((await execution).isErr()).toBe(true);
      const locks = await sql<{ held: boolean }>`SELECT EXISTS (SELECT 1 FROM pg_locks
        WHERE locktype = 'advisory' AND granted AND objsubid = 2
          AND classid = hashtext('teable.table_query_ops.search_vector.data')::oid
          AND objid = hashtext(${tableId})::oid) AS held`.execute(meta);
      expect(locks.rows[0]?.held).toBe(true);
    } finally {
      release.resolve();
      await holder;
      await execution;
    }
  }, 120_000);

  it.each(['metadata', 'data'] as const)(
    'fences physical work when the pinned %s session dies',
    async (failedSession) => {
      const { table } = await createTable();
      const title = fieldByName(table, 'Title');
      const score = fieldByName(table, 'Score');
      await createSemanticRecords(table, title.id().toString(), score.id().toString());
      const meta = testContainer.metaDb as unknown as Kysely<TableQueryOpsDatabase>;
      const analysis = await new PostgresTableSearchVectorAdvisor(db).analyze(context, {
        table,
        provider: 'pg_trgm',
        maxRecommendations: 1,
      });
      expect(analysis.recommendations).toHaveLength(1);
      const task = expectOk(
        TableQueryRemediationTask.createQueued({
          tableId: table.id().toString(),
          baseId: table.baseId().toString(),
          kind: 'create_search_access_path',
          now: new Date(),
          payload: {
            trigger: 'admin_search_access_path',
            executionMode: 'manual',
            mode: 'create',
            provider: 'pg_trgm',
            expectedDefinitionKey: analysis.recommendations[0].candidateKey,
            validationMode: 'real_ddl',
            allowLargeTableRewrite: true,
          },
        })
      );
      recoveryTaskIds.push(task.snapshot().id);
      expectOk(await taskRepository.save(context, task));
      expectOk(await taskRepository.save(context, expectOk(task.start('departed', new Date()))));
      await meta
        .updateTable('table_query_remediation_task')
        .set({ locked_at: new Date(Date.now() - 120_000) })
        .where('id', '=', task.snapshot().id)
        .execute();
      const oldOwner = expectOk(await taskRepository.findById(context, task.snapshot().id));
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const checkpoints = new Set<unknown>();
      const releaseSnapshot = Promise.withResolvers<void>();
      let snapshot: Promise<void> | undefined;
      let dataLockAttempts = 0;
      const dataLockQueries = new Set<unknown>();
      let rewrites = 0;
      let held = false;
      const observedMeta = meta.withPlugin({
        transformQuery(args) {
          const compiled = new PostgresQueryCompiler().compileQuery(args.node, args.queryId);
          if (
            compiled.parameters.some(
              (value) => typeof value === 'string' && value.includes('"phase":"column_ready"')
            )
          )
            checkpoints.add(args.queryId);
          return args.node;
        },
        async transformResult(args) {
          if (!held && checkpoints.has(args.queryId)) {
            held = true;
            entered.resolve();
            await release.promise;
          }
          return args.result;
        },
      });
      const data = db.withPlugin({
        transformQuery(args) {
          const compiled = new PostgresQueryCompiler().compileQuery(args.node, args.queryId);
          if (compiled.sql.includes('ADD COLUMN')) rewrites += 1;
          if (
            compiled.sql.includes('pg_try_advisory_lock') &&
            compiled.parameters.includes('teable.table_query_ops.search_vector.data')
          )
            dataLockQueries.add(args.queryId);
          return args.node;
        },
        async transformResult(args) {
          if (
            dataLockQueries.has(args.queryId) &&
            args.result.rows.some((row) => row.acquired === false)
          )
            dataLockAttempts += 1;
          return args.result;
        },
      });
      const executor = new PostgresTableQueryRemediationExecutor(
        observedMeta as unknown as Kysely<UnknownPostgresDatabase>,
        data,
        tableRepository,
        new PostgresTableSearchVectorReconciler(
          observedMeta as unknown as Kysely<UnknownPostgresDatabase>,
          data
        )
      );
      const departed = executor.execute(context, {
        task: oldOwner,
        allowManualIndexExecution: false,
      });
      let replacement: Promise<Result<unknown, DomainError>> | undefined;
      try {
        await Promise.race([
          entered.promise,
          departed.then((result) => {
            expectOk(result);
            throw new Error('Executor did not reach the physical rewrite');
          }),
        ]);
        if (failedSession === 'metadata') {
          const snapshotEntered = Promise.withResolvers<void>();
          const physical = expectOk(getTablePhysicalName(table));
          const tableSql = `${quoteIdentifier(physical.schema)}.${quoteIdentifier(physical.tableName)}`;
          snapshot = db.connection().execute(async (reader) => {
            await sql`BEGIN ISOLATION LEVEL REPEATABLE READ`.execute(reader);
            try {
              await sql.raw(`SELECT count(*) FROM ${tableSql}`).execute(reader);
              snapshotEntered.resolve();
              await releaseSnapshot.promise;
            } finally {
              await sql`ROLLBACK`.execute(reader);
            }
          });
          await snapshotEntered.promise;
          release.resolve();
          await expect
            .poll(async () => {
              const building = await sql<{ building: boolean }>`SELECT EXISTS (
            SELECT 1 FROM pg_stat_activity activity JOIN pg_locks lock ON lock.pid = activity.pid
            WHERE activity.query ILIKE 'CREATE INDEX CONCURRENTLY%'
              AND activity.query LIKE ${`%${physical.tableName}%`}
              AND lock.locktype = 'virtualxid' AND NOT lock.granted) AS building`.execute(db);
              return building.rows[0]?.building;
            })
            .toBe(true);
        }
        const lockNamespace =
          failedSession === 'metadata'
            ? 'teable.table_query_ops.search_vector'
            : 'teable.table_query_ops.search_vector.data';
        const owner = await sql<{ pid: number }>`SELECT pid FROM pg_locks
        WHERE locktype = 'advisory' AND granted AND objsubid = 2
          AND classid = hashtext(${lockNamespace})::oid
          AND objid = hashtext(${table.id().toString()})::oid`.execute(meta);
        expect(owner.rows).toHaveLength(1);
        await sql`SELECT pg_terminate_backend(${owner.rows[0].pid})`.execute(meta);
        await expect
          .poll(async () => {
            const live = await sql<{ held: boolean }>`SELECT EXISTS (SELECT 1 FROM pg_locks
          WHERE pid = ${owner.rows[0].pid} AND locktype = 'advisory') AS held`.execute(meta);
            return live.rows[0]?.held;
          })
          .toBe(false);
        if (failedSession === 'data') {
          expect(
            expectOk(
              await taskRepository.claimNextAccepted(context, {
                scope: 'manual_search',
                workerId: 'replacement',
                now: new Date(),
                allowedKinds: [],
                allowManualIndexExecution: false,
                allowPolicyIndexExecution: false,
              })
            )
          ).toBeUndefined();
          release.resolve();
          expect((await departed).isErr()).toBe(true);
        }
        const claimed = expectOk(
          await taskRepository.claimNextAccepted(context, {
            scope: 'manual_search',
            workerId: 'replacement',
            now: new Date(),
            allowedKinds: [],
            allowManualIndexExecution: false,
            allowPolicyIndexExecution: false,
          })
        );
        expect(claimed?.snapshot().id).toBe(task.snapshot().id);
        if (!claimed) throw new Error('Interrupted search task was not claimed');
        const running = expectOk(
          await taskRepository.save(context, expectOk(claimed.start('replacement', new Date())))
        );
        replacement = executor.execute(context, {
          task: running,
          allowManualIndexExecution: false,
        });
        if (failedSession === 'metadata') {
          await expect.poll(() => dataLockAttempts).toBeGreaterThan(0);
          const stillBuilding = await sql<{ building: boolean }>`SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity WHERE query ILIKE 'CREATE INDEX CONCURRENTLY%'
            AND state = 'active') AS building`.execute(db);
          expect(stillBuilding.rows[0]?.building).toBe(true);
          releaseSnapshot.resolve();
          await snapshot;
        }
        expect(rewrites).toBe(1);
        release.resolve();
        expect((await departed).isErr()).toBe(true);
        const receipt = expectOk(await replacement);
        expect(rewrites).toBe(1);
        const staleCompletion = await taskRepository.save(
          context,
          expectOk(oldOwner.succeed({ stale: true }, new Date()))
        );
        expect(staleCompletion.isErr() ? staleCompletion.error : undefined).toMatchObject({
          code: 'table_query_ops.task_ownership_conflict',
        });
        expectOk(
          await taskRepository.save(context, expectOk(running.succeed(receipt, new Date())))
        );
        expect((await searchUsingRuntime(table, 'lifecycleunique')).total).toBe(1);
      } finally {
        release.resolve();
        releaseSnapshot.resolve();
        await snapshot;
        await departed;
        await replacement;
      }
    },
    120_000
  );

  const createTable = async (): Promise<CreateTableResult> => {
    const result = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      CreateTableCommand.create({
        baseId: testContainer.baseId.toString(),
        name: 'Search Vector Lifecycle',
        fields: [
          { type: 'singleLineText', name: 'Title', isPrimary: true },
          { type: 'singleLineText', name: 'Score' },
        ],
        views: [{ type: 'grid' }],
      })._unsafeUnwrap()
    );
    return expectOk(result);
  };

  const createSemanticRecords = async (
    table: Table,
    titleFieldId: string,
    scoreFieldId: string
  ) => {
    const result = await commandBus.execute<CreateRecordsCommand, CreateRecordsResult>(
      context,
      CreateRecordsCommand.create({
        tableId: table.id().toString(),
        records: [
          { fields: { [titleFieldId]: 'lifecycleunique order', [scoreFieldId]: '42' } },
          { fields: { [titleFieldId]: 'ordinary order alpha', [scoreFieldId]: '7' } },
          { fields: { [titleFieldId]: 'ordinary order beta', [scoreFieldId]: '9' } },
        ],
      })._unsafeUnwrap()
    );
    expect(expectOk(result).records).toHaveLength(3);
  };

  const insertPlannerFiller = async (
    table: Table,
    titleField: ReturnType<typeof fieldByName>,
    scoreField: ReturnType<typeof fieldByName>,
    count: number
  ) => {
    const physical = getTablePhysicalName(table)._unsafeUnwrap();
    const tableSql = `${quoteIdentifier(physical.schema)}.${quoteIdentifier(physical.tableName)}`;
    const titleDbName = titleField.dbFieldName()._unsafeUnwrap().value()._unsafeUnwrap();
    const scoreDbName = scoreField.dbFieldName()._unsafeUnwrap().value()._unsafeUnwrap();
    await sql
      .raw(
        `INSERT INTO ${tableSql} ("__id", "__created_by", "__version", ${quoteIdentifier(
          titleDbName
        )}, ${quoteIdentifier(
          scoreDbName
        )}) SELECT 'rec_tqops_fill_' || g::text, 'system', 1, 'ordinary order ' || g::text, (g % 100)::text FROM generate_series(1, ${count}) AS g`
      )
      .execute(db);
    await sql.raw(`ANALYZE ${tableSql}`).execute(db);
  };

  const expectReadyConfig = async (
    table: Table,
    provider: SearchVectorConfig['provider'] = 'pg_trgm'
  ): Promise<SearchVectorConfig> => {
    const configs = await sql<SearchVectorConfig>`
      SELECT candidate_key, generated_column_name, index_name, field_ids, field_db_names,
             search_scope, status, semantics, access_path, provider, operator_class
      FROM table_query_search_vector_config
      WHERE table_id = ${table.id().toString()}
      ORDER BY last_modified_time DESC NULLS LAST, created_time DESC
    `.execute(testContainer.metaDb as unknown as Kysely<TableQueryOpsDatabase>);
    const ready = configs.rows.filter((row) => row.status === 'ready');
    expect(ready).toHaveLength(1);
    const config = ready[0] as SearchVectorConfig;
    expect(config).toMatchObject({
      semantics: 'substring',
      access_path: 'generated_text',
      provider,
      operator_class: provider === 'pg_bigm' ? 'gin_bigm_ops' : 'gin_trgm_ops',
    });

    const physical = getTablePhysicalName(table)._unsafeUnwrap();
    const state = await sql<SearchVectorPhysicalState>`
      SELECT
        pg_get_expr(ad.adbin, ad.adrelid) AS expression,
        a.attgenerated AS generated,
        i.indisvalid AS index_valid
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
      JOIN pg_index i ON i.indrelid = c.oid
      JOIN pg_class idx ON idx.oid = i.indexrelid AND idx.relname = ${config.index_name}
      WHERE n.nspname = ${physical.schema}
        AND c.relname = ${physical.tableName}
        AND a.attname = ${config.generated_column_name}
    `.execute(db);
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]).toMatchObject({ generated: 's', index_valid: true });
    for (const fieldDbName of asStringArray(config.field_db_names)) {
      expect(state.rows[0]?.expression).toContain(fieldDbName);
    }
    return config;
  };

  const expectPendingConfig = async (table: Table): Promise<void> => {
    const configs = await sql<Pick<SearchVectorConfig, 'status'>>`
      SELECT status
      FROM table_query_search_vector_config
      WHERE table_id = ${table.id().toString()}
      ORDER BY last_modified_time DESC NULLS LAST, created_time DESC
      LIMIT 1
    `.execute(testContainer.metaDb as unknown as Kysely<TableQueryOpsDatabase>);
    expect(configs.rows[0]?.status).toBe('rebuild_pending');

    const tasks = await sql<{ count: string }>`
      SELECT count(*)::text AS count
      FROM table_query_remediation_task
      WHERE table_id = ${table.id().toString()}
        AND kind = 'rebuild_search_access_path'
        AND status = 'queued'
    `.execute(testContainer.metaDb as unknown as Kysely<TableQueryOpsDatabase>);
    expect(Number(tasks.rows[0]?.count)).toBe(1);
  };

  const runPendingMaintenance = async (): Promise<void> => {
    const claimed = await taskRepository.claimNextAccepted(context, {
      scope: 'all',
      workerId: 'search-vector-lifecycle-e2e-worker',
      now: new Date(),
      allowedKinds: ['rebuild_search_access_path'],
      allowManualIndexExecution: false,
      allowPolicyIndexExecution: false,
    });
    const task = claimed._unsafeUnwrap();
    expect(task).toBeDefined();
    const result = await commandBus.execute<
      RunTableQueryRemediationTaskCommand,
      TableQueryRemediationTask
    >(
      context,
      new RunTableQueryRemediationTaskCommand(
        task!.snapshot().id,
        false,
        'search-vector-lifecycle-e2e-worker'
      )
    );
    expect(result._unsafeUnwrap().snapshot().status).toBe('succeeded');
  };

  const searchTotal = async (table: Table, config: SearchVectorConfig, value: string) => {
    const fieldIds = asStringArray(config.field_ids);
    const coveredFieldIds = fieldIds.map((id) => FieldId.create(id)._unsafeUnwrap());
    const result = await recordQueryRepository.find(context, table, undefined, {
      search: { search: RecordSearch.fromTuple([value, fieldIds.join(','), true]) },
      searchAccessPath: {
        kind: 'generated_text',
        generatedColumnName: config.generated_column_name,
        provider: config.provider,
        searchScope: 'selected_fields',
        coveredFieldIds,
      },
    });
    const value_ = result._unsafeUnwrap();
    // Guard against silent fallback: every lifecycle assertion below would
    // also pass on plain ILIKE, so require the indexed path to actually run.
    expect(value_.searchAccessPath).toMatchObject({ used: 'generated_text' });
    return value_.total;
  };

  const searchTotalWithDefaultPath = async (table: Table, value: string) => {
    const result = await recordQueryRepository.find(context, table, undefined, {
      search: { search: RecordSearch.fromTuple([value, '', true]) },
    });
    return result._unsafeUnwrap().total;
  };

  const searchTotalAcrossAllFields = async (
    table: Table,
    config: SearchVectorConfig,
    value: string
  ) => {
    const coveredFieldIds = asStringArray(config.field_ids).map((id) =>
      FieldId.create(id)._unsafeUnwrap()
    );
    const result = await recordQueryRepository.find(context, table, undefined, {
      search: { search: RecordSearch.fromTuple([value, '', true]) },
      searchAccessPath: {
        kind: 'generated_text',
        generatedColumnName: config.generated_column_name,
        provider: config.provider,
        searchScope: 'all_fields',
        coveredFieldIds,
      },
    });
    const value_ = result._unsafeUnwrap();
    expect(value_.searchAccessPath).toMatchObject({ used: 'generated_text' });
    return value_.total;
  };

  const searchUsingRuntime = async (table: Table, value: string) => {
    table = await loadTable(table.id().toString());
    const path = resolveTableSearchAccessPath(table);
    const result = await recordQueryRepository.find(context, table, undefined, {
      search: { search: RecordSearch.fromTuple([value, '', true]) },
      searchAccessPath: path,
    });
    return expectOk(result);
  };

  const loadTable = async (tableId: string) => {
    const id = TableByIdSpec.create(expectOk(TableId.create(tableId)));
    return expectOk(await tableRepository.findOne(context, id));
  };
});

const fieldByName = (table: Table, name: string) =>
  table.getField((field) => field.name().toString() === name)._unsafeUnwrap();

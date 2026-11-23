/* eslint-disable @typescript-eslint/naming-convention */
import { connect, createServer, type Socket } from 'node:net';
import { createV2PostgresDb } from '@teable/v2-adapter-db-postgres-pg';
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
  defaultTableQueryDecisionPolicyConfig,
  reclaimDropTaskId,
  registerV2TableOps,
  resolveTableSearchAccessPath,
  RunTableQueryRemediationTaskCommand,
  RunTableQueryRemediationTaskHandler,
  startTableQueryOpsTaskWorkerIfEnabled,
  TableQueryRemediationTask,
  TableQueryOpsExecutionUnavailableError,
  v2TableOpsTokens,
  type TableQueryRemediationTaskRepository,
  type TableQueryOpsRunnerHandle,
  type TableSearchVectorReconciler,
  type TableSearchVectorStatusReader,
} from '@teable/v2-table-query-ops';
import { PostgresQueryCompiler, sql, type Kysely } from 'kysely';
import type { Result } from 'neverthrow';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { PostgresTableQueryRemediationExecutor } from './executor';
import { getTablePhysicalName, quoteIdentifier } from './helpers';
import { PostgresTableQueryRemediationTaskRepository } from './repositories';
import { registerV2TableOpsPostgresAdapter } from './register';
import type { TableQueryOpsDatabase } from './schema';
import {
  PostgresTableSearchVectorAdvisor,
  PostgresTableSearchVectorExecutor,
  PostgresTableSearchVectorReconciler,
  type SearchGenerationExecutionState,
} from './searchVector';
import {
  PostgresTableSearchVectorSchemaMaintenanceScheduler,
  type SearchMaintenanceOptions,
} from './searchVectorMaintenance';
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
  const maintenanceTableIds: string[] = [];

  it('discards a timed-out maintenance session and eventually releases its data lock', async () => {
    const maintenance = await createV2PostgresDb<UnknownPostgresDatabase>(
      { pg: { connectionString: testContainer.connectionString, pool: { max: 1 } } },
      { maintenanceStatementDeadlineMs: 500 }
    );
    const tableId = `transport_${process.pid}_${Date.now()}`;
    let backendPid = 0;
    try {
      await expect(
        maintenance.connection().execute(async (session) => {
          backendPid = (
            await sql<{ pid: number }>`SELECT pg_backend_pid() AS pid`.execute(session)
          ).rows[0].pid;
          await sql`SELECT pg_advisory_lock(hashtext('teable.table_query_ops.search_vector.data'), hashtext(${tableId}))`.execute(
            session
          );
          await sql`SELECT pg_sleep(3)`.execute(session);
        })
      ).rejects.toMatchObject({ code: 'TABLE_QUERY_OPS_STATEMENT_TIMEOUT' });

      const replacement = (
        await sql<{ pid: number }>`SELECT pg_backend_pid() AS pid`.execute(maintenance)
      ).rows[0].pid;
      expect(replacement).not.toBe(backendPid);
      expect((await sql<{ healthy: number }>`SELECT 1 AS healthy`.execute(db)).rows[0].healthy).toBe(
        1
      );
      await vi.waitFor(
        async () => {
          const probe = await sql<{ available: boolean }>`SELECT pg_try_advisory_xact_lock(
            hashtext('teable.table_query_ops.search_vector.data'), hashtext(${tableId})) AS available`.execute(db);
          expect(probe.rows[0].available).toBe(true);
        },
        { timeout: 5000 }
      );
    } finally {
      await maintenance.destroy();
    }
  }, 15_000);

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
    if (!journal.generatedColumnName)
      throw new Error('Document interruption fixture requires a document generation');
    return {
      table,
      task,
      journal: { ...journal, generatedColumnName: journal.generatedColumnName },
      meta,
    };
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
        AND attname = ${journal.generatedColumnName ?? null} AND NOT attisdropped) AS column_present,
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
    if (!candidate.generatedColumnName)
      throw new Error('Legacy fixture requires a document-only canonical generation');
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
    const meta = testContainer.metaDb as unknown as Kysely<TableQueryOpsDatabase>;
    const tableIds = maintenanceTableIds.splice(0);
    const taskIds = recoveryTaskIds.splice(0);
    if (tableIds.length)
      await meta
        .deleteFrom('table_query_remediation_task')
        .where('table_id', 'in', tableIds)
        .execute();
    if (taskIds.length)
      await meta.deleteFrom('table_query_remediation_task').where('id', 'in', taskIds).execute();
  });

  afterAll(async () => {
    await testContainer?.dispose();
  });

  it.each(['fresh', 'recovered', 'true_error'] as const)(
    'defers a %s retirement without queueing ahead of foreground reads or writes and later reclaims it',
    async (mode) => {
      let { table } = await createTable();
      const tableId = table.id().toString();
      maintenanceTableIds.push(tableId);
      const score = fieldByName(table, 'Score');
      await createSemanticRecords(
        table,
        fieldByName(table, 'Title').id().toString(),
        score.id().toString()
      );
      const physical = expectOk(getTablePhysicalName(table));
      const relation = `${quoteIdentifier(physical.schema)}.${quoteIdentifier(physical.tableName)}`;
      const scoreColumn = quoteIdentifier(expectOk(expectOk(score.dbFieldName()).value()));
      const titleColumn = quoteIdentifier(
        expectOk(expectOk(fieldByName(table, 'Title').dbFieldName()).value())
      );
      // Reuse the hybrid-generation seam so both independently reclaimed artifacts must wait.
      await sql.raw(`ALTER TABLE ${relation} ADD COLUMN residual_seed text`).execute(db);
      await sql
        .raw(`UPDATE ${relation} SET residual_seed = 'recoverable-' || ${scoreColumn}`)
        .execute(db);
      await sql
        .raw(`ALTER TABLE ${relation} DROP COLUMN ${scoreColumn},
        ADD COLUMN ${scoreColumn} text GENERATED ALWAYS AS (residual_seed) STORED`)
        .execute(db);
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
      const retiredSnapshot = (await loadTable(tableId)).searchIndex()!;
      expect(retiredSnapshot.document?.ready).toBe(true);
      expect(retiredSnapshot.residual?.ready).toBe(true);
      table = expectOk(
        await commandBus.execute<CreateFieldCommand, CreateFieldResult>(
          context,
          CreateFieldCommand.create({
            baseId: table.baseId().toString(),
            tableId,
            field: { type: 'singleLineText', name: 'Retirement addition' },
          })._unsafeUnwrap()
        )
      ).table;
      const meta = testContainer.metaDb as unknown as Kysely<UnknownPostgresDatabase>;
      const now = new Date();
      const hhmm = (minute: number) =>
        `${Math.floor(minute / 60)
          .toString()
          .padStart(2, '0')}:${(minute % 60).toString().padStart(2, '0')}`;
      const minute = now.getUTCHours() * 60 + now.getUTCMinutes();
      const options = {
        windowUtc: `${hhmm((minute + 1410) % 1440)}-${hhmm((minute + 30) % 1440)}`,
        allowUnknownOrLargeRewrite: true,
      };
      const run = async (id: string, executionDb = db) =>
        expectOk(
          await new RunTableQueryRemediationTaskHandler(
            taskRepository,
            new PostgresTableQueryRemediationExecutor(
              meta,
              executionDb,
              tableRepository,
              new PostgresTableSearchVectorReconciler(meta, executionDb, options)
            ),
            testContainer.container.resolve(v2TableOpsTokens.decisionPolicy),
            testContainer.container.resolve(v2TableOpsTokens.decisionLogRepository),
            { now: () => new Date() }
          ).handle(
            context,
            new RunTableQueryRemediationTaskCommand(id, false, 'retirement-lock-worker')
          )
        );
      const pending = (
        await sql<{ id: string }>`SELECT id FROM table_query_remediation_task
        WHERE table_id = ${tableId} AND status = 'queued' AND payload->>'trigger' = 'schema_change'`.execute(
          meta
        )
      ).rows;
      expect(pending).toHaveLength(1);
      expect((await run(pending[0].id)).snapshot().status).toBe('succeeded');
      const serving = (await loadTable(tableId)).searchIndex()!;
      expect(serving.document!.indexName).not.toBe(retiredSnapshot.document!.indexName);
      expect(serving.residual!.indexName).not.toBe(retiredSnapshot.residual!.indexName);
      // Retirement still runs outside the build window, but must never queue its table lock.
      options.windowUtc = `${hhmm((minute + 60) % 1440)}-${hhmm((minute + 120) % 1440)}`;
      const beforeSearch = await searchUsingRuntime(table, 'lifecycleunique');
      expect(beforeSearch.total).toBe(1);
      expect(beforeSearch.searchAccessPath).toMatchObject({
        used: 'generated_text',
        indexedBranches: ['document', 'residual'],
      });
      const claim = () =>
        taskRepository.claimNextAccepted(context, {
          scope: 'search_maintenance',
          workerId: 'retirement-lock-worker',
          now: new Date(),
          allowedKinds: ['drop_search_access_path'],
          allowManualIndexExecution: false,
          allowPolicyIndexExecution: false,
        });
      // The grace gate is still authoritative even when contention can defer a task.
      expect(expectOk(await claim())).toBeUndefined();
      await sql`UPDATE table_query_search_vector_config SET reclaim_drop_after = now() - interval '1 second'
        WHERE table_id = ${tableId} AND status = 'disabled'`.execute(meta);
      const taskId = (
        await sql<{ id: string }>`SELECT id FROM table_query_remediation_task
        WHERE table_id = ${tableId} AND payload->>'trigger' = 'reclaim'`.execute(meta)
      ).rows[0].id;
      let departed: TableQueryRemediationTask | undefined;
      if (mode === 'recovered') {
        await sql`UPDATE table_query_remediation_task SET status = 'running', attempts = 3,
          locked_by = 'departed', locked_at = now() - interval '2 minutes' WHERE id = ${taskId}`.execute(
          meta
        );
        departed = expectOk(await taskRepository.findById(context, taskId));
      }
      const retirementMetadata = async () =>
        (
          await sql<{ config: unknown }>`SELECT to_jsonb(config) AS config
        FROM table_query_search_vector_config config WHERE table_id = ${tableId} AND status = 'disabled'`.execute(
            meta
          )
        ).rows;
      const physicalArtifacts = async () =>
        (
          await sql<{ columns: string[]; indexes: string[] }>`SELECT
        (SELECT array_agg(attname::text ORDER BY attname) FROM pg_attribute
          WHERE attrelid = to_regclass(${relation}) AND NOT attisdropped AND attnum > 0) AS columns,
        (SELECT array_agg(indexrelid::text ORDER BY indexrelid) FROM pg_index
          WHERE indrelid = to_regclass(${relation})) AS indexes`.execute(db)
        ).rows;
      const retainedMetadata = await retirementMetadata();
      const retainedArtifacts = await physicalArtifacts();
      let lockStatements = 0;
      const denied = db.withPlugin({
        transformQuery(args) {
          const compiled = new PostgresQueryCompiler().compileQuery(args.node, args.queryId);
          if (compiled.sql.startsWith('LOCK TABLE ') && ++lockStatements % 2 === 1)
            throw Object.assign(new Error('retirement document lock permission denied'), {
              code: '42501',
            });
          return args.node;
        },
        async transformResult(args) {
          return args.result;
        },
      });
      await db.transaction().execute(async (reader) => {
        await sql.raw(`LOCK TABLE ${relation} IN ACCESS SHARE MODE`).execute(reader);
        for (let round = 0; round < (mode === 'true_error' ? 3 : 4); round += 1) {
          expect(expectOk(await claim())?.snapshot().id).toBe(taskId);
          let settled = false;
          const retirement = run(taskId, mode === 'true_error' ? denied : db).finally(() => {
            settled = true;
          });
          const foreground = (async () => {
            const read = await sql<{ count: number }>`SELECT count(*)::int AS count
              FROM ${sql.raw(relation)}`.execute(db);
            const write = await sql<{ touched: number }>`UPDATE ${sql.raw(relation)}
              SET ${sql.raw(titleColumn)} = ${sql.raw(titleColumn)} RETURNING 1 AS touched`.execute(
              db
            );
            expect(read.rows[0].count).toBeGreaterThan(0);
            expect(write.rows.length).toBe(read.rows[0].count);
          })();
          const observeQueue = async () => {
            // Hold the conflicting reader until reclamation and both foreground
            // operations settle. Observe the lock queue while reclamation is in flight.
            do {
              const locks = await sql<{ queued: boolean }>`SELECT EXISTS (
                SELECT 1 FROM pg_locks WHERE relation = to_regclass(${relation})
                  AND mode = 'AccessExclusiveLock' AND NOT granted) AS queued`.execute(db);
              if (locks.rows[0].queued) return true;
            } while (!settled);
            return false;
          };
          const [, , queued] = await Promise.all([retirement, foreground, observeQueue()]);
          expect(queued).toBe(false);
          const persisted = expectOk(await taskRepository.findById(context, taskId));
          expect(persisted.snapshot()).toMatchObject({
            status: mode === 'true_error' ? 'failed' : 'queued',
            attempts: mode === 'true_error' ? round + 1 : mode === 'recovered' ? 3 : 0,
            maxAttempts: 3,
            resumeAttempt: mode === 'recovered',
            lastError:
              mode === 'true_error'
                ? 'retirement document lock permission denied'
                : 'Search retirement is waiting for the table lock',
          });
          expect(persisted.snapshot().lockedAt).toBeUndefined();
          expect(persisted.snapshot().lockedBy).toBeUndefined();
          expect(await retirementMetadata()).toEqual(retainedMetadata);
          expect(await physicalArtifacts()).toEqual(retainedArtifacts);
          expect((await loadTable(tableId)).searchIndex()).toEqual(serving);
          const duringSearch = await searchUsingRuntime(table, 'lifecycleunique');
          expect(duringSearch.total).toBe(beforeSearch.total);
          expect(duringSearch.searchAccessPath).toEqual(beforeSearch.searchAccessPath);
          const locks = await sql<{ count: number }>`SELECT count(*)::int AS count FROM pg_locks
            WHERE relation = to_regclass(${relation}) AND mode = 'AccessExclusiveLock'`.execute(db);
          expect(locks.rows[0].count).toBe(0);
          await meta.transaction().execute(async (owner) => {
            const advisory = await sql<{ available: boolean }>`SELECT pg_try_advisory_xact_lock(
              hashtext('teable.table_query_ops.search_vector'), hashtext(${tableId})) AS available`.execute(
              owner
            );
            expect(advisory.rows[0].available).toBe(true);
          });
        }
      });
      if (mode === 'true_error') {
        // A later residual 55P03 must never hide the earlier real document failure.
        expect(lockStatements).toBe(6);
        expect(expectOk(await claim())).toBeUndefined();
        const exhausted = expectOk(await taskRepository.findById(context, taskId));
        expect(exhausted.start('retirement-lock-worker', new Date()).isErr()).toBe(true);
        return;
      }
      expect(expectOk(await claim())?.snapshot().id).toBe(taskId);
      const completed = (await run(taskId)).snapshot();
      expect(completed).toMatchObject({
        status: 'succeeded',
        attempts: mode === 'recovered' ? 3 : 1,
        maxAttempts: 3,
      });
      expect(completed.lastError).toBeUndefined();
      if (departed)
        expect(
          (
            await taskRepository.save(
              context,
              expectOk(departed.succeed({ stale: true }, new Date()))
            )
          ).isErr()
        ).toBe(true);
      const cleaned = (
        await sql<{
          serving_snapshot: unknown;
          reclaim_drop_after: Date | null;
          reclaim_drop_queued_at: Date | null;
        }>`SELECT serving_snapshot, reclaim_drop_after, reclaim_drop_queued_at
        FROM table_query_search_vector_config
        WHERE table_id = ${tableId} AND status = 'disabled'`.execute(meta)
      ).rows;
      expect(cleaned).toEqual([
        { serving_snapshot: null, reclaim_drop_after: null, reclaim_drop_queued_at: null },
      ]);
      const artifacts = await sql<{
        column_present: boolean;
        document_present: boolean;
        residual_present: boolean;
      }>`SELECT
        EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass(${relation})
          AND attname = ${retiredSnapshot.document!.generatedColumnName} AND NOT attisdropped) AS column_present,
        to_regclass(${`${quoteIdentifier(physical.schema)}.${quoteIdentifier(retiredSnapshot.document!.indexName)}`}) IS NOT NULL AS document_present,
        to_regclass(${`${quoteIdentifier(physical.schema)}.${quoteIdentifier(retiredSnapshot.residual!.indexName)}`}) IS NOT NULL AS residual_present`.execute(
        db
      );
      expect(artifacts.rows[0]).toEqual({
        column_present: false,
        document_present: false,
        residual_present: false,
      });
      expect((await loadTable(tableId)).searchIndex()).toEqual(serving);
      const afterSearch = await searchUsingRuntime(table, 'lifecycleunique');
      expect(afterSearch.total).toBe(beforeSearch.total);
      expect(afterSearch.searchAccessPath).toEqual(beforeSearch.searchAccessPath);
    },
    120_000
  );

  it('keeps a warm split-data retirement retryable beyond maxAttempts while its database rejects connections', async () => {
    const meta = testContainer.metaDb as unknown as Kysely<UnknownPostgresDatabase>;
    const databaseName = `search_retirement_${process.pid}_${Date.now()}`;
    let isolated: Kysely<UnknownPostgresDatabase> | undefined;
    let executionDb: Kysely<UnknownPostgresDatabase> | undefined;
    await sql.raw(`CREATE DATABASE ${quoteIdentifier(databaseName)}`).execute(meta);
    try {
      const url = new URL(testContainer.connectionString);
      url.pathname = `/${databaseName}`;
      isolated = await createV2PostgresDb({ pg: { connectionString: url.toString() } });
      await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`.execute(isolated);
      const fixture = await prepareWarmRetirement(isolated);
      // This observer connection survives ALLOW_CONNECTIONS=false, so assertions
      // can inspect the owned database without opening a new data connection.
      await isolated.connection().execute(async (observer) => {
        executionDb = await createV2PostgresDb({
          pg: {
            connectionString: url.toString(),
            pool: { max: 1, maxUses: 1, connectionTimeoutMillis: 2_000 },
          },
        });
        await sql`SELECT 1`.execute(executionDb);
        const unavailable = vi.fn(
          (error: unknown) =>
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            error.code === '55000' &&
            error instanceof Error &&
            error.message === `database "${databaseName}" is not currently accepting connections`
        );
        const worker = warmRetirementWorker(fixture.tableId, executionDb, unavailable);
        const retained = await fixture.retirementMetadata();
        expect(await fixture.artifacts(observer)).toEqual({
          column_present: true,
          index_present: true,
        });
        await sql
          .raw(`ALTER DATABASE ${quoteIdentifier(databaseName)} ALLOW_CONNECTIONS false`)
          .execute(meta);
        // A recovered final charged attempt is the most restrictive queue state.
        await sql`UPDATE table_query_remediation_task SET status = 'running', attempts = 3,
          locked_by = 'departed-warm-worker', locked_at = now() - interval '2 minutes'
          WHERE id = ${fixture.taskId}`.execute(meta);
        for (let round = 0; round < 4; round += 1) {
          await worker.runOnce();
          const deferred = expectOk(
            await taskRepository.findById(context, fixture.taskId)
          ).snapshot();
          expect(deferred).toMatchObject({
            id: fixture.taskId,
            status: 'queued',
            attempts: 3,
            maxAttempts: 3,
            resumeAttempt: true,
            lastError: `Search retirement connection unavailable: database "${databaseName}" is not currently accepting connections`,
          });
          expect(deferred.lockedAt).toBeUndefined();
          expect(deferred.lockedBy).toBeUndefined();
          expect(await fixture.retirementMetadata()).toEqual(retained);
          expect(await fixture.artifacts(observer)).toEqual({
            column_present: true,
            index_present: true,
          });
          expect(
            (await sql<{ healthy: number }>`SELECT 1 AS healthy`.execute(meta)).rows[0].healthy
          ).toBe(1);
          await meta.transaction().execute(async (owner) => {
            expect(
              (
                await sql<{ available: boolean }>`SELECT pg_try_advisory_xact_lock(
              hashtext('teable.table_query_ops.search_vector'), hashtext(${fixture.tableId})) AS available`.execute(
                  owner
                )
              ).rows[0].available
            ).toBe(true);
          });
        }
        expect(unavailable).toHaveBeenCalledTimes(4);
        await sql
          .raw(`ALTER DATABASE ${quoteIdentifier(databaseName)} ALLOW_CONNECTIONS true`)
          .execute(meta);
        await worker.runOnce();
        const completed = expectOk(
          await taskRepository.findById(context, fixture.taskId)
        ).snapshot();
        expect(completed).toMatchObject({
          id: fixture.taskId,
          status: 'succeeded',
          attempts: 3,
          maxAttempts: 3,
        });
        expect(completed.lastError).toBeUndefined();
        expect(await fixture.artifacts(observer)).toEqual({
          column_present: false,
          index_present: false,
        });
        expect(await fixture.retirementMetadata()).toMatchObject([
          { serving_snapshot: null, reclaim_drop_after: null, reclaim_drop_queued_at: null },
        ]);
        expect(worker.resolveExecution).toHaveBeenCalledTimes(5);
        expect(worker.execute).toHaveBeenCalledTimes(5);
        expect(
          (
            await sql<{ count: number }>`SELECT count(*)::int AS count
          FROM table_query_remediation_task WHERE table_id = ${fixture.tableId}
          AND payload->>'trigger' = 'reclaim'`.execute(meta)
          ).rows[0].count
        ).toBe(1);
      });
    } finally {
      // Only this fixture's database is changed; the metadata database and CI
      // roles retain their original connection policy even on an assertion failure.
      await sql
        .raw(`ALTER DATABASE ${quoteIdentifier(databaseName)} ALLOW_CONNECTIONS true`)
        .execute(meta);
      await executionDb?.destroy();
      await isolated?.destroy();
      await sql.raw(`DROP DATABASE ${quoteIdentifier(databaseName)}`).execute(meta);
    }
  }, 120_000);

  it.each([0, 3])(
    'preserves a warm retirement deferral when its shared session dies before the data lock at charged attempt %i',
    async (chargedAttempts) => {
      const fixture = await prepareWarmRetirement();
      const meta = testContainer.metaDb as unknown as Kysely<UnknownPostgresDatabase>;
      const metadataNamespace = 'teable.table_query_ops.search_vector';
      const dataNamespace = 'teable.table_query_ops.search_vector.data';
      const refusal = Object.assign(new Error('shared data advisory connection reset'), {
        code: 'ECONNRESET',
      });
      const unavailable = vi.fn(
        (error: unknown) =>
          error === refusal ||
          (typeof error === 'object' && error !== null && 'code' in error && error.code === '57P01')
      );
      const metadataLocks = new Set<object>();
      const metadataUnlocks = new Set<object>();
      const terminated: number[] = [];
      let dataFailures = 0;
      let successfulUnlocks = 0;
      const executionDb = db.withPlugin({
        transformQuery(args) {
          const compiled = new PostgresQueryCompiler().compileQuery(args.node, args.queryId);
          if (compiled.sql.includes('pg_try_advisory_lock')) {
            if (compiled.parameters[0] === metadataNamespace) metadataLocks.add(args.queryId);
            if (compiled.parameters[0] === dataNamespace) {
              dataFailures += 1;
              throw refusal;
            }
          }
          if (
            compiled.sql.includes('pg_advisory_unlock') &&
            compiled.parameters[0] === metadataNamespace
          )
            metadataUnlocks.add(args.queryId);
          return args.node;
        },
        async transformResult(args) {
          if (metadataUnlocks.has(args.queryId)) successfulUnlocks += 1;
          if (metadataLocks.has(args.queryId) && args.result.rows[0]?.acquired === true) {
            const owner = await sql<{ pid: number }>`SELECT pid FROM pg_locks
              WHERE locktype = 'advisory' AND granted AND objsubid = 2
                AND classid = hashtext(${metadataNamespace})::oid
                AND objid = hashtext(${fixture.tableId})::oid`.execute(meta);
            expect(owner.rows).toHaveLength(1);
            const pid = owner.rows[0].pid;
            terminated.push(pid);
            expect(
              (
                await sql<{
                  terminated: boolean;
                }>`SELECT pg_terminate_backend(${pid}) AS terminated`.execute(meta)
              ).rows[0].terminated
            ).toBe(true);
            await vi.waitFor(async () => {
              expect(
                (
                  await sql<{ held: boolean }>`SELECT EXISTS (
                SELECT 1 FROM pg_locks WHERE pid = ${pid} AND locktype = 'advisory'
              ) AS held`.execute(meta)
                ).rows[0].held
              ).toBe(false);
            });
          }
          return args.result;
        },
      });
      // Both reservations must refer to the identical Kysely object, matching
      // the host's shared meta/data connection path rather than a split pool.
      const worker = warmRetirementWorker(fixture.tableId, executionDb, unavailable, executionDb);
      const retained = await fixture.retirementMetadata();
      if (chargedAttempts > 0) {
        await sql`UPDATE table_query_remediation_task SET status = 'running', attempts = ${chargedAttempts},
          locked_by = 'departed-shared-worker', locked_at = now() - interval '2 minutes'
          WHERE id = ${fixture.taskId}`.execute(meta);
      }
      for (let round = 0; round < 4; round += 1) {
        await worker.runOnce();
        const deferred = expectOk(
          await taskRepository.findById(context, fixture.taskId)
        ).snapshot();
        expect(deferred).toMatchObject({
          id: fixture.taskId,
          status: 'queued',
          attempts: chargedAttempts,
          maxAttempts: 3,
          resumeAttempt: chargedAttempts > 0,
          lastError: `Search retirement connection unavailable: ${refusal.message}`,
        });
        expect(deferred.lockedAt).toBeUndefined();
        expect(deferred.lockedBy).toBeUndefined();
        expect(terminated).toHaveLength(round + 1);
        expect(dataFailures).toBe(round + 1);
        expect(metadataUnlocks.size).toBe(round + 1);
        expect(successfulUnlocks).toBe(0);
        expect(await fixture.retirementMetadata()).toEqual(retained);
        expect(await fixture.artifacts()).toEqual({ column_present: true, index_present: true });
      }
      expect(unavailable).toHaveBeenCalledWith(refusal);
      const recovered = warmRetirementWorker(fixture.tableId, db, unavailable, db);
      await recovered.runOnce();
      const completed = expectOk(await taskRepository.findById(context, fixture.taskId)).snapshot();
      expect(completed).toMatchObject({
        id: fixture.taskId,
        status: 'succeeded',
        attempts: chargedAttempts || 1,
        maxAttempts: 3,
      });
      expect(completed.lastError).toBeUndefined();
      expect(await fixture.artifacts()).toEqual({ column_present: false, index_present: false });
      expect(await fixture.retirementMetadata()).toEqual([
        { serving_snapshot: null, reclaim_drop_after: null, reclaim_drop_queued_at: null },
      ]);
    },
    120_000
  );

  it.each([
    { boundary: 'data_reservation', code: 'ECONNREFUSED', deferred: true },
    { boundary: 'data_reservation', code: '57P03', deferred: true },
    { boundary: 'data_reservation', code: '28P01', deferred: false },
    { boundary: 'metadata_reservation', code: 'ECONNREFUSED', deferred: false },
    { boundary: 'data_advisory_lock', code: 'ECONNRESET', deferred: true },
    { boundary: 'after_data_lock', code: 'ECONNRESET', deferred: false },
    { boundary: 'after_ddl', code: 'ECONNRESET', deferred: false },
    { boundary: 'admin_data_reservation', code: 'ECONNREFUSED', deferred: false },
    { boundary: 'admin_table_lock', code: '55P03', deferred: false },
  ] as const)(
    'bounds warm retirement $boundary/$code only when physical work can have started',
    async ({ boundary, code, deferred }) => {
      const admin = boundary === 'admin_data_reservation' || boundary === 'admin_table_lock';
      const fixture = await prepareWarmRetirement(db, admin);
      const meta = testContainer.metaDb as unknown as Kysely<UnknownPostgresDatabase>;
      const refusal = Object.assign(new Error(`raw ${boundary} ${code}`), { code });
      const unavailable = vi.fn((error: unknown) => error === refusal && code !== '28P01');
      let lockAcquired = false;
      let failedQueries = 0;
      let tableLockAcquired = false;
      const advisoryQueries = new Set<object>();
      const tableLockQueries = new Set<object>();
      const ddlQueries = new Set<object>();
      const executionDb = db.withPlugin({
        transformQuery(args) {
          const compiled = new PostgresQueryCompiler().compileQuery(args.node, args.queryId);
          if (compiled.sql.includes('pg_try_advisory_lock')) advisoryQueries.add(args.queryId);
          if (compiled.sql.startsWith('LOCK TABLE ')) tableLockQueries.add(args.queryId);
          if (
            boundary === 'after_ddl' &&
            compiled.sql.startsWith('ALTER TABLE ') &&
            compiled.sql.includes('DROP COLUMN')
          )
            ddlQueries.add(args.queryId);
          if (compiled.sql.includes('pg_try_advisory_lock') && boundary === 'data_advisory_lock') {
            failedQueries += 1;
            throw refusal;
          }
          if (
            compiled.sql.startsWith('LOCK TABLE ') &&
            (boundary === 'after_data_lock' || boundary === 'admin_table_lock')
          ) {
            failedQueries += 1;
            throw refusal;
          }
          return args.node;
        },
        async transformResult(args) {
          if (advisoryQueries.has(args.queryId)) lockAcquired = true;
          if (tableLockQueries.has(args.queryId)) tableLockAcquired = true;
          if (ddlQueries.has(args.queryId)) {
            failedQueries += 1;
            throw refusal;
          }
          return args.result;
        },
      });
      // A distinct wrapper keeps the task repository healthy while refusing only
      // the executor's metadata reservation in the negative control.
      const executionMeta = meta.withPlugin({
        transformQuery(args) {
          return args.node;
        },
        async transformResult(args) {
          return args.result;
        },
      });
      const refusedDb = boundary === 'metadata_reservation' ? executionMeta : executionDb;
      const reservation = refusedDb.connection();
      const executeReservation = vi.spyOn(reservation, 'execute');
      const connection = vi.spyOn(refusedDb, 'connection');
      if (
        boundary === 'data_reservation' ||
        boundary === 'metadata_reservation' ||
        boundary === 'admin_data_reservation'
      ) {
        executeReservation.mockRejectedValue(refusal);
        connection.mockReturnValue(reservation);
      }
      try {
        const retained = await fixture.retirementMetadata();
        const worker = warmRetirementWorker(
          fixture.tableId,
          executionDb,
          unavailable,
          executionMeta,
          admin
        );
        for (let round = 0; round < (deferred ? 4 : 3); round += 1) {
          await worker.runOnce();
          const persisted = expectOk(
            await taskRepository.findById(context, fixture.taskId)
          ).snapshot();
          expect(persisted).toMatchObject({
            id: fixture.taskId,
            status: deferred ? 'queued' : 'failed',
            attempts: deferred ? 0 : round + 1,
            maxAttempts: 3,
          });
          expect(persisted.lastError).toContain(refusal.message);
          expect(persisted.lockedAt).toBeUndefined();
          expect(persisted.lockedBy).toBeUndefined();
          expect(await fixture.retirementMetadata()).toEqual(retained);
          expect(await fixture.artifacts()).toEqual({ column_present: true, index_present: true });
        }
        if (deferred) expect(lockAcquired).toBe(false);
        if (
          admin ||
          boundary === 'metadata_reservation' ||
          boundary === 'after_data_lock' ||
          boundary === 'after_ddl'
        )
          expect(unavailable).not.toHaveBeenCalled();
        if (boundary === 'after_data_lock' || boundary === 'after_ddl')
          expect(lockAcquired).toBe(true);
        if (boundary === 'after_ddl') expect(tableLockAcquired).toBe(true);
        if (
          boundary === 'data_advisory_lock' ||
          boundary === 'after_data_lock' ||
          boundary === 'after_ddl'
        )
          expect(failedQueries).toBeGreaterThanOrEqual(deferred ? 4 : 3);
        if (deferred) {
          expect(unavailable).toHaveBeenCalledTimes(4);
          connection.mockRestore();
          executeReservation.mockRestore();
          // Remove only the injected query failure, preserving the same durable job.
          const recovery = warmRetirementWorker(fixture.tableId, db, unavailable);
          await recovery.runOnce();
          expect(
            expectOk(await taskRepository.findById(context, fixture.taskId)).snapshot()
          ).toMatchObject({ id: fixture.taskId, status: 'succeeded', attempts: 1 });
          expect(await fixture.artifacts()).toEqual({
            column_present: false,
            index_present: false,
          });
        } else {
          expect(
            expectOk(
              await taskRepository.claimNextAccepted(context, {
                scope: admin ? 'all' : 'search_maintenance',
                workerId: 'exhausted-warm-worker',
                now: new Date(),
                allowedKinds: ['drop_search_access_path'],
                allowManualIndexExecution: admin,
                allowPolicyIndexExecution: false,
              })
            )
          ).toBeUndefined();
          expect(
            expectOk(await taskRepository.findById(context, fixture.taskId))
              .start('again', new Date())
              .isErr()
          ).toBe(true);
        }
      } finally {
        connection.mockRestore();
        executeReservation.mockRestore();
      }
    },
    120_000
  );

  it('releases two stalled maintenance routes while healthy long SQL finishes', async () => {
    const target = new URL(testContainer.connectionString);
    const sockets = new Set<Socket>();
    let paused = false;
    const proxy = createServer((client) => {
      sockets.add(client);
      if (paused) return;
      const upstream = connect(Number(target.port || 5432), target.hostname);
      sockets.add(upstream);
      client.on('error', () => upstream.destroy());
      upstream.on('error', () => client.destroy());
      client.pipe(upstream).pipe(client);
    });
    await new Promise<void>((resolve, reject) => {
      proxy.once('error', reject).listen(0, '127.0.0.1', resolve);
    });
    const address = proxy.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP address');
    const routed = new URL(target);
    routed.hostname = '127.0.0.1';
    routed.port = String(address.port);
    const maintenance = (connectionString: string) =>
      createV2PostgresDb(
        {
          pg: { connectionString, pool: { max: 1 } },
        },
        { maintenanceStatementDeadlineMs: 6 * 60 * 60 * 1000 }
      );
    const routes = await Promise.all([
      maintenance(routed.href),
      maintenance(routed.href),
      maintenance(target.href),
    ]);
    try {
      await Promise.all(routes.map((route) => sql`SELECT 1`.execute(route)));
      paused = true;
      for (const socket of sockets) socket.pause();
      const lost = routes
        .slice(0, 2)
        .map((route) =>
          expect(sql`SELECT 1`.execute(route)).rejects.toMatchObject({ code: 'ETIMEDOUT' })
        );
      const healthy = sql<{ value: number }>`SELECT 42 AS value FROM pg_sleep(12)`.execute(
        routes[2]
      );
      await Promise.all(lost);
      expect((await healthy).rows[0].value).toBe(42);
    } finally {
      for (const socket of sockets) socket.destroy();
      await Promise.all(routes.map((route) => route.destroy()));
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
    }
  }, 35_000);

  it('lets one worker use the second global slot for another space while work is held', async () => {
    const meta = testContainer.metaDb as unknown as Kysely<TableQueryOpsDatabase>;
    const suffix = `${Date.now()}${Math.floor(Math.random() * 100000)}`;
    const spaceId = `spc_capacity_${suffix}`;
    const otherSpaceId = `spc_capacity_other_${suffix}`;
    const bases = [`bse_capacity_a_${suffix}`, `bse_capacity_b_${suffix}`, `bse_capacity_c_${suffix}`];
    const { promise: held, resolve: release } = Promise.withResolvers<void>();
    let worker: TableQueryOpsRunnerHandle | undefined;
    try {
      await sql`INSERT INTO space (id, name, created_by) VALUES
        (${spaceId}, 'Capacity', 'test'), (${otherSpaceId}, 'Capacity other', 'test')`.execute(meta);
      await sql`INSERT INTO base (id, space_id, name, "order", created_by) VALUES
        (${bases[0]}, ${spaceId}, 'A', 0, 'test'),
        (${bases[1]}, ${spaceId}, 'B', 0, 'test'),
        (${bases[2]}, ${otherSpaceId}, 'C', 0, 'test')`.execute(meta);
      const tasks = bases.map((baseId, index) => expectOk(TableQueryRemediationTask.createQueued({
        tableId: `tbl_capacity_${index}_${suffix}`,
        baseId,
        kind: 'rebuild_search_access_path',
        payload: { trigger: 'schema_change' },
        now: new Date(Date.now() - (3 - index) * 1000),
      })));
      for (const task of tasks) {
        recoveryTaskIds.push(task.snapshot().id);
        expectOk(await taskRepository.save(context, task));
      }
      // A charged resume remains subject to the space limit even at its retry cap.
      await sql`UPDATE table_query_remediation_task SET attempts = 3, resume_attempt = true
        WHERE id = ${tasks[1].snapshot().id}`.execute(meta);
      const workerContainer = testContainer.container.createChildContainer();
      workerContainer.registerInstance(v2TableOpsTokens.taskWorkerConfig, {
        enabled: true, intervalMs: 30, workerId: 'capacity-worker', scope: 'search_maintenance',
        allowedKinds: ['rebuild_search_access_path'],
        allowManualIndexExecution: false, allowPolicyIndexExecution: false,
      });
      workerContainer.registerInstance(v2TableOpsTokens.clock, { now: () => new Date() });
      const execute = vi.fn(async (_context: IExecutionContext, command: RunTableQueryRemediationTaskCommand) => {
        const task = expectOk(await taskRepository.findById(context, command.taskId));
        expectOk(await taskRepository.save(context, expectOk(task.start(command.workerId, new Date()))));
        await held;
        return { isErr: () => false };
      });
      workerContainer.registerInstance(v2CoreTokens.commandBus, { execute } as unknown as ICommandBus);
      worker = startTableQueryOpsTaskWorkerIfEnabled(workerContainer, context);
      await vi.waitFor(async () => {
        expect(execute).toHaveBeenCalledTimes(2);
        const running = await Promise.all([tasks[0], tasks[2]].map(async (task) =>
          expectOk(await taskRepository.findById(context, task.snapshot().id)).snapshot().status
        ));
        expect(running).toEqual(['running', 'running']);
      }, { timeout: 5_000 });
      const startedIds = execute.mock.calls.map(([, command]) => command.taskId);
      expect(startedIds).toEqual([tasks[0].snapshot().id, tasks[2].snapshot().id]);
      expect(expectOk(await taskRepository.claimNextAccepted(context, {
        scope: 'search_maintenance', workerId: 'third-worker', now: new Date(),
        allowedKinds: ['rebuild_search_access_path'],
        allowManualIndexExecution: false, allowPolicyIndexExecution: false,
      }))).toBeUndefined();
      worker?.stop();
      const lockAcquired = Promise.withResolvers<void>();
      const unlock = Promise.withResolvers<void>();
      const lock = meta.transaction().execute(async (trx) => {
        await sql`SELECT pg_advisory_xact_lock(hashtext('teable.table_query_ops.search_vector'),
          hashtext(${tasks[0].snapshot().tableId}))`.execute(trx);
        lockAcquired.resolve();
        await unlock.promise;
      });
      try {
        await lockAcquired.promise;
        await sql`UPDATE table_query_remediation_task SET locked_at = now() - interval '2 minutes'
          WHERE id = ${tasks[0].snapshot().id}`.execute(meta);
        const healthy = expectOk(await taskRepository.findById(context, tasks[2].snapshot().id));
        expectOk(await taskRepository.save(context, expectOk(healthy.succeed({}, new Date()))));
        expect(expectOk(await taskRepository.claimNextAccepted(context, {
          scope: 'search_maintenance', workerId: 'replacement-worker', now: new Date(),
          allowedKinds: ['rebuild_search_access_path'],
          allowManualIndexExecution: false, allowPolicyIndexExecution: false,
        }))).toBeUndefined();
      } finally {
        unlock.resolve();
        await lock;
      }
    } finally {
      worker?.stop();
      release();
      await sql`DELETE FROM table_query_remediation_task WHERE base_id = ANY(${bases})`.execute(meta);
      await sql`DELETE FROM base WHERE id = ANY(${bases})`.execute(meta);
      await sql`DELETE FROM space WHERE id IN (${spaceId}, ${otherSpaceId})`.execute(meta);
    }
  });

  it.each([0, 3])(
    'rotates an unavailable oldest rebuild and retirement behind healthy work at charged attempt %i',
    async (chargedAttempts) => {
      let { table } = await createTable();
      const tableId = table.id().toString();
      maintenanceTableIds.push(tableId);
      await createSemanticRecords(
        table,
        fieldByName(table, 'Title').id().toString(),
        fieldByName(table, 'Score').id().toString()
      );
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
      const retired = (await loadTable(tableId)).searchIndex()!;
      const physical = expectOk(getTablePhysicalName(table));
      const relation = `${quoteIdentifier(physical.schema)}.${quoteIdentifier(physical.tableName)}`;
      const oldArtifacts = async () =>
        (
          await sql<{ column_present: boolean; index_present: boolean }>`SELECT
            EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass(${relation})
              AND attname = ${retired.document!.generatedColumnName} AND NOT attisdropped) AS column_present,
            to_regclass(${`${quoteIdentifier(physical.schema)}.${quoteIdentifier(retired.document!.indexName)}`}) IS NOT NULL AS index_present`.execute(
            db
          )
        ).rows[0];
      const meta = testContainer.metaDb as unknown as Kysely<UnknownPostgresDatabase>;
      const now = new Date();
      const minute = now.getUTCHours() * 60 + now.getUTCMinutes();
      const hhmm = (value: number) =>
        `${Math.floor(value / 60)
          .toString()
          .padStart(2, '0')}:${(value % 60).toString().padStart(2, '0')}`;
      const maintenanceReconciler = new PostgresTableSearchVectorReconciler(meta, db, {
        windowUtc: `${hhmm((minute + 1410) % 1440)}-${hhmm((minute + 30) % 1440)}`,
        allowUnknownOrLargeRewrite: true,
      });
      const handler = new RunTableQueryRemediationTaskHandler(
        taskRepository,
        new PostgresTableQueryRemediationExecutor(meta, db, tableRepository, maintenanceReconciler),
        testContainer.container.resolve(v2TableOpsTokens.decisionPolicy),
        testContainer.container.resolve(v2TableOpsTokens.decisionLogRepository),
        { now: () => new Date() }
      );
      table = expectOk(
        await commandBus.execute<CreateFieldCommand, CreateFieldResult>(
          context,
          CreateFieldCommand.create({
            baseId: table.baseId().toString(),
            tableId,
            field: { type: 'singleLineText', name: 'Routing outage addition' },
          })._unsafeUnwrap()
        )
      ).table;
      let { table: healthyTable } = await createTable();
      const healthyTableId = healthyTable.id().toString();
      maintenanceTableIds.push(healthyTableId);
      await createSemanticRecords(
        healthyTable,
        fieldByName(healthyTable, 'Title').id().toString(),
        fieldByName(healthyTable, 'Score').id().toString()
      );
      expectOk(
        await reconciler.reconcile(context, {
          table: healthyTable,
          mode: 'create',
          provider: 'pg_trgm',
          validationMode: 'real_ddl',
          requirePlanImprovement: false,
          allowLargeTableRewrite: true,
        })
      );
      healthyTable = expectOk(
        await commandBus.execute<CreateFieldCommand, CreateFieldResult>(
          context,
          CreateFieldCommand.create({
            baseId: healthyTable.baseId().toString(),
            tableId: healthyTableId,
            field: { type: 'singleLineText', name: 'Healthy maintenance addition' },
          })._unsafeUnwrap()
        )
      ).table;
      for (const kind of ['rebuild_search_access_path', 'drop_search_access_path'] as const) {
        const trigger = kind === 'drop_search_access_path' ? 'reclaim' : 'schema_change';
        const pending = (
          await sql<{ id: string }>`SELECT id FROM table_query_remediation_task
          WHERE table_id = ${tableId} AND status = 'queued' AND payload->>'trigger' = ${trigger}`.execute(
            meta
          )
        ).rows;
        expect(pending).toHaveLength(1);
        const taskId = pending[0].id;
        const healthyPending = (
          await sql<{ id: string }>`SELECT id FROM table_query_remediation_task
            WHERE table_id = ${healthyTableId} AND status = 'queued'
              AND payload->>'trigger' = ${trigger}`.execute(meta)
        ).rows;
        expect(healthyPending).toHaveLength(1);
        const healthyTaskId = healthyPending[0].id;
        // Both jobs are eligible. The unavailable tenant is deterministically oldest
        // before its first deferral; healthy work must win the following claim.
        await sql`UPDATE table_query_remediation_task
          SET created_time = now() - interval '2 days', last_modified_time = now() - interval '2 days'
          WHERE id = ${taskId}`.execute(meta);
        await sql`UPDATE table_query_remediation_task
          SET created_time = now() - interval '1 day', last_modified_time = now() - interval '1 day'
          WHERE id = ${healthyTaskId}`.execute(meta);
        let departed: TableQueryRemediationTask | undefined;
        if (chargedAttempts > 0) {
          await sql`UPDATE table_query_remediation_task SET status = 'running', attempts = ${chargedAttempts},
            locked_by = 'departed-routing-worker', locked_at = now() - interval '2 minutes'
            WHERE id = ${taskId}`.execute(meta);
          departed = expectOk(await taskRepository.findById(context, taskId));
        }
        const serving = (await loadTable(tableId)).searchIndex();
        const beforeSearch = await searchUsingRuntime(table, 'lifecycleunique');
        expect(beforeSearch.total).toBe(1);
        expect(await oldArtifacts()).toEqual({ column_present: true, index_present: true });
        const workerContainer = testContainer.container.createChildContainer();
        workerContainer.registerInstance(v2TableOpsTokens.taskWorkerConfig, {
          enabled: true,
          intervalMs: 60_000,
          workerId: 'routing-recovery-worker',
          scope: 'search_maintenance',
          allowedKinds: [kind],
          allowManualIndexExecution: false,
          allowPolicyIndexExecution: false,
        });
        workerContainer.registerInstance(v2TableOpsTokens.clock, { now: () => new Date() });
        const execute = vi.fn(
          (executionContext: IExecutionContext, command: RunTableQueryRemediationTaskCommand) =>
            handler.handle(executionContext, command)
        );
        workerContainer.registerInstance(v2CoreTokens.commandBus, {
          execute,
        } as unknown as ICommandBus);
        const refusal = new TableQueryOpsExecutionUnavailableError(
          Object.assign(
            new Error('database "pr4559_data" is not currently accepting connections'),
            {
              code: '55000',
            }
          )
        );
        let unavailable = true;
        const resolveExecution = vi.fn(async (routedTableId: string) => {
          expect([tableId, healthyTableId]).toContain(routedTableId);
          if (routedTableId === tableId && unavailable) throw refusal;
          return { container: workerContainer, context };
        });
        for (let round = 0; round < 4; round += 1) {
          const worker = startTableQueryOpsTaskWorkerIfEnabled(
            workerContainer,
            context,
            resolveExecution
          );
          try {
            await vi.waitFor(
              async () => {
                expect(resolveExecution).toHaveBeenCalledTimes(round + 1 + (round > 0 ? 1 : 0));
                const persisted = expectOk(
                  await taskRepository.findById(context, taskId)
                ).snapshot();
                expect(persisted).toMatchObject({
                  status: 'queued',
                  attempts: chargedAttempts,
                  maxAttempts: 3,
                  resumeAttempt: chargedAttempts > 0,
                  lastError: `Task routing failed: ${String(refusal)}`,
                });
                expect(persisted.lockedBy).toBeUndefined();
                expect(persisted.lockedAt).toBeUndefined();
              },
              { timeout: 5_000 }
            );
          } finally {
            worker?.stop();
          }
          expect(execute).toHaveBeenCalledTimes(round > 0 ? 1 : 0);
          expect(await oldArtifacts()).toEqual({ column_present: true, index_present: true });
          expect((await loadTable(tableId)).searchIndex()).toEqual(serving);
          const duringSearch = await searchUsingRuntime(table, 'lifecycleunique');
          expect(duringSearch.total).toBe(beforeSearch.total);
          expect(duringSearch.searchAccessPath).toEqual(beforeSearch.searchAccessPath);
          if (round === 0) {
            const healthyWorker = startTableQueryOpsTaskWorkerIfEnabled(
              workerContainer,
              context,
              resolveExecution
            );
            try {
              await vi.waitFor(
                async () => {
                  expect(resolveExecution).toHaveBeenCalledTimes(2);
                  expect(resolveExecution).toHaveBeenLastCalledWith(healthyTableId);
                  const completed = expectOk(
                    await taskRepository.findById(context, healthyTaskId)
                  ).snapshot();
                  expect(completed).toMatchObject({ status: 'succeeded', attempts: 1 });
                  const deferred = expectOk(
                    await taskRepository.findById(context, taskId)
                  ).snapshot();
                  expect(deferred).toMatchObject({
                    status: 'queued',
                    attempts: chargedAttempts,
                    resumeAttempt: chargedAttempts > 0,
                    lastError: `Task routing failed: ${String(refusal)}`,
                  });
                  expect(deferred.lockedBy).toBeUndefined();
                  expect(deferred.lockedAt).toBeUndefined();
                },
                { timeout: 15_000 }
              );
            } finally {
              healthyWorker?.stop();
            }
            expect(execute).toHaveBeenCalledTimes(1);
            const healthySearch = await searchUsingRuntime(healthyTable, 'lifecycleunique');
            expect(healthySearch.total).toBe(1);
            expect(healthySearch.searchAccessPath).toMatchObject({ used: 'generated_text' });
          }
        }
        if (departed)
          expect(
            (
              await taskRepository.save(
                context,
                expectOk(departed.fail('Stale routing failure', new Date()))
              )
            ).isErr()
          ).toBe(true);
        unavailable = false;
        const worker = startTableQueryOpsTaskWorkerIfEnabled(
          workerContainer,
          context,
          resolveExecution
        );
        try {
          await vi.waitFor(
            async () => {
              const completed = expectOk(await taskRepository.findById(context, taskId)).snapshot();
              expect(completed).toMatchObject({
                status: 'succeeded',
                attempts: chargedAttempts || 1,
                maxAttempts: 3,
              });
              expect(completed.lastError).toBeUndefined();
            },
            { timeout: 15_000 }
          );
        } finally {
          worker?.stop();
        }
        expect(execute).toHaveBeenCalledTimes(2);
        if (departed)
          expect(
            (
              await taskRepository.save(
                context,
                expectOk(departed.succeed({ stale: true }, new Date()))
              )
            ).isErr()
          ).toBe(true);
        if (trigger === 'schema_change') {
          expect((await loadTable(tableId)).searchIndex()!.document!.indexName).not.toBe(
            retired.document!.indexName
          );
          // Only advance the existing seven-day gate after proving it still blocks cleanup.
          expect(
            expectOk(
              await taskRepository.claimNextAccepted(context, {
                scope: 'search_maintenance',
                workerId: 'grace-check',
                now: new Date(),
                allowedKinds: ['drop_search_access_path'],
                allowManualIndexExecution: false,
                allowPolicyIndexExecution: false,
              })
            )
          ).toBeUndefined();
          await sql`UPDATE table_query_search_vector_config SET reclaim_drop_after = now() - interval '1 second'
            WHERE table_id IN (${tableId}, ${healthyTableId}) AND status = 'disabled'`.execute(
            meta
          );
        } else {
          expect(await oldArtifacts()).toEqual({ column_present: false, index_present: false });
          expect((await loadTable(tableId)).searchIndex()).toEqual(serving);
          const afterSearch = await searchUsingRuntime(table, 'lifecycleunique');
          expect(afterSearch.total).toBe(1);
          expect(afterSearch.searchAccessPath).toEqual(beforeSearch.searchAccessPath);
          expect(afterSearch.searchAccessPath).toMatchObject({ used: 'generated_text' });
          const retained = await sql<{ count: number }>`SELECT count(*)::int AS count
            FROM table_query_search_vector_config WHERE table_id = ${tableId} AND status = 'disabled'
              AND (serving_snapshot IS NOT NULL OR reclaim_drop_after IS NOT NULL OR reclaim_drop_queued_at IS NOT NULL)`.execute(
            meta
          );
          expect(retained.rows[0].count).toBe(0);
        }
      }
    },
    120_000
  );

  it.each([
    ['schema_change', 'rebuild_search_access_path', 1],
    ['schema_change', 'rebuild_search_access_path', 3],
    ['reclaim', 'drop_search_access_path', 1],
    ['reclaim', 'drop_search_access_path', 3],
  ] as const)(
    'persists worker routing failures after queued %s %s recovery at attempt %i',
    async (trigger, kind, chargedAttempts) => {
      const { table } = await createTable();
      const tableId = table.id().toString();
      maintenanceTableIds.push(tableId);
      const meta = testContainer.metaDb as unknown as Kysely<UnknownPostgresDatabase>;
      const task = expectOk(
        TableQueryRemediationTask.createQueued({
          tableId,
          baseId: table.baseId().toString(),
          kind,
          payload: { trigger, ...(trigger === 'reclaim' ? { scopeKey: 'retired' } : {}) },
          now: new Date(),
        })
      );
      const taskId = task.snapshot().id;
      if (trigger === 'reclaim')
        await sql`INSERT INTO table_query_search_vector_config
          (id, base_id, table_id, candidate_key, generated_column_name, index_name,
            field_ids, field_db_names, status, reclaim_drop_after, reclaim_drop_queued_at)
          VALUES (${`retired_${taskId}`}, ${table.baseId().toString()}, ${tableId}, 'retired',
            'retired_column', 'retired_index', '[]'::jsonb, '[]'::jsonb, 'disabled',
            now() - interval '1 second', now())`.execute(meta);
      expectOk(await taskRepository.save(context, task));
      await sql`UPDATE table_query_remediation_task SET status = 'running', attempts = ${chargedAttempts},
        locked_by = 'departed-route-owner', locked_at = now() - interval '2 minutes'
        WHERE id = ${taskId}`.execute(meta);
      const departed = expectOk(await taskRepository.findById(context, taskId));
      const claimed = expectOk(
        await taskRepository.claimNextAccepted(context, {
          scope: 'search_maintenance',
          workerId: 'replacement-route-owner',
          now: new Date(),
          allowedKinds: [kind],
          allowManualIndexExecution: false,
          allowPolicyIndexExecution: false,
        })
      )!;
      expect(claimed.snapshot().id).toBe(taskId);
      const resumed = expectOk(
        await taskRepository.save(
          context,
          expectOk(claimed.start('replacement-route-owner', new Date()))
        )
      );
      const deferred = expectOk(
        await taskRepository.save(
          context,
          expectOk(resumed.deferMaintenance('Table lock unavailable', chargedAttempts, new Date()))
        )
      );
      expect(deferred.snapshot()).toMatchObject({
        status: 'queued',
        attempts: chargedAttempts,
        resumeAttempt: true,
      });
      expect(
        (
          await taskRepository.save(
            context,
            expectOk(departed.fail('Stale routing failure', new Date()))
          )
        ).isErr()
      ).toBe(true);
      const workerContainer = testContainer.container.createChildContainer();
      workerContainer.registerInstance(v2TableOpsTokens.taskWorkerConfig, {
        enabled: true,
        intervalMs: 60_000,
        workerId: 'routing-failure-worker',
        scope: 'search_maintenance',
        allowedKinds: [kind],
        allowManualIndexExecution: false,
        allowPolicyIndexExecution: false,
      });
      workerContainer.registerInstance(v2TableOpsTokens.clock, { now: () => new Date() });
      const resolveExecution = vi.fn(async (routedTableId: string) => {
        expect(routedTableId).toBe(tableId);
        throw new Error('Retirement target database is unavailable');
      });
      for (let attempts = chargedAttempts; attempts <= 3; attempts += 1) {
        // Exercise the actual consumer's start().fail() save without a running-state save.
        const worker = startTableQueryOpsTaskWorkerIfEnabled(
          workerContainer,
          context,
          resolveExecution
        );
        try {
          await vi.waitFor(
            async () => {
              const persisted = expectOk(await taskRepository.findById(context, taskId));
              expect(persisted.snapshot()).toMatchObject({
                status: 'failed',
                attempts,
                maxAttempts: 3,
                resumeAttempt: false,
                lastError: 'Task routing failed: Error: Retirement target database is unavailable',
              });
              expect(persisted.snapshot().lockedAt).toBeUndefined();
              expect(persisted.snapshot().lockedBy).toBeUndefined();
            },
            { timeout: 5_000 }
          );
        } finally {
          worker?.stop();
        }
      }
      expect(resolveExecution).toHaveBeenCalledTimes(4 - chargedAttempts);
      expect(
        expectOk(
          await taskRepository.claimNextAccepted(context, {
            scope: 'search_maintenance',
            workerId: 'exhausted-route-worker',
            now: new Date(),
            allowedKinds: [kind],
            allowManualIndexExecution: false,
            allowPolicyIndexExecution: false,
          })
        )
      ).toBeUndefined();
      expect(
        (
          await taskRepository.save(
            context,
            expectOk(resumed.fail('Stale resumed routing failure', new Date()))
          )
        ).isErr()
      ).toBe(true);
      const terminal = expectOk(await taskRepository.findById(context, taskId));
      expect(terminal.snapshot()).toMatchObject({ status: 'failed', attempts: 3, maxAttempts: 3 });
      expect(terminal.start('exhausted-route-worker', new Date()).isErr()).toBe(true);
    }
  );

  it('rechecks the exact product-switch row threshold when an unconfirmed task executes', async () => {
    const { table } = await createTable();
    const tableId = table.id().toString();
    const title = fieldByName(table, 'Title');
    const score = fieldByName(table, 'Score');
    await createSemanticRecords(table, title.id().toString(), score.id().toString());
    const candidate = (
      await new PostgresTableSearchVectorAdvisor(db).analyze(context, {
        table,
        provider: 'pg_trgm',
        maxRecommendations: 1,
      })
    ).recommendations[0];
    expect(candidate).toBeDefined();
    const task = expectOk(
      TableQueryRemediationTask.createQueued({
        tableId,
        baseId: table.baseId().toString(),
        kind: 'create_search_access_path',
        now: new Date(),
        payload: {
          trigger: 'admin_search_access_path',
          executionMode: 'manual',
          productSwitch: true,
          largeTableConfirmed: false,
          mode: 'create',
          expectedDefinitionKey: candidate!.candidateKey,
          provider: 'pg_trgm',
          validationMode: 'real_ddl',
          allowLargeTableRewrite: true,
        },
      })
    );
    expectOk(await taskRepository.save(context, task));

    await insertPlannerFiller(table, title, score, 49_997);
    const physical = getTablePhysicalName(table)._unsafeUnwrap();
    const relation = `${quoteIdentifier(physical.schema)}.${quoteIdentifier(physical.tableName)}`;
    const before = await sql<{ columns: number; indexes: number }>`SELECT
      (SELECT count(*)::int FROM pg_attribute a
        WHERE a.attrelid = to_regclass(${relation}) AND a.attnum > 0 AND NOT a.attisdropped) AS columns,
      (SELECT count(*)::int FROM pg_index i
        WHERE i.indrelid = to_regclass(${relation})) AS indexes`.execute(db);
    const firstAttempt = (await runTask(task.snapshot().id)).snapshot();
    expect(firstAttempt).toMatchObject({
      status: 'failed',
      attempts: 1,
      lastError: expect.stringContaining(
        'Confirmation is required for tables with 50000 or more records'
      ),
    });
    const retry = (await runTask(task.snapshot().id)).snapshot();
    expect(retry).toMatchObject({ status: 'failed', attempts: 2 });
    const after = await sql<{ columns: number; indexes: number }>`SELECT
      (SELECT count(*)::int FROM pg_attribute a
        WHERE a.attrelid = to_regclass(${relation}) AND a.attnum > 0 AND NOT a.attisdropped) AS columns,
      (SELECT count(*)::int FROM pg_index i
        WHERE i.indrelid = to_regclass(${relation})) AS indexes`.execute(db);
    expect(after.rows[0]).toEqual(before.rows[0]);
    expect((await loadTable(tableId)).searchIndex()).toBeUndefined();
    expect(
      await sql`SELECT 1 FROM table_query_search_vector_config WHERE table_id = ${tableId}`.execute(
        testContainer.metaDb as unknown as Kysely<TableQueryOpsDatabase>
      )
    ).toMatchObject({ rows: [] });
  }, 120_000);

  it('allows an unconfirmed product-switch task for a small table with unknown statistics', async () => {
    const { table } = await createTable();
    const tableId = table.id().toString();
    const physical = getTablePhysicalName(table)._unsafeUnwrap();
    const tableSql = `${quoteIdentifier(physical.schema)}.${quoteIdentifier(physical.tableName)}`;
    const titleDbName = fieldByName(table, 'Title')
      .dbFieldName()
      ._unsafeUnwrap()
      .value()
      ._unsafeUnwrap();
    const scoreDbName = fieldByName(table, 'Score')
      .dbFieldName()
      ._unsafeUnwrap()
      .value()
      ._unsafeUnwrap();
    // Seed this fresh heap with plain DML: the record commands ANALYZE a
    // previously empty table, which would make pg_class.reltuples known. The
    // rows stay real while the planner size stays unknown (-1).
    await sql
      .raw(
        `INSERT INTO ${tableSql} ("__id", "__created_by", "__version", ${quoteIdentifier(
          titleDbName
        )}, ${quoteIdentifier(
          scoreDbName
        )}) SELECT 'rec_tqops_small_' || g::text, 'system', 1, 'lifecycle order ' || g::text, (g % 100)::text FROM generate_series(1, 3) AS g`
      )
      .execute(db);
    const statistics = await sql<{ rows: number; actual: number }>`SELECT
      (SELECT c.reltuples::int
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = ${physical.schema} AND c.relname = ${physical.tableName}) AS rows,
      (SELECT count(*)::int FROM ${sql.raw(tableSql)}) AS actual`.execute(db);
    expect(statistics.rows[0]).toEqual({ rows: -1, actual: 3 });
    const candidate = (
      await new PostgresTableSearchVectorAdvisor(db).analyze(context, {
        table,
        provider: 'pg_trgm',
        maxRecommendations: 1,
      })
    ).recommendations[0];
    expect(candidate).toBeDefined();
    const task = expectOk(
      TableQueryRemediationTask.createQueued({
        tableId,
        baseId: table.baseId().toString(),
        kind: 'create_search_access_path',
        now: new Date(),
        payload: {
          trigger: 'admin_search_access_path',
          executionMode: 'manual',
          productSwitch: true,
          largeTableConfirmed: false,
          mode: 'create',
          expectedDefinitionKey: candidate!.candidateKey,
          provider: 'pg_trgm',
          validationMode: 'real_ddl',
          allowLargeTableRewrite: true,
        },
      })
    );
    expectOk(await taskRepository.save(context, task));
    expect((await runTask(task.snapshot().id)).snapshot()).toMatchObject({ status: 'succeeded' });
    await expectReadyConfig(table);
    const rowsAfter = await sql<{ actual: number }>`
      SELECT count(*)::int AS actual FROM ${sql.raw(tableSql)}`.execute(db);
    expect(rowsAfter.rows[0]?.actual).toBe(3);
  }, 120_000);

  it.each(['replaced', 'serving_cleared'] as const)(
    'executes a queued product drop after its generation is %s',
    async (scenario) => {
      const { table } = await createTable();
      const tableId = table.id().toString();
      maintenanceTableIds.push(tableId);
      await createSemanticRecords(
        table,
        fieldByName(table, 'Title').id().toString(),
        fieldByName(table, 'Score').id().toString()
      );
      const publish = async (mode: 'create' | 'rebuild') => {
        expectOk(
          await reconciler.reconcile(context, {
            table: await loadTable(tableId),
            mode,
            provider: 'pg_trgm',
            validationMode: 'real_ddl',
            requirePlanImprovement: false,
            allowLargeTableRewrite: true,
          })
        );
        return (await loadTable(tableId)).searchIndex()!;
      };
      const first = await publish('create');
      const meta = testContainer.metaDb as unknown as Kysely<UnknownPostgresDatabase>;
      const snapshot = await sql<{ value: Record<string, unknown> }>`SELECT jsonb_build_object(
      'searchIndex', (SELECT search_index FROM table_meta WHERE id = ${tableId}),
      'configs', (SELECT jsonb_agg(jsonb_build_object('id', c.id, 'key', c.candidate_key,
        'index', c.index_name, 'column', c.generated_column_name, 'serving', c.serving_snapshot) ORDER BY c.id)
        FROM table_query_search_vector_config c WHERE c.table_id = ${tableId})
    ) AS value`.execute(meta);
      const drop = expectOk(
        TableQueryRemediationTask.createQueued({
          tableId,
          baseId: table.baseId().toString(),
          now: new Date(),
          kind: 'drop_search_access_path',
          payload: {
            trigger: 'admin_search_access_path',
            executionMode: 'manual',
            mode: 'drop',
            productSwitch: true,
            productDropSnapshot: snapshot.rows[0].value,
          },
        })
      );
      expectOk(await taskRepository.save(context, drop));
      if (scenario === 'serving_cleared') {
        await sql`UPDATE table_meta SET search_index = NULL WHERE id = ${tableId}`.execute(meta);
        expect((await runTask(drop.snapshot().id)).snapshot().status).toBe('succeeded');
        const physical = expectOk(getTablePhysicalName(table));
        const index = `${quoteIdentifier(physical.schema)}.${quoteIdentifier(first.document!.indexName)}`;
        const check = await sql<{
          removed: boolean;
        }>`SELECT to_regclass(${index}) IS NULL AS removed`.execute(db);
        expect(check.rows[0].removed).toBe(true);
        return;
      }
      const replacement = await publish('rebuild');
      expect(replacement.document!.indexName).not.toBe(first.document!.indexName);
      const result = (await runTask(drop.snapshot().id)).snapshot();
      expect(result.status).toBe('failed');
      expect(result.lastError).toContain('Product search configuration changed before drop');
      expect((await loadTable(tableId)).searchIndex()).toEqual(replacement);
      expect((await searchUsingRuntime(await loadTable(tableId), 'lifecycleunique')).total).toBe(1);
    },
    60_000
  );

  it('atomically queues seven-day retirement on repeated additions without an analyzer and resumes cleanup after restart', async () => {
    let { table } = await createTable();
    const tableId = table.id().toString();
    maintenanceTableIds.push(tableId);
    await createSemanticRecords(
      table,
      fieldByName(table, 'Title').id().toString(),
      fieldByName(table, 'Score').id().toString()
    );
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
    const meta = testContainer.metaDb as unknown as Kysely<UnknownPostgresDatabase>;
    const now = new Date();
    const hhmm = (minute: number) =>
      `${Math.floor(minute / 60)
        .toString()
        .padStart(2, '0')}:${(minute % 60).toString().padStart(2, '0')}`;
    const minute = now.getUTCHours() * 60 + now.getUTCMinutes();
    const options = {
      windowUtc: `${hhmm((minute + 1410) % 1440)}-${hhmm((minute + 30) % 1440)}`,
      allowUnknownOrLargeRewrite: true,
    };
    const physical = expectOk(getTablePhysicalName(table));
    const relation = `${quoteIdentifier(physical.schema)}.${quoteIdentifier(physical.tableName)}`;
    const runMaintenance = async (taskId: string, executionMeta = meta) =>
      expectOk(
        await new RunTableQueryRemediationTaskHandler(
          taskRepository,
          new PostgresTableQueryRemediationExecutor(
            executionMeta,
            db,
            tableRepository,
            new PostgresTableSearchVectorReconciler(executionMeta, db, options)
          ),
          testContainer.container.resolve(v2TableOpsTokens.decisionPolicy),
          testContainer.container.resolve(v2TableOpsTokens.decisionLogRepository),
          { now: () => new Date() }
        ).handle(
          context,
          new RunTableQueryRemediationTaskCommand(taskId, false, 'retirement-maintenance')
        )
      );
    const claim = () =>
      taskRepository.claimNextAccepted(context, {
        scope: 'search_maintenance',
        workerId: 'retirement-worker',
        now: new Date(),
        allowedKinds: ['drop_search_access_path'],
        allowManualIndexExecution: false,
        allowPolicyIndexExecution: false,
      });
    const initial = (await loadTable(tableId)).searchIndex()!;
    const legacy = {
      version: 1,
      dbTableName: initial.dbTableName,
      definitionKey: initial.definitionKey,
      searchScope: initial.searchScope,
      fields: initial.document!.fields,
      indexUsable: true,
      provider: initial.document!.provider,
      indexName: initial.document!.indexName,
      generatedColumnName: initial.document!.generatedColumnName,
    };
    await sql`UPDATE table_meta SET search_index = ${JSON.stringify(legacy)}::jsonb WHERE id = ${tableId}`.execute(
      meta
    );
    await sql`UPDATE table_query_search_vector_config SET serving_snapshot = NULL WHERE table_id = ${tableId}`.execute(
      meta
    );
    for (let round = 0; round < 3; round += 1) {
      table = expectOk(
        await commandBus.execute<CreateFieldCommand, CreateFieldResult>(
          context,
          CreateFieldCommand.create({
            baseId: table.baseId().toString(),
            tableId,
            field: { type: 'singleLineText', name: `Retirement addition ${round}` },
          })._unsafeUnwrap()
        )
      ).table;
      const pending = (
        await sql<{ id: string }>`SELECT id FROM table_query_remediation_task
        WHERE table_id = ${tableId} AND status = 'queued' AND payload->>'trigger' = 'schema_change'`.execute(
          meta
        )
      ).rows;
      expect(pending).toHaveLength(1);
      if (round === 0) {
        const beforePublication = (await loadTable(tableId)).searchIndex();
        const publicationReads = new Set<object>();
        let raced = false;
        const failing = meta.withPlugin({
          transformQuery(args) {
            const compiled = new PostgresQueryCompiler().compileQuery(args.node, args.queryId);
            if (
              compiled.sql.includes('SELECT search_index') &&
              compiled.sql.includes('FROM table_meta')
            )
              publicationReads.add(args.queryId);
            return args.node;
          },
          async transformResult(args) {
            if (!raced && publicationReads.has(args.queryId)) {
              raced = true;
              await sql`UPDATE table_meta SET version = version + 1 WHERE id = ${tableId}`.execute(
                meta
              );
            }
            return args.result;
          },
        });
        expect((await runMaintenance(pending[0].id, failing)).snapshot().status).toBe('failed');
        expect(raced).toBe(true);
        expect((await loadTable(tableId)).searchIndex()).toEqual(beforePublication);
        expect(
          (
            await sql<{
              count: number;
            }>`SELECT count(*)::int AS count FROM table_query_remediation_task
          WHERE table_id = ${tableId} AND payload->>'trigger' = 'reclaim'`.execute(meta)
          ).rows[0].count
        ).toBe(0);
        table = await loadTable(tableId);
        expectOk(
          await new PostgresTableSearchVectorSchemaMaintenanceScheduler(meta).schedule(context, {
            table,
            reason: 'field_updated',
          })
        );
        pending[0] = (
          await sql<{ id: string }>`SELECT id FROM table_query_remediation_task
          WHERE table_id = ${tableId} AND status = 'queued' AND payload->>'trigger' = 'schema_change'`.execute(
            meta
          )
        ).rows[0];
      }
      expect((await runMaintenance(pending[0].id)).snapshot().status).toBe('succeeded');
      table = await loadTable(tableId);
      if (round === 1) {
        const verifier = expectOk(
          TableQueryRemediationTask.createQueued({
            tableId,
            baseId: table.baseId().toString(),
            kind: 'create_search_access_path',
            now: new Date(),
            payload: {
              trigger: 'admin_search_access_path',
              executionMode: 'manual',
              mode: 'create',
              provider: 'pg_trgm',
              expectedDefinitionKey: table.searchIndex()!.definitionKey,
              validationMode: 'real_ddl',
              allowLargeTableRewrite: true,
            },
          })
        );
        expectOk(await taskRepository.save(context, verifier));
        expect((await runTask(verifier.snapshot().id, 'verifier')).snapshot().status).toBe(
          'succeeded'
        );
      }
      const retired = (
        await sql<{
          candidate_key: string;
          reclaim_disabled_at: Date;
          reclaim_drop_after: Date;
          reclaim_drop_queued_at: Date;
        }>`
        SELECT candidate_key, reclaim_disabled_at, reclaim_drop_after, reclaim_drop_queued_at
        FROM table_query_search_vector_config WHERE table_id = ${tableId} AND status = 'disabled'`.execute(
          meta
        )
      ).rows;
      expect(retired).toHaveLength(round + 1);
      if (round === 0) {
        // A previous-version stale row was never queued; the next publication must include it.
        await sql`DELETE FROM table_query_remediation_task WHERE table_id = ${tableId} AND payload->>'trigger' = 'reclaim'`.execute(
          meta
        );
        await sql`UPDATE table_query_search_vector_config SET status = 'stale', reclaim_disabled_at = NULL,
          reclaim_drop_after = NULL, reclaim_drop_queued_at = NULL WHERE table_id = ${tableId} AND status = 'disabled'`.execute(
          meta
        );
        continue;
      }
      for (const row of retired) {
        expect(row.reclaim_drop_after.getTime() - row.reclaim_disabled_at.getTime()).toBe(
          defaultTableQueryDecisionPolicyConfig.reclaimDisableGraceMs
        );
        expect(row.reclaim_drop_queued_at.getTime()).toBe(row.reclaim_disabled_at.getTime());
        const task = expectOk(
          await taskRepository.findById(
            context,
            reclaimDropTaskId(tableId, row.candidate_key, row.reclaim_drop_after)
          )
        );
        expect(task.snapshot()).toMatchObject({ status: 'queued', attempts: 0 });
      }
      expect(expectOk(await claim())).toBeUndefined();
    }
    const sameKey = table.searchIndex()!;
    await sql
      .raw(
        `DROP INDEX ${quoteIdentifier(physical.schema)}.${quoteIdentifier(sameKey.document!.indexName)}`
      )
      .execute(db);
    expectOk(
      await new PostgresTableSearchVectorSchemaMaintenanceScheduler(meta).schedule(context, {
        table,
        reason: 'field_updated',
      })
    );
    const repair = (
      await sql<{ id: string }>`SELECT id FROM table_query_remediation_task
      WHERE table_id = ${tableId} AND status = 'queued' AND payload->>'trigger' = 'schema_change'`.execute(
        meta
      )
    ).rows[0];
    expect((await runMaintenance(repair.id)).snapshot().status).toBe('succeeded');
    table = await loadTable(tableId);
    expect(table.searchIndex()!.definitionKey).toBe(sameKey.definitionKey);
    expect(
      (
        await sql<{
          count: number;
        }>`SELECT count(*)::int AS count FROM table_query_search_vector_config
      WHERE table_id = ${tableId} AND status = 'disabled'
        AND candidate_key LIKE ${`${sameKey.definitionKey}:retired:%`}`.execute(meta)
      ).rows[0].count
    ).toBe(1);
    await sql`UPDATE table_query_search_vector_config SET reclaim_drop_after = now() - interval '1 second'
      WHERE table_id = ${tableId} AND status = 'disabled'`.execute(meta);
    for (let round = 0; round < 4; round += 1) {
      const task = expectOk(await claim())!;
      expect(task).toBeDefined();
      if (round === 0) {
        // A surviving DDL owner prevents takeover even when its durable heartbeat expired.
        await sql`UPDATE table_query_remediation_task SET status = 'running', attempts = 1,
          locked_at = now() - interval '2 minutes' WHERE id = ${task.snapshot().id}`.execute(meta);
        await sql`UPDATE table_query_search_vector_config SET reclaim_drop_after = now() + interval '1 day'
          WHERE table_id = ${tableId} AND status = 'disabled' AND candidate_key <>
            (SELECT payload->>'scopeKey' FROM table_query_remediation_task WHERE id = ${task.snapshot().id})`.execute(
          meta
        );
        await meta.connection().execute(async (owner) => {
          await sql`SELECT pg_advisory_lock(hashtext('teable.table_query_ops.search_vector'), hashtext(${tableId}))`.execute(
            owner
          );
          try {
            expect(expectOk(await claim())).toBeUndefined();
          } finally {
            await sql`SELECT pg_advisory_unlock(hashtext('teable.table_query_ops.search_vector'), hashtext(${tableId}))`.execute(
              owner
            );
          }
        });
        const resumed = expectOk(await claim())!;
        expect(resumed.snapshot().id).toBe(task.snapshot().id);
        expect(resumed.snapshot().attempts).toBe(1);
        await sql`UPDATE table_query_search_vector_config SET reclaim_drop_after = now() - interval '1 second'
          WHERE table_id = ${tableId} AND status = 'disabled'`.execute(meta);
      }
      // Fresh executor instances simulate restart; no analyzer discovers these tasks.
      expect((await runTask(task.snapshot().id, 'retirement-worker')).snapshot().status).toBe(
        'succeeded'
      );
    }
    const artifacts = (
      await sql<{ columns: number; indexes: number }>`SELECT
      (SELECT count(*)::int FROM pg_attribute WHERE attrelid = to_regclass(${relation}) AND NOT attisdropped
        AND attgenerated = 's' AND attname LIKE '__tqops_search_%') AS columns,
      (SELECT count(*)::int FROM pg_index i JOIN pg_class idx ON idx.oid = i.indexrelid
        JOIN pg_am am ON am.oid = idx.relam WHERE i.indrelid = to_regclass(${relation}) AND am.amname = 'gin') AS indexes`.execute(
        db
      )
    ).rows[0];
    expect(artifacts).toEqual({ columns: 1, indexes: 1 });
    expect((await searchUsingRuntime(table, 'lifecycleunique')).total).toBe(1);
    expect((await loadTable(tableId)).searchIndex()!.definitionKey).toBe(
      table.searchIndex()!.definitionKey
    );
    // Foreground drop and create must coexist with future and then obsolete retirement tasks.
    const retained = (
      await sql<{
        candidate_key: string;
      }>`SELECT candidate_key FROM table_query_search_vector_config
      WHERE table_id = ${tableId} AND status = 'disabled' LIMIT 1`.execute(meta)
    ).rows[0];
    await sql`UPDATE table_query_search_vector_config SET reclaim_drop_after = now() + interval '7 days',
      reclaim_drop_queued_at = now() WHERE table_id = ${tableId} AND candidate_key = ${retained.candidate_key}`.execute(
      meta
    );
    const queuedDrop = expectOk(
      TableQueryRemediationTask.createQueued({
        tableId,
        baseId: table.baseId().toString(),
        kind: 'drop_search_access_path',
        now: new Date(),
        payload: { trigger: 'reclaim', scopeKey: retained.candidate_key },
      })
    );
    expectOk(await taskRepository.save(context, queuedDrop));
    const manualDrop = expectOk(
      TableQueryRemediationTask.createQueued({
        tableId,
        baseId: table.baseId().toString(),
        kind: 'drop_search_access_path',
        now: new Date(),
        payload: { trigger: 'admin_search_access_path', executionMode: 'manual', mode: 'drop' },
      })
    );
    expectOk(await taskRepository.save(context, manualDrop));
    expect((await runTask(manualDrop.snapshot().id, 'foreground')).snapshot().status).toBe(
      'succeeded'
    );
    table = await loadTable(tableId);
    const candidate = (
      await new PostgresTableSearchVectorAdvisor(db).analyze(context, {
        table,
        provider: 'pg_trgm',
        maxRecommendations: 1,
      })
    ).recommendations[0];
    const manualCreate = expectOk(
      TableQueryRemediationTask.createQueued({
        tableId,
        baseId: table.baseId().toString(),
        kind: 'create_search_access_path',
        now: new Date(),
        payload: {
          trigger: 'admin_search_access_path',
          executionMode: 'manual',
          mode: 'create',
          provider: 'pg_trgm',
          expectedDefinitionKey: candidate.candidateKey,
          validationMode: 'real_ddl',
          allowLargeTableRewrite: true,
        },
      })
    );
    expectOk(await taskRepository.save(context, manualCreate));
    expect((await runTask(manualCreate.snapshot().id, 'foreground')).snapshot().status).toBe(
      'succeeded'
    );
  }, 120_000);

  it.each(['search_maintenance', 'all'] as const)(
    'resumes a completed retirement receipt after a crash and temporary route outage at the attempt cap in %s scope',
    async (scope) => {
      let { table } = await createTable();
      const tableId = table.id().toString();
      const meta = testContainer.metaDb as unknown as Kysely<UnknownPostgresDatabase>;
      await createSemanticRecords(
        table,
        fieldByName(table, 'Title').id().toString(),
        fieldByName(table, 'Score').id().toString()
      );
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
      const retired = (await loadTable(tableId)).searchIndex()!;
      table = expectOk(
        await commandBus.execute<CreateFieldCommand, CreateFieldResult>(
          context,
          CreateFieldCommand.create({
            baseId: table.baseId().toString(),
            tableId,
            field: { type: 'singleLineText', name: 'Completed receipt addition' },
          })._unsafeUnwrap()
        )
      ).table;
      const now = new Date();
      const minute = now.getUTCHours() * 60 + now.getUTCMinutes();
      const hhmm = (value: number) =>
        `${Math.floor(value / 60)
          .toString()
          .padStart(2, '0')}:${(value % 60).toString().padStart(2, '0')}`;
      const ddl: string[] = [];
      const executionDb = db.withPlugin({
        transformQuery(args) {
          const compiled = new PostgresQueryCompiler().compileQuery(args.node, args.queryId);
          if (/^(ALTER TABLE|CREATE INDEX|DROP INDEX)\b/.test(compiled.sql))
            ddl.push(compiled.sql);
          return args.node;
        },
        async transformResult(args) {
          return args.result;
        },
      });
      const executor = new PostgresTableQueryRemediationExecutor(
        meta,
        executionDb,
        tableRepository,
        new PostgresTableSearchVectorReconciler(meta, executionDb, {
          windowUtc: `${hhmm((minute + 1410) % 1440)}-${hhmm((minute + 30) % 1440)}`,
          allowUnknownOrLargeRewrite: true,
        })
      );
      const handler = new RunTableQueryRemediationTaskHandler(
        taskRepository,
        executor,
        testContainer.container.resolve(v2TableOpsTokens.decisionPolicy),
        testContainer.container.resolve(v2TableOpsTokens.decisionLogRepository),
        { now: () => new Date() }
      );
      const pending = (
        await sql<{ id: string }>`SELECT id FROM table_query_remediation_task
          WHERE table_id = ${tableId} AND status = 'queued'
            AND payload->>'trigger' = 'schema_change'`.execute(meta)
      ).rows;
      expect(pending).toHaveLength(1);
      expect(
        expectOk(
          await handler.handle(
            context,
            new RunTableQueryRemediationTaskCommand(pending[0].id, false, 'receipt-build-worker')
          )
        ).snapshot().status
      ).toBe('succeeded');
      const serving = (await loadTable(tableId)).searchIndex()!;
      expect(serving.document!.indexName).not.toBe(retired.document!.indexName);
      const beforeSearch = await searchUsingRuntime(table, 'lifecycleunique');
      expect(beforeSearch.total).toBe(1);
      expect(beforeSearch.searchAccessPath).toMatchObject({ used: 'generated_text' });
      await sql`UPDATE table_query_search_vector_config
        SET reclaim_drop_after = now() - interval '1 second'
        WHERE table_id = ${tableId} AND status = 'disabled'`.execute(meta);
      const retirement = (
        await sql<{ id: string; scope_key: string }>`SELECT id, payload->>'scopeKey' AS scope_key
          FROM table_query_remediation_task
          WHERE table_id = ${tableId} AND payload->>'trigger' = 'reclaim'`.execute(meta)
      ).rows;
      expect(retirement).toHaveLength(1);
      const { id: taskId, scope_key: scopeKey } = retirement[0];
      const claim = (workerId: string) =>
        taskRepository.claimNextAccepted(context, {
          scope,
          workerId,
          now: new Date(),
          allowedKinds: ['drop_search_access_path'],
          allowManualIndexExecution: false,
          allowPolicyIndexExecution: false,
        });
      await sql`UPDATE table_query_remediation_task SET attempts = max_attempts - 1
        WHERE id = ${taskId}`.execute(meta);
      const claimed = expectOk(await claim('departed-receipt-worker'))!;
      expect(claimed.snapshot().id).toBe(taskId);
      const departed = expectOk(
        await taskRepository.save(
          context,
          expectOk(claimed.start('departed-receipt-worker', new Date()))
        )
      );
      expect(departed.snapshot()).toMatchObject({ status: 'running', attempts: 3, maxAttempts: 3 });
      ddl.length = 0;
      expectOk(await executor.execute(context, { task: departed, allowManualIndexExecution: false }));
      // Crash after both real DDL and the reclaimed metadata receipt committed,
      // before the task owner can save succeeded.
      expect(ddl.some((statement) => statement.includes('DROP COLUMN'))).toBe(true);
      const completedDdl = [...ddl];
      const physical = expectOk(getTablePhysicalName(table));
      const relation = `${quoteIdentifier(physical.schema)}.${quoteIdentifier(physical.tableName)}`;
      const artifacts = async () =>
        (
          await sql<{ column_present: boolean; index_present: boolean }>`SELECT
            EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass(${relation})
              AND attname = ${retired.document!.generatedColumnName} AND NOT attisdropped) AS column_present,
            to_regclass(${`${quoteIdentifier(physical.schema)}.${quoteIdentifier(retired.document!.indexName)}`}) IS NOT NULL AS index_present`.execute(
            db
          )
        ).rows[0];
      expect(await artifacts()).toEqual({ column_present: false, index_present: false });
      expect(expectOk(await taskRepository.findById(context, taskId)).snapshot()).toMatchObject({
        id: taskId,
        status: 'running',
        attempts: 3,
        maxAttempts: 3,
      });
      const receipt = async () =>
        (
          await sql<{
            status: string;
            serving_snapshot: unknown;
            reclaim_drop_after: Date | null;
            reclaim_drop_queued_at: Date | null;
            last_inspection: unknown;
          }>`SELECT status, serving_snapshot, reclaim_drop_after, reclaim_drop_queued_at, last_inspection
            FROM table_query_search_vector_config
            WHERE table_id = ${tableId} AND candidate_key = ${scopeKey}`.execute(meta)
        ).rows[0];
      const completedReceipt = await receipt();
      expect(completedReceipt).toEqual({
        status: 'disabled',
        serving_snapshot: null,
        reclaim_drop_after: null,
        reclaim_drop_queued_at: null,
        last_inspection: { state: 'disabled', staleReasons: ['reclaimed_after_grace'] },
      });
      await sql`UPDATE table_query_remediation_task
        SET locked_at = now() - interval '2 minutes' WHERE id = ${taskId}`.execute(meta);
      const workerContainer = testContainer.container.createChildContainer();
      workerContainer.registerInstance(v2TableOpsTokens.taskWorkerConfig, {
        enabled: true,
        intervalMs: 60_000,
        workerId: 'unavailable-receipt-worker',
        scope,
        allowedKinds: ['drop_search_access_path'],
        allowManualIndexExecution: false,
        allowPolicyIndexExecution: false,
      });
      workerContainer.registerInstance(v2TableOpsTokens.clock, { now: () => new Date() });
      const execute = vi.fn(
        (executionContext: IExecutionContext, command: RunTableQueryRemediationTaskCommand) =>
          handler.handle(executionContext, command)
      );
      workerContainer.registerInstance(v2CoreTokens.commandBus, { execute } as unknown as ICommandBus);
      const refusal = new TableQueryOpsExecutionUnavailableError(
        new Error('Completed retirement database route is temporarily unavailable')
      );
      const resolveExecution = vi.fn(async (routedTableId: string) => {
        expect(routedTableId).toBe(tableId);
        throw refusal;
      });
      const worker = startTableQueryOpsTaskWorkerIfEnabled(
        workerContainer,
        context,
        resolveExecution
      );
      try {
        await vi.waitFor(async () => {
          const deferred = expectOk(await taskRepository.findById(context, taskId)).snapshot();
          expect(deferred).toMatchObject({
            id: taskId,
            status: 'queued',
            attempts: 3,
            maxAttempts: 3,
            resumeAttempt: true,
            lastError: `Task routing failed: ${String(refusal)}`,
          });
          expect(deferred.lockedAt).toBeUndefined();
          expect(deferred.lockedBy).toBeUndefined();
        }, { timeout: 5_000 });
      } finally {
        worker?.stop();
      }
      expect(resolveExecution).toHaveBeenCalledTimes(1);
      expect(execute).not.toHaveBeenCalled();
      // The completed-receipt SQL branch admits only a genuine resumed task;
      // an ordinary queued task remains ineligible even below the attempt cap.
      await sql`UPDATE table_query_remediation_task SET resume_attempt = false, attempts = 2
        WHERE id = ${taskId}`.execute(meta);
      expect(expectOk(await claim('unstarted-receipt-worker'))).toBeUndefined();
      await sql`UPDATE table_query_remediation_task SET resume_attempt = true, attempts = 3
        WHERE id = ${taskId}`.execute(meta);
      const resumed = expectOk(await claim('restored-receipt-worker'))!;
      expect(resumed.snapshot()).toMatchObject({
        id: taskId,
        status: 'queued',
        attempts: 3,
        resumeAttempt: true,
      });
      const completed = expectOk(
        await handler.handle(
          context,
          new RunTableQueryRemediationTaskCommand(taskId, false, 'restored-receipt-worker')
        )
      ).snapshot();
      expect(completed).toMatchObject({ id: taskId, status: 'succeeded', attempts: 3, maxAttempts: 3 });
      expect(completed.lastError).toBeUndefined();
      expect(ddl).toEqual(completedDdl);
      expect(await receipt()).toEqual(completedReceipt);
      expect(await artifacts()).toEqual({ column_present: false, index_present: false });
      expect((await loadTable(tableId)).searchIndex()).toEqual(serving);
      const afterSearch = await searchUsingRuntime(table, 'lifecycleunique');
      expect(afterSearch.total).toBe(beforeSearch.total);
      expect(afterSearch.searchAccessPath).toEqual(beforeSearch.searchAccessPath);
    },
    120_000
  );

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

  it.each([
    'small',
    'approved',
    'unknown',
    'recovered',
    'exhausted',
    'legacy_refused',
    'legacy_datallowconn',
    'legacy_pool_timeout',
    'outage',
    'selected',
    'changed_scope',
    'disabled',
  ] as const)(
    'maintains %s coverage from field creation with durable window and size gates',
    async (mode) => {
      let { table } = await createTable();
      const title = fieldByName(table, 'Title');
      const score = fieldByName(table, 'Score');
      await createSemanticRecords(table, title.id().toString(), score.id().toString());
      expectOk(
        await reconciler.reconcile(context, {
          table,
          mode: 'create',
          provider: 'pg_trgm',
          validationMode: 'real_ddl',
          requirePlanImprovement: false,
          allowLargeTableRewrite: true,
          ...(mode === 'selected' ? { fieldIds: [title.id().toString()] } : {}),
        })
      );
      const previous = await expectReadyConfig(table);
      const noteId = FieldId.mustGenerate().toString();
      table = expectOk(
        await commandBus.execute<CreateFieldCommand, CreateFieldResult>(
          context,
          CreateFieldCommand.create({
            baseId: table.baseId().toString(),
            tableId: table.id().toString(),
            field: { id: noteId, type: 'singleLineText', name: 'New coverage' },
          })._unsafeUnwrap()
        )
      ).table;
      expectOk(
        await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
          context,
          CreateRecordCommand.create({
            tableId: table.id().toString(),
            fields: { [noteId]: 'newfieldonlyneedle' },
          })._unsafeUnwrap()
        )
      );
      const meta = testContainer.metaDb as unknown as Kysely<UnknownPostgresDatabase>;
      const tasks = await sql<{ id: string }>`SELECT id FROM table_query_remediation_task
        WHERE table_id = ${table.id().toString()} AND payload->>'trigger' = 'schema_change'
          AND status = 'queued'`.execute(meta);
      expect(tasks.rows).toHaveLength(1);
      const taskId = tasks.rows[0].id;
      recoveryTaskIds.push(taskId);
      const run = async (
        options: SearchMaintenanceOptions,
        executionMeta = meta,
        executionData = db
      ) => {
        const handler = new RunTableQueryRemediationTaskHandler(
          taskRepository,
          new PostgresTableQueryRemediationExecutor(
            executionMeta,
            executionData,
            tableRepository,
            new PostgresTableSearchVectorReconciler(executionMeta, executionData, options),
            options.isConnectionUnavailable
          ),
          testContainer.container.resolve(v2TableOpsTokens.decisionPolicy),
          testContainer.container.resolve(v2TableOpsTokens.decisionLogRepository),
          { now: () => new Date() }
        );
        return expectOk(
          await handler.handle(
            context,
            new RunTableQueryRemediationTaskCommand(taskId, false, 'schema-coverage-worker')
          )
        );
      };
      if (mode !== 'selected') {
        for (const windowUtc of [undefined, 'invalid']) {
          expect((await run({ windowUtc })).snapshot()).toMatchObject({
            status: 'queued',
            attempts: 0,
          });
          const state = await sql<{ execution_state: unknown }>`SELECT execution_state
            FROM table_query_remediation_task WHERE id = ${taskId}`.execute(meta);
          expect(state.rows[0].execution_state).toBeNull();
          expect((await searchUsingRuntime(table, 'newfieldonlyneedle')).total).toBe(1);
        }
      }
      const time = (minutes: number) =>
        `${Math.floor(minutes / 60)
          .toString()
          .padStart(2, '0')}:${(minutes % 60).toString().padStart(2, '0')}`;
      const now = new Date();
      const minute = now.getUTCHours() * 60 + now.getUTCMinutes();
      const windowUtc = `${time((minute + 1410) % 1440)}-${time((minute + 30) % 1440)}`;
      if (mode.startsWith('legacy_') || mode === 'outage') {
        const recoveryRepository = new PostgresTableQueryRemediationTaskRepository(
          meta as unknown as Kysely<TableQueryOpsDatabase>
        );
        let scanTime = Date.now();
        const claim = () =>
          recoveryRepository.claimNextAccepted(context, {
            scope: 'search_maintenance',
            workerId: 'schema-coverage-worker',
            now: new Date((scanTime += 31_000)),
            allowedKinds: ['rebuild_search_access_path'],
            allowManualIndexExecution: false,
            allowPolicyIndexExecution: false,
          });
        if (mode.startsWith('legacy_')) {
          await sql`UPDATE table_query_remediation_task SET status = 'failed', attempts = 3,
            last_error = 'permission denied for table' WHERE id = ${taskId}`.execute(meta);
          expect(expectOk(await claim())).toBeUndefined();
          const legacyError =
            mode === 'legacy_refused'
              ? 'connect ECONNREFUSED 127.0.0.1:5432'
              : mode === 'legacy_datallowconn'
                ? 'database "coverage" is not currently accepting connections'
                : 'timeout exceeded when trying to connect';
          await sql`UPDATE table_query_remediation_task SET last_error = ${legacyError}
            WHERE id = ${taskId}`.execute(meta);
          await sql`UPDATE table_query_remediation_task SET payload = jsonb_set(payload,
            '{configKey}', to_jsonb('obsolete'::text)) WHERE id = ${taskId}`.execute(meta);
          expect(expectOk(await claim())).toBeUndefined();
          await sql`UPDATE table_query_remediation_task SET payload = jsonb_set(payload,
            '{configKey}', to_jsonb(${previous.candidate_key}::text)) WHERE id = ${taskId}`.execute(meta);
          expect(expectOk(await claim())).toBeUndefined();
          expect(expectOk(await claim())?.snapshot()).toMatchObject({ id: taskId, attempts: 3 });
        }
        const earlyFailure = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
          code: 'ECONNREFUSED',
        });
        const unavailableMeta = meta.withPlugin({
          transformQuery(args) {
            const compiled = new PostgresQueryCompiler().compileQuery(args.node, args.queryId);
            if (compiled.sql.includes('SELECT version FROM table_meta')) throw earlyFailure;
            return args.node;
          },
          async transformResult(args) {
            return args.result;
          },
        });
        expect(
          (await run({ windowUtc, isConnectionUnavailable: (error) => error === earlyFailure }, unavailableMeta)).snapshot()
        ).toMatchObject({
          status: 'queued',
          attempts: mode.startsWith('legacy_') ? 3 : 0,
          lastError: `Search coverage connection unavailable: ${earlyFailure.message}`,
        });
        for (const failure of [
          Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
            code: 'ECONNREFUSED',
          }),
          Object.assign(new Error('database "coverage" is not currently accepting connections'), {
            code: '55000',
          }),
          new Error('timeout exceeded when trying to connect'),
        ]) {
          const unavailable = db.withPlugin({
            transformQuery() {
              throw failure;
            },
            async transformResult(args) {
              return args.result;
            },
          });
          const waiting = (
            await run({ windowUtc, isConnectionUnavailable: (error) => error === failure }, meta, unavailable)
          ).snapshot();
          expect(waiting).toMatchObject({
            status: 'queued',
            attempts: mode.startsWith('legacy_') ? 3 : 0,
            lastError: `Search coverage connection unavailable: ${failure.message}`,
          });
          expect(waiting.lockedAt).toBeUndefined();
          expect(waiting.lockedBy).toBeUndefined();
        }
      }
      if (mode === 'changed_scope' || mode === 'disabled') {
        table = await loadTable(table.id().toString());
        expectOk(
          await reconciler.reconcile(
            context,
            mode === 'disabled'
              ? { table, mode: 'drop' }
              : {
                  table,
                  mode: 'rebuild',
                  fieldIds: [title.id().toString()],
                  provider: 'pg_trgm',
                  validationMode: 'real_ddl',
                  requirePlanImprovement: false,
                  allowLargeTableRewrite: true,
                }
          )
        );
        expect((await run({ windowUtc })).snapshot()).toMatchObject({
          status: 'failed',
          attempts: 1,
          maxAttempts: 1,
        });
        const status = expectOk(await statusReader.read(context, table.id().toString()));
        if (mode === 'disabled')
          expect(status).toMatchObject({ state: 'disabled', configured: false });
        else {
          expect(status.searchScope).toBe('selected_fields');
          expect(status.coveredFieldIds).toEqual([title.id().toString()]);
        }
        const state = await sql<{ execution_state: unknown }>`SELECT execution_state
          FROM table_query_remediation_task WHERE id = ${taskId}`.execute(meta);
        expect(state.rows[0].execution_state).toBeNull();
        expect((await searchUsingRuntime(table, 'newfieldonlyneedle')).total).toBe(
          mode === 'disabled' ? 1 : 0
        );
        return;
      }
      const physical = expectOk(getTablePhysicalName(table));
      if (mode === 'unknown') {
        // Inject unavailable pg_class statistics at the metadata read boundary. TRUNCATE can report known zero.
        const estimateQueries = new Set<object>();
        const unknownStatistics = db.withPlugin({
          transformQuery(args) {
            const compiled = new PostgresQueryCompiler().compileQuery(args.node, args.queryId);
            if (compiled.sql.includes('c.reltuples AS reltuples'))
              estimateQueries.add(args.queryId);
            return args.node;
          },
          async transformResult(args) {
            return estimateQueries.has(args.queryId)
              ? { ...args.result, rows: [{ reltuples: -1 }] }
              : args.result;
          },
        });
        expect((await run({ windowUtc }, meta, unknownStatistics)).snapshot()).toMatchObject({
          status: 'queued',
          attempts: 0,
        });
      }
      await sql
        .raw(`ANALYZE ${quoteIdentifier(physical.schema)}.${quoteIdentifier(physical.tableName)}`)
        .execute(db);
      if (mode !== 'selected') {
        expect((await run({ windowUtc, knownSmallRowCap: 1 })).snapshot()).toMatchObject({
          status: 'queued',
          attempts: mode.startsWith('legacy_') ? 3 : 0,
        });
      }
      let interrupted: SearchGenerationExecutionState | undefined;
      if (mode === 'recovered' || mode === 'exhausted') {
        const interruptedMeta = meta.withPlugin({
          transformQuery(args) {
            const compiled = new PostgresQueryCompiler().compileQuery(args.node, args.queryId);
            if (
              compiled.parameters.some(
                (value) => typeof value === 'string' && value.includes('"phase":"index_ready"')
              )
            )
              throw new Error('maintenance worker fails after physical index creation');
            return args.node;
          },
          async transformResult(args) {
            return args.result;
          },
        });
        expect((await run({ windowUtc }, interruptedMeta)).snapshot()).toMatchObject({
          status: 'failed',
          attempts: 1,
        });
        interrupted = (
          await sql<{ execution_state: SearchGenerationExecutionState }>`SELECT execution_state
          FROM table_query_remediation_task WHERE id = ${taskId}`.execute(meta)
        ).rows[0].execution_state;
        if (mode === 'exhausted') {
          const claim = () =>
            taskRepository.claimNextAccepted(context, {
              scope: 'search_maintenance',
              workerId: 'schema-coverage-worker',
              now: new Date(),
              allowedKinds: ['rebuild_search_access_path'],
              allowManualIndexExecution: false,
              allowPolicyIndexExecution: false,
            });
          for (const attempts of [1, 2]) {
            for (let wait = 0; wait < 3; wait += 1) {
              expect(expectOk(await claim())?.snapshot().id).toBe(taskId);
              const waiting = (await run({})).snapshot();
              expect(waiting).toMatchObject({ status: 'queued', attempts });
              expect(waiting.lockedAt).toBeUndefined();
              expect(waiting.lockedBy).toBeUndefined();
              const retained = (
                await sql<{
                  execution_state: SearchGenerationExecutionState;
                }>`SELECT execution_state
                  FROM table_query_remediation_task WHERE id = ${taskId}`.execute(meta)
              ).rows[0].execution_state;
              expect(retained).toMatchObject({
                generatedColumnName: interrupted.generatedColumnName,
                indexName: interrupted.indexName,
                targetDefinition: interrupted.targetDefinition,
              });
            }
            expect(expectOk(await claim())?.snapshot().id).toBe(taskId);
            expect((await run({ windowUtc }, interruptedMeta)).snapshot()).toMatchObject({
              status: 'failed',
              attempts: attempts + 1,
            });
          }
          expect(expectOk(await claim())).toBeUndefined();
          const exhausted = expectOk(await taskRepository.findById(context, taskId));
          expect(exhausted.snapshot()).toMatchObject({ status: 'failed', attempts: 3 });
          expect(exhausted.start('schema-coverage-worker', new Date()).isErr()).toBe(true);
          const current = (
            await sql<{
              generated_column_name: string;
              index_name: string;
            }>`SELECT generated_column_name, index_name
              FROM table_query_search_vector_config WHERE table_id = ${table.id().toString()}
                AND candidate_key = ${previous.candidate_key}`.execute(meta)
          ).rows[0];
          expect(current).toEqual({
            generated_column_name: previous.generated_column_name,
            index_name: previous.index_name,
          });
          expect((await searchUsingRuntime(table, 'newfieldonlyneedle')).total).toBe(1);
          return;
        }
        const connectionFailure = Object.assign(new Error('maintenance statement timed out'), {
          code: 'TABLE_QUERY_OPS_STATEMENT_TIMEOUT',
        });
        const unavailable = db.withPlugin({
          transformQuery() {
            throw connectionFailure;
          },
          async transformResult(args) {
            return args.result;
          },
        });
        expect(
          (await run({ windowUtc, isConnectionUnavailable: (error) => error === connectionFailure }, meta, unavailable)).snapshot()
        ).toMatchObject({
          status: 'queued',
          attempts: 1,
          lastError: `Search coverage connection unavailable: ${connectionFailure.message}`,
        });
        const retained = await sql<{ execution_state: SearchGenerationExecutionState }>`SELECT execution_state
          FROM table_query_remediation_task WHERE id = ${taskId}`.execute(meta);
        expect(retained.rows[0].execution_state).toEqual(interrupted);
        expect((await run({})).snapshot()).toMatchObject({ status: 'queued', attempts: 1 });
        const claimed = expectOk(
          await taskRepository.claimNextAccepted(context, {
            scope: 'search_maintenance',
            workerId: 'schema-coverage-worker',
            now: new Date(),
            allowedKinds: ['rebuild_search_access_path'],
            allowManualIndexExecution: false,
            allowPolicyIndexExecution: false,
          })
        );
        expect(claimed?.snapshot().id).toBe(taskId);
      }
      const completed = await run({
        windowUtc: mode === 'selected' ? undefined : windowUtc,
        knownSmallRowCap: mode === 'approved' ? 1 : 5000,
        allowUnknownOrLargeRewrite: mode === 'approved',
      });
      expect(completed.snapshot()).toMatchObject({
        status: 'succeeded',
        attempts: mode.startsWith('legacy_') ? 3 : mode === 'recovered' ? 2 : 1,
      });
      const current = await expectReadyConfig(table);
      expect(asStringArray(current.field_ids).includes(noteId)).toBe(mode !== 'selected');
      expect(current.search_scope).toBe(mode === 'selected' ? 'selected_fields' : 'all_fields');
      expect((await searchUsingRuntime(table, 'newfieldonlyneedle')).total).toBe(
        mode === 'selected' ? 0 : 1
      );
      expect((await searchUsingRuntime(table, 'lifecycleunique')).total).toBe(1);
      const state = await sql<{
        execution_state: SearchGenerationExecutionState;
      }>`SELECT execution_state
        FROM table_query_remediation_task WHERE id = ${taskId}`.execute(meta);
      expect(state.rows[0].execution_state).toMatchObject({
        kind: 'search_generation',
        phase: 'published',
      });
      if (interrupted) {
        expect(state.rows[0].execution_state).toMatchObject({
          generatedColumnName: interrupted.generatedColumnName,
          indexName: interrupted.indexName,
          targetDefinition: interrupted.targetDefinition,
        });
      }
      if (mode === 'selected') {
        expect(current.generated_column_name).toBe(previous.generated_column_name);
        expect(current.index_name).toBe(previous.index_name);
      }
      if (mode !== 'selected') {
        expect(current.index_name).not.toBe(previous.index_name);
        expect(
          (
            await sql<{
              present: boolean;
            }>`SELECT to_regclass(${`${quoteIdentifier(physical.schema)}.${quoteIdentifier(previous.index_name)}`}) IS NOT NULL AS present`.execute(
              db
            )
          ).rows[0].present
        ).toBe(true);
      }
    },
    120_000
  );

  it.each(['prepared', 'published', 'published_with_continuation'] as const)(
    'resumes a %s repair before continuing all-fields coverage expansion',
    async (stop) => {
      let { table } = await createTable();
      const tableId = table.id().toString();
      maintenanceTableIds.push(tableId);
      const title = fieldByName(table, 'Title');
      const score = fieldByName(table, 'Score');
      await createSemanticRecords(table, title.id().toString(), score.id().toString());
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
      const previous = await expectReadyConfig(table);
      const physical = expectOk(getTablePhysicalName(table));
      const tableSql = `${quoteIdentifier(physical.schema)}.${quoteIdentifier(physical.tableName)}`;
      await sql
        .raw(`DROP INDEX ${quoteIdentifier(physical.schema)}.${quoteIdentifier(previous.index_name)}`)
        .execute(db);
      const noteId = FieldId.mustGenerate().toString();
      table = expectOk(
        await commandBus.execute<CreateFieldCommand, CreateFieldResult>(
          context,
          CreateFieldCommand.create({
            baseId: table.baseId().toString(),
            tableId,
            field: { id: noteId, type: 'singleLineText', name: 'Expansion after repair' },
          })._unsafeUnwrap()
        )
      ).table;
      expectOk(
        await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
          context,
          CreateRecordCommand.create({
            tableId,
            fields: { [noteId]: 'repaircontinuationneedle' },
          })._unsafeUnwrap()
        )
      );
      await sql.raw(`ANALYZE ${tableSql}`).execute(db);
      const meta = testContainer.metaDb as unknown as Kysely<UnknownPostgresDatabase>;
      const pending = () =>
        sql<{ id: string; payload: { configKey: string; configScope: string } }>`SELECT id, payload
          FROM table_query_remediation_task WHERE table_id = ${tableId}
            AND payload->>'trigger' = 'schema_change' AND status = 'queued'`.execute(meta);
      const initial = (await pending()).rows;
      expect(initial).toHaveLength(1);
      const taskId = initial[0].id;
      const task = expectOk(await taskRepository.findById(context, taskId));
      const running = expectOk(task.start('departed-repair', new Date()));
      expectOk(await taskRepository.save(context, running));
      const checkpointQueries = new Set<object>();
      const interruptedMeta = meta.withPlugin({
        transformQuery(args) {
          const compiled = new PostgresQueryCompiler().compileQuery(args.node, args.queryId);
          const phase = stop === 'prepared' ? 'prepared' : 'published';
          if (
            compiled.parameters.some(
              (value) => typeof value === 'string' && value.includes(`"phase":"${phase}"`)
            )
          )
            checkpointQueries.add(args.queryId);
          return args.node;
        },
        async transformResult(args) {
          if (checkpointQueries.has(args.queryId))
            throw new Error('repair process stops after durable checkpoint');
          return args.result;
        },
      });
      // No window is configured: repair is allowed, but the new field must wait.
      const interrupted = await new PostgresTableQueryRemediationExecutor(
        interruptedMeta,
        db,
        tableRepository,
        new PostgresTableSearchVectorReconciler(interruptedMeta, db, {})
      ).execute(context, { task: running, allowManualIndexExecution: false });
      expect(interrupted.isErr()).toBe(true);
      const journal = (
        await sql<{ execution_state: SearchGenerationExecutionState }>`SELECT execution_state
          FROM table_query_remediation_task WHERE id = ${taskId}`.execute(meta)
      ).rows[0].execution_state;
      expect(journal.phase).toBe(stop === 'prepared' ? 'prepared' : 'published');
      expect(
        JSON.parse(journal.targetDefinition)
          .fields.map((field: { fieldId: string }) => field.fieldId)
          .sort()
      ).toEqual(asStringArray(previous.field_ids).sort());
      expect((await pending()).rows).toHaveLength(0);
      let existingContinuation: string | undefined;
      if (stop === 'published_with_continuation') {
        const scheduled = expectOk(
          await new PostgresTableSearchVectorSchemaMaintenanceScheduler(meta).schedule(context, {
            table,
            reason: 'field_updated',
          })
        );
        expect(scheduled).toBeDefined();
        existingContinuation = scheduled!.taskId;
      }
      await sql`UPDATE table_query_remediation_task SET locked_at = now() - interval '2 minutes'
        WHERE id = ${taskId}`.execute(meta);
      const claimed = expectOk(
        await taskRepository.claimNextAccepted(context, {
          scope: 'search_maintenance',
          workerId: 'resumed-repair',
          now: new Date(),
          allowedKinds: ['rebuild_search_access_path'],
          allowManualIndexExecution: false,
          allowPolicyIndexExecution: false,
        })
      );
      expect(claimed?.snapshot().id).toBe(taskId);
      const run = async (id: string, options: SearchMaintenanceOptions, workerId: string) =>
        expectOk(
          await new RunTableQueryRemediationTaskHandler(
            taskRepository,
            new PostgresTableQueryRemediationExecutor(
              meta,
              db,
              tableRepository,
              new PostgresTableSearchVectorReconciler(meta, db, options)
            ),
            testContainer.container.resolve(v2TableOpsTokens.decisionPolicy),
            testContainer.container.resolve(v2TableOpsTokens.decisionLogRepository),
            { now: () => new Date() }
          ).handle(context, new RunTableQueryRemediationTaskCommand(id, false, workerId))
        );
      expect((await run(taskId, {}, 'resumed-repair')).snapshot().status).toBe('succeeded');
      const resumedJournal = (
        await sql<{ execution_state: SearchGenerationExecutionState }>`SELECT execution_state
          FROM table_query_remediation_task WHERE id = ${taskId}`.execute(meta)
      ).rows[0].execution_state;
      expect(resumedJournal).toMatchObject({
        targetDefinition: journal.targetDefinition,
        generatedColumnName: journal.generatedColumnName,
        indexName: journal.indexName,
        phase: 'published',
      });
      const repaired = (
        await sql<SearchVectorConfig>`SELECT * FROM table_query_search_vector_config
          WHERE table_id = ${tableId} AND status = 'rebuild_pending'`.execute(meta)
      ).rows;
      expect(repaired).toHaveLength(1);
      expect(repaired[0]).toMatchObject({
        candidate_key: previous.candidate_key,
        generated_column_name: journal.generatedColumnName,
        index_name: journal.indexName,
        search_scope: 'all_fields',
      });
      expect(asStringArray(repaired[0].field_ids).sort()).toEqual(
        asStringArray(previous.field_ids).sort()
      );
      expect(await generationPresence(table, journal)).toEqual({
        column_present: true,
        index_present: true,
      });
      const continuations = (await pending()).rows;
      expect(continuations).toHaveLength(1);
      if (existingContinuation) expect(continuations[0].id).toBe(existingContinuation);
      expect(continuations[0].payload).toMatchObject({
        configKey: previous.candidate_key,
        configScope: 'all_fields',
      });
      const continuationId = continuations[0].id;
      expect((await run(continuationId, {}, 'expansion-worker')).snapshot()).toMatchObject({
        status: 'queued',
        attempts: 0,
      });
      const continuationState = (
        await sql<{ execution_state: unknown }>`SELECT execution_state
          FROM table_query_remediation_task WHERE id = ${continuationId}`.execute(meta)
      ).rows[0].execution_state;
      expect(continuationState).toBeNull();
      const now = new Date();
      const minute = now.getUTCHours() * 60 + now.getUTCMinutes();
      const time = (n: number) =>
        `${Math.floor(n / 60)
          .toString()
          .padStart(2, '0')}:${(n % 60).toString().padStart(2, '0')}`;
      const windowUtc = `${time((minute + 1410) % 1440)}-${time((minute + 30) % 1440)}`;
      expect(
        (await run(continuationId, { windowUtc }, 'expansion-worker')).snapshot().status
      ).toBe('succeeded');
      const expanded = await expectReadyConfig(table);
      expect(expanded.search_scope).toBe('all_fields');
      expect(asStringArray(expanded.field_ids).sort()).toEqual(
        [...asStringArray(previous.field_ids), noteId].sort()
      );
      expect((await pending()).rows).toHaveLength(0);
      expect((await searchUsingRuntime(table, 'repaircontinuationneedle')).total).toBe(1);
      expect((await searchUsingRuntime(table, 'lifecycleunique')).total).toBe(1);
    },
    120_000
  );

  it.each([
    'before_journal',
    'column_ready',
    'published',
    'window_closed',
    'relaxed_cap',
    'withdrawn_approval',
  ] as const)(
    'recovers %s maintenance without losing capacity, authorization or its physical generation',
    async (stop) => {
      let { table } = await createTable();
      maintenanceTableIds.push(table.id().toString());
      const title = fieldByName(table, 'Title');
      const score = fieldByName(table, 'Score');
      await createSemanticRecords(table, title.id().toString(), score.id().toString());
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
      const noteId = FieldId.mustGenerate().toString();
      table = expectOk(
        await commandBus.execute<CreateFieldCommand, CreateFieldResult>(
          context,
          CreateFieldCommand.create({
            baseId: table.baseId().toString(),
            tableId: table.id().toString(),
            field: { id: noteId, type: 'singleLineText', name: 'Recoverable coverage' },
          })._unsafeUnwrap()
        )
      ).table;
      expectOk(
        await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
          context,
          CreateRecordCommand.create({
            tableId: table.id().toString(),
            fields: { [noteId]: 'recoveryonlyneedle' },
          })._unsafeUnwrap()
        )
      );
      const physical = expectOk(getTablePhysicalName(table));
      const tableSql = `${quoteIdentifier(physical.schema)}.${quoteIdentifier(physical.tableName)}`;
      await sql.raw(`ANALYZE ${tableSql}`).execute(db);
      const meta = testContainer.metaDb as unknown as Kysely<UnknownPostgresDatabase>;
      const taskId = (
        await sql<{ id: string }>`SELECT id FROM table_query_remediation_task
        WHERE table_id = ${table.id().toString()} AND status = 'queued' AND payload->>'trigger' = 'schema_change'`.execute(
          meta
        )
      ).rows[0].id;
      const task = expectOk(await taskRepository.findById(context, taskId));
      expectOk(
        await taskRepository.save(context, expectOk(task.start('departed-maintenance', new Date())))
      );
      await sql`UPDATE table_query_remediation_task SET attempts = max_attempts WHERE id = ${taskId}`.execute(
        meta
      );
      const running = expectOk(await taskRepository.findById(context, taskId));
      const now = new Date();
      const minute = now.getUTCHours() * 60 + now.getUTCMinutes();
      const time = (n: number) =>
        `${Math.floor(n / 60)
          .toString()
          .padStart(2, '0')}:${(n % 60).toString().padStart(2, '0')}`;
      const windowUtc = `${time((minute + 1410) % 1440)}-${time((minute + 30) % 1440)}`;
      const options = {
        windowUtc: windowUtc as string | undefined,
        knownSmallRowCap: stop === 'withdrawn_approval' ? 1 : 5,
        allowUnknownOrLargeRewrite: stop === 'withdrawn_approval',
      };
      const checkpointQueries = new Set<object>();
      const interruptedMeta = meta.withPlugin({
        transformQuery(args) {
          const compiled = new PostgresQueryCompiler().compileQuery(args.node, args.queryId);
          const phase =
            stop === 'before_journal'
              ? 'prepared'
              : stop === 'published'
                ? 'published'
                : 'column_ready';
          if (
            compiled.parameters.some(
              (value) => typeof value === 'string' && value.includes(`"phase":"${phase}"`)
            )
          ) {
            if (stop !== 'window_closed')
              throw new Error('maintenance process stops at checkpoint');
            checkpointQueries.add(args.queryId);
          }
          return args.node;
        },
        async transformResult(args) {
          if (checkpointQueries.has(args.queryId)) options.windowUtc = undefined;
          return args.result;
        },
      });
      const interrupted = await new PostgresTableQueryRemediationExecutor(
        interruptedMeta,
        db,
        tableRepository,
        new PostgresTableSearchVectorReconciler(interruptedMeta, db, options)
      ).execute(context, {
        task: running,
        allowManualIndexExecution: false,
      });
      expect(interrupted.isErr()).toBe(true);
      expect(expectOk(await taskRepository.findById(context, taskId)).snapshot()).toMatchObject({
        status: 'running',
        attempts: 3,
      });
      const journal = (
        await sql<{ execution_state: SearchGenerationExecutionState | null }>`SELECT execution_state
        FROM table_query_remediation_task WHERE id = ${taskId}`.execute(meta)
      ).rows[0].execution_state;
      if (stop === 'before_journal') expect(journal).toBeNull();
      else {
        expect(journal).toMatchObject({
          maintenanceAuthorization: {
            knownSmallRowCap: stop === 'withdrawn_approval' ? 1 : 5,
            allowUnknownOrLargeRewrite: stop === 'withdrawn_approval',
          },
        });
        if (stop !== 'published')
          expect(
            (
              await sql<{
                present: boolean;
              }>`SELECT to_regclass(${`${quoteIdentifier(physical.schema)}.${quoteIdentifier(journal!.indexName)}`}) IS NOT NULL AS present`.execute(
                db
              )
            ).rows[0].present
          ).toBe(false);
      }
      if (stop === 'relaxed_cap') await insertPlannerFiller(table, title, score, 10);
      await sql`UPDATE table_query_remediation_task SET locked_at = now() - interval '2 minutes' WHERE id = ${taskId}`.execute(
        meta
      );
      const departed = expectOk(await taskRepository.findById(context, taskId));
      const claimed = expectOk(
        await taskRepository.claimNextAccepted(context, {
          scope: 'search_maintenance',
          workerId: 'replacement-maintenance',
          now: new Date(),
          allowedKinds: ['rebuild_search_access_path'],
          allowManualIndexExecution: false,
          allowPolicyIndexExecution: false,
        })
      );
      expect(claimed?.snapshot().id).toBe(taskId);
      const outsideData = db.withPlugin({
        transformQuery(args) {
          const compiled = new PostgresQueryCompiler().compileQuery(args.node, args.queryId);
          if (
            /EXPLAIN|ADD COLUMN|CREATE (?:INDEX|OR REPLACE FUNCTION)/.test(compiled.sql) ||
            compiled.sql.includes(`FROM ${tableSql}`)
          )
            throw new Error('Recovery started new sampling or DDL without permission');
          return args.node;
        },
        async transformResult(args) {
          return args.result;
        },
      });
      const recoveryOptions: SearchMaintenanceOptions =
        stop === 'relaxed_cap'
          ? { windowUtc, knownSmallRowCap: 5000, allowUnknownOrLargeRewrite: true }
          : stop === 'withdrawn_approval'
            ? { windowUtc, knownSmallRowCap: 1, allowUnknownOrLargeRewrite: false }
            : stop === 'published'
              ? { knownSmallRowCap: 1, allowUnknownOrLargeRewrite: false }
              : {};
      const handler = new RunTableQueryRemediationTaskHandler(
        taskRepository,
        new PostgresTableQueryRemediationExecutor(
          meta,
          outsideData,
          tableRepository,
          new PostgresTableSearchVectorReconciler(meta, outsideData, recoveryOptions)
        ),
        testContainer.container.resolve(v2TableOpsTokens.decisionPolicy),
        testContainer.container.resolve(v2TableOpsTokens.decisionLogRepository),
        { now: () => new Date() }
      );
      const recovered = expectOk(
        await handler.handle(
          context,
          new RunTableQueryRemediationTaskCommand(taskId, false, 'replacement-maintenance')
        )
      );
      expect(recovered.snapshot()).toMatchObject({
        status: stop === 'published' ? 'succeeded' : 'queued',
        attempts: 3,
      });
      expect(recovered.snapshot().lockedBy).toBeUndefined();
      expect(recovered.snapshot().lockedAt).toBeUndefined();
      expect(
        (
          await taskRepository.save(
            context,
            expectOk(departed.succeed({ stale: true }, new Date()))
          )
        ).isErr()
      ).toBe(true);
      const retained = (
        await sql<{ execution_state: SearchGenerationExecutionState | null }>`SELECT execution_state
        FROM table_query_remediation_task WHERE id = ${taskId}`.execute(meta)
      ).rows[0].execution_state;
      if (journal)
        expect(retained).toMatchObject({
          generatedColumnName: journal.generatedColumnName,
          indexName: journal.indexName,
          targetDefinition: journal.targetDefinition,
          maintenanceAuthorization: journal.maintenanceAuthorization,
        });
      const other = await createTable();
      const candidateIds: string[] = [];
      for (const candidate of [table, other.table]) {
        const queued = expectOk(
          TableQueryRemediationTask.createQueued({
            tableId: candidate.id().toString(),
            baseId: candidate.baseId().toString(),
            kind: 'create_filter_index',
            payload: { trigger: 'admin_index' },
            now: new Date(),
          })
        );
        candidateIds.push(queued.snapshot().id);
        recoveryTaskIds.push(queued.snapshot().id);
        expectOk(await taskRepository.saveIfAbsent(context, queued));
      }
      const claims = [];
      for (const workerId of ['capacity-one', 'capacity-two'])
        claims.push(
          expectOk(
            await taskRepository.claimNextAccepted(context, {
              scope: 'all',
              workerId,
              now: new Date(),
              allowedKinds: ['create_filter_index'],
              allowManualIndexExecution: false,
              allowPolicyIndexExecution: false,
            })
          )
        );
      expect(claims.filter(Boolean)).toHaveLength(2);
      expect(new Set(claims.map((value) => value?.snapshot().tableId)).size).toBe(2);
      await sql`DELETE FROM table_query_remediation_task WHERE id = ANY(${candidateIds}::text[])`.execute(
        meta
      );
      if (stop !== 'published' && stop !== 'relaxed_cap' && stop !== 'withdrawn_approval') {
        const resumed = expectOk(
          await taskRepository.claimNextAccepted(context, {
            scope: 'search_maintenance',
            workerId: 'final-maintenance',
            now: new Date(),
            allowedKinds: ['rebuild_search_access_path'],
            allowManualIndexExecution: false,
            allowPolicyIndexExecution: false,
          })
        );
        expect(resumed?.snapshot().id).toBe(taskId);
        const finalHandler = new RunTableQueryRemediationTaskHandler(
          taskRepository,
          new PostgresTableQueryRemediationExecutor(
            meta,
            db,
            tableRepository,
            new PostgresTableSearchVectorReconciler(meta, db, { windowUtc, knownSmallRowCap: 5 })
          ),
          testContainer.container.resolve(v2TableOpsTokens.decisionPolicy),
          testContainer.container.resolve(v2TableOpsTokens.decisionLogRepository),
          { now: () => new Date() }
        );
        expect(
          expectOk(
            await finalHandler.handle(
              context,
              new RunTableQueryRemediationTaskCommand(taskId, false, 'final-maintenance')
            )
          ).snapshot()
        ).toMatchObject({ status: 'succeeded', attempts: 3 });
      }
      if (stop !== 'relaxed_cap' && stop !== 'withdrawn_approval') {
        expect(asStringArray((await expectReadyConfig(table)).field_ids)).toContain(noteId);
        expect((await searchUsingRuntime(table, 'recoveryonlyneedle')).total).toBe(1);
      }
    },
    120_000
  );

  it.each(['queued', 'frozen'] as const)(
    'fences a %s all-fields task after native selected scope keeps the same membership and hash',
    async (phase) => {
      let { table } = await createTable();
      const title = fieldByName(table, 'Title');
      const score = fieldByName(table, 'Score');
      await createSemanticRecords(table, title.id().toString(), score.id().toString());
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
      const previous = await expectReadyConfig(table);
      const meta = testContainer.metaDb as unknown as Kysely<UnknownPostgresDatabase>;
      const scheduled = expectOk(
        await new PostgresTableSearchVectorSchemaMaintenanceScheduler(meta).schedule(context, {
          table,
          reason: 'field_updated',
        })
      )!;
      const preparedQueries = new Set<object>();
      const interruptedMeta = meta.withPlugin({
        transformQuery(args) {
          const compiled = new PostgresQueryCompiler().compileQuery(args.node, args.queryId);
          if (
            compiled.parameters.some(
              (value) => typeof value === 'string' && value.includes('"phase":"prepared"')
            )
          )
            preparedQueries.add(args.queryId);
          return args.node;
        },
        async transformResult(args) {
          if (preparedQueries.has(args.queryId))
            throw new Error('maintenance stops after freezing its existing generation');
          return args.result;
        },
      });
      if (phase === 'frozen') {
        const handler = new RunTableQueryRemediationTaskHandler(
          taskRepository,
          new PostgresTableQueryRemediationExecutor(
            interruptedMeta,
            db,
            tableRepository,
            new PostgresTableSearchVectorReconciler(interruptedMeta, db)
          ),
          testContainer.container.resolve(v2TableOpsTokens.decisionPolicy),
          testContainer.container.resolve(v2TableOpsTokens.decisionLogRepository),
          { now: () => new Date() }
        );
        expect(
          expectOk(
            await handler.handle(
              context,
              new RunTableQueryRemediationTaskCommand(scheduled.taskId, false, 'scope-worker')
            )
          ).snapshot()
        ).toMatchObject({ status: 'failed', attempts: 1, maxAttempts: 3 });
        const state = (
          await sql<{ execution_state: SearchGenerationExecutionState }>`SELECT execution_state
            FROM table_query_remediation_task WHERE id = ${scheduled.taskId}`.execute(meta)
        ).rows[0].execution_state;
        expect(JSON.parse(state.targetDefinition).searchScope).toBe('all_fields');
      }
      table = await loadTable(table.id().toString());
      expectOk(
        await reconciler.reconcile(context, {
          table,
          mode: 'create',
          fieldIds: asStringArray(previous.field_ids),
          provider: 'pg_trgm',
          validationMode: 'real_ddl',
          requirePlanImprovement: false,
          allowLargeTableRewrite: true,
        })
      );
      const selected = await expectReadyConfig(table);
      expect(selected).toMatchObject({
        candidate_key: previous.candidate_key,
        search_scope: 'selected_fields',
        generated_column_name: previous.generated_column_name,
        index_name: previous.index_name,
      });
      expect(asStringArray(selected.field_ids)).toEqual(asStringArray(previous.field_ids));
      const failed = await runTask(scheduled.taskId, 'scope-worker');
      const attempts = phase === 'frozen' ? 2 : 1;
      expect(failed.snapshot()).toMatchObject({
        status: 'failed',
        attempts,
        maxAttempts: attempts,
      });
      expect(failed.snapshot().lastError).not.toContain('cleanup failed');
      expect(failed.start('again', new Date()).isErr()).toBe(true);
      expect(await expectReadyConfig(table)).toEqual(selected);
      expect((await searchUsingRuntime(table, 'lifecycleunique')).total).toBe(1);
      expect(expectOk(await statusReader.read(context, table.id().toString())).searchScope).toBe(
        'selected_fields'
      );
    },
    120_000
  );

  it.each(['window_scope', 'size_schema'] as const)(
    'retains the last-attempt partial generation on %s deferral and cleans it only when obsolete',
    async (stop) => {
      let { table } = await createTable();
      const title = fieldByName(table, 'Title');
      const score = fieldByName(table, 'Score');
      await createSemanticRecords(table, title.id().toString(), score.id().toString());
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
      const previous = await expectReadyConfig(table);
      const noteId = FieldId.mustGenerate().toString();
      table = expectOk(
        await commandBus.execute<CreateFieldCommand, CreateFieldResult>(
          context,
          expectOk(
            CreateFieldCommand.create({
              baseId: table.baseId().toString(),
              tableId: table.id().toString(),
              field: { id: noteId, type: 'singleLineText', name: 'Partial generation' },
            })
          )
        )
      ).table;
      const physical = expectOk(getTablePhysicalName(table));
      await sql
        .raw(`ANALYZE ${quoteIdentifier(physical.schema)}.${quoteIdentifier(physical.tableName)}`)
        .execute(db);
      const meta = testContainer.metaDb as unknown as Kysely<UnknownPostgresDatabase>;
      const taskId = (
        await sql<{ id: string }>`SELECT id FROM table_query_remediation_task
          WHERE table_id = ${table.id().toString()} AND status = 'queued'
            AND payload->>'trigger' = 'schema_change'`.execute(meta)
      ).rows[0].id;
      const task = expectOk(await taskRepository.findById(context, taskId));
      expectOk(
        await taskRepository.save(context, expectOk(task.start('partial-worker', new Date())))
      );
      await sql`UPDATE table_query_remediation_task SET attempts = max_attempts
        WHERE id = ${taskId}`.execute(meta);
      const now = new Date();
      const minute = now.getUTCHours() * 60 + now.getUTCMinutes();
      const time = (n: number) =>
        `${Math.floor(n / 60)
          .toString()
          .padStart(2, '0')}:${(n % 60).toString().padStart(2, '0')}`;
      const options: { windowUtc?: string; knownSmallRowCap: number } = {
        windowUtc: `${time((minute + 1410) % 1440)}-${time((minute + 30) % 1440)}`,
        knownSmallRowCap: 5000,
      };
      const checkpoints = new Set<object>();
      const interruptedMeta = meta.withPlugin({
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
          if (checkpoints.has(args.queryId)) {
            if (stop === 'window_scope') options.windowUtc = undefined;
            else options.knownSmallRowCap = 1;
          }
          return args.result;
        },
      });
      const handler = new RunTableQueryRemediationTaskHandler(
        taskRepository,
        new PostgresTableQueryRemediationExecutor(
          interruptedMeta,
          db,
          tableRepository,
          new PostgresTableSearchVectorReconciler(interruptedMeta, db, options)
        ),
        testContainer.container.resolve(v2TableOpsTokens.decisionPolicy),
        testContainer.container.resolve(v2TableOpsTokens.decisionLogRepository),
        { now: () => new Date() }
      );
      const deferred = expectOk(
        await handler.handle(
          context,
          new RunTableQueryRemediationTaskCommand(taskId, false, 'partial-worker')
        )
      );
      expect(deferred.snapshot()).toMatchObject({
        status: 'queued',
        attempts: 3,
        maxAttempts: 3,
        resumeAttempt: true,
      });
      expect(deferred.snapshot().lockedAt).toBeUndefined();
      expect(deferred.snapshot().lockedBy).toBeUndefined();
      const journal = (
        await sql<{ execution_state: SearchGenerationExecutionState }>`SELECT execution_state
          FROM table_query_remediation_task WHERE id = ${taskId}`.execute(meta)
      ).rows[0].execution_state;
      expect(journal.phase).toBe('column_ready');
      expect(await generationPresence(table, journal)).toEqual({
        column_present: true,
        index_present: false,
      });
      if (stop === 'window_scope') {
        table = await loadTable(table.id().toString());
        expectOk(
          await reconciler.reconcile(context, {
            table,
            mode: 'create',
            fieldIds: asStringArray(previous.field_ids),
            provider: 'pg_trgm',
            validationMode: 'real_ddl',
            requirePlanImprovement: false,
            allowLargeTableRewrite: true,
          })
        );
      } else {
        await sql`UPDATE table_meta SET version = version + 1
          WHERE id = ${table.id().toString()}`.execute(meta);
      }
      const beforeCleanup = (
        await sql`SELECT candidate_key, search_scope, status, serving_snapshot
          FROM table_query_search_vector_config WHERE table_id = ${table.id().toString()}
            AND candidate_key = ${previous.candidate_key}`.execute(meta)
      ).rows;
      const failed = await runTask(taskId, 'partial-worker');
      expect(failed.snapshot()).toMatchObject({ status: 'failed', attempts: 3, maxAttempts: 3 });
      expect(failed.snapshot().lastError).not.toContain('cleanup failed');
      expect(await generationPresence(table, journal)).toEqual({
        column_present: false,
        index_present: false,
      });
      expect(
        (
          await sql`SELECT candidate_key, search_scope, status, serving_snapshot
            FROM table_query_search_vector_config WHERE table_id = ${table.id().toString()}
              AND candidate_key = ${previous.candidate_key}`.execute(meta)
        ).rows
      ).toEqual(beforeCleanup);
      expect((await searchUsingRuntime(table, 'lifecycleunique')).total).toBe(1);
      expect(failed.start('again', new Date()).isErr()).toBe(true);
    },
    120_000
  );

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
        state: 'rebuild_pending',
        configured: true,
        coveredFieldCount: 2,
      }
    );
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
    await runPendingMaintenance('queued');
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
      document: { provider: 'pg_bigm', ready: true },
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
      document: { provider: 'pg_trgm', ready: true },
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
      document: { ready: false },
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
    expect(drifted).toMatchObject({ kind: 'generated_text', document: { ready: true } });
    expect(
      drifted?.kind === 'generated_text'
        ? (drifted.document?.coveredFieldIds ?? []).map((fieldId) => fieldId.toString())
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
          if (compiled.sql.includes('published AS (')) publications.add(args.queryId);
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

  it.each([
    ['mixed', 'validated'],
    ['mixed', 'publication'],
    ['residual_only', 'index_ready'],
    ['residual_only', 'publication'],
    ['residual_only', 'foreign_index'],
    ['mixed', 'terminal_version'],
    ['residual_only', 'terminal_version'],
    ['mixed', 'terminal_absent_race'],
    ['residual_only', 'terminal_absent_race'],
    ['residual_only', 'terminal_foreign_index'],
    ['mixed', 'abandoned'],
    ['residual_only', 'abandoned'],
  ] as const)(
    'recovers a task-backed %s generation after %s with physical ownership and publication fencing',
    async (bundle, crash) => {
      const { table } = await createTable();
      const title = fieldByName(table, 'Title');
      const score = fieldByName(table, 'Score');
      await createSemanticRecords(table, title.id().toString(), score.id().toString());
      const physical = expectOk(getTablePhysicalName(table));
      const tableSql = `${quoteIdentifier(physical.schema)}.${quoteIdentifier(physical.tableName)}`;
      const scoreColumn = quoteIdentifier(expectOk(expectOk(score.dbFieldName()).value()));
      await sql.raw(`ALTER TABLE ${tableSql} ADD COLUMN residual_seed text`).execute(db);
      await sql
        .raw(`UPDATE ${tableSql} SET residual_seed = 'recoverable-' || ${scoreColumn}`)
        .execute(db);
      await sql
        .raw(`ALTER TABLE ${tableSql} DROP COLUMN ${scoreColumn},
      ADD COLUMN ${scoreColumn} text GENERATED ALWAYS AS (residual_seed) STORED`)
        .execute(db);
      await sql.raw(`ANALYZE ${tableSql}`).execute(db);
      const fieldIds = bundle === 'residual_only' ? [score.id().toString()] : undefined;
      const original = expectOk(
        await reconciler.reconcile(context, {
          table,
          mode: 'create',
          provider: 'pg_trgm',
          fieldIds,
          validationMode: 'real_ddl',
          requirePlanImprovement: false,
          allowLargeTableRewrite: true,
        })
      );
      const originalSnapshot = (await loadTable(table.id().toString())).searchIndex()!;
      expect(originalSnapshot.residual?.ready).toBe(true);
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
            provider: 'pg_trgm',
            ...(fieldIds ? { fieldIds } : {}),
            expectedDefinitionKey: original.definitionKey,
            validationMode: 'real_ddl',
            requirePlanImprovement: false,
            allowLargeTableRewrite: true,
          },
        })
      );
      recoveryTaskIds.push(task.snapshot().id);
      expectOk(await taskRepository.save(context, task));
      const departed = expectOk(
        await taskRepository.save(context, expectOk(task.start('departed-residual', new Date())))
      );
      const statements: string[] = [];
      const publications = new Set<unknown>();
      let armed = true;
      const residualInspections = new Set<unknown>();
      let afterResidualInspection: (() => Promise<void>) | undefined;
      let residualInspectionSql: string | undefined;
      const reclamationLocks = new Set<unknown>();
      let reclamationLocked = false;
      let residualAbsenceObserved = false;
      const observedMeta = meta.withPlugin({
        transformQuery(args) {
          const query = new PostgresQueryCompiler().compileQuery(args.node, args.queryId);
          if (query.sql.includes('published AS (')) publications.add(args.queryId);
          const state = query.parameters.find(
            (value) => typeof value === 'string' && value.includes('"kind":"search_generation"')
          );
          const target =
            crash === 'foreign_index' || crash.startsWith('terminal_') || crash === 'abandoned'
              ? 'validated'
              : crash;
          if (armed && typeof state === 'string' && JSON.parse(state).phase === target) {
            armed = false;
            throw new Error('residual worker interrupted');
          }
          return args.node;
        },
        async transformResult(args) {
          if (armed && crash === 'publication' && publications.has(args.queryId)) {
            armed = false;
            throw new Error('residual worker interrupted after publication');
          }
          return args.result;
        },
      }) as unknown as Kysely<UnknownPostgresDatabase>;
      const data = db.withPlugin({
        transformQuery(args) {
          const compiled = new PostgresQueryCompiler().compileQuery(args.node, args.queryId);
          statements.push(compiled.sql);
          if (
            afterResidualInspection &&
            compiled.sql === `LOCK TABLE ${tableSql} IN ACCESS EXCLUSIVE MODE`
          )
            reclamationLocks.add(args.queryId);
          if (
            compiled.sql.includes('AS foreign_dependents') &&
            compiled.sql.includes('LEFT JOIN pg_index') &&
            compiled.parameters.includes(residualInspectionSql)
          )
            residualInspections.add(args.queryId);
          return args.node;
        },
        async transformResult(args) {
          if (reclamationLocks.has(args.queryId)) reclamationLocked = true;
          if (
            afterResidualInspection &&
            reclamationLocked &&
            residualInspections.has(args.queryId)
          ) {
            expect(args.result.rows).toEqual([]);
            residualAbsenceObserved = true;
            const intervene = afterResidualInspection;
            afterResidualInspection = undefined;
            await intervene();
          }
          return args.result;
        },
      });
      const executor = new PostgresTableQueryRemediationExecutor(
        observedMeta,
        data,
        tableRepository,
        new PostgresTableSearchVectorReconciler(observedMeta, data)
      );
      const failed = await executor.execute(context, {
        task: departed,
        allowManualIndexExecution: false,
      });
      expect(failed.isErr() ? failed.error : undefined).toMatchObject({
        message: expect.stringContaining('residual worker interrupted'),
      });
      expect(armed).toBe(false);
      const journal = (
        await meta
          .selectFrom('table_query_remediation_task')
          .select('execution_state')
          .where('id', '=', task.snapshot().id)
          .executeTakeFirstOrThrow()
      ).execution_state as SearchGenerationExecutionState;
      expect(journal.residualIndexName).toBeDefined();
      expect(journal.generatedColumnName === undefined).toBe(bundle === 'residual_only');
      const residualSql = `${quoteIdentifier(physical.schema)}.${quoteIdentifier(journal.residualIndexName!)}`;
      residualInspectionSql = residualSql;
      const physicalBefore = await sql<{
        oid: string;
        expression: string;
      }>`SELECT i.indexrelid::text AS oid,
      pg_get_expr(i.indexprs, i.indrelid) AS expression FROM pg_index i WHERE i.indexrelid = to_regclass(${residualSql})`.execute(
        db
      );
      expect(physicalBefore.rows).toHaveLength(1);
      if (crash === 'validated')
        await sql`UPDATE pg_index SET indisvalid = false WHERE indexrelid = to_regclass(${residualSql})`.execute(
          db
        );
      let foreignOid: string | undefined;
      if (crash === 'foreign_index' || crash === 'terminal_foreign_index') {
        const foreignSql = `${quoteIdentifier(physical.schema)}.${quoteIdentifier(`residual_foreign_${table.id().toString()}`)}`;
        await sql
          .raw(`CREATE TABLE ${foreignSql} (LIKE ${tableSql} INCLUDING GENERATED)`)
          .execute(db);
        await sql.raw(`DROP INDEX ${residualSql}`).execute(db);
        await sql
          .raw(`CREATE INDEX ${quoteIdentifier(journal.residualIndexName!)} ON ${foreignSql}
        USING GIN ((${physicalBefore.rows[0]!.expression}) gin_trgm_ops)`)
          .execute(db);
        await sql`UPDATE pg_index SET indisvalid = false WHERE indexrelid = to_regclass(${residualSql})`.execute(
          db
        );
        foreignOid = (
          await sql<{ oid: string }>`SELECT to_regclass(${residualSql})::oid::text AS oid`.execute(
            db
          )
        ).rows[0]!.oid;
      }
      if (crash === 'terminal_absent_race') {
        await sql.raw(`DROP INDEX ${residualSql}`).execute(db);
        const other = (await createTable()).table;
        const otherPhysical = expectOk(getTablePhysicalName(other));
        const otherSql = `${quoteIdentifier(otherPhysical.schema)}.${quoteIdentifier(otherPhysical.tableName)}`;
        afterResidualInspection = async () => {
          await sql
            .raw(
              `CREATE INDEX ${quoteIdentifier(journal.residualIndexName!)} ON ${otherSql} (__id)`
            )
            .execute(db);
          foreignOid = (
            await sql<{
              oid: string;
            }>`SELECT to_regclass(${residualSql})::oid::text AS oid`.execute(db)
          ).rows[0]!.oid;
        };
      }
      if (crash === 'abandoned') {
        await meta
          .updateTable('table_query_remediation_task')
          .set({ status: 'failed', attempts: 3, locked_by: null, locked_at: null })
          .where('id', '=', task.snapshot().id)
          .execute();
        await new PostgresTableSearchVectorExecutor(observedMeta, data).drop(table.id().toString());
        expect(await generationPresence(table, journal)).toEqual({
          column_present: false,
          index_present: false,
        });
        expect(
          (
            await sql<{
              present: boolean;
            }>`SELECT to_regclass(${residualSql}) IS NOT NULL AS present`.execute(db)
          ).rows[0].present
        ).toBe(false);
        return;
      }
      if (crash.startsWith('terminal_'))
        await sql`UPDATE table_meta SET version = version + 1 WHERE id = ${table.id().toString()}`.execute(
          meta
        );
      const versionBefore = (
        await sql<{
          version: number;
        }>`SELECT version FROM table_meta WHERE id = ${table.id().toString()}`.execute(meta)
      ).rows[0]!.version;
      const statementsBefore = statements.length;
      await meta
        .updateTable('table_query_remediation_task')
        .set({ locked_at: new Date(Date.now() - 120_000) })
        .where('id', '=', task.snapshot().id)
        .execute();
      const claimed = expectOk(
        await taskRepository.claimNextAccepted(context, {
          scope: 'manual_search',
          workerId: 'replacement-residual',
          now: new Date(),
          allowedKinds: [],
          allowManualIndexExecution: false,
          allowPolicyIndexExecution: false,
        })
      );
      expect(claimed?.snapshot().id).toBe(task.snapshot().id);
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
          new RunTableQueryRemediationTaskCommand(task.snapshot().id, false, 'replacement-residual')
        )
      );
      const resumedStatements = statements.slice(statementsBefore);
      expect(resumedStatements.some((statement) => statement.includes('ADD COLUMN'))).toBe(false);
      expect(statements.filter((statement) => statement.includes('ADD COLUMN'))).toHaveLength(
        bundle === 'mixed' ? 1 : 0
      );
      if (crash.startsWith('terminal_')) {
        const unsafe = crash === 'terminal_foreign_index';
        expect(completed.snapshot()).toMatchObject({
          status: 'failed',
          attempts: 1,
          maxAttempts: 1,
        });
        if (unsafe) expect(completed.snapshot().lastError).toContain('cleanup failed');
        else expect(completed.snapshot().lastError).not.toContain('cleanup failed');
        expect(await generationPresence(table, journal)).toEqual({
          column_present: unsafe && bundle === 'mixed',
          index_present: bundle === 'residual_only' ? foreignOid !== undefined : unsafe,
        });
        const residualAfter = await sql<{
          oid: string;
        }>`SELECT to_regclass(${residualSql})::oid::text AS oid`.execute(db);
        expect(residualAfter.rows[0].oid).toBe(foreignOid ?? null);
        if (crash === 'terminal_absent_race') {
          expect(residualAbsenceObserved).toBe(true);
          expect(foreignOid).toBeDefined();
        }
        expect((await loadTable(table.id().toString())).searchIndex()).toEqual(originalSnapshot);
        const retained = await sql<{
          present: boolean;
        }>`SELECT to_regclass(${`${quoteIdentifier(physical.schema)}.${quoteIdentifier(originalSnapshot.residual!.indexName)}`}) IS NOT NULL AS present`.execute(
          db
        );
        expect(retained.rows[0].present).toBe(true);
        expect((await searchUsingRuntime(table, '42')).total).toBe(1);
        return;
      }
      if (foreignOid) {
        expect(completed.snapshot()).toMatchObject({
          status: 'failed',
          lastError: expect.stringContaining('incompatible physical object'),
        });
        const foreignAfter = await sql<{
          oid: string;
          valid: boolean;
        }>`SELECT indexrelid::text AS oid, indisvalid AS valid
        FROM pg_index WHERE indexrelid = to_regclass(${residualSql})`.execute(db);
        expect(foreignAfter.rows).toEqual([{ oid: foreignOid, valid: false }]);
        expect(resumedStatements.some((statement) => /(?:DROP|CREATE) INDEX/.test(statement))).toBe(
          false
        );
        expect((await loadTable(table.id().toString())).searchIndex()!.residual!.indexName).toBe(
          originalSnapshot.residual!.indexName
        );
        return;
      }
      expect(completed.snapshot()).toMatchObject({
        status: 'succeeded',
        attempts: 1,
        payload: task.snapshot().payload,
      });
      expect(
        resumedStatements.filter((statement) => statement.includes('CREATE INDEX CONCURRENTLY'))
      ).toHaveLength(crash === 'validated' ? 1 : 0);
      const serving = (await loadTable(table.id().toString())).searchIndex()!;
      expect(serving.residual).toMatchObject({ ready: true, indexName: journal.residualIndexName });
      expect(serving.document?.generatedColumnName).toBe(journal.generatedColumnName);
      const versionAfter = (
        await sql<{
          version: number;
        }>`SELECT version FROM table_meta WHERE id = ${table.id().toString()}`.execute(meta)
      ).rows[0]!.version;
      expect(Number(versionAfter) - Number(versionBefore)).toBe(crash === 'publication' ? 0 : 1);
      expect((await searchUsingRuntime(table, '42')).total).toBe(1);
      const retained = await sql<{
        present: boolean;
      }>`SELECT to_regclass(${`${quoteIdentifier(physical.schema)}.${quoteIdentifier(originalSnapshot.residual!.indexName)}`}) IS NOT NULL AS present`.execute(
        db
      );
      expect(retained.rows[0]?.present).toBe(true);
      const staleCompletion = await taskRepository.save(
        context,
        expectOk(departed.succeed({ stale: true }, new Date()))
      );
      expect(staleCompletion.isErr() ? staleCompletion.error : undefined).toMatchObject({
        code: 'table_query_ops.task_ownership_conflict',
      });
    },
    120_000
  );

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
          if (compiled.sql.includes('published AS (')) publications.add(args.queryId);
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
        expect(acknowledgementLost).toBe(failure === 'committed_acknowledgement_lost');
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
          expect(failed.snapshot().lastError).toContain(
            'publication acknowledgement lost after commit'
          );
          expect((await expectReadyConfig(table)).generated_column_name).toBe(
            journal.generatedColumnName
          );
          expect(serving.search_index).toMatchObject({
            version: 2,
            document: {
              generatedColumnName: journal.generatedColumnName,
              indexName: journal.indexName,
            },
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
            `COMMENT ON COLUMN ${tableSql}.${quoteIdentifier(journal.generatedColumnName!)} IS NULL`
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

  const prepareWarmRetirement = async (executionDb = db, admin = false) => {
    const { table } = await createTable();
    const tableId = table.id().toString();
    const meta = testContainer.metaDb as unknown as Kysely<UnknownPostgresDatabase>;
    const physical = expectOk(getTablePhysicalName(table));
    const relation = `${quoteIdentifier(physical.schema)}.${quoteIdentifier(physical.tableName)}`;
    if (executionDb !== db) {
      const title = expectOk(expectOk(fieldByName(table, 'Title').dbFieldName()).value());
      const score = expectOk(expectOk(fieldByName(table, 'Score').dbFieldName()).value());
      await sql
        .raw(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(physical.schema)}`)
        .execute(executionDb);
      await sql
        .raw(`CREATE TABLE ${relation} (__id text PRIMARY KEY,
        ${quoteIdentifier(title)} text, ${quoteIdentifier(score)} text)`)
        .execute(executionDb);
      await sql`INSERT INTO ${sql.raw(relation)} (__id, ${sql.id(title)}, ${sql.id(score)})
        VALUES ('rec_warm_retirement', 'lifecycleunique order', '42')`.execute(executionDb);
    } else {
      await createSemanticRecords(
        table,
        fieldByName(table, 'Title').id().toString(),
        fieldByName(table, 'Score').id().toString()
      );
    }
    expectOk(
      await new PostgresTableSearchVectorReconciler(meta, executionDb).reconcile(context, {
        table,
        mode: 'create',
        provider: 'pg_trgm',
        validationMode: 'real_ddl',
        requirePlanImprovement: false,
        allowLargeTableRewrite: true,
      })
    );
    const retired = (await loadTable(tableId)).searchIndex()!;
    expect(retired.document?.ready).toBe(true);
    // The retirement starts after grace with its real ownership snapshot intact.
    // Only connection availability is under test; schema-change discovery has
    // separate lifecycle coverage above.
    await sql`UPDATE table_meta SET search_index = NULL, version = version + 1
      WHERE id = ${tableId}`.execute(meta);
    await sql`UPDATE table_query_search_vector_config SET status = 'disabled',
      reclaim_drop_after = now() - interval '1 second', reclaim_drop_queued_at = now()
      WHERE table_id = ${tableId} AND candidate_key = ${retired.definitionKey}`.execute(meta);
    const task = expectOk(
      TableQueryRemediationTask.createQueued({
        tableId,
        baseId: table.baseId().toString(),
        kind: 'drop_search_access_path',
        now: new Date(),
        payload: admin
          ? {
              trigger: 'admin_search_access_path',
              executionMode: 'manual',
              mode: 'drop',
              expectedDefinitionKey: retired.definitionKey,
            }
          : { trigger: 'reclaim', scopeKey: retired.definitionKey },
      })
    );
    expectOk(await taskRepository.save(context, task));
    return {
      tableId,
      taskId: task.snapshot().id,
      retirementMetadata: async () =>
        (
          await sql<{
            serving_snapshot: unknown;
            reclaim_drop_after: Date | null;
            reclaim_drop_queued_at: Date | null;
          }>`SELECT serving_snapshot, reclaim_drop_after, reclaim_drop_queued_at
        FROM table_query_search_vector_config WHERE table_id = ${tableId}
        AND candidate_key = ${retired.definitionKey}`.execute(meta)
        ).rows,
      artifacts: async (readDb = executionDb) =>
        (
          await sql<{ column_present: boolean; index_present: boolean }>`SELECT
        EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass(${relation})
          AND attname = ${retired.document!.generatedColumnName} AND NOT attisdropped) AS column_present,
        to_regclass(${`${quoteIdentifier(physical.schema)}.${quoteIdentifier(retired.document!.indexName)}`}) IS NOT NULL AS index_present`.execute(
            readDb
          )
        ).rows[0],
    };
  };

  const warmRetirementWorker = (
    tableId: string,
    executionDb: Kysely<UnknownPostgresDatabase>,
    isConnectionUnavailable: (error: unknown) => boolean,
    executionMeta = testContainer.metaDb as unknown as Kysely<UnknownPostgresDatabase>,
    admin = false
  ) => {
    const handler = new RunTableQueryRemediationTaskHandler(
      taskRepository,
      new PostgresTableQueryRemediationExecutor(
        executionMeta,
        executionDb,
        tableRepository,
        new PostgresTableSearchVectorReconciler(executionMeta, executionDb, {
          isConnectionUnavailable,
        })
      ),
      testContainer.container.resolve(v2TableOpsTokens.decisionPolicy),
      testContainer.container.resolve(v2TableOpsTokens.decisionLogRepository),
      { now: () => new Date() }
    );
    const workerContainer = testContainer.container.createChildContainer();
    workerContainer.registerInstance(v2TableOpsTokens.taskWorkerConfig, {
      enabled: true,
      intervalMs: 60_000,
      workerId: 'warm-retirement-worker',
      scope: admin ? 'all' : 'search_maintenance',
      allowedKinds: ['drop_search_access_path'],
      allowManualIndexExecution: admin,
      allowPolicyIndexExecution: false,
    });
    workerContainer.registerInstance(v2TableOpsTokens.clock, { now: () => new Date() });
    const execute = vi.fn(
      (executionContext: IExecutionContext, command: RunTableQueryRemediationTaskCommand) =>
        handler.handle(executionContext, command)
    );
    workerContainer.registerInstance(v2CoreTokens.commandBus, {
      execute,
    } as unknown as ICommandBus);
    // Route resolution always succeeds and returns the already constructed
    // container/executor. The raw refusal occurs inside the real adapter.
    const resolveExecution = vi.fn(async (routedTableId: string) => {
      expect(routedTableId).toBe(tableId);
      return { container: workerContainer, context };
    });
    return {
      execute,
      resolveExecution,
      runOnce: async () => {
        const calls = execute.mock.calls.length + 1;
        const worker = startTableQueryOpsTaskWorkerIfEnabled(
          workerContainer,
          context,
          resolveExecution
        );
        try {
          await vi.waitFor(
            async () => {
              expect(execute).toHaveBeenCalledTimes(calls);
              expectOk(await execute.mock.results[calls - 1].value);
            },
            { timeout: 10_000 }
          );
        } finally {
          worker?.stop();
        }
      },
    };
  };

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
    const created = expectOk(result);
    maintenanceTableIds.push(created.table.id().toString());
    return created;
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

  const runPendingMaintenance = async (expectedStatus = 'succeeded'): Promise<void> => {
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
    expect(result._unsafeUnwrap().snapshot().status).toBe(expectedStatus);
  };

  const searchTotal = async (table: Table, config: SearchVectorConfig, value: string) => {
    const fieldIds = asStringArray(config.field_ids);
    const coveredFieldIds = fieldIds.map((id) => FieldId.create(id)._unsafeUnwrap());
    const result = await recordQueryRepository.find(context, table, undefined, {
      search: { search: RecordSearch.fromTuple([value, fieldIds.join(','), true]) },
      searchAccessPath: {
        fieldIds: coveredFieldIds,
        kind: 'generated_text',
        searchScope: 'selected_fields',
        document: {
          generatedColumnName: config.generated_column_name,
          provider: config.provider,
          coveredFieldIds,
          ready: true,
        },
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
        fieldIds: coveredFieldIds,
        kind: 'generated_text',
        searchScope: 'all_fields',
        document: {
          generatedColumnName: config.generated_column_name,
          provider: config.provider,
          coveredFieldIds,
          ready: true,
        },
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

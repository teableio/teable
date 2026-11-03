import { context, propagation, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { createV2PostgresPgliteDb } from '@teable/v2-adapter-db-postgres-pglite';
import {
  ComputedUpdateOutbox,
  ComputedUpdateWorker,
  defaultComputedUpdateOutboxConfig,
  HybridWithOutboxStrategy,
  defaultHybridWithOutboxStrategyConfig,
  deserializeComputedUpdatePlan,
  type ComputedUpdateOutboxTaskInput,
  type ComputedOutboxWakeup,
} from '@teable/v2-adapter-table-repository-postgres';
import { ActorId, type DomainError, type IExecutionContext } from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { sql } from 'kysely';
import { ok, type Result } from 'neverthrow';
import { expect, it } from 'vitest';

import { OpenTelemetryTracer } from './v2-tracer.adapter';

it('exports naturally persisted split tasks across wakeups without borrowing legacy origins', async () => {
  const exporter = new InMemorySpanExporter();
  const sdk = new NodeSDK({
    autoDetectResources: false,
    logRecordProcessors: [],
    metricReaders: [],
    contextManager: new AsyncLocalStorageContextManager(),
    spanProcessors: [new SimpleSpanProcessor(exporter)],
    instrumentations: [],
  });
  sdk.start();
  const db = await createV2PostgresPgliteDb<V1TeableDatabase>({
    pg: { connectionString: 'memory://' },
  });
  try {
    const fixtureSql = `
      CREATE TABLE space (id text PRIMARY KEY, name text);
      CREATE TABLE base (id text PRIMARY KEY, space_id text, name text);
      CREATE TABLE space_data_db_binding (id text PRIMARY KEY, space_id text, mode text, status text);
      CREATE TABLE table_meta (id text PRIMARY KEY, base_id text, name text, deleted_time timestamptz);
      CREATE TABLE computed_update_pause_scope (id text PRIMARY KEY, scope_type text, scope_id text, resume_at timestamptz);
      CREATE TABLE computed_update_stage_ledger (
        scope_id text, kind text, table_id text, record_id text, seq bigint DEFAULT 0,
        PRIMARY KEY(scope_id,kind,table_id,record_id));
      CREATE TABLE computed_update_change_frontier (
        scope_id text, kind text, table_id text, record_id text, field_id text,
        PRIMARY KEY(scope_id,kind,table_id,record_id,field_id));
      CREATE TABLE computed_update_outbox (
        id text PRIMARY KEY, worker_lane text DEFAULT 'production', base_id text, seed_table_id text,
        seed_record_ids jsonb, change_type text, steps jsonb, edges jsonb, status text,
        attempts integer DEFAULT 0, max_attempts integer DEFAULT 8, next_run_at timestamptz,
        locked_at timestamptz, locked_by text, last_error text, estimated_complexity integer,
        plan_hash text, dirty_stats jsonb, affected_table_ids text[], affected_field_ids text[],
        sync_max_level integer, run_id text, origin_run_ids text[], run_total_steps integer,
        run_completed_steps_before integer, source_changed_at timestamptz, stage_depth integer,
        predecessor_task_id text, created_at timestamptz, updated_at timestamptz);
      CREATE UNIQUE INDEX computed_update_outbox_pending_unique_idx
        ON computed_update_outbox(base_id,seed_table_id,plan_hash,change_type) WHERE status='pending';
      CREATE TABLE computed_update_outbox_seed (
        id text PRIMARY KEY, task_id text, table_id text, record_id text,
        UNIQUE(task_id,table_id,record_id));
      INSERT INTO space VALUES ('spcaaaaaaaaaaaaaaaa','trace-space');
      INSERT INTO base VALUES ('bseaaaaaaaaaaaaaaaa','spcaaaaaaaaaaaaaaaa','trace-base');
      INSERT INTO table_meta VALUES ('tblbbbbbbbbbbbbbbbb','bseaaaaaaaaaaaaaaaa','trace-table',NULL);
    `;
    for (const statement of fixtureSql.split(';')) {
      if (statement.trim()) await sql.raw(statement).execute(db);
    }
    const tracer = new OpenTelemetryTracer('persisted-computed-trace-test');
    const wakeups: ComputedOutboxWakeup[] = [];
    const logger = {
      debug() {},
      info() {},
      warn() {},
      error() {},
      child() {
        return this;
      },
    };
    const config = {
      ...defaultComputedUpdateOutboxConfig,
      maxSeedRecordsPerTask: 1,
      stageMaxDirtyRecords: 0,
      stageMaxSteps: 1,
      stageSmallRunComplexityThreshold: 0,
      runHistoryEnabled: false,
      stageLedgerCompactionEnabled: false,
    };
    const outbox = new ComputedUpdateOutbox(db, config, logger as never, db, {
      publish: async (wakeup) => {
        wakeups.push(wakeup);
        return { status: 'accepted' };
      },
    });
    const input = (runId: string): ComputedUpdateOutboxTaskInput => ({
      baseId: 'bseaaaaaaaaaaaaaaaa',
      seedTableId: 'tblbbbbbbbbbbbbbbbb',
      seedRecordIds: ['recdddddddddddddddd', 'receeeeeeeeeeeeeeee'],
      extraSeedRecords: [],
      beforeImageRecords: [],
      steps: [
        { tableId: 'tblbbbbbbbbbbbbbbbb', fieldIds: ['fldcccccccccccccccc'], level: 0 },
        { tableId: 'tblbbbbbbbbbbbbbbbb', fieldIds: ['fldffffffffffffffff'], level: 1 },
      ],
      edges: [],
      estimatedComplexity: 2,
      changeType: 'update',
      planHash: runId,
      runId,
      originRunIds: [],
      runTotalSteps: 2,
      runCompletedStepsBefore: 0,
      affectedTableIds: ['tblbbbbbbbbbbbbbbbb'],
      affectedFieldIds: ['fldcccccccccccccccc'],
      syncMaxLevel: 0,
      sourceChangedAt: new Date(),
    });
    const actorId = ActorId.create('system')._unsafeUnwrap();
    const rootA = tracer.startSpan('teable.test.persisted.origin.a');
    await tracer.withSpan(rootA, async () => {
      (await outbox.enqueueOrMerge(input('run-a'), { actorId, tracer }))._unsafeUnwrap();
    });
    rootA.end();
    const rootB = tracer.startSpan('teable.test.persisted.origin.b');
    await tracer.withSpan(rootB, async () => {
      (await outbox.enqueueOrMerge(input('run-b'), { actorId, tracer }))._unsafeUnwrap();
    });
    rootB.end();
    // Simulate pre-upgrade/corrupted durable rows, rather than building claimed tasks in JS.
    for (const runId of ['legacy', 'invalid']) {
      const unrelated = tracer.startSpan('teable.test.unrelated.enqueue');
      try {
        await tracer.withSpan(unrelated, async () => {
          (
            await outbox.enqueueOrMerge(
              { ...input(runId), sourceChangedAt: new Date() },
              { actorId, tracer }
            )
          )._unsafeUnwrap();
        });
      } finally {
        unrelated.end();
      }
    }
    await sql`UPDATE computed_update_outbox SET dirty_stats = dirty_stats - 'traceparent' - 'tracestate' WHERE run_id = 'legacy'`.execute(
      db
    );
    await sql`UPDATE computed_update_outbox SET dirty_stats = jsonb_set(dirty_stats, '{traceparent}', '"broken"'::jsonb) WHERE run_id = 'invalid'`.execute(
      db
    );
    const worker = new ComputedUpdateWorker(
      outbox,
      config,
      {
        cleanupValueFrontierOrphans: async () => ok({ afterScope: '', deleted: 0 }),
        acquireLocks: async () =>
          ok({ mode: 'record', totalLocks: 1, recordLocks: 1, tableLocks: 0 }),
        execute: async () => ok({ changesByStep: [] }),
        collectStageOutputSeedGroups: async () => ok({ groups: [], seedAllTableIds: [] }),
        pushStageLedgerFrontierSeeds: async () => ok(0),
        settleStageLedgerPartialBatch: async () =>
          ok({ processedByTable: [], newFrontierRows: 0, retiredFrontierRows: 0 }),
        collectDirtySeedGroups: async () => ok({ groups: [], seedAllTableIds: [] }),
        clearTaskStageLedger: async () => ok(0),
      } as never,
      { planStage: async () => ok({ steps: [], edges: [] }) } as never,
      {
        withTransaction: async <T>(
          ctx: IExecutionContext,
          work: (ctx: IExecutionContext) => Promise<Result<T, DomainError>>
        ) => work(ctx),
      } as never,
      logger as never,
      { sha256: () => 'hash' } as never,
      {} as never,
      {} as never,
      { publishMany: async () => ok(undefined) } as never
    );
    const firstWakeup = wakeups[0];
    for (let invocation = 0; invocation < 30; invocation++) {
      const nextWakeup = wakeups[invocation] ?? firstWakeup;
      const processed = await tracer.runWithPropagationCarrier(nextWakeup, async () =>
        worker.runOnce({ workerId: 'trace-worker', limit: 1, tracer })
      );
      if (processed._unsafeUnwrap() === 0) break;
    }
    const remaining = await db.selectFrom('computed_update_outbox').select('id').execute();
    expect(remaining).toEqual([]);
    const spans = exporter.getFinishedSpans();
    const originA = spans.find((span) => span.name === 'teable.test.persisted.origin.a')!;
    const originB = spans.find((span) => span.name === 'teable.test.persisted.origin.b')!;
    const taskSpans = spans.filter((span) => span.name === 'teable.worker.processClaimedTask');
    for (const [runId, origin] of [
      ['run-a', originA],
      ['run-b', originB],
    ] as const) {
      const tasks = taskSpans.filter((span) => span.attributes['computed.runId'] === runId);
      expect(tasks).toHaveLength(5);
      expect(tasks.some((span) => span.attributes['computed.predecessorTaskId'] !== 'none')).toBe(
        true
      );
      for (const span of tasks) {
        expect(span.spanContext().traceId).toBe(origin.spanContext().traceId);
        expect(span.parentSpanContext?.spanId).toBe(origin.spanContext().spanId);
      }
    }
    for (const runId of ['legacy', 'invalid']) {
      const tasks = taskSpans.filter((span) => span.attributes['computed.runId'] === runId);
      expect(tasks).toHaveLength(5);
      for (const span of tasks) {
        expect(span.parentSpanContext).toBeUndefined();
        expect(span.spanContext().traceId).not.toBe(originA.spanContext().traceId);
      }
    }

    // Exercise the real fresh-mutation strategy, not only its outbox enqueue seam.
    const strategy = new HybridWithOutboxStrategy(
      outbox,
      worker,
      { ...defaultHybridWithOutboxStrategyConfig, dispatchMode: 'external' },
      logger as never,
      { sha256: () => 'strategy-plan' },
      {} as never,
      { publishMany: async () => ok(undefined) } as never
    );
    const parsedStrategyPlan = deserializeComputedUpdatePlan(input('strategy'))._unsafeUnwrap();
    const strategyPlan = {
      ...parsedStrategyPlan,
      seedAllTableIds: [parsedStrategyPlan.seedTableId],
    };
    const request = tracer.startSpan('teable.test.mutation.request');
    await tracer.withSpan(request, async () => {
      (await strategy.execute({} as never, strategyPlan, { actorId, tracer }))._unsafeUnwrap();
    });
    request.end();
    const strategyWakeup = wakeups.at(-1)!;
    const claimed = (
      await outbox.claimById({ taskId: strategyWakeup.taskId, workerId: 'strategy-proof' })
    )._unsafeUnwrap();
    expect(claimed?.sourceChangedAt).toBeInstanceOf(Date);
    const strategySpans = exporter.getFinishedSpans();
    const requestSpan = strategySpans.find((span) => span.name === 'teable.test.mutation.request')!;
    const strategySpan = strategySpans.find(
      (span) => span.name === 'teable.computed.hybrid.execute'
    )!;
    expect(strategySpan.parentSpanContext?.spanId).toBe(requestSpan.spanContext().spanId);
    expect(claimed?.traceparent).toBe(
      `00-${requestSpan.spanContext().traceId}-${strategySpan.spanContext().spanId}-01`
    );
    expect(strategyWakeup.traceparent).toBe(claimed?.traceparent);
  } finally {
    await db.destroy();
    await sdk.shutdown();
    context.disable();
    propagation.disable();
    trace.disable();
  }
}, 30_000);

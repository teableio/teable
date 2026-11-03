import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import {
  ComputedUpdateWorker,
  defaultComputedUpdateOutboxConfig,
  type ComputedUpdateOutboxItem,
} from '@teable/v2-adapter-table-repository-postgres';
import type { DomainError, IExecutionContext } from '@teable/v2-core';
import { ok, type Result } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { OpenTelemetryTracer } from './v2-tracer.adapter';

describe('durable computed trace propagation', () => {
  let exporter: InMemorySpanExporter;
  let sdk: NodeSDK;

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    sdk = new NodeSDK({
      autoDetectResources: false,
      logRecordProcessors: [],
      metricReaders: [],
      contextManager: new AsyncLocalStorageContextManager(),
      spanProcessors: [new SimpleSpanProcessor(exporter)],
      instrumentations: [],
    });
    sdk.start();
  });

  afterEach(async () => {
    await sdk.shutdown();
  });

  it('exports each claimed task under its durable origin across separate wakeups', async () => {
    const tracer = new OpenTelemetryTracer('durable-computed-trace-test');
    const createOrigin = async (name: string) => {
      const span = tracer.startSpan(name);
      try {
        return await tracer.withSpan(span, async () => {
          const carrier = tracer.capturePropagationCarrier();
          if (!carrier?.traceparent) throw new Error('expected injected traceparent');
          return carrier;
        });
      } finally {
        span.end();
      }
    };
    const firstCarrier = await createOrigin('teable.test.origin.first');
    const secondCarrier = await createOrigin('teable.test.origin.second');

    const baseId = `bse${'a'.repeat(16)}`;
    const tableId = `tbl${'b'.repeat(16)}`;
    const fieldId = `fld${'c'.repeat(16)}`;
    const recordId = `rec${'d'.repeat(16)}`;
    const task = (
      id: string,
      carrier: typeof firstCarrier,
      predecessorTaskId?: string
    ): ComputedUpdateOutboxItem => ({
      id,
      ...carrier,
      baseId,
      seedTableId: tableId,
      seedRecordIds: [recordId],
      extraSeedRecords: [],
      beforeImageRecords: [],
      steps: [{ tableId, fieldIds: [fieldId], level: 0 }],
      edges: [],
      estimatedComplexity: 1,
      changeType: 'update',
      planHash: id,
      runId: id,
      originRunIds: [],
      runTotalSteps: 1,
      runCompletedStepsBefore: 0,
      affectedTableIds: [tableId],
      affectedFieldIds: [fieldId],
      syncMaxLevel: 0,
      stageDepth: predecessorTaskId ? 1 : 0,
      predecessorTaskId,
      sourceChangedAt: new Date(Date.now() - 1000),
      status: 'processing',
      attempts: 0,
      maxAttempts: 8,
      lockedBy: 'trace-worker',
      nextRunAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const first = task('cuo-origin-first', firstCarrier);
    const second = task('cuo-origin-second', secondCarrier);
    const continuation = task('cuo-origin-continuation', firstCarrier, first.id);
    const legacy = task('cuo-origin-legacy', {});
    const invalid = task('cuo-origin-invalid', { traceparent: 'not-a-w3c-parent' });
    let nextBatch = [first, second, legacy, invalid];
    const logger = {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    };
    const worker = new ComputedUpdateWorker(
      {
        claimBatch: async () => ok(nextBatch),
        renewLease: async ({ taskIds }: { taskIds: string[] }) => ok(taskIds),
        markDone: async () => ok(true),
        claimById: async () => ok(null),
      } as never,
      defaultComputedUpdateOutboxConfig,
      {
        cleanupValueFrontierOrphans: async () => ok({ afterScope: '', deleted: 0 }),
        acquireLocks: async () =>
          ok({ mode: 'record', totalLocks: 1, recordLocks: 1, tableLocks: 0 }),
        execute: async () => ok({ changesByStep: [] }),
        pushStageLedgerFrontierSeeds: async () => ok(0),
        settleStageLedgerPartialBatch: async () =>
          ok({ processedByTable: [], newFrontierRows: 0, retiredFrontierRows: 0 }),
        collectStageOutputSeedGroups: async () => ok({ groups: [], seedAllTableIds: [] }),
        collectDirtySeedGroups: async () => ok({ groups: [], seedAllTableIds: [] }),
        clearTaskStageLedger: async () => ok(0),
      } as never,
      { planStage: async () => ok({ steps: [], edges: [] }) } as never,
      {
        withTransaction: async <T>(
          ctx: IExecutionContext,
          work: (context: IExecutionContext) => Promise<Result<T, DomainError>>
        ): Promise<Result<T, DomainError>> => work(ctx),
      } as never,
      logger as never,
      { sha256: () => 'hash' } as never,
      {} as never,
      {} as never,
      { publishMany: async () => ok(undefined) } as never
    );

    // Both tasks are drained while wakeup A is active. B must not inherit A.
    await tracer.runWithPropagationCarrier(firstCarrier, async () => {
      const wakeup = tracer.startSpan('teable.test.wakeup');
      try {
        await tracer.withSpan(wakeup, async () => {
          expect(
            (await worker.runOnce({ workerId: 'trace-worker', limit: 4, tracer }))._unsafeUnwrap()
          ).toBe(4);
        });
      } finally {
        wakeup.end();
      }
    });
    // A later delivery has no broker carrier at all: only the claimed DB payload remains.
    nextBatch = [continuation];
    await Promise.resolve();
    expect(
      (await worker.runOnce({ workerId: 'trace-worker', limit: 1, tracer }))._unsafeUnwrap()
    ).toBe(1);
    const spans = exporter.getFinishedSpans();
    const firstOrigin = spans.find((span) => span.name === 'teable.test.origin.first');
    const secondOrigin = spans.find((span) => span.name === 'teable.test.origin.second');
    const claimed = spans.filter((span) => span.name === 'teable.worker.processClaimedTask');
    expect(firstOrigin).toBeDefined();
    expect(secondOrigin).toBeDefined();
    expect(claimed).toHaveLength(5);
    expect(claimed[0].spanContext().traceId).toBe(firstOrigin?.spanContext().traceId);
    expect(claimed[0].parentSpanContext?.spanId).toBe(firstOrigin?.spanContext().spanId);
    expect(claimed[1].spanContext().traceId).toBe(secondOrigin?.spanContext().traceId);
    expect(claimed[1].parentSpanContext?.spanId).toBe(secondOrigin?.spanContext().spanId);
    expect(claimed[0].spanContext().traceId).not.toBe(claimed[1].spanContext().traceId);
    expect(claimed[2].parentSpanContext).toBeUndefined();
    expect(claimed[2].spanContext().traceId).not.toBe(firstOrigin?.spanContext().traceId);
    expect(claimed[3].parentSpanContext).toBeUndefined();
    expect(claimed[3].spanContext().traceId).not.toBe(firstOrigin?.spanContext().traceId);
    expect(claimed[4].spanContext().traceId).toBe(firstOrigin?.spanContext().traceId);
    expect(claimed[4].parentSpanContext?.spanId).toBe(firstOrigin?.spanContext().spanId);
    const continuationAttributes: Record<string, unknown> = {};
    continuationAttributes['computed.runId'] = continuation.runId;
    continuationAttributes['computed.stageDepth'] = 1;
    continuationAttributes['computed.predecessorTaskId'] = first.id;
    continuationAttributes['computed.hasDurableTraceOrigin'] = true;
    expect(claimed[4].attributes).toMatchObject(continuationAttributes);
  });
});

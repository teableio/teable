import {
  BaseId,
  FieldId,
  TableId,
  domainError,
  type Field,
  type IEventBus,
  type IExecutionContext,
  type IHasher,
  type ILogger,
  type ITableRepository,
  type IUnitOfWork,
  type Table,
} from '@teable/v2-core';
import { err, ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import type { ComputedFieldBackfillService } from '../ComputedFieldBackfillService';
import type { ComputedUpdatePlanner } from '../ComputedUpdatePlanner';
import { defaultComputedUpdateOutboxConfig } from '../outbox/IComputedUpdateOutbox';
import type {
  FieldBackfillOutboxItem,
  IComputedUpdateOutbox,
} from '../outbox/IComputedUpdateOutbox';
import type { IPeriodicFieldRefreshLifecycleSink } from '../PeriodicFieldRefreshLifecycleSink';
import { ComputedUpdateWorker } from './ComputedUpdateWorker';

const BASE_ID = `bse${'a'.repeat(16)}`;
const TABLE_0_ID = `tbl${'b'.repeat(16)}`;
const TABLE_1_ID = `tbl${'c'.repeat(16)}`;
const FIELD_0_ID = `fld${'d'.repeat(16)}`;
const FIELD_1_ID = `fld${'e'.repeat(16)}`;
const REC_CURSOR = `rec${'f'.repeat(16)}`;

const createNoopLogger = (): ILogger =>
  ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
    scope: vi.fn().mockReturnThis(),
  }) as unknown as ILogger;

const createHasher = (): IHasher => ({
  sha256: (input: string) => `hash:${input}`,
});

const createUnitOfWork = (): IUnitOfWork => ({
  withTransaction: async <T>(
    context: IExecutionContext,
    fn: (txContext: IExecutionContext) => Promise<T>
  ) =>
    fn({
      ...context,
      transaction: { kind: 'unitOfWorkTransaction' },
    }),
});

const makeTable = (tableIdStr: string, fieldIdStr: string) => {
  const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
  const tableId = TableId.create(tableIdStr)._unsafeUnwrap();
  const fieldId = FieldId.create(fieldIdStr)._unsafeUnwrap();
  const field = { id: () => fieldId } as unknown as Field;
  const table = {
    id: () => tableId,
    baseId: () => baseId,
    getField: (predicate: (f: Field) => boolean) =>
      predicate(field) ? ok(field) : ok(undefined as never),
    getFields: () => [],
  } as unknown as Table;
  return { table, field };
};

const createTableRepoStub = (...tables: Table[]): ITableRepository =>
  ({
    findOne: vi.fn(async (_ctx, spec: { tableId?: () => TableId }) => {
      const id = spec.tableId?.().toString();
      const matched = tables.find((t) => t.id().toString() === id) ?? tables[0];
      return ok(matched);
    }),
    find: vi.fn().mockResolvedValue(ok(tables)),
  }) as unknown as ITableRepository;

const createOutboxStub = (overrides: Partial<IComputedUpdateOutbox> = {}): IComputedUpdateOutbox =>
  ({
    enqueueOrMerge: vi.fn().mockResolvedValue(ok({ taskId: 'cuo-noop', merged: false })),
    enqueueSeedTask: vi.fn().mockResolvedValue(ok({ taskId: 'cuo-noop', merged: false })),
    registerPlannedTaskActivity: vi.fn().mockResolvedValue(ok(undefined)),
    enqueueFieldBackfill: vi.fn().mockResolvedValue(ok({ taskId: 'cuo-next', merged: false })),
    claimBatch: vi.fn().mockResolvedValue(ok([])),
    claimById: vi.fn().mockResolvedValue(ok(null)),
    renewLease: vi
      .fn()
      .mockImplementation(({ taskIds }: { taskIds: string[] }) => Promise.resolve(ok(taskIds))),
    releaseForRetry: vi.fn().mockResolvedValue(ok(true)),
    markDone: vi.fn().mockResolvedValue(ok(true)),
    markFailed: vi.fn().mockResolvedValue(ok(true)),
    projectStageSettlement: vi.fn().mockResolvedValue(ok(null)),
    discardFieldBackfills: vi
      .fn()
      .mockResolvedValue(
        ok({ discardedTaskIds: [], trimmedTaskIds: [], discardedDeadLetterTaskIds: [] })
      ),
    ...overrides,
  }) as unknown as IComputedUpdateOutbox;

const createEventBus = () => {
  const published: unknown[] = [];
  const bus: IEventBus = {
    publish: vi.fn().mockResolvedValue(ok(undefined)),
    publishMany: vi.fn(async (_ctx, events) => {
      published.push(...events);
      return ok(undefined);
    }),
  } as unknown as IEventBus;
  return { bus, published };
};

const createUpdaterStub = () =>
  ({
    cleanupValueFrontierOrphans: vi.fn().mockResolvedValue(ok({ afterScope: undefined })),
  }) as never;

const baseTask = (overrides: Partial<FieldBackfillOutboxItem> = {}): FieldBackfillOutboxItem => ({
  id: 'cuo-stage-0',
  taskType: 'field-backfill',
  baseId: BASE_ID,
  tableId: TABLE_0_ID,
  fieldIds: [FIELD_0_ID],
  runId: 'pfr123456789012345',
  planHash: 'stage0-hash',
  status: 'processing',
  attempts: 0,
  maxAttempts: 8,
  nextRunAt: new Date(),
  lockedAt: new Date(),
  lockedBy: 'worker-1',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('ComputedUpdateWorker periodic stage barrier', () => {
  it('propagates stageChain across cursor batches without advancing downstream stage early', async () => {
    const t0 = makeTable(TABLE_0_ID, FIELD_0_ID);
    const stageChain = {
      remainingStages: [{ tableId: TABLE_1_ID, fieldIds: [FIELD_1_ID] }],
      notifyTargets: [],
    };
    const task = baseTask({ stageChain });
    const continuationTask = baseTask({
      id: 'cuo-stage-0-cont',
      cursor: REC_CURSOR,
      stageChain,
    });
    const executeSyncMany = vi.fn().mockResolvedValueOnce(
      ok({
        fields: [t0.field],
        batch: { recordCount: 500, lastRecordId: REC_CURSOR, hasMore: true },
      })
    );
    const enqueueFieldBackfill = vi
      .fn()
      .mockResolvedValueOnce(ok({ taskId: 'cuo-stage-0-cont', merged: false, claimed: null }));
    const { bus, published } = createEventBus();

    const worker = new ComputedUpdateWorker(
      createOutboxStub({
        claimBatch: vi.fn().mockResolvedValue(ok([task])),
        claimById: vi.fn().mockResolvedValue(ok(continuationTask)).mockResolvedValueOnce(ok(null)),
        enqueueFieldBackfill,
      }),
      defaultComputedUpdateOutboxConfig,
      createUpdaterStub(),
      {} as ComputedUpdatePlanner,
      createUnitOfWork(),
      createNoopLogger(),
      createHasher(),
      createTableRepoStub(t0.table),
      { executeSyncMany } as unknown as ComputedFieldBackfillService,
      bus
    );

    await worker.runOnce({ workerId: 'worker-1', limit: 10 });

    expect(enqueueFieldBackfill).toHaveBeenCalledTimes(1);
    const enqueued = enqueueFieldBackfill.mock.calls[0]![0];
    expect(enqueued.tableId).toBe(TABLE_0_ID);
    expect(enqueued.cursor).toBe(REC_CURSOR);
    expect(enqueued.stageChain).toEqual(stageChain);
    expect(published).toHaveLength(0);
  });

  it('enqueues downstream stage strictly when !batch.hasMore and emits only TableActionTriggerRequested on final stage', async () => {
    const t0 = makeTable(TABLE_0_ID, FIELD_0_ID);
    const t1 = makeTable(TABLE_1_ID, FIELD_1_ID);

    const stage0 = baseTask({
      id: 'cuo-stage-0',
      cursor: REC_CURSOR,
      stageChain: {
        remainingStages: [{ tableId: TABLE_1_ID, fieldIds: [FIELD_1_ID] }],
        notifyTargets: [],
      },
    });
    const stage1 = baseTask({
      id: 'cuo-stage-1',
      tableId: TABLE_1_ID,
      fieldIds: [FIELD_1_ID],
      stageChain: {
        remainingStages: [],
        notifyTargets: [{ tableId: TABLE_0_ID, fieldIds: [FIELD_0_ID] }],
      },
    });

    const executeSyncMany = vi
      .fn()
      .mockResolvedValueOnce(
        ok({
          fields: [t0.field],
          batch: { recordCount: 120, lastRecordId: 'rec_last_0', hasMore: false },
        })
      )
      .mockResolvedValueOnce(
        ok({
          fields: [t1.field],
          batch: { recordCount: 40, lastRecordId: 'rec_last_1', hasMore: false },
        })
      );

    const enqueueFieldBackfill = vi
      .fn()
      .mockResolvedValueOnce(ok({ taskId: 'cuo-stage-1', merged: false, claimed: stage1 }));

    const tableRepository = createTableRepoStub(t0.table, t1.table);

    const { bus, published } = createEventBus();
    const worker = new ComputedUpdateWorker(
      createOutboxStub({
        claimBatch: vi.fn().mockResolvedValue(ok([stage0])),
        enqueueFieldBackfill,
      }),
      defaultComputedUpdateOutboxConfig,
      createUpdaterStub(),
      {} as ComputedUpdatePlanner,
      createUnitOfWork(),
      createNoopLogger(),
      createHasher(),
      tableRepository,
      { executeSyncMany } as unknown as ComputedFieldBackfillService,
      bus
    );

    const processed = await worker.runOnce({ workerId: 'worker-1', limit: 10 });

    expect(processed.isOk()).toBe(true);
    expect(processed._unsafeUnwrap()).toBe(2);
    expect(enqueueFieldBackfill).toHaveBeenCalledTimes(1);
    expect(enqueueFieldBackfill.mock.calls[0]![0]).toMatchObject({
      tableId: TABLE_1_ID,
      fieldIds: [FIELD_1_ID],
      stageChain: {
        remainingStages: [],
        notifyTargets: [{ tableId: TABLE_0_ID, fieldIds: [FIELD_0_ID] }],
      },
    });

    // Only TableActionTriggerRequested('setField') emitted after final stage — never RecordsBatchUpdated.
    expect(published).toHaveLength(2);
    for (const event of published as Array<{ name: { toString(): string }; actionKey?: string }>) {
      expect(event.name.toString()).toBe('TableActionTriggerRequested');
      expect(event.actionKey).toBe('setField');
    }
  });

  it('does not emit TableActionTriggerRequested for plain field-backfill without stageChain', async () => {
    const t0 = makeTable(TABLE_0_ID, FIELD_0_ID);
    const plain = baseTask({ stageChain: undefined });
    const executeSyncMany = vi.fn().mockResolvedValueOnce(
      ok({
        fields: [t0.field],
        batch: { recordCount: 10, lastRecordId: REC_CURSOR, hasMore: false },
      })
    );
    const { bus, published } = createEventBus();

    const worker = new ComputedUpdateWorker(
      createOutboxStub({
        claimBatch: vi.fn().mockResolvedValue(ok([plain])),
      }),
      defaultComputedUpdateOutboxConfig,
      createUpdaterStub(),
      {} as ComputedUpdatePlanner,
      createUnitOfWork(),
      createNoopLogger(),
      createHasher(),
      createTableRepoStub(t0.table),
      { executeSyncMany } as unknown as ComputedFieldBackfillService,
      bus
    );

    const res = await worker.runOnce({ workerId: 'worker-1', limit: 10 });
    expect(res.isOk()).toBe(true);
    expect(res._unsafeUnwrap()).toBe(1);
    expect(published).toHaveLength(0);
  });

  it('invokes lifecycleSink.onCompleted only when the final stage commits, never on intermediate stages', async () => {
    const t0 = makeTable(TABLE_0_ID, FIELD_0_ID);
    const t1 = makeTable(TABLE_1_ID, FIELD_1_ID);
    const periodicRefresh = {
      sourceFieldId: FIELD_0_ID,
      sourceTableId: TABLE_0_ID,
      rangeHash: 'r:month_2026_09',
      localDate: '2026-09-01',
      timeZone: 'UTC',
      containsNowPrecision: false,
      triggeredAtIso: '2026-09-01T00:05:00.000Z',
    };

    const stage0 = baseTask({
      id: 'cuo-stage-0',
      stageChain: {
        remainingStages: [{ tableId: TABLE_1_ID, fieldIds: [FIELD_1_ID] }],
        notifyTargets: [],
        periodicRefresh,
      },
    });
    const stage1 = baseTask({
      id: 'cuo-stage-1',
      tableId: TABLE_1_ID,
      fieldIds: [FIELD_1_ID],
      stageChain: {
        remainingStages: [],
        notifyTargets: [{ tableId: TABLE_0_ID, fieldIds: [FIELD_0_ID] }],
        periodicRefresh,
      },
    });

    const executeSyncMany = vi
      .fn()
      .mockResolvedValueOnce(
        ok({
          fields: [t0.field],
          batch: { recordCount: 10, lastRecordId: 'rec_0', hasMore: false },
        })
      )
      .mockResolvedValueOnce(
        ok({
          fields: [t1.field],
          batch: { recordCount: 10, lastRecordId: 'rec_1', hasMore: false },
        })
      );

    const lifecycleSink: IPeriodicFieldRefreshLifecycleSink = {
      onCompleted: vi.fn().mockResolvedValue(undefined),
      onFailed: vi.fn().mockResolvedValue(undefined),
    };

    const { bus } = createEventBus();
    const worker = new ComputedUpdateWorker(
      createOutboxStub({
        claimBatch: vi
          .fn()
          .mockResolvedValueOnce(ok([stage0]))
          .mockResolvedValueOnce(ok([stage1])),
        enqueueFieldBackfill: vi
          .fn()
          .mockResolvedValueOnce(ok({ taskId: 'cuo-stage-1', merged: false })),
      }),
      defaultComputedUpdateOutboxConfig,
      createUpdaterStub(),
      {} as ComputedUpdatePlanner,
      createUnitOfWork(),
      createNoopLogger(),
      createHasher(),
      createTableRepoStub(t0.table, t1.table),
      { executeSyncMany } as unknown as ComputedFieldBackfillService,
      bus,
      undefined,
      undefined,
      lifecycleSink
    );

    // Stage 0 completes -> must NOT mark refresh completed yet
    await worker.runOnce({ workerId: 'worker-1', limit: 10 });
    expect(lifecycleSink.onCompleted).not.toHaveBeenCalled();
    expect(lifecycleSink.onFailed).not.toHaveBeenCalled();

    // Stage 1 completes -> now final stage committed, marks refresh completed
    await worker.runOnce({ workerId: 'worker-1', limit: 10 });
    expect(lifecycleSink.onCompleted).toHaveBeenCalledTimes(1);
    expect(lifecycleSink.onCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        ...periodicRefresh,
        baseId: BASE_ID,
        taskId: 'cuo-stage-1',
        completedAt: expect.any(Date),
      })
    );
    expect(lifecycleSink.onFailed).not.toHaveBeenCalled();
  });

  it('invokes lifecycleSink.onFailed only on terminal exhaustion/non-retryable failure, not on retryable attempts', async () => {
    const t1 = makeTable(TABLE_1_ID, FIELD_1_ID);
    const periodicRefresh = {
      sourceFieldId: FIELD_0_ID,
      sourceTableId: TABLE_0_ID,
      rangeHash: 'r:month_2026_09',
      localDate: '2026-09-01',
      timeZone: 'UTC',
      containsNowPrecision: false,
      triggeredAtIso: '2026-09-01T00:05:00.000Z',
    };

    const retryableAttempt = baseTask({
      id: 'cuo-stage-1',
      tableId: TABLE_1_ID,
      fieldIds: [FIELD_1_ID],
      attempts: 0,
      maxAttempts: 8,
      stageChain: {
        remainingStages: [],
        notifyTargets: [{ tableId: TABLE_0_ID, fieldIds: [FIELD_0_ID] }],
        periodicRefresh,
      },
    });
    const finalExhaustedAttempt = baseTask({
      ...retryableAttempt,
      attempts: 7,
      maxAttempts: 8,
    });

    const executeSyncMany = vi
      .fn()
      .mockResolvedValue(
        err(domainError.infrastructure({ message: 'Transient connection reset' }))
      );

    const lifecycleSink: IPeriodicFieldRefreshLifecycleSink = {
      onCompleted: vi.fn().mockResolvedValue(undefined),
      onFailed: vi.fn().mockResolvedValue(undefined),
    };

    const { bus } = createEventBus();
    const worker = new ComputedUpdateWorker(
      createOutboxStub({
        claimBatch: vi
          .fn()
          .mockResolvedValueOnce(ok([retryableAttempt]))
          .mockResolvedValueOnce(ok([finalExhaustedAttempt])),
      }),
      defaultComputedUpdateOutboxConfig,
      createUpdaterStub(),
      {} as ComputedUpdatePlanner,
      createUnitOfWork(),
      createNoopLogger(),
      createHasher(),
      createTableRepoStub(t1.table),
      { executeSyncMany } as unknown as ComputedFieldBackfillService,
      bus,
      undefined,
      undefined,
      lifecycleSink
    );

    // Retryable attempt 1/8 -> does NOT invoke onFailed yet
    await worker.runOnce({ workerId: 'worker-1', limit: 10 });
    expect(lifecycleSink.onFailed).not.toHaveBeenCalled();

    // Attempt 8/8 exhausts retries -> moves to dead letter and notifies lifecycleSink.onFailed
    await worker.runOnce({ workerId: 'worker-1', limit: 10 });
    expect(lifecycleSink.onFailed).toHaveBeenCalledTimes(1);
    expect(lifecycleSink.onFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        ...periodicRefresh,
        baseId: BASE_ID,
        taskId: 'cuo-stage-1',
        message: 'Transient connection reset',
        failedAt: expect.any(Date),
      })
    );
    expect(lifecycleSink.onCompleted).not.toHaveBeenCalled();
  });
});

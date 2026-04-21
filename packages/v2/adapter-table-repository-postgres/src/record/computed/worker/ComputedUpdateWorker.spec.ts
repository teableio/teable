import { domainError, FieldId, RecordId, RecordsBatchUpdated, TableId } from '@teable/v2-core';
import type { IEventBus, IHasher, ILogger, ITableRepository, IUnitOfWork } from '@teable/v2-core';
import { ok, err } from 'neverthrow';
import { describe, it, expect, vi } from 'vitest';

import type { ComputedFieldBackfillService } from '../ComputedFieldBackfillService';
import type { ComputedFieldUpdater } from '../ComputedFieldUpdater';
import type { ComputedUpdatePlanner } from '../ComputedUpdatePlanner';
import { COMPUTED_UPDATE_LOCK_UNAVAILABLE_CODE } from '../ComputedUpdateLock';
import type { ComputedUpdateOutboxItem } from '../outbox/ComputedUpdateOutboxPayload';
import {
  defaultComputedUpdateOutboxConfig,
  type IComputedUpdateOutbox,
} from '../outbox/IComputedUpdateOutbox';
import { ComputedUpdateWorker } from './ComputedUpdateWorker';

const BASE_ID = `bse${'a'.repeat(16)}`;
const TABLE_ID = `tbl${'b'.repeat(16)}`;
const FIELD_ID = `fld${'c'.repeat(16)}`;
const RECORD_ID = `rec${'d'.repeat(16)}`;

// Create a mock logger
const createLogger = (): ILogger => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn().mockReturnThis(),
  scope: vi.fn().mockReturnThis(),
});

// Create a mock hasher
const createHasher = (): IHasher => ({
  sha256: vi.fn().mockReturnValue('hash123'),
});

// Create a mock unit of work
const createUnitOfWork = (): IUnitOfWork => ({
  withTransaction: vi.fn().mockImplementation(async (_ctx, fn) => fn(_ctx)),
});

const createTableRepository = (): ITableRepository => ({}) as unknown as ITableRepository;

const createBackfillService = (): ComputedFieldBackfillService =>
  ({
    executeSyncMany: vi.fn(),
  }) as unknown as ComputedFieldBackfillService;

const createEventBus = (): IEventBus =>
  ({
    publish: vi.fn(),
    publishMany: vi.fn().mockResolvedValue(ok(undefined)),
  }) as unknown as IEventBus;

const createLockResult = () =>
  ok({
    mode: 'record',
    totalLocks: 1,
    recordLocks: 1,
    tableLocks: 0,
    tableLockTableIds: [],
    seedRecordCount: 1,
  });

const createUpdaterStub = (overrides: Record<string, unknown> = {}) =>
  ({
    acquireLocks: vi.fn().mockResolvedValue(createLockResult()),
    ...overrides,
  }) as unknown as ComputedFieldUpdater;

const createOutboxStub = (
  overrides: Partial<IComputedUpdateOutbox> = {}
): IComputedUpdateOutbox => ({
  enqueueOrMerge: vi.fn(),
  enqueueSeedTask: vi.fn(),
  enqueueFieldBackfill: vi.fn(),
  claimBatch: vi.fn().mockResolvedValue(ok([])),
  claimById: vi.fn().mockResolvedValue(ok(null)),
  renewLease: vi
    .fn()
    .mockImplementation(({ taskIds }: { taskIds: string[] }) => Promise.resolve(ok(taskIds))),
  releaseForRetry: vi.fn().mockResolvedValue(ok(true)),
  markDone: vi.fn().mockResolvedValue(ok(true)),
  markFailed: vi.fn().mockResolvedValue(ok(true)),
  ...overrides,
});

// Create a mock task
const createMockTask = (
  overrides: Partial<ComputedUpdateOutboxItem> = {}
): ComputedUpdateOutboxItem => ({
  id: 'cuo123456789012345',
  baseId: BASE_ID,
  seedTableId: TABLE_ID,
  seedRecordIds: [RECORD_ID],
  extraSeedRecords: [],
  steps: [{ level: 0, tableId: TABLE_ID, fieldIds: [FIELD_ID] }],
  edges: [],
  estimatedComplexity: 1,
  changeType: 'update',
  planHash: 'abc123',
  dirtyStats: [{ tableId: TABLE_ID, recordCount: 1 }],
  runId: 'run123',
  originRunIds: ['run123'],
  runTotalSteps: 1,
  runCompletedStepsBefore: 0,
  affectedTableIds: [TABLE_ID],
  affectedFieldIds: [FIELD_ID],
  syncMaxLevel: 0,
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

describe('ComputedUpdateWorker', () => {
  describe('runOnce', () => {
    it('returns 0 when no tasks are claimed', async () => {
      const outbox = createOutboxStub();

      const updater = createUpdaterStub();
      const planner = {} as ComputedUpdatePlanner;
      const logger = createLogger();
      const hasher = createHasher();
      const unitOfWork = createUnitOfWork();

      const worker = new ComputedUpdateWorker(
        outbox,
        defaultComputedUpdateOutboxConfig,
        updater,
        planner,
        unitOfWork,
        logger,
        hasher,
        createTableRepository(),
        createBackfillService(),
        createEventBus()
      );

      const result = await worker.runOnce({ workerId: 'worker-1', limit: 10 });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(0);
    });

    it('calls markFailed when task execution fails', async () => {
      const task = createMockTask();
      const markFailed = vi.fn().mockResolvedValue(ok(true));

      const outbox = createOutboxStub({
        claimBatch: vi.fn().mockResolvedValue(ok([task])),
        markFailed,
      });

      const updater = createUpdaterStub({
        execute: vi
          .fn()
          .mockResolvedValue(err(domainError.infrastructure({ message: 'Test error' }))),
        collectDirtySeedGroups: vi.fn().mockResolvedValue(ok({ groups: [], seedAllTableIds: [] })),
      });

      const planner = {
        planStage: vi.fn().mockResolvedValue(ok({ steps: [], edges: [] })),
      } as unknown as ComputedUpdatePlanner;

      const logger = createLogger();
      const hasher = createHasher();
      const unitOfWork: IUnitOfWork = {
        withTransaction: vi.fn().mockImplementation(async (_ctx, fn) => {
          return fn(_ctx);
        }),
      };

      const worker = new ComputedUpdateWorker(
        outbox,
        defaultComputedUpdateOutboxConfig,
        updater,
        planner,
        unitOfWork,
        logger,
        hasher,
        createTableRepository(),
        createBackfillService(),
        createEventBus()
      );

      await worker.runOnce({ workerId: 'worker-1', limit: 10 });

      expect(markFailed).toHaveBeenCalledWith(task, expect.any(String), expect.anything());
    });

    it('releases the task for retry when computed locks are unavailable', async () => {
      const task = createMockTask();
      const releaseForRetry = vi.fn().mockResolvedValue(ok(true));
      const markFailed = vi.fn().mockResolvedValue(ok(true));
      const execute = vi.fn().mockResolvedValue(ok({ changesByStep: [] }));

      const outbox = createOutboxStub({
        claimBatch: vi.fn().mockResolvedValue(ok([task])),
        releaseForRetry,
        markFailed,
      });

      const updater = createUpdaterStub({
        acquireLocks: vi.fn().mockResolvedValue(
          err(
            domainError.infrastructure({
              code: COMPUTED_UPDATE_LOCK_UNAVAILABLE_CODE,
              message: 'Computed update lock unavailable: lock-key',
            })
          )
        ),
        execute,
        collectDirtySeedGroups: vi.fn().mockResolvedValue(ok({ groups: [], seedAllTableIds: [] })),
      });

      const planner = {
        planStage: vi.fn().mockResolvedValue(ok({ steps: [], edges: [] })),
      } as unknown as ComputedUpdatePlanner;

      const worker = new ComputedUpdateWorker(
        outbox,
        defaultComputedUpdateOutboxConfig,
        updater,
        planner,
        createUnitOfWork(),
        createLogger(),
        createHasher(),
        createTableRepository(),
        createBackfillService(),
        createEventBus()
      );

      const result = await worker.runOnce({ workerId: 'worker-1', limit: 10 });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(0);
      expect(releaseForRetry).toHaveBeenCalledWith(
        {
          task,
          reason: 'Computed update lock unavailable: lock-key',
        },
        expect.anything()
      );
      expect(markFailed).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
    });

    it('splits large computed tasks into smaller child tasks before acquiring locks', async () => {
      const seedRecordIds = Array.from(
        { length: 5 },
        (_, index) => `rec${index.toString().padStart(16, '0')}`
      );
      const task = createMockTask({
        seedRecordIds,
        beforeImageRecords: seedRecordIds.map((recordId) => ({
          recordId,
          fieldValuesByDbName: { col_value: recordId },
        })),
      });
      const enqueueOrMerge = vi.fn().mockResolvedValue(ok({ taskId: 'child', merged: false }));
      const markDone = vi.fn().mockResolvedValue(ok(true));
      const acquireLocks = vi.fn().mockResolvedValue(createLockResult());

      const outbox = createOutboxStub({
        claimBatch: vi.fn().mockResolvedValue(ok([task])),
        enqueueOrMerge,
        markDone,
      });

      const worker = new ComputedUpdateWorker(
        outbox,
        {
          ...defaultComputedUpdateOutboxConfig,
          maxSeedRecordsPerTask: 2,
        },
        createUpdaterStub({ acquireLocks }),
        {} as ComputedUpdatePlanner,
        createUnitOfWork(),
        createLogger(),
        createHasher(),
        createTableRepository(),
        createBackfillService(),
        createEventBus()
      );

      const result = await worker.runOnce({ workerId: 'worker-1', limit: 10 });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(1);
      expect(enqueueOrMerge).toHaveBeenCalledTimes(3);
      expect(enqueueOrMerge.mock.calls.map((call) => call[0].seedRecordIds)).toEqual([
        seedRecordIds.slice(0, 2),
        seedRecordIds.slice(2, 4),
        seedRecordIds.slice(4, 5),
      ]);
      expect(enqueueOrMerge.mock.calls.map((call) => call[0].planHash)).toEqual([
        'abc123:chunk:1/3',
        'abc123:chunk:2/3',
        'abc123:chunk:3/3',
      ]);
      expect(markDone).toHaveBeenCalledWith(task, expect.anything());
      expect(acquireLocks).not.toHaveBeenCalled();
    });

    it('calls markDone when task execution succeeds', async () => {
      const task = createMockTask();
      const markDone = vi.fn().mockResolvedValue(ok(true));

      const outbox = createOutboxStub({
        claimBatch: vi.fn().mockResolvedValue(ok([task])),
        markDone,
      });

      const updater = createUpdaterStub({
        execute: vi.fn().mockResolvedValue(ok({ changesByStep: [] })),
        collectDirtySeedGroups: vi.fn().mockResolvedValue(ok({ groups: [], seedAllTableIds: [] })),
      });

      const planner = {
        planStage: vi.fn().mockResolvedValue(ok({ steps: [], edges: [] })),
      } as unknown as ComputedUpdatePlanner;

      const logger = createLogger();
      const hasher = createHasher();
      const unitOfWork: IUnitOfWork = {
        withTransaction: vi.fn().mockImplementation(async (_ctx, fn) => {
          return fn(_ctx);
        }),
      };

      const worker = new ComputedUpdateWorker(
        outbox,
        defaultComputedUpdateOutboxConfig,
        updater,
        planner,
        unitOfWork,
        logger,
        hasher,
        createTableRepository(),
        createBackfillService(),
        createEventBus()
      );

      const result = await worker.runOnce({ workerId: 'worker-1', limit: 10 });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(1);
      expect(markDone).toHaveBeenCalledWith(task, expect.anything());
    });

    it('publishes computed update events with orchestration metadata from the outbox task', async () => {
      const task = createMockTask({
        orchestration: {
          operationId: 'opr_stream_duplicate',
          groupId: 'opr_stream_duplicate',
          totalRecordCount: 2000,
          totalChunkCount: 4,
          chunkIndex: 0,
          scope: 'chunk',
        },
      });
      const markDone = vi.fn().mockResolvedValue(ok(true));
      const eventBus = createEventBus();

      const outbox = createOutboxStub({
        claimBatch: vi.fn().mockResolvedValue(ok([task])),
        markDone,
      });

      const updater = createUpdaterStub({
        execute: vi.fn().mockResolvedValue(
          ok({
            changesByStep: [
              {
                tableId: TABLE_ID,
                recordChanges: [
                  {
                    recordId: RECORD_ID,
                    oldVersion: 1,
                    changes: [{ fieldId: FIELD_ID, newValue: 'updated' }],
                  },
                ],
              },
            ],
          })
        ),
        collectDirtySeedGroups: vi.fn().mockResolvedValue(ok({ groups: [], seedAllTableIds: [] })),
      });

      const worker = new ComputedUpdateWorker(
        outbox,
        defaultComputedUpdateOutboxConfig,
        updater,
        {} as ComputedUpdatePlanner,
        createUnitOfWork(),
        createLogger(),
        createHasher(),
        createTableRepository(),
        createBackfillService(),
        eventBus
      );

      const result = await worker.runOnce({ workerId: 'worker-1', limit: 10 });

      expect(result.isOk()).toBe(true);
      expect(eventBus.publishMany).toHaveBeenCalledTimes(1);
      const publishedEvents = vi.mocked(eventBus.publishMany).mock.calls[0]?.[1] as
        | RecordsBatchUpdated[]
        | undefined;
      const batchEvent = publishedEvents?.find((event) => event instanceof RecordsBatchUpdated);
      expect(batchEvent?.orchestration).toEqual(task.orchestration);
    });

    it('defers computed update event publishing until the transaction commits', async () => {
      const task = createMockTask();
      const eventBus = createEventBus();
      const afterCommitHandlers: Array<() => Promise<void> | void> = [];
      const transaction = {
        kind: 'unitOfWorkTransaction' as const,
        afterCommit: vi.fn((handler: () => Promise<void> | void) => {
          afterCommitHandlers.push(handler);
        }),
      };
      const unitOfWork: IUnitOfWork = {
        withTransaction: vi.fn().mockImplementation(async (ctx, fn) => {
          const result = await fn({ ...ctx, transaction });
          expect(eventBus.publishMany).not.toHaveBeenCalled();
          for (const handler of afterCommitHandlers) {
            await handler();
          }
          return result;
        }),
      };

      const outbox = createOutboxStub({
        claimBatch: vi.fn().mockResolvedValue(ok([task])),
      });
      const updater = createUpdaterStub({
        execute: vi.fn().mockResolvedValue(
          ok({
            changesByStep: [
              {
                tableId: TABLE_ID,
                recordChanges: [
                  {
                    recordId: RECORD_ID,
                    oldVersion: 1,
                    changes: [{ fieldId: FIELD_ID, newValue: 'updated' }],
                  },
                ],
              },
            ],
          })
        ),
        collectDirtySeedGroups: vi.fn().mockResolvedValue(ok({ groups: [], seedAllTableIds: [] })),
      });

      const worker = new ComputedUpdateWorker(
        outbox,
        defaultComputedUpdateOutboxConfig,
        updater,
        {} as ComputedUpdatePlanner,
        unitOfWork,
        createLogger(),
        createHasher(),
        createTableRepository(),
        createBackfillService(),
        eventBus
      );

      const result = await worker.runOnce({ workerId: 'worker-1', limit: 10 });

      expect(result.isOk()).toBe(true);
      expect(transaction.afterCommit).toHaveBeenCalledTimes(1);
      expect(eventBus.publishMany).toHaveBeenCalledTimes(1);
      expect(vi.mocked(eventBus.publishMany).mock.calls[0]?.[0]).not.toHaveProperty('transaction');
    });

    it('processes multiple tasks and counts successful ones', async () => {
      const task1 = createMockTask({ id: 'cuo1' });
      const task2 = createMockTask({ id: 'cuo2' });
      const task3 = createMockTask({ id: 'cuo3' });
      const markDone = vi.fn().mockResolvedValue(ok(true));

      const outbox = createOutboxStub({
        claimBatch: vi.fn().mockResolvedValue(ok([task1, task2, task3])),
        markDone,
      });

      const updater = createUpdaterStub({
        execute: vi.fn().mockResolvedValue(ok({ changesByStep: [] })),
        collectDirtySeedGroups: vi.fn().mockResolvedValue(ok({ groups: [], seedAllTableIds: [] })),
      });

      const planner = {
        planStage: vi.fn().mockResolvedValue(ok({ steps: [], edges: [] })),
      } as unknown as ComputedUpdatePlanner;

      const logger = createLogger();
      const hasher = createHasher();
      const unitOfWork: IUnitOfWork = {
        withTransaction: vi.fn().mockImplementation(async (_ctx, fn) => {
          return fn(_ctx);
        }),
      };

      const worker = new ComputedUpdateWorker(
        outbox,
        defaultComputedUpdateOutboxConfig,
        updater,
        planner,
        unitOfWork,
        logger,
        hasher,
        createTableRepository(),
        createBackfillService(),
        createEventBus()
      );

      const result = await worker.runOnce({ workerId: 'worker-1', limit: 10 });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(3);
      expect(markDone).toHaveBeenCalledTimes(3);
    });

    it('downgrades insert changeType to update when planning next async stage', async () => {
      // Next-stage planning is only needed when the current stage has cross-record propagation
      // edges. If edges are empty (pure same-record work like same-table formula chains),
      // the worker should mark the task done without re-planning.
      const task = createMockTask({
        changeType: 'insert',
        edges: [
          {
            fromFieldId: FIELD_ID,
            toFieldId: `fld${'e'.repeat(16)}`,
            fromTableId: TABLE_ID,
            toTableId: TABLE_ID,
            order: 0,
          },
        ],
      });
      const markDone = vi.fn().mockResolvedValue(ok(true));

      const outbox = createOutboxStub({
        claimBatch: vi.fn().mockResolvedValue(ok([task])),
        markDone,
      });

      const updater = createUpdaterStub({
        execute: vi.fn().mockResolvedValue(ok({ changesByStep: [] })),
        collectDirtySeedGroups: vi.fn().mockResolvedValue(
          ok({
            groups: [
              {
                tableId: TableId.create(TABLE_ID)._unsafeUnwrap(),
                recordIds: [RecordId.create(RECORD_ID)._unsafeUnwrap()],
              },
            ],
            seedAllTableIds: [],
          })
        ),
      });

      const planner = {
        planStage: vi.fn().mockResolvedValue(ok({ steps: [], edges: [] })),
      } as unknown as ComputedUpdatePlanner;

      const logger = createLogger();
      const hasher = createHasher();
      const unitOfWork: IUnitOfWork = {
        withTransaction: vi.fn().mockImplementation(async (_ctx, fn) => {
          return fn(_ctx);
        }),
      };

      const worker = new ComputedUpdateWorker(
        outbox,
        defaultComputedUpdateOutboxConfig,
        updater,
        planner,
        unitOfWork,
        logger,
        hasher,
        createTableRepository(),
        createBackfillService(),
        createEventBus()
      );

      await worker.runOnce({ workerId: 'worker-1', limit: 10 });

      // After the first insert stage completes, plan subsequent stages as updates to avoid
      // re-planning seed-table computed fields.
      expect(planner.planStage).toHaveBeenCalledWith(
        expect.objectContaining({
          changeType: 'update',
          changedFieldIds: [FieldId.create(FIELD_ID)._unsafeUnwrap()],
        }),
        expect.anything()
      );
    });

    it('logs task failure with run context', async () => {
      const task = createMockTask({
        runId: 'run-abc',
        originRunIds: ['origin-1', 'origin-2'],
      });

      const outbox = createOutboxStub({
        claimBatch: vi.fn().mockResolvedValue(ok([task])),
      });

      const updater = createUpdaterStub({
        execute: vi
          .fn()
          .mockResolvedValue(err(domainError.infrastructure({ message: 'Test error' }))),
        collectDirtySeedGroups: vi.fn(),
      });

      const planner = {} as ComputedUpdatePlanner;

      const logger = createLogger();
      const hasher = createHasher();
      const unitOfWork: IUnitOfWork = {
        withTransaction: vi.fn().mockImplementation(async (_ctx, fn) => {
          return fn(_ctx);
        }),
      };

      const worker = new ComputedUpdateWorker(
        outbox,
        defaultComputedUpdateOutboxConfig,
        updater,
        planner,
        unitOfWork,
        logger,
        hasher,
        createTableRepository(),
        createBackfillService(),
        createEventBus()
      );

      await worker.runOnce({ workerId: 'worker-1', limit: 10 });

      expect(logger.error).toHaveBeenCalledWith(
        'computed:outbox:task_failed',
        expect.objectContaining({
          taskId: task.id,
          computedRunId: 'run-abc',
          computedOriginRunIds: ['origin-1', 'origin-2'],
        })
      );
    });

    it('handles markFailed errors gracefully', async () => {
      const task = createMockTask();
      const markFailed = vi
        .fn()
        .mockResolvedValue(err(domainError.infrastructure({ message: 'Mark failed error' })));

      const outbox = createOutboxStub({
        claimBatch: vi.fn().mockResolvedValue(ok([task])),
        markFailed,
      });

      const updater = createUpdaterStub({
        execute: vi
          .fn()
          .mockResolvedValue(err(domainError.infrastructure({ message: 'Test error' }))),
        collectDirtySeedGroups: vi.fn(),
      });

      const planner = {} as ComputedUpdatePlanner;

      const logger = createLogger();
      const hasher = createHasher();
      const unitOfWork: IUnitOfWork = {
        withTransaction: vi.fn().mockImplementation(async (_ctx, fn) => {
          return fn(_ctx);
        }),
      };

      const worker = new ComputedUpdateWorker(
        outbox,
        defaultComputedUpdateOutboxConfig,
        updater,
        planner,
        unitOfWork,
        logger,
        hasher,
        createTableRepository(),
        createBackfillService(),
        createEventBus()
      );

      // Should not throw
      const result = await worker.runOnce({ workerId: 'worker-1', limit: 10 });

      expect(result.isOk()).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith(
        'computed:outbox:markFailed_failed',
        expect.objectContaining({
          taskId: task.id,
        })
      );
    });

    it('renews leases while a long-running task is still processing', async () => {
      vi.useFakeTimers();
      try {
        const task = createMockTask({ lockedBy: 'worker-1:cuc_lease' });
        const renewLease = vi.fn().mockResolvedValue(ok([task.id]));
        const markDone = vi.fn().mockResolvedValue(ok(true));

        const outbox = createOutboxStub({
          claimBatch: vi.fn().mockResolvedValue(ok([task])),
          renewLease,
          markDone,
        });

        const updater = createUpdaterStub({
          execute: vi.fn().mockImplementation(async () => {
            await new Promise((resolve) => setTimeout(resolve, 3500));
            return ok({ changesByStep: [] });
          }),
          collectDirtySeedGroups: vi
            .fn()
            .mockResolvedValue(ok({ groups: [], seedAllTableIds: [] })),
        });

        const planner = {
          planStage: vi.fn().mockResolvedValue(ok({ steps: [], edges: [] })),
        } as unknown as ComputedUpdatePlanner;

        const worker = new ComputedUpdateWorker(
          outbox,
          {
            ...defaultComputedUpdateOutboxConfig,
            processingLeaseMs: 3000,
            heartbeatIntervalMs: 1000,
          },
          updater,
          planner,
          createUnitOfWork(),
          createLogger(),
          createHasher(),
          createTableRepository(),
          createBackfillService(),
          createEventBus()
        );

        const runPromise = worker.runOnce({ workerId: 'worker-1', limit: 10 });
        await vi.advanceTimersByTimeAsync(3500);
        const result = await runPromise;

        expect(result.isOk()).toBe(true);
        expect(result._unsafeUnwrap()).toBe(1);
        expect(renewLease).toHaveBeenCalled();
        expect(renewLease.mock.calls.length).toBeGreaterThanOrEqual(2);
        expect(markDone).toHaveBeenCalledWith(task, expect.anything());
      } finally {
        vi.useRealTimers();
      }
    });

    it('skips claimed tasks that lose their lease before processing starts', async () => {
      const task1 = createMockTask({ id: 'cuo-lease-1', lockedBy: 'worker-1:cuc_batch' });
      const task2 = createMockTask({ id: 'cuo-lease-2', lockedBy: 'worker-1:cuc_batch' });
      const renewLease = vi
        .fn()
        .mockImplementation(({ taskIds }: { taskIds: string[] }) =>
          Promise.resolve(ok(taskIds.includes(task2.id) ? [] : taskIds))
        );
      const markDone = vi.fn().mockResolvedValue(ok(true));

      const outbox = createOutboxStub({
        claimBatch: vi.fn().mockResolvedValue(ok([task1, task2])),
        renewLease,
        markDone,
      });

      const updater = createUpdaterStub({
        execute: vi.fn().mockResolvedValue(ok({ changesByStep: [] })),
        collectDirtySeedGroups: vi.fn().mockResolvedValue(ok({ groups: [], seedAllTableIds: [] })),
      });

      const planner = {
        planStage: vi.fn().mockResolvedValue(ok({ steps: [], edges: [] })),
      } as unknown as ComputedUpdatePlanner;

      const logger = createLogger();
      const worker = new ComputedUpdateWorker(
        outbox,
        defaultComputedUpdateOutboxConfig,
        updater,
        planner,
        createUnitOfWork(),
        logger,
        createHasher(),
        createTableRepository(),
        createBackfillService(),
        createEventBus()
      );

      const result = await worker.runOnce({ workerId: 'worker-1', limit: 10 });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(1);
      expect(markDone).toHaveBeenCalledTimes(1);
      expect(markDone).toHaveBeenCalledWith(task1, expect.anything());
      expect(logger.warn).toHaveBeenCalledWith(
        'computed:worker:task_skipped_lost_lease',
        expect.objectContaining({ taskId: task2.id })
      );
    });
  });

  describe('runTaskById', () => {
    it('claims and processes the specified task id', async () => {
      const task = createMockTask();
      const markDone = vi.fn().mockResolvedValue(ok(true));
      const claimById = vi.fn().mockResolvedValue(ok(task));

      const outbox = createOutboxStub({
        claimById,
        markDone,
      });

      const updater = createUpdaterStub({
        execute: vi.fn().mockResolvedValue(ok({ changesByStep: [] })),
        collectDirtySeedGroups: vi.fn().mockResolvedValue(ok({ groups: [], seedAllTableIds: [] })),
      });

      const planner = {
        planStage: vi.fn().mockResolvedValue(ok({ steps: [], edges: [] })),
      } as unknown as ComputedUpdatePlanner;

      const worker = new ComputedUpdateWorker(
        outbox,
        defaultComputedUpdateOutboxConfig,
        updater,
        planner,
        createUnitOfWork(),
        createLogger(),
        createHasher(),
        createTableRepository(),
        createBackfillService(),
        createEventBus()
      );

      const result = await worker.runTaskById({
        taskId: task.id,
        workerId: 'manual-worker',
      });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(true);
      expect(claimById).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: task.id,
          workerId: 'manual-worker',
          allowProcessingTakeover: true,
        }),
        expect.anything()
      );
      expect(markDone).toHaveBeenCalledWith(task, expect.anything());
    });

    it('returns false when the task cannot be claimed by id', async () => {
      const outbox = createOutboxStub({
        claimById: vi.fn().mockResolvedValue(ok(null)),
      });

      const worker = new ComputedUpdateWorker(
        outbox,
        defaultComputedUpdateOutboxConfig,
        createUpdaterStub(),
        {} as ComputedUpdatePlanner,
        createUnitOfWork(),
        createLogger(),
        createHasher(),
        createTableRepository(),
        createBackfillService(),
        createEventBus()
      );

      const result = await worker.runTaskById({
        taskId: 'cuo-missing',
        workerId: 'manual-worker',
      });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(false);
    });
  });
});

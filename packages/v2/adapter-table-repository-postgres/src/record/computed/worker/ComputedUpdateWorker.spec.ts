import { domainError, FieldId, RecordId, TableId } from '@teable/v2-core';
import type { IEventBus, IHasher, ILogger, ITableRepository, IUnitOfWork } from '@teable/v2-core';
import { ok, err } from 'neverthrow';
import { describe, it, expect, vi } from 'vitest';

import type { ComputedFieldBackfillService } from '../ComputedFieldBackfillService';
import type { ComputedFieldUpdater } from '../ComputedFieldUpdater';
import type { ComputedUpdatePlanner } from '../ComputedUpdatePlanner';
import type { ComputedUpdateOutboxItem } from '../outbox/ComputedUpdateOutboxPayload';
import type { IComputedUpdateOutbox } from '../outbox/IComputedUpdateOutbox';
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
      const outbox: IComputedUpdateOutbox = {
        enqueueOrMerge: vi.fn(),
        enqueueSeedTask: vi.fn(),
        enqueueFieldBackfill: vi.fn(),
        claimBatch: vi.fn().mockResolvedValue(ok([])),
        markDone: vi.fn(),
        markFailed: vi.fn(),
      };

      const updater = createUpdaterStub();
      const planner = {} as ComputedUpdatePlanner;
      const logger = createLogger();
      const hasher = createHasher();
      const unitOfWork = createUnitOfWork();

      const worker = new ComputedUpdateWorker(
        outbox,
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
      const markFailed = vi.fn().mockResolvedValue(ok(undefined));

      const outbox: IComputedUpdateOutbox = {
        enqueueOrMerge: vi.fn(),
        enqueueSeedTask: vi.fn(),
        enqueueFieldBackfill: vi.fn(),
        claimBatch: vi.fn().mockResolvedValue(ok([task])),
        markDone: vi.fn(),
        markFailed,
      };

      const updater = createUpdaterStub({
        execute: vi
          .fn()
          .mockResolvedValue(err(domainError.infrastructure({ message: 'Test error' }))),
        collectDirtySeedGroups: vi.fn().mockResolvedValue(ok([])),
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

    it('calls markDone when task execution succeeds', async () => {
      const task = createMockTask();
      const markDone = vi.fn().mockResolvedValue(ok(undefined));

      const outbox: IComputedUpdateOutbox = {
        enqueueOrMerge: vi.fn(),
        enqueueSeedTask: vi.fn(),
        enqueueFieldBackfill: vi.fn(),
        claimBatch: vi.fn().mockResolvedValue(ok([task])),
        markDone,
        markFailed: vi.fn(),
      };

      const updater = createUpdaterStub({
        execute: vi.fn().mockResolvedValue(ok({ changesByStep: [] })),
        collectDirtySeedGroups: vi.fn().mockResolvedValue(ok([])),
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
      expect(markDone).toHaveBeenCalledWith(task.id, expect.anything());
    });

    it('processes multiple tasks and counts successful ones', async () => {
      const task1 = createMockTask({ id: 'cuo1' });
      const task2 = createMockTask({ id: 'cuo2' });
      const task3 = createMockTask({ id: 'cuo3' });
      const markDone = vi.fn().mockResolvedValue(ok(undefined));

      const outbox: IComputedUpdateOutbox = {
        enqueueOrMerge: vi.fn(),
        enqueueSeedTask: vi.fn(),
        enqueueFieldBackfill: vi.fn(),
        claimBatch: vi.fn().mockResolvedValue(ok([task1, task2, task3])),
        markDone,
        markFailed: vi.fn(),
      };

      const updater = createUpdaterStub({
        execute: vi.fn().mockResolvedValue(ok({ changesByStep: [] })),
        collectDirtySeedGroups: vi.fn().mockResolvedValue(ok([])),
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
      const markDone = vi.fn().mockResolvedValue(ok(undefined));

      const outbox: IComputedUpdateOutbox = {
        enqueueOrMerge: vi.fn(),
        enqueueSeedTask: vi.fn(),
        enqueueFieldBackfill: vi.fn(),
        claimBatch: vi.fn().mockResolvedValue(ok([task])),
        markDone,
        markFailed: vi.fn(),
      };

      const updater = createUpdaterStub({
        execute: vi.fn().mockResolvedValue(ok({ changesByStep: [] })),
        collectDirtySeedGroups: vi.fn().mockResolvedValue(
          ok([
            {
              tableId: TableId.create(TABLE_ID)._unsafeUnwrap(),
              recordIds: [RecordId.create(RECORD_ID)._unsafeUnwrap()],
            },
          ])
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

      const outbox: IComputedUpdateOutbox = {
        enqueueOrMerge: vi.fn(),
        enqueueSeedTask: vi.fn(),
        enqueueFieldBackfill: vi.fn(),
        claimBatch: vi.fn().mockResolvedValue(ok([task])),
        markDone: vi.fn(),
        markFailed: vi.fn().mockResolvedValue(ok(undefined)),
      };

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

      const outbox: IComputedUpdateOutbox = {
        enqueueOrMerge: vi.fn(),
        enqueueSeedTask: vi.fn(),
        enqueueFieldBackfill: vi.fn(),
        claimBatch: vi.fn().mockResolvedValue(ok([task])),
        markDone: vi.fn(),
        markFailed,
      };

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
  });
});

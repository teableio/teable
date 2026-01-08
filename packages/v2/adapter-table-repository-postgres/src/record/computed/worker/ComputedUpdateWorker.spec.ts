import { domainError, type ILogger, type IHasher, type IUnitOfWork } from '@teable/v2-core';
import { ok, err } from 'neverthrow';
import { describe, it, expect, vi } from 'vitest';

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
        claimBatch: vi.fn().mockResolvedValue(ok([])),
        markDone: vi.fn(),
        markFailed: vi.fn(),
      };

      const updater = {} as ComputedFieldUpdater;
      const planner = {} as ComputedUpdatePlanner;
      const logger = createLogger();
      const hasher = createHasher();
      const unitOfWork = createUnitOfWork();

      const worker = new ComputedUpdateWorker(outbox, updater, planner, unitOfWork, logger, hasher);

      const result = await worker.runOnce({ workerId: 'worker-1', limit: 10 });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(0);
    });

    it('calls markFailed when task execution fails', async () => {
      const task = createMockTask();
      const markFailed = vi.fn().mockResolvedValue(ok(undefined));

      const outbox: IComputedUpdateOutbox = {
        enqueueOrMerge: vi.fn(),
        claimBatch: vi.fn().mockResolvedValue(ok([task])),
        markDone: vi.fn(),
        markFailed,
      };

      const updater = {
        execute: vi
          .fn()
          .mockResolvedValue(err(domainError.infrastructure({ message: 'Test error' }))),
        collectDirtySeedGroups: vi.fn().mockResolvedValue(ok([])),
      } as unknown as ComputedFieldUpdater;

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

      const worker = new ComputedUpdateWorker(outbox, updater, planner, unitOfWork, logger, hasher);

      await worker.runOnce({ workerId: 'worker-1', limit: 10 });

      expect(markFailed).toHaveBeenCalledWith(task, expect.any(String));
    });

    it('calls markDone when task execution succeeds', async () => {
      const task = createMockTask();
      const markDone = vi.fn().mockResolvedValue(ok(undefined));

      const outbox: IComputedUpdateOutbox = {
        enqueueOrMerge: vi.fn(),
        claimBatch: vi.fn().mockResolvedValue(ok([task])),
        markDone,
        markFailed: vi.fn(),
      };

      const updater = {
        execute: vi.fn().mockResolvedValue(ok(undefined)),
        collectDirtySeedGroups: vi.fn().mockResolvedValue(ok([])),
      } as unknown as ComputedFieldUpdater;

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

      const worker = new ComputedUpdateWorker(outbox, updater, planner, unitOfWork, logger, hasher);

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
        claimBatch: vi.fn().mockResolvedValue(ok([task1, task2, task3])),
        markDone,
        markFailed: vi.fn(),
      };

      const updater = {
        execute: vi.fn().mockResolvedValue(ok(undefined)),
        collectDirtySeedGroups: vi.fn().mockResolvedValue(ok([])),
      } as unknown as ComputedFieldUpdater;

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

      const worker = new ComputedUpdateWorker(outbox, updater, planner, unitOfWork, logger, hasher);

      const result = await worker.runOnce({ workerId: 'worker-1', limit: 10 });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(3);
      expect(markDone).toHaveBeenCalledTimes(3);
    });

    it('logs task failure with run context', async () => {
      const task = createMockTask({
        runId: 'run-abc',
        originRunIds: ['origin-1', 'origin-2'],
      });

      const outbox: IComputedUpdateOutbox = {
        enqueueOrMerge: vi.fn(),
        claimBatch: vi.fn().mockResolvedValue(ok([task])),
        markDone: vi.fn(),
        markFailed: vi.fn().mockResolvedValue(ok(undefined)),
      };

      const updater = {
        execute: vi
          .fn()
          .mockResolvedValue(err(domainError.infrastructure({ message: 'Test error' }))),
        collectDirtySeedGroups: vi.fn(),
      } as unknown as ComputedFieldUpdater;

      const planner = {} as ComputedUpdatePlanner;

      const logger = createLogger();
      const hasher = createHasher();
      const unitOfWork: IUnitOfWork = {
        withTransaction: vi.fn().mockImplementation(async (_ctx, fn) => {
          return fn(_ctx);
        }),
      };

      const worker = new ComputedUpdateWorker(outbox, updater, planner, unitOfWork, logger, hasher);

      await worker.runOnce({ workerId: 'worker-1', limit: 10 });

      expect(logger.warn).toHaveBeenCalledWith(
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
        claimBatch: vi.fn().mockResolvedValue(ok([task])),
        markDone: vi.fn(),
        markFailed,
      };

      const updater = {
        execute: vi
          .fn()
          .mockResolvedValue(err(domainError.infrastructure({ message: 'Test error' }))),
        collectDirtySeedGroups: vi.fn(),
      } as unknown as ComputedFieldUpdater;

      const planner = {} as ComputedUpdatePlanner;

      const logger = createLogger();
      const hasher = createHasher();
      const unitOfWork: IUnitOfWork = {
        withTransaction: vi.fn().mockImplementation(async (_ctx, fn) => {
          return fn(_ctx);
        }),
      };

      const worker = new ComputedUpdateWorker(outbox, updater, planner, unitOfWork, logger, hasher);

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

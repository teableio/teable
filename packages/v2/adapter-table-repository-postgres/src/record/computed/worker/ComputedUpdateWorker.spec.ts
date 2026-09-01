import {
  BaseId,
  domainError,
  FieldId,
  RecordId,
  RecordsBatchUpdated,
  TableId,
} from '@teable/v2-core';
import type {
  IEventBus,
  IHasher,
  ISpan,
  ITracer,
  ILogger,
  ITableRepository,
  IUnitOfWork,
  Table,
} from '@teable/v2-core';
import { ok, err } from 'neverthrow';
import { describe, it, expect, vi } from 'vitest';

import type { ComputedFieldBackfillService } from '../ComputedFieldBackfillService';
import type { ComputedFieldUpdater } from '../ComputedFieldUpdater';
import { COMPUTED_UPDATE_LOCK_UNAVAILABLE_CODE } from '../ComputedUpdateLock';
import type { ComputedUpdatePlan, ComputedUpdatePlanner } from '../ComputedUpdatePlanner';
import type { ComputedUpdateOutboxItem } from '../outbox/ComputedUpdateOutboxPayload';
import {
  defaultComputedUpdateOutboxConfig,
  normalizeComputedUpdateOutboxConfig,
  type SeedOutboxItem,
  type IComputedUpdateOutbox,
} from '../outbox/IComputedUpdateOutbox';
import {
  ComputedUpdateWorker,
  resolveEffectiveMaxSeedRecordsPerTask,
  shouldSkipOneLevelClamp,
  shouldWaitForSmallHostTask,
  splitComputedTaskForSeedRecordLimit,
  splitSeedTaskForSeedRecordLimit,
} from './ComputedUpdateWorker';

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
    pushStageLedgerFrontierSeeds: vi.fn().mockResolvedValue(ok(0)),
    settleStageLedgerPartialBatch: vi
      .fn()
      .mockResolvedValue(ok({ processedByTable: [], newFrontierRows: 0, retiredFrontierRows: 0 })),
    collectStageOutputSeedGroups: vi
      .fn()
      .mockResolvedValue(ok({ groups: [], seedAllTableIds: [] })),
    clearTaskStageLedger: vi.fn().mockResolvedValue(ok(0)),
    ...overrides,
  }) as unknown as ComputedFieldUpdater;

const createOutboxStub = (
  overrides: Partial<IComputedUpdateOutbox> = {}
): IComputedUpdateOutbox => ({
  enqueueOrMerge: vi.fn(),
  enqueueSeedTask: vi.fn(),
  registerPlannedTaskActivity: vi.fn().mockResolvedValue(ok(undefined)),
  enqueueFieldBackfill: vi.fn(),
  claimBatch: vi.fn().mockResolvedValue(ok([])),
  claimById: vi.fn().mockResolvedValue(ok(null)),
  renewLease: vi
    .fn()
    .mockImplementation(({ taskIds }: { taskIds: string[] }) => Promise.resolve(ok(taskIds))),
  releaseForRetry: vi.fn().mockResolvedValue(ok(true)),
  markDone: vi.fn().mockResolvedValue(ok(true)),
  markFailed: vi.fn().mockResolvedValue(ok(true)),
  projectStageSettlement: vi.fn().mockResolvedValue(ok(null)),
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

const createMockSeedTask = (overrides: Partial<SeedOutboxItem> = {}): SeedOutboxItem => ({
  id: 'cuo123456789012346',
  taskType: 'seed',
  baseId: BASE_ID,
  seedTableId: TABLE_ID,
  seedRecordIds: [RECORD_ID],
  extraSeedRecords: [],
  beforeImageRecords: [],
  changedFieldIds: [FIELD_ID],
  changeType: 'update',
  runId: 'run123',
  planHash: 'seed-hash123',
  status: 'processing',
  attempts: 5,
  maxAttempts: 8,
  nextRunAt: new Date(),
  lockedAt: new Date(),
  lockedBy: 'worker-1',
  lastError: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('ComputedUpdateWorker', () => {
  describe('config normalization', () => {
    it('clamps a 1-row dirty budget to 2 so seeding and propagation both get a slot', () => {
      const normalized = normalizeComputedUpdateOutboxConfig({
        ...defaultComputedUpdateOutboxConfig,
        stageMaxDirtyRecords: 1,
      });
      expect(normalized.stageMaxDirtyRecords).toBe(2);

      expect(
        normalizeComputedUpdateOutboxConfig({
          ...defaultComputedUpdateOutboxConfig,
          stageMaxDirtyRecords: 0,
        }).stageMaxDirtyRecords
      ).toBe(0);
    });
  });

  describe('shouldWaitForSmallHostTask', () => {
    it('never waits so lock-contention can requeue instead of blocking', () => {
      expect(
        shouldWaitForSmallHostTask(
          createMockTask({
            changeType: 'update',
            seedRecordIds: [RECORD_ID],
            dirtyStats: [{ tableId: TABLE_ID, recordCount: 1 }],
          })
        )
      ).toBe(false);
    });

    it('does not wait when dirty expansion covers a wide host fan-out', () => {
      expect(
        shouldWaitForSmallHostTask(
          createMockTask({
            changeType: 'update',
            seedRecordIds: [RECORD_ID],
            dirtyStats: [{ tableId: TABLE_ID, recordCount: 265 }],
          })
        )
      ).toBe(false);
    });
  });

  describe('shouldSkipOneLevelClamp', () => {
    it('skips only a tiny same-record host formula chain', () => {
      expect(
        shouldSkipOneLevelClamp(
          {
            changeType: 'update',
            seedAllTableIds: [],
            seedTableId: TableId.create(TABLE_ID)._unsafeUnwrap(),
            steps: [
              { level: 0, tableId: TableId.create(TABLE_ID)._unsafeUnwrap(), fieldIds: [] },
              { level: 1, tableId: TableId.create(TABLE_ID)._unsafeUnwrap(), fieldIds: [] },
            ],
            edges: [],
          },
          1
        )
      ).toBe(true);
    });

    it('keeps the clamp for a tiny cross-table chain', () => {
      expect(
        shouldSkipOneLevelClamp(
          {
            changeType: 'update',
            seedAllTableIds: [],
            seedTableId: TableId.create(TABLE_ID)._unsafeUnwrap(),
            steps: [
              { level: 0, tableId: TableId.create(TABLE_ID)._unsafeUnwrap(), fieldIds: [] },
              {
                level: 1,
                tableId: TableId.create(`tbl${'e'.repeat(16)}`)._unsafeUnwrap(),
                fieldIds: [],
              },
            ],
            edges: [],
          },
          1
        )
      ).toBe(false);
    });

    it('keeps the clamp when a 1-row source fans out to another table', () => {
      expect(
        shouldSkipOneLevelClamp(
          {
            changeType: 'update',
            seedAllTableIds: [],
            seedTableId: TableId.create(`tbl${'e'.repeat(16)}`)._unsafeUnwrap(),
            steps: [
              { level: 0, tableId: TableId.create(TABLE_ID)._unsafeUnwrap(), fieldIds: [] },
              { level: 1, tableId: TableId.create(TABLE_ID)._unsafeUnwrap(), fieldIds: [] },
            ],
            edges: [],
          },
          1
        )
      ).toBe(false);
    });

    it('keeps the clamp for same-table conditional rollup', () => {
      expect(
        shouldSkipOneLevelClamp(
          {
            changeType: 'insert',
            seedAllTableIds: [],
            seedTableId: TableId.create(TABLE_ID)._unsafeUnwrap(),
            steps: [
              { level: 0, tableId: TableId.create(TABLE_ID)._unsafeUnwrap(), fieldIds: [] },
              { level: 1, tableId: TableId.create(TABLE_ID)._unsafeUnwrap(), fieldIds: [] },
            ],
            edges: [
              {
                fromFieldId: FieldId.create(FIELD_ID)._unsafeUnwrap(),
                toFieldId: FieldId.create(FIELD_ID)._unsafeUnwrap(),
                fromTableId: TableId.create(TABLE_ID)._unsafeUnwrap(),
                toTableId: TableId.create(TABLE_ID)._unsafeUnwrap(),
                propagationMode: 'conditionalFiltered',
                order: 1,
              },
            ],
          },
          1
        )
      ).toBe(false);
    });
  });

  describe('seed record chunking', () => {
    it('keeps 4k seed tasks whole by default', () => {
      const seedRecordIds = Array.from(
        { length: 4000 },
        (_, index) => `rec${index.toString().padStart(16, '0')}`
      );

      expect(
        splitSeedTaskForSeedRecordLimit(
          createMockSeedTask({ seedRecordIds }),
          defaultComputedUpdateOutboxConfig.maxSeedRecordsPerTask
        )
      ).toEqual([]);
      expect(
        splitComputedTaskForSeedRecordLimit(
          createMockTask({ seedRecordIds }),
          defaultComputedUpdateOutboxConfig.maxSeedRecordsPerTask
        )
      ).toEqual([]);
    });

    it('fanout-splits linkTraversal plans with large dirtyStats and few seeds', () => {
      const seedRecordIds = Array.from(
        { length: 12 },
        (_, index) => `rec${index.toString().padStart(16, '0')}`
      );
      const task = createMockTask({
        seedRecordIds,
        edges: [
          {
            fromFieldId: FIELD_ID,
            toFieldId: FIELD_ID,
            fromTableId: TABLE_ID,
            toTableId: TABLE_ID,
            linkFieldId: FIELD_ID,
            propagationMode: 'linkTraversal',
            order: 0,
          },
        ],
        dirtyStats: [{ tableId: TABLE_ID, recordCount: 3000 }],
      });

      const maxSeeds = resolveEffectiveMaxSeedRecordsPerTask(
        task,
        defaultComputedUpdateOutboxConfig
      );
      expect(maxSeeds).toBe(defaultComputedUpdateOutboxConfig.fanoutSeedSplitMaxSeeds);

      const chunks = splitComputedTaskForSeedRecordLimit(task, maxSeeds);
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.every((chunk) => chunk.seedRecordIds.length <= maxSeeds)).toBe(true);
    });

    it('carries a proportional share of the parent dirty estimate into split children', () => {
      // Resetting child dirtyStats to bare seed counts would let fanout-split
      // children of a high-fanout import pass volume gates the parent failed.
      const seedRecordIds = Array.from(
        { length: 12 },
        (_, index) => `rec${index.toString().padStart(16, '0')}`
      );
      const task = createMockTask({
        seedRecordIds,
        changeType: 'insert',
        edges: [
          {
            fromFieldId: FIELD_ID,
            toFieldId: FIELD_ID,
            fromTableId: TABLE_ID,
            toTableId: TABLE_ID,
            linkFieldId: FIELD_ID,
            propagationMode: 'linkTraversal',
            order: 0,
          },
        ],
        dirtyStats: [{ tableId: TABLE_ID, recordCount: 3000 }],
      });

      const chunks = splitComputedTaskForSeedRecordLimit(task, 5);
      expect(chunks.map((chunk) => chunk.seedRecordIds.length)).toEqual([5, 5, 2]);
      expect(chunks.map((chunk) => chunk.dirtyStats)).toEqual([
        [{ tableId: TABLE_ID, recordCount: Math.ceil((3000 * 5) / 12) }],
        [{ tableId: TABLE_ID, recordCount: Math.ceil((3000 * 5) / 12) }],
        [{ tableId: TABLE_ID, recordCount: Math.ceil((3000 * 2) / 12) }],
      ]);
    });

    it('falls back to seed-count dirtyStats when the parent has none', () => {
      const seedRecordIds = Array.from(
        { length: 7 },
        (_, index) => `rec${index.toString().padStart(16, '0')}`
      );
      const task = createMockTask({ seedRecordIds, dirtyStats: [] });

      const chunks = splitComputedTaskForSeedRecordLimit(task, 5);
      expect(chunks.map((chunk) => chunk.dirtyStats)).toEqual([
        [{ tableId: TABLE_ID, recordCount: 5 }],
        [{ tableId: TABLE_ID, recordCount: 2 }],
      ]);
    });

    it('does not fanout-split when plan has allTargetRecords edges', () => {
      const seedRecordIds = Array.from(
        { length: 12 },
        (_, index) => `rec${index.toString().padStart(16, '0')}`
      );
      const task = createMockTask({
        seedRecordIds,
        edges: [
          {
            fromFieldId: FIELD_ID,
            toFieldId: FIELD_ID,
            fromTableId: TABLE_ID,
            toTableId: TABLE_ID,
            propagationMode: 'allTargetRecords',
            order: 0,
          },
        ],
        dirtyStats: [{ tableId: TABLE_ID, recordCount: 3000 }],
      });

      const maxSeeds = resolveEffectiveMaxSeedRecordsPerTask(
        task,
        defaultComputedUpdateOutboxConfig
      );
      expect(maxSeeds).toBe(defaultComputedUpdateOutboxConfig.maxSeedRecordsPerTask);
      expect(splitComputedTaskForSeedRecordLimit(task, maxSeeds)).toEqual([]);
    });

    it('does not fanout-split when seed set would create too many chunks', () => {
      // 240 seeds / fanoutSeedSplitMaxSeeds(5) would be 48 children (> MAX_FANOUT_CHUNKS=16)
      const seedRecordIds = Array.from(
        { length: 240 },
        (_, index) => `rec${index.toString().padStart(16, '0')}`
      );
      const task = createMockTask({
        seedRecordIds,
        edges: [
          {
            fromFieldId: FIELD_ID,
            toFieldId: FIELD_ID,
            fromTableId: TABLE_ID,
            toTableId: TABLE_ID,
            linkFieldId: FIELD_ID,
            propagationMode: 'linkTraversal',
            order: 0,
          },
        ],
        dirtyStats: [{ tableId: TABLE_ID, recordCount: 5000 }],
      });

      const maxSeeds = resolveEffectiveMaxSeedRecordsPerTask(
        task,
        defaultComputedUpdateOutboxConfig
      );
      expect(maxSeeds).toBe(defaultComputedUpdateOutboxConfig.maxSeedRecordsPerTask);
      expect(splitComputedTaskForSeedRecordLimit(task, maxSeeds)).toEqual([]);
    });
  });

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

    it('claims announced follow-up tasks by id in the same round', async () => {
      // A task above the per-task seed limit splits into chunks; the worker
      // must claim those chunk ids directly instead of waiting for the next
      // claim-scan round (or the chunks' own wakeups).
      const task = createMockTask({
        seedRecordIds: [`rec${'1'.repeat(16)}`, `rec${'2'.repeat(16)}`],
      });
      const enqueueOrMerge = vi
        .fn()
        .mockResolvedValueOnce(ok({ taskId: 'cuo-chunk-1', merged: false }))
        .mockResolvedValueOnce(ok({ taskId: 'cuo-chunk-2', merged: false }));
      const claimById = vi.fn().mockResolvedValue(ok(null));
      const outbox = createOutboxStub({
        claimBatch: vi.fn().mockResolvedValue(ok([task])),
        enqueueOrMerge,
        claimById,
      });

      const worker = new ComputedUpdateWorker(
        outbox,
        { ...defaultComputedUpdateOutboxConfig, maxSeedRecordsPerTask: 1 },
        createUpdaterStub(),
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
      expect(enqueueOrMerge).toHaveBeenCalledTimes(2);
      expect(claimById).toHaveBeenCalledTimes(2);
      expect(claimById).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'cuo-chunk-1', allowProcessingTakeover: false }),
        expect.anything()
      );
      expect(claimById).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'cuo-chunk-2', allowProcessingTakeover: false }),
        expect.anything()
      );
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

      expect(markFailed).toHaveBeenCalledWith(
        task,
        expect.any(String),
        expect.anything(),
        expect.objectContaining({
          failureKind: 'transient',
          failureReason: 'unknown',
          retryable: true,
        })
      );
    });

    it('forces statement-timeout failures into dead letter', async () => {
      const task = createMockTask({ attempts: 1, maxAttempts: 8 });
      const markFailed = vi.fn().mockResolvedValue(ok(true));

      const outbox = createOutboxStub({
        claimBatch: vi.fn().mockResolvedValue(ok([task])),
        markFailed,
      });

      const updater = createUpdaterStub({
        execute: vi.fn().mockResolvedValue(
          err(
            domainError.infrastructure({
              message: 'canceling statement due to statement timeout',
            })
          )
        ),
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

      await worker.runOnce({ workerId: 'worker-1', limit: 10 });

      expect(markFailed).toHaveBeenCalledWith(
        task,
        expect.stringContaining('statement timeout'),
        expect.anything(),
        expect.objectContaining({
          failureKind: 'statement_timeout',
          failureReason: 'statement_timeout',
          retryable: false,
          directDeadLetter: true,
          diagnostics: expect.objectContaining({
            version: 1,
            failure: expect.objectContaining({
              directDeadLetter: true,
              phase: 'execute_plan',
            }),
          }),
        })
      );
    });

    it('persists DomainError details on dead-letter diagnostics', async () => {
      const task = createMockTask({ attempts: 1, maxAttempts: 8 });
      const markFailed = vi.fn().mockResolvedValue(ok(true));

      const outbox = createOutboxStub({
        claimBatch: vi.fn().mockResolvedValue(ok([task])),
        markFailed,
      });

      const updater = createUpdaterStub({
        execute: vi.fn().mockResolvedValue(
          err(
            domainError.validation({
              code: 'validation.limit.computed_cell_value_max_bytes',
              message:
                'Table data safety limit exceeded: validation.limit.computed_cell_value_max_bytes',
              details: {
                tableId: 'tblw25nXwL4IQbZ6Wt0',
                recordId: 'rechhhhhhhhhhhhhhhh',
                fieldId: 'fldjjjjjjjjjjjjjjjj',
                attempted: 312000,
                max: 262144,
                postgresSql: { sql: 'update oversized', parameterCount: 1 },
              },
            })
          )
        ),
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

      await worker.runOnce({ workerId: 'worker-1', limit: 10 });

      expect(markFailed).toHaveBeenCalledWith(
        task,
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          diagnostics: expect.objectContaining({
            failure: expect.objectContaining({
              details: {
                tableId: 'tblw25nXwL4IQbZ6Wt0',
                recordId: 'rechhhhhhhhhhhhhhhh',
                fieldId: 'fldjjjjjjjjjjjjjjjj',
                attempted: 312000,
                max: 262144,
              },
            }),
          }),
        })
      );
    });

    it('forces deterministic postgres sql generation failures into dead letter', async () => {
      const task = createMockTask({ attempts: 1, maxAttempts: 8 });
      const markFailed = vi.fn().mockResolvedValue(ok(true));

      const outbox = createOutboxStub({
        claimBatch: vi.fn().mockResolvedValue(ok([task])),
        markFailed,
      });

      const updater = createUpdaterStub({
        execute: vi.fn().mockResolvedValue(
          err(
            domainError.infrastructure({
              message:
                'Unexpected unit of work error: error: cannot cast type jsonb to timestamp with time zone',
            })
          )
        ),
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

      await worker.runOnce({ workerId: 'worker-1', limit: 10 });

      expect(markFailed).toHaveBeenCalledWith(
        task,
        expect.stringContaining('cannot cast type jsonb to timestamp with time zone'),
        expect.anything(),
        expect.objectContaining({
          failureKind: 'computed_code_bug',
          failureReason: 'postgres_sql_generation_error',
          retryable: false,
          directDeadLetter: true,
          diagnostics: expect.objectContaining({
            version: 1,
            failure: expect.objectContaining({
              directDeadLetter: true,
              phase: 'execute_plan',
            }),
          }),
        })
      );
    });

    it('forces invalid-input-syntax (22P02) failures into dead letter on first attempt', async () => {
      const task = createMockTask({ attempts: 1, maxAttempts: 8 });
      const markFailed = vi.fn().mockResolvedValue(ok(true));

      const outbox = createOutboxStub({
        claimBatch: vi.fn().mockResolvedValue(ok([task])),
        markFailed,
      });

      const updater = createUpdaterStub({
        execute: vi.fn().mockResolvedValue(
          err(
            domainError.infrastructure({
              message:
                'Unexpected unit of work error: error: invalid input syntax for type double precision: "[1.25]"',
            })
          )
        ),
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

      await worker.runOnce({ workerId: 'worker-1', limit: 10 });

      expect(markFailed).toHaveBeenCalledWith(
        task,
        expect.stringContaining('invalid input syntax for type double precision'),
        expect.anything(),
        expect.objectContaining({
          failureKind: 'computed_code_bug',
          failureReason: 'postgres_sql_generation_error',
          retryable: false,
          directDeadLetter: true,
          diagnostics: expect.objectContaining({
            version: 1,
            failure: expect.objectContaining({
              directDeadLetter: true,
              phase: 'execute_plan',
            }),
          }),
        })
      );
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
          retryDelayMs: defaultComputedUpdateOutboxConfig.lockUnavailableRetryDelayMs,
        },
        expect.anything()
      );
      expect(markFailed).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
    });

    it('releases seed tasks with the lock contention retry delay', async () => {
      const task = createMockSeedTask();
      const releaseForRetry = vi.fn().mockResolvedValue(ok(true));
      const markFailed = vi.fn().mockResolvedValue(ok(true));
      const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
      const tableId = TableId.create(TABLE_ID)._unsafeUnwrap();
      const recordId = RecordId.create(RECORD_ID)._unsafeUnwrap();
      const fieldId = FieldId.create(FIELD_ID)._unsafeUnwrap();
      const table = {
        baseId: () => baseId,
        id: () => tableId,
      } as unknown as Table;
      const tableRepository: ITableRepository = {
        ...createTableRepository(),
        findOne: vi.fn().mockResolvedValue(ok(table)),
      };
      const planner = {
        planStage: vi.fn().mockResolvedValue(
          ok({
            baseId,
            seedTableId: tableId,
            seedRecordIds: [recordId],
            extraSeedRecords: [],
            steps: [{ level: 0, tableId, fieldIds: [fieldId] }],
            edges: [],
            changeType: 'update',
          })
        ),
      } as unknown as ComputedUpdatePlanner;
      const updater = createUpdaterStub({
        acquireLocks: vi.fn().mockResolvedValue(
          err(
            domainError.infrastructure({
              code: COMPUTED_UPDATE_LOCK_UNAVAILABLE_CODE,
              message: 'Computed update lock unavailable: seed-lock-key',
            })
          )
        ),
      });
      const outbox = createOutboxStub({
        claimBatch: vi.fn().mockResolvedValue(ok([task])),
        releaseForRetry,
        markFailed,
      });
      const worker = new ComputedUpdateWorker(
        outbox,
        defaultComputedUpdateOutboxConfig,
        updater,
        planner,
        createUnitOfWork(),
        createLogger(),
        createHasher(),
        tableRepository,
        createBackfillService(),
        createEventBus()
      );

      const result = await worker.runOnce({ workerId: 'worker-1', limit: 10 });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(0);
      expect(releaseForRetry).toHaveBeenCalledWith(
        {
          task,
          reason: 'Computed update lock unavailable: seed-lock-key',
          retryDelayMs: defaultComputedUpdateOutboxConfig.lockUnavailableRetryDelayMs,
        },
        expect.anything()
      );
      expect(markFailed).not.toHaveBeenCalled();
    });

    it('executes edge-only seed plans instead of marking them done', async () => {
      // A propagation-only plan (edges, no steps — orphan/delete shapes) is
      // real executable work; the seed path must not short-circuit it.
      const task = createMockSeedTask();
      const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
      const tableId = TableId.create(TABLE_ID)._unsafeUnwrap();
      const recordId = RecordId.create(RECORD_ID)._unsafeUnwrap();
      const plan: ComputedUpdatePlan = {
        baseId,
        seedTableId: tableId,
        seedRecordIds: [recordId],
        extraSeedRecords: [],
        beforeImageRecords: [],
        steps: [],
        edges: [
          {
            fromFieldId: FieldId.create(FIELD_ID)._unsafeUnwrap(),
            toFieldId: FieldId.create(`fld${'e'.repeat(16)}`)._unsafeUnwrap(),
            fromTableId: tableId,
            toTableId: TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap(),
            propagationMode: 'linkTraversal',
            order: 0,
          } as unknown as ComputedUpdatePlan['edges'][number],
        ],
        estimatedComplexity: 1,
        changeType: 'delete',
        sameTableBatches: [],
      };
      const execute = vi.fn().mockResolvedValue(ok({ changesByStep: [] }));
      const markDone = vi.fn().mockResolvedValue(ok(true));
      const outbox = createOutboxStub({
        claimBatch: vi.fn().mockResolvedValue(ok([task])),
        markDone,
      });
      const updater = createUpdaterStub({ execute });
      const planner = {
        planStage: vi.fn().mockResolvedValue(ok(plan)),
      } as unknown as ComputedUpdatePlanner;
      const table = { id: () => tableId, baseId: () => baseId } as unknown as Table;
      const tableRepository = {
        ...createTableRepository(),
        findOne: vi.fn().mockResolvedValue(ok(table)),
      } as ITableRepository;
      const worker = new ComputedUpdateWorker(
        outbox,
        defaultComputedUpdateOutboxConfig,
        updater,
        planner,
        createUnitOfWork(),
        createLogger(),
        createHasher(),
        tableRepository,
        createBackfillService(),
        createEventBus()
      );

      const result = await worker.runOnce({ workerId: 'worker-1', limit: 10 });

      expect(result.isOk()).toBe(true);
      expect(execute).toHaveBeenCalledTimes(1);
      expect(execute.mock.calls[0][0].steps).toHaveLength(0);
      expect(execute.mock.calls[0][0].edges).toHaveLength(1);
      expect(markDone).toHaveBeenCalledWith(task, expect.anything(), expect.anything());
    });

    it('registers planned computed targets for seed tasks before execution', async () => {
      const task = createMockSeedTask();
      const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
      const tableId = TableId.create(TABLE_ID)._unsafeUnwrap();
      const recordId = RecordId.create(RECORD_ID)._unsafeUnwrap();
      const computedFieldId = FieldId.create(`fld${'e'.repeat(16)}`)._unsafeUnwrap();
      const table = {
        id: () => tableId,
        baseId: () => baseId,
      } as unknown as Table;
      const plan: ComputedUpdatePlan = {
        baseId,
        seedTableId: tableId,
        seedRecordIds: [recordId],
        extraSeedRecords: [],
        beforeImageRecords: [],
        steps: [{ level: 0, tableId, fieldIds: [computedFieldId] }],
        edges: [],
        estimatedComplexity: 7,
        changeType: 'update',
        sameTableBatches: [],
      };
      const registerPlannedTaskActivity = vi.fn().mockResolvedValue(ok(undefined));
      const execute = vi.fn().mockResolvedValue(ok({ changesByStep: [] }));
      const markDone = vi.fn().mockResolvedValue(ok(true));
      const outbox = createOutboxStub({
        claimBatch: vi.fn().mockResolvedValue(ok([task])),
        registerPlannedTaskActivity,
        markDone,
      });
      const updater = createUpdaterStub({
        execute,
        collectDirtySeedGroups: vi.fn().mockResolvedValue(ok({ groups: [], seedAllTableIds: [] })),
      });
      const planner = {
        planStage: vi.fn().mockResolvedValue(ok(plan)),
      } as unknown as ComputedUpdatePlanner;
      const tableRepository = {
        ...createTableRepository(),
        findOne: vi.fn().mockResolvedValue(ok(table)),
      } as ITableRepository;
      const worker = new ComputedUpdateWorker(
        outbox,
        defaultComputedUpdateOutboxConfig,
        updater,
        planner,
        createUnitOfWork(),
        createLogger(),
        createHasher(),
        tableRepository,
        createBackfillService(),
        createEventBus()
      );

      const result = await worker.runOnce({ workerId: 'worker-1', limit: 10 });

      expect(result._unsafeUnwrap()).toBe(1);
      expect(registerPlannedTaskActivity).toHaveBeenCalledWith(
        {
          taskId: task.id,
          baseId: BASE_ID,
          targets: [{ tableId, fieldId: computedFieldId }],
          metrics: {
            estimatedComplexity: 7,
            estimatedDirtyRecords: 1,
            hasAllTargetRecords: false,
          },
        },
        expect.anything()
      );
      expect(registerPlannedTaskActivity.mock.invocationCallOrder[0]).toBeLessThan(
        execute.mock.invocationCallOrder[0]
      );
      expect(execute.mock.calls[0][3]).toEqual(
        expect.objectContaining({ isolateOversizedComputedCells: true })
      );
      expect(markDone).toHaveBeenCalledWith(task, expect.anything(), expect.anything());
    });

    it('completes seed tasks when the seed table exists but is not active', async () => {
      const task = createMockSeedTask();
      const releaseForRetry = vi.fn().mockResolvedValue(ok(true));
      const markDone = vi.fn().mockResolvedValue(ok(true));
      const markFailed = vi.fn().mockResolvedValue(ok(true));
      const planner = {
        plan: vi.fn(),
      } as unknown as ComputedUpdatePlanner;
      const tableRepository: ITableRepository = {
        ...createTableRepository(),
        findOne: vi
          .fn()
          .mockResolvedValueOnce(err(domainError.notFound({ message: 'Table not found' })))
          .mockResolvedValueOnce(ok({} as Table)),
      };

      const outbox = createOutboxStub({
        claimBatch: vi.fn().mockResolvedValue(ok([task])),
        releaseForRetry,
        markDone,
        markFailed,
      });

      const worker = new ComputedUpdateWorker(
        outbox,
        defaultComputedUpdateOutboxConfig,
        createUpdaterStub(),
        planner,
        createUnitOfWork(),
        createLogger(),
        createHasher(),
        tableRepository,
        createBackfillService(),
        createEventBus()
      );

      const result = await worker.runOnce({ workerId: 'worker-1', limit: 10 });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(1);
      expect(tableRepository.findOne).toHaveBeenNthCalledWith(
        2,
        expect.anything(),
        expect.anything(),
        { state: 'all' }
      );
      expect(markDone).toHaveBeenCalledWith(task, expect.anything(), expect.anything());
      expect(releaseForRetry).not.toHaveBeenCalled();
      expect(markFailed).not.toHaveBeenCalled();
      expect(planner.plan).not.toHaveBeenCalled();
    });

    it('completes obsolete seed tasks when the seed table no longer exists', async () => {
      const task = createMockSeedTask();
      const markDone = vi.fn().mockResolvedValue(ok(true));
      const markFailed = vi.fn().mockResolvedValue(ok(true));
      const planner = {
        plan: vi.fn(),
      } as unknown as ComputedUpdatePlanner;
      const tableRepository: ITableRepository = {
        ...createTableRepository(),
        findOne: vi
          .fn()
          .mockResolvedValue(err(domainError.notFound({ message: 'Table not found' }))),
      };
      const outbox = createOutboxStub({
        claimBatch: vi.fn().mockResolvedValue(ok([task])),
        markDone,
        markFailed,
      });
      const worker = new ComputedUpdateWorker(
        outbox,
        defaultComputedUpdateOutboxConfig,
        createUpdaterStub(),
        planner,
        createUnitOfWork(),
        createLogger(),
        createHasher(),
        tableRepository,
        createBackfillService(),
        createEventBus()
      );

      const result = await worker.runOnce({ workerId: 'worker-1', limit: 10 });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(1);
      expect(markDone).toHaveBeenCalledWith(task, expect.anything(), expect.anything());
      expect(markFailed).not.toHaveBeenCalled();
      expect(planner.plan).not.toHaveBeenCalled();
    });

    it('completes obsolete planned tasks when a referenced table no longer exists', async () => {
      const task = createMockTask();
      const markDone = vi.fn().mockResolvedValue(ok(true));
      const markFailed = vi.fn().mockResolvedValue(ok(true));
      const updater = createUpdaterStub({
        execute: vi
          .fn()
          .mockResolvedValue(
            err(domainError.notFound({ message: `Missing table for computed update: ${TABLE_ID}` }))
          ),
      });
      const tableRepository: ITableRepository = {
        ...createTableRepository(),
        findOne: vi
          .fn()
          .mockResolvedValue(err(domainError.notFound({ message: 'Table not found' }))),
      };
      const outbox = createOutboxStub({
        claimBatch: vi.fn().mockResolvedValue(ok([task])),
        markDone,
        markFailed,
      });
      const worker = new ComputedUpdateWorker(
        outbox,
        defaultComputedUpdateOutboxConfig,
        updater,
        {} as ComputedUpdatePlanner,
        createUnitOfWork(),
        createLogger(),
        createHasher(),
        tableRepository,
        createBackfillService(),
        createEventBus()
      );

      const result = await worker.runOnce({ workerId: 'worker-1', limit: 10 });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(1);
      expect(markDone).toHaveBeenCalledWith(task, expect.anything(), expect.anything());
      expect(markFailed).not.toHaveBeenCalled();
    });

    it('requeues seed tasks when the seed table is still pending provision', async () => {
      const task = createMockSeedTask();
      const releaseForRetry = vi.fn().mockResolvedValue(ok(true));
      const markDone = vi.fn().mockResolvedValue(ok(true));
      const markFailed = vi.fn().mockResolvedValue(ok(true));
      const tableRepository: ITableRepository = {
        ...createTableRepository(),
        findOne: vi.fn().mockResolvedValue(
          err(
            domainError.notFound({
              code: 'table.provision_pending',
              message:
                'Table not found (TableByIdSpec) tableId=tblbbbbbbbbbbbbbbbb (provision_state=pending)',
            })
          )
        ),
      };
      const outbox = createOutboxStub({
        claimBatch: vi.fn().mockResolvedValue(ok([task])),
        releaseForRetry,
        markDone,
        markFailed,
      });
      const worker = new ComputedUpdateWorker(
        outbox,
        defaultComputedUpdateOutboxConfig,
        createUpdaterStub(),
        { plan: vi.fn() } as unknown as ComputedUpdatePlanner,
        createUnitOfWork(),
        createLogger(),
        createHasher(),
        tableRepository,
        createBackfillService(),
        createEventBus()
      );

      const result = await worker.runOnce({ workerId: 'worker-1', limit: 10 });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(0);
      expect(releaseForRetry).toHaveBeenCalledWith(
        {
          task,
          reason:
            'Table not found (TableByIdSpec) tableId=tblbbbbbbbbbbbbbbbb (provision_state=pending)',
          retryDelayMs: defaultComputedUpdateOutboxConfig.lockUnavailableRetryDelayMs,
        },
        expect.anything()
      );
      expect(markDone).not.toHaveBeenCalled();
      expect(markFailed).not.toHaveBeenCalled();
    });

    it('requeues planned tasks when a transactional table miss is a provision race', async () => {
      const task = createMockTask();
      const releaseForRetry = vi.fn().mockResolvedValue(ok(true));
      const markDone = vi.fn().mockResolvedValue(ok(true));
      const markFailed = vi.fn().mockResolvedValue(ok(true));
      const updater = createUpdaterStub({
        execute: vi.fn().mockResolvedValue(
          err(
            domainError.notFound({
              code: 'table.not_found',
              message: `Table not found (TableByIdSpec) tableId=${TABLE_ID}`,
            })
          )
        ),
      });
      const tableRepository: ITableRepository = {
        ...createTableRepository(),
        findOne: vi.fn().mockResolvedValue(ok({} as Table)),
      };
      const outbox = createOutboxStub({
        claimBatch: vi.fn().mockResolvedValue(ok([task])),
        releaseForRetry,
        markDone,
        markFailed,
      });
      const worker = new ComputedUpdateWorker(
        outbox,
        defaultComputedUpdateOutboxConfig,
        updater,
        {} as ComputedUpdatePlanner,
        createUnitOfWork(),
        createLogger(),
        createHasher(),
        tableRepository,
        createBackfillService(),
        createEventBus()
      );

      const result = await worker.runOnce({ workerId: 'worker-1', limit: 10 });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(0);
      expect(releaseForRetry).toHaveBeenCalled();
      expect(markDone).not.toHaveBeenCalled();
      expect(markFailed).not.toHaveBeenCalled();
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
      expect(markDone).toHaveBeenCalledWith(task, expect.anything(), expect.anything());
      expect(acquireLocks).not.toHaveBeenCalled();
    });

    it('calls markDone when task execution succeeds', async () => {
      const task = createMockTask();
      const markDone = vi.fn().mockResolvedValue(ok(true));

      const outbox = createOutboxStub({
        claimBatch: vi.fn().mockResolvedValue(ok([task])),
        markDone,
      });

      const collectStageOutputSeedGroups = vi
        .fn()
        .mockResolvedValue(ok({ groups: [], seedAllTableIds: [] }));
      const clearTaskStageLedger = vi.fn().mockResolvedValue(ok(0));
      const updater = createUpdaterStub({
        execute: vi.fn().mockResolvedValue(ok({ changesByStep: [] })),
        collectStageOutputSeedGroups,
        clearTaskStageLedger,
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
      // Stage completed: outputs collect over dirty ∪ exclusion ledger (no fold
      // back into the transaction) and the chain's ledger state is dropped.
      expect(collectStageOutputSeedGroups).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ scopeId: task.id })
      );
      expect(clearTaskStageLedger).toHaveBeenCalledWith(expect.anything(), task.id);
      expect(markDone).toHaveBeenCalledWith(task, expect.anything(), expect.anything());
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
        steps: [],
        edges: [
          {
            fromFieldId: FIELD_ID,
            toFieldId: FIELD_ID,
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
        collectStageOutputSeedGroups: vi.fn().mockResolvedValue(
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

    it('folds the next-stage enqueue and the predecessor markDone into one activity projection', async () => {
      // When a stage completes whole (no partial batch, no deferred split) and
      // plans a follow-up stage, the worker settles both outbox calls through
      // enqueueContinuationAndMarkDone instead of two independent activity
      // projector rounds — see ComputedUpdateWorker.enqueueContinuationAndMarkDone.
      const task = createMockTask();
      const continuationTaskId = 'cuo-continuation';
      const claimedTask = createMockTask({ id: continuationTaskId, status: 'processing' });
      const pendingActivityEnqueue = {
        taskId: continuationTaskId,
        baseId: BASE_ID,
        targets: [
          {
            fieldId: FieldId.create(FIELD_ID)._unsafeUnwrap(),
            tableId: TableId.create(TABLE_ID)._unsafeUnwrap(),
          },
        ],
        metrics: { estimatedComplexity: 1, estimatedDirtyRecords: 1, hasAllTargetRecords: false },
      };
      const enqueueOrMerge = vi.fn().mockResolvedValue(
        ok({
          taskId: continuationTaskId,
          merged: false,
          claimed: claimedTask,
          pendingActivityEnqueue,
        })
      );
      const markDone = vi.fn().mockResolvedValue(ok(true));
      const projectStageSettlement = vi.fn().mockResolvedValue(ok(null));

      const outbox = createOutboxStub({
        claimBatch: vi.fn().mockResolvedValue(ok([task])),
        enqueueOrMerge,
        markDone,
        projectStageSettlement,
      });

      const updater = createUpdaterStub({
        // A real change to FIELD_ID (the sole planned field) on the first
        // (predecessor) task so collectStageContinuationFieldIds has something
        // to carry into planNextStage — an empty changesByStep would
        // short-circuit before the planner is even consulted. The relay-claimed
        // continuation task the worker then dequeues reports no further changes,
        // so it settles as a plain markDone with no second continuation (this
        // test only cares about the first hop's combined projection call).
        execute: vi
          .fn()
          .mockResolvedValueOnce(
            ok({
              changesByStep: [
                {
                  tableId: TABLE_ID,
                  recordChanges: [
                    {
                      recordId: RECORD_ID,
                      oldVersion: 1,
                      changes: [{ fieldId: FIELD_ID, oldValue: null, newValue: 1 }],
                    },
                  ],
                },
              ],
            })
          )
          .mockResolvedValue(ok({ changesByStep: [] })),
        collectStageOutputSeedGroups: vi.fn().mockResolvedValue(
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

      const baseIdVO = BaseId.create(BASE_ID)._unsafeUnwrap();
      const tableIdVO = TableId.create(TABLE_ID)._unsafeUnwrap();
      const fieldIdVO = FieldId.create(FIELD_ID)._unsafeUnwrap();
      const planner = {
        planStage: vi.fn().mockResolvedValue(
          ok({
            baseId: baseIdVO,
            seedTableId: tableIdVO,
            seedRecordIds: [],
            extraSeedRecords: [],
            steps: [{ level: 0, tableId: tableIdVO, fieldIds: [fieldIdVO] }],
            edges: [],
            estimatedComplexity: 1,
            changeType: 'update' as const,
            sameTableBatches: [],
          })
        ),
      } as unknown as ComputedUpdatePlanner;

      const table = {
        baseId: () => baseIdVO,
        id: () => tableIdVO,
        // Before-image lookups are irrelevant to this test's activity-projection
        // assertions; report "not found" so buildBeforeImageRecordsFromStepChanges
        // skips them cleanly instead of needing a full field mock.
        getField: () => err(domainError.notFound({ message: 'field not found' })),
      } as unknown as Table;
      const tableRepository: ITableRepository = {
        ...createTableRepository(),
        findOne: vi.fn().mockResolvedValue(ok(table)),
      };

      const worker = new ComputedUpdateWorker(
        outbox,
        defaultComputedUpdateOutboxConfig,
        updater,
        planner,
        createUnitOfWork(),
        createLogger(),
        createHasher(),
        tableRepository,
        createBackfillService(),
        createEventBus()
      );

      const result = await worker.runOnce({ workerId: 'worker-1', limit: 10 });
      expect(result.isOk()).toBe(true);
      // The predecessor and its relay-claimed continuation (which reports no
      // further changes and settles as a plain markDone) both count as processed.
      expect(result._unsafeUnwrap()).toBe(2);

      // The predecessor's enqueue+markDone pair runs with their own activity
      // round skipped...
      expect(enqueueOrMerge).toHaveBeenCalledTimes(1);
      expect(enqueueOrMerge).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          relayClaim: { workerId: 'worker-1', predecessorTaskId: task.id },
          skipActivityProjection: true,
        })
      );
      expect(markDone).toHaveBeenCalledWith(
        task,
        expect.anything(),
        expect.objectContaining({ skipActivityProjection: true })
      );
      // The claimed continuation has no further work, so it settles through the
      // ordinary (non-skipped) markDone path — one call per task, two total.
      expect(markDone).toHaveBeenCalledTimes(2);
      expect(markDone).toHaveBeenCalledWith(claimedTask, expect.anything(), expect.anything());

      // ...and settled together in exactly one combined projection call.
      expect(projectStageSettlement).toHaveBeenCalledTimes(1);
      expect(projectStageSettlement).toHaveBeenCalledWith(
        expect.objectContaining({
          done: expect.objectContaining({ taskId: task.id, baseId: task.baseId }),
          enqueued: pendingActivityEnqueue,
          claimed: [{ taskId: continuationTaskId, baseId: claimedTask.baseId }],
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
        expect(markDone).toHaveBeenCalledWith(task, expect.anything(), expect.anything());
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
      expect(markDone).toHaveBeenCalledWith(task1, expect.anything(), expect.anything());
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
          allowProcessingTakeover: false,
        }),
        expect.anything()
      );
      expect(markDone).toHaveBeenCalledWith(task, expect.anything(), expect.anything());
    });

    it('annotates claimed computed task traces with run and stage context', async () => {
      const task = createMockTask({
        stageDepth: 2,
        runTotalSteps: 5,
        runCompletedStepsBefore: 2,
        affectedTableIds: [TABLE_ID, `tbl${'e'.repeat(16)}`],
        affectedFieldIds: [FIELD_ID, `fld${'f'.repeat(16)}`],
      });
      const rootSpan: ISpan = {
        setAttribute: vi.fn(),
        setAttributes: vi.fn(),
        recordError: vi.fn(),
        end: vi.fn(),
      };
      const tracer: ITracer = {
        startSpan: vi.fn(() => rootSpan),
        withSpan: vi.fn(async <T>(_span: ISpan, work: () => Promise<T>) => await work()),
        getActiveSpan: vi.fn(() => rootSpan),
      };
      const outbox = createOutboxStub({
        claimById: vi.fn().mockResolvedValue(ok(task)),
        markDone: vi.fn().mockResolvedValue(ok(true)),
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
        tracer,
      });

      expect(result.isOk()).toBe(true);
      expect(rootSpan.setAttribute).toHaveBeenCalledWith('outbox.taskClaimed', true);
      expect(rootSpan.setAttributes).toHaveBeenCalledWith(
        expect.objectContaining({
          'outbox.baseId': BASE_ID,
          'outbox.taskKind': 'computed',
        })
      );
      expect(rootSpan.setAttribute).toHaveBeenCalledWith('outbox.seedTableId', TABLE_ID);
      expect(rootSpan.setAttributes).toHaveBeenCalledWith(
        expect.objectContaining({
          'computed.runId': task.runId,
          'computed.stageDepth': 2,
          'computed.stepCount': 1,
          'computed.affectedTableCount': 2,
          'computed.affectedFieldCount': 2,
        })
      );
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

describe('ComputedUpdateWorker stage budget', () => {
  const TABLE_ID_B = `tbl${'e'.repeat(16)}`;
  const TABLE_ID_C = `tbl${'f'.repeat(16)}`;
  const FIELD_ID_B = `fld${'g'.repeat(16)}`;
  const FIELD_ID_C = `fld${'h'.repeat(16)}`;
  const RECORD_ID_B = `rec${'i'.repeat(16)}`;

  const stagedConfig = {
    ...defaultComputedUpdateOutboxConfig,
    stageMaxSteps: 2,
    stageMaxFields: 0,
    stageMaxEdges: 0,
    // These cases exercise STATIC step splitting; the dirty budget's one-level-
    // per-transaction clamp would otherwise override maxSteps, and small-run
    // adaptivity would scale maxSteps past the tiny test plans.
    stageMaxDirtyRecords: 0,
    stageSmallRunComplexityThreshold: 0,
  };

  const threeStepTaskFields = {
    steps: [
      { level: 0, tableId: TABLE_ID, fieldIds: [FIELD_ID] },
      { level: 1, tableId: TABLE_ID_B, fieldIds: [FIELD_ID_B] },
      { level: 2, tableId: TABLE_ID_C, fieldIds: [FIELD_ID_C] },
    ],
    edges: [
      {
        fromFieldId: FIELD_ID,
        toFieldId: FIELD_ID_B,
        fromTableId: TABLE_ID,
        toTableId: TABLE_ID_B,
        linkFieldId: FIELD_ID_B,
        propagationMode: 'linkTraversal' as const,
        order: 0,
      },
      {
        fromFieldId: FIELD_ID_B,
        toFieldId: FIELD_ID_C,
        fromTableId: TABLE_ID_B,
        toTableId: TABLE_ID_C,
        linkFieldId: FIELD_ID_C,
        propagationMode: 'linkTraversal' as const,
        order: 1,
      },
    ],
    affectedTableIds: [TABLE_ID, TABLE_ID_B, TABLE_ID_C],
    affectedFieldIds: [FIELD_ID, FIELD_ID_B, FIELD_ID_C],
    runTotalSteps: 3,
  };

  it('executes a bounded stage and enqueues the deferred continuation for computed tasks', async () => {
    const task = createMockTask(threeStepTaskFields);
    const execute = vi.fn().mockResolvedValue(ok({ changesByStep: [] }));
    const dirtyTableId = TableId.create(TABLE_ID_B)._unsafeUnwrap();
    const dirtyRecordId = RecordId.create(RECORD_ID_B)._unsafeUnwrap();
    const collectStageOutputSeedGroups = vi
      .fn()
      .mockResolvedValue(
        ok({ groups: [{ tableId: dirtyTableId, recordIds: [dirtyRecordId] }], seedAllTableIds: [] })
      );
    const enqueueOrMerge = vi.fn().mockResolvedValue(ok({ taskId: 'cont', merged: false }));
    const markDone = vi.fn().mockResolvedValue(ok(true));
    const outbox = createOutboxStub({
      claimBatch: vi.fn().mockResolvedValue(ok([task])),
      enqueueOrMerge,
      markDone,
    });
    const worker = new ComputedUpdateWorker(
      outbox,
      stagedConfig,
      createUpdaterStub({ execute, collectStageOutputSeedGroups }),
      // planner must stay untouched: budget continuations do not replan
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

    const executedPlan = execute.mock.calls[0][0];
    expect(executedPlan.steps.map((step: { level: number }) => step.level)).toEqual([0, 1]);
    expect(executedPlan.edges).toHaveLength(1);

    const collectParams = collectStageOutputSeedGroups.mock.calls[0][1];
    expect(collectParams.tableIds.map((id: { toString(): string }) => id.toString())).toEqual([
      TABLE_ID,
      TABLE_ID_B,
    ]);
    expect(collectParams.exactIdsTotalCap).toBe(
      defaultComputedUpdateOutboxConfig.stageMaxCollectedSeedIds
    );

    expect(enqueueOrMerge).toHaveBeenCalledTimes(1);
    const continuation = enqueueOrMerge.mock.calls[0][0];
    expect(continuation.steps).toEqual([threeStepTaskFields.steps[2]]);
    expect(continuation.edges.map((e: { toTableId: string }) => e.toTableId)).toEqual([TABLE_ID_C]);
    expect(continuation.runTotalSteps).toBe(3);
    expect(continuation.runCompletedStepsBefore).toBe(2);
    expect(continuation.stageDepth).toBe(0);
    // Seeds narrow to tables the deferred work reads from: only tableB remains.
    expect(continuation.seedRecordIds).toEqual([]);
    expect(continuation.extraSeedRecords).toEqual([
      { tableId: TABLE_ID_B, recordIds: [RECORD_ID_B] },
    ]);
    // Lineage-scoped idempotency key: same-shape continuations from other runs,
    // stages, or predecessor tasks must not merge.
    expect(continuation.planHash).toBe('hash123:run:run123:stage:2:from:cuo123456789012345');
    expect(markDone).toHaveBeenCalledWith(task, expect.anything(), expect.anything());
  });

  it('processes relay-claimed stage continuations without a separate claimById round trip', async () => {
    const task = createMockTask(threeStepTaskFields);
    const relayClaimedContinuation = createMockTask({
      id: 'cuo-relay-next',
      steps: [],
      edges: [],
      lockedBy: 'worker-1:cuc-relay',
    });
    const execute = vi.fn().mockResolvedValue(ok({ changesByStep: [] }));
    const dirtyTableId = TableId.create(TABLE_ID_B)._unsafeUnwrap();
    const dirtyRecordId = RecordId.create(RECORD_ID_B)._unsafeUnwrap();
    const collectStageOutputSeedGroups = vi
      .fn()
      .mockResolvedValue(
        ok({ groups: [{ tableId: dirtyTableId, recordIds: [dirtyRecordId] }], seedAllTableIds: [] })
      );
    const enqueueOrMerge = vi
      .fn()
      .mockResolvedValue(
        ok({ taskId: 'cuo-relay-next', merged: false, claimed: relayClaimedContinuation })
      );
    const claimById = vi.fn().mockResolvedValue(ok(null));
    const markDone = vi.fn().mockResolvedValue(ok(true));
    const outbox = createOutboxStub({
      claimBatch: vi.fn().mockResolvedValue(ok([task])),
      enqueueOrMerge,
      claimById,
      markDone,
    });
    const worker = new ComputedUpdateWorker(
      outbox,
      stagedConfig,
      createUpdaterStub({ execute, collectStageOutputSeedGroups }),
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
    // Parent + relay-claimed continuation both processed in the same round.
    expect(result._unsafeUnwrap()).toBe(2);
    // The stage continuation requests a relay claim naming this worker and the
    // predecessor being marked done in the same transaction.
    expect(enqueueOrMerge).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        relayClaim: { workerId: 'worker-1', predecessorTaskId: task.id },
      })
    );
    // The relay-claimed continuation is queued directly — no claimById hop.
    expect(claimById).not.toHaveBeenCalled();
    const markedDoneIds = markDone.mock.calls.map((call) =>
      typeof call[0] === 'string' ? call[0] : call[0].id
    );
    expect(markedDoneIds).toEqual(expect.arrayContaining([task.id, 'cuo-relay-next']));
  });

  it('splits seed task plans and defers the remainder without replanning', async () => {
    const task = createMockSeedTask();
    const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
    const tableA = TableId.create(TABLE_ID)._unsafeUnwrap();
    const tableB = TableId.create(TABLE_ID_B)._unsafeUnwrap();
    const tableC = TableId.create(TABLE_ID_C)._unsafeUnwrap();
    const fieldA = FieldId.create(FIELD_ID)._unsafeUnwrap();
    const fieldB = FieldId.create(FIELD_ID_B)._unsafeUnwrap();
    const fieldC = FieldId.create(FIELD_ID_C)._unsafeUnwrap();
    const recordA = RecordId.create(RECORD_ID)._unsafeUnwrap();
    const table = {
      id: () => tableA,
      baseId: () => baseId,
    } as unknown as Table;
    const plan: ComputedUpdatePlan = {
      baseId,
      seedTableId: tableA,
      seedRecordIds: [recordA],
      extraSeedRecords: [],
      beforeImageRecords: [],
      steps: [
        { tableId: tableA, fieldIds: [fieldA], level: 0 },
        { tableId: tableB, fieldIds: [fieldB], level: 1 },
        { tableId: tableC, fieldIds: [fieldC], level: 2 },
      ],
      edges: [
        {
          fromFieldId: fieldA,
          toFieldId: fieldB,
          fromTableId: tableA,
          toTableId: tableB,
          linkFieldId: fieldB,
          propagationMode: 'linkTraversal',
          order: 0,
        },
        {
          fromFieldId: fieldB,
          toFieldId: fieldC,
          fromTableId: tableB,
          toTableId: tableC,
          linkFieldId: fieldC,
          propagationMode: 'linkTraversal',
          order: 1,
        },
      ],
      estimatedComplexity: 6,
      changeType: 'update',
      sameTableBatches: [],
    };
    const planStage = vi.fn().mockResolvedValue(ok(plan));
    const execute = vi.fn().mockResolvedValue(ok({ changesByStep: [] }));
    const collectDirtySeedGroups = vi
      .fn()
      .mockResolvedValue(ok({ groups: [], seedAllTableIds: [] }));
    const enqueueOrMerge = vi.fn().mockResolvedValue(ok({ taskId: 'cont', merged: false }));
    const markDone = vi.fn().mockResolvedValue(ok(true));
    const outbox = createOutboxStub({
      claimBatch: vi.fn().mockResolvedValue(ok([task])),
      enqueueOrMerge,
      markDone,
    });
    const worker = new ComputedUpdateWorker(
      outbox,
      stagedConfig,
      createUpdaterStub({ execute, collectDirtySeedGroups }),
      { planStage } as unknown as ComputedUpdatePlanner,
      createUnitOfWork(),
      createLogger(),
      createHasher(),
      {
        ...createTableRepository(),
        findOne: vi.fn().mockResolvedValue(ok(table)),
      } as ITableRepository,
      createBackfillService(),
      createEventBus()
    );

    const result = await worker.runOnce({ workerId: 'worker-1', limit: 10 });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe(1);
    // one initial planStage call, no replanning for the continuation
    expect(planStage).toHaveBeenCalledTimes(1);

    const executedPlan = execute.mock.calls[0][0];
    expect(executedPlan.steps.map((step: { level: number }) => step.level)).toEqual([0, 1]);

    expect(enqueueOrMerge).toHaveBeenCalledTimes(1);
    const continuation = enqueueOrMerge.mock.calls[0][0];
    expect(continuation.steps).toEqual([{ tableId: TABLE_ID_C, fieldIds: [FIELD_ID_C], level: 2 }]);
    expect(continuation.runTotalSteps).toBe(3);
    expect(continuation.runCompletedStepsBefore).toBe(2);
    expect(continuation.stageDepth).toBe(0);
    expect(markDone).toHaveBeenCalledWith(task, expect.anything(), expect.anything());
  });
});

describe('ComputedUpdateWorker dirty-record budget', () => {
  const TABLE_ID_B = `tbl${'e'.repeat(16)}`;
  const TABLE_ID_C = `tbl${'f'.repeat(16)}`;
  const FIELD_ID_B = `fld${'g'.repeat(16)}`;
  const FIELD_ID_C = `fld${'h'.repeat(16)}`;

  it('shrinks the stage and retries when propagation exceeds the dirty budget', async () => {
    const task = createMockTask({
      steps: [
        { level: 0, tableId: TABLE_ID, fieldIds: [FIELD_ID] },
        { level: 0, tableId: TABLE_ID_B, fieldIds: [FIELD_ID_B] },
        { level: 0, tableId: TABLE_ID_C, fieldIds: [FIELD_ID_C] },
      ],
      edges: [
        {
          fromFieldId: FIELD_ID,
          toFieldId: FIELD_ID_B,
          fromTableId: TABLE_ID,
          toTableId: TABLE_ID_B,
          linkFieldId: FIELD_ID_B,
          propagationMode: 'linkTraversal' as const,
          order: 0,
        },
        {
          fromFieldId: FIELD_ID_B,
          toFieldId: FIELD_ID_C,
          fromTableId: TABLE_ID_B,
          toTableId: TABLE_ID_C,
          linkFieldId: FIELD_ID_C,
          propagationMode: 'linkTraversal' as const,
          order: 1,
        },
      ],
      affectedTableIds: [TABLE_ID, TABLE_ID_B, TABLE_ID_C],
      affectedFieldIds: [FIELD_ID, FIELD_ID_B, FIELD_ID_C],
      runTotalSteps: 3,
    });
    const execute = vi
      .fn()
      .mockResolvedValueOnce(
        ok({ changesByStep: [], dirtyBudget: { status: 'exceeded', dirtyRecordsAtAbort: 42 } })
      )
      .mockResolvedValue(ok({ changesByStep: [] }));
    const collectDirtySeedGroups = vi
      .fn()
      .mockResolvedValue(ok({ groups: [], seedAllTableIds: [] }));
    const enqueueOrMerge = vi.fn().mockResolvedValue(ok({ taskId: 'cont', merged: false }));
    const markDone = vi.fn().mockResolvedValue(ok(true));
    const outbox = createOutboxStub({
      claimBatch: vi.fn().mockResolvedValue(ok([task])),
      enqueueOrMerge,
      markDone,
    });
    const worker = new ComputedUpdateWorker(
      outbox,
      {
        ...defaultComputedUpdateOutboxConfig,
        stageMaxSteps: 0,
        stageMaxFields: 0,
        stageMaxEdges: 0,
        stageMaxDirtyRecords: 10,
      },
      createUpdaterStub({ execute, collectDirtySeedGroups }),
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
    expect(execute).toHaveBeenCalledTimes(2);

    // First attempt: full 3-step plan probed under the budget in abort mode.
    expect(execute.mock.calls[0][0].steps).toHaveLength(3);
    expect(execute.mock.calls[0][3]).toMatchObject({
      maxDirtyRecords: 10,
      dirtyBudgetMode: 'abort',
    });

    // Retry after shrink: floor(3/2) = 1 step; single-step stages record-batch
    // in partial mode instead of running unguarded.
    expect(execute.mock.calls[1][0].steps.map((step: { level: number }) => step.level)).toEqual([
      0,
    ]);
    expect(execute.mock.calls[1][3]).toMatchObject({
      maxDirtyRecords: 10,
      dirtyBudgetMode: 'partial',
    });

    expect(enqueueOrMerge).toHaveBeenCalledTimes(1);
    const continuation = enqueueOrMerge.mock.calls[0][0];
    expect(continuation.steps.map((step: { level: number }) => step.level)).toEqual([0, 0]);
    expect(continuation.runCompletedStepsBefore).toBe(1);
    expect(markDone).toHaveBeenCalledWith(task, expect.anything(), expect.anything());
  });

  it('re-enqueues a partial floor batch with its outputs settled into the stage ledger', async () => {
    const task = createMockTask({
      steps: [{ level: 0, tableId: TABLE_ID_B, fieldIds: [FIELD_ID_B] }],
      edges: [
        {
          fromFieldId: FIELD_ID,
          toFieldId: FIELD_ID_B,
          fromTableId: TABLE_ID,
          toTableId: TABLE_ID_B,
          linkFieldId: FIELD_ID_B,
          propagationMode: 'linkTraversal' as const,
          order: 0,
        },
      ],
      affectedTableIds: [TABLE_ID, TABLE_ID_B],
      affectedFieldIds: [FIELD_ID, FIELD_ID_B],
      runTotalSteps: 1,
    });
    const execute = vi.fn().mockResolvedValue(
      ok({
        changesByStep: [],
        dirtyBudget: {
          status: 'partial',
          propagatedDirtyRecords: 10,
          truncated: 'seeding',
          // The migrated explicit seed was the seeded queue head; propagation
          // completed, so the consumed head retires.
          frontierConsumed: 1,
          frontierMaxSeq: '0',
        },
      })
    );
    const pushStageLedgerFrontierSeeds = vi.fn().mockResolvedValue(ok(1));
    const settleStageLedgerPartialBatch = vi.fn().mockResolvedValue(
      ok({
        processedByTable: [{ tableId: TABLE_ID_B, recordCount: 1 }],
        newFrontierRows: 0,
        retiredFrontierRows: 1,
      })
    );
    const collectDirtySeedGroups = vi.fn();
    const enqueueOrMerge = vi.fn().mockResolvedValue(ok({ taskId: 'batch2', merged: false }));
    const markDone = vi.fn().mockResolvedValue(ok(true));
    const outbox = createOutboxStub({
      claimBatch: vi.fn().mockResolvedValue(ok([task])),
      enqueueOrMerge,
      markDone,
    });
    const worker = new ComputedUpdateWorker(
      outbox,
      {
        ...defaultComputedUpdateOutboxConfig,
        stageMaxSteps: 0,
        stageMaxFields: 0,
        stageMaxEdges: 0,
        stageMaxDirtyRecords: 10,
      },
      createUpdaterStub({
        execute,
        collectDirtySeedGroups,
        pushStageLedgerFrontierSeeds,
        settleStageLedgerPartialBatch,
      }),
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
    // Single step, no self-referential edges: executed in partial mode with the
    // stage-ledger scope (chain root = this task).
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][3]).toMatchObject({
      maxDirtyRecords: 10,
      dirtyBudgetMode: 'partial',
      ledgerScopeId: task.id,
    });
    // Floor entry migrates the explicit seed into the ledger's frontier queue.
    expect(pushStageLedgerFrontierSeeds).toHaveBeenCalledTimes(1);
    expect(pushStageLedgerFrontierSeeds.mock.calls[0][1]).toBe(task.id);
    expect(
      pushStageLedgerFrontierSeeds.mock.calls[0][2].map(
        (group: { tableId: { toString(): string }; recordIds: Array<{ toString(): string }> }) => ({
          tableId: group.tableId.toString(),
          recordIds: group.recordIds.map((id) => id.toString()),
        })
      )
    ).toEqual([{ tableId: TABLE_ID, recordIds: [RECORD_ID] }]);
    // Settlement is SQL-side: exclusions and retirement never surface as arrays.
    expect(settleStageLedgerPartialBatch).toHaveBeenCalledTimes(1);
    expect(settleStageLedgerPartialBatch.mock.calls[0][1]).toMatchObject({
      scopeId: task.id,
      appendFrontier: false,
      retireFrontierUpToSeq: '0',
    });
    expect(collectDirtySeedGroups).not.toHaveBeenCalled();

    expect(enqueueOrMerge).toHaveBeenCalledTimes(1);
    const continuation = enqueueOrMerge.mock.calls[0][0];
    // The step is not complete: same plan continues, keyed to the same ledger
    // scope, with only O(1) durable state in the payload.
    expect(continuation.steps).toEqual(task.steps);
    expect(continuation.runCompletedStepsBefore).toBe(0);
    expect(continuation.ledgerScopeId).toBe(task.id);
    expect(continuation.seedRecordIds).toEqual([]);
    expect(continuation.extraSeedRecords).toEqual([]);
    expect(continuation.affectedFieldIds).toEqual([]);
    expect(continuation.dirtyStats).toEqual([{ tableId: TABLE_ID_B, recordCount: 1 }]);
    expect(continuation.planHash).toBe('hash123:run:run123:stage:0:from:cuo123456789012345');
    expect(markDone).toHaveBeenCalledWith(task, expect.anything(), expect.anything());
  });

  it('keeps the frontier queue unretired while propagation truncates', async () => {
    const task = createMockTask({
      steps: [{ level: 0, tableId: TABLE_ID_B, fieldIds: [FIELD_ID_B] }],
      edges: [
        {
          fromFieldId: FIELD_ID,
          toFieldId: FIELD_ID_B,
          fromTableId: TABLE_ID,
          toTableId: TABLE_ID_B,
          linkFieldId: FIELD_ID_B,
          propagationMode: 'linkTraversal' as const,
          order: 0,
        },
      ],
      affectedTableIds: [TABLE_ID, TABLE_ID_B],
      affectedFieldIds: [FIELD_ID, FIELD_ID_B],
      runTotalSteps: 1,
    });
    const execute = vi.fn().mockResolvedValue(
      ok({
        changesByStep: [],
        dirtyBudget: {
          status: 'partial',
          propagatedDirtyRecords: 10,
          truncated: 'propagation',
          frontierConsumed: 1,
          frontierMaxSeq: '0',
        },
      })
    );
    const pushStageLedgerFrontierSeeds = vi.fn().mockResolvedValue(ok(1));
    const settleStageLedgerPartialBatch = vi
      .fn()
      .mockResolvedValue(ok({ processedByTable: [], newFrontierRows: 0, retiredFrontierRows: 0 }));
    const enqueueOrMerge = vi.fn().mockResolvedValue(ok({ taskId: 'batch2', merged: false }));
    const markDone = vi.fn().mockResolvedValue(ok(true));
    const outbox = createOutboxStub({
      claimBatch: vi.fn().mockResolvedValue(ok([task])),
      enqueueOrMerge,
      markDone,
    });
    const worker = new ComputedUpdateWorker(
      outbox,
      {
        ...defaultComputedUpdateOutboxConfig,
        stageMaxSteps: 0,
        stageMaxFields: 0,
        stageMaxEdges: 0,
        stageMaxDirtyRecords: 10,
      },
      createUpdaterStub({ execute, pushStageLedgerFrontierSeeds, settleStageLedgerPartialBatch }),
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
    // Propagation truncated: the consumed head's targets are unfinished, so the
    // queue must NOT retire — the same head re-seeds next batch and progresses
    // via target exclusions.
    expect(settleStageLedgerPartialBatch.mock.calls[0][1]).toMatchObject({
      retireFrontierUpToSeq: null,
    });
    const continuation = enqueueOrMerge.mock.calls[0][0];
    expect(continuation.seedRecordIds).toEqual([]);
    expect(continuation.ledgerScopeId).toBe(task.id);
  });

  it('appends the self-referential frontier during SQL-side settlement', async () => {
    const task = createMockTask({
      steps: [{ level: 0, tableId: TABLE_ID_B, fieldIds: [FIELD_ID_B] }],
      edges: [
        {
          fromFieldId: FIELD_ID_B,
          toFieldId: FIELD_ID_B,
          fromTableId: TABLE_ID_B,
          toTableId: TABLE_ID_B,
          linkFieldId: FIELD_ID_B,
          propagationMode: 'linkTraversal' as const,
          order: 0,
        },
      ],
      affectedTableIds: [TABLE_ID_B],
      // A previous partial batch changed FIELD_ID; this batch adds FIELD_ID_B.
      affectedFieldIds: [FIELD_ID],
      runTotalSteps: 1,
    });
    const execute = vi.fn().mockResolvedValue(
      ok({
        changesByStep: [
          {
            tableId: TABLE_ID_B,
            recordChanges: [
              {
                recordId: RECORD_ID,
                oldVersion: 1,
                changes: [{ fieldId: FIELD_ID_B, newValue: 'next-batch' }],
              },
            ],
          },
        ],
        dirtyBudget: {
          status: 'partial',
          propagatedDirtyRecords: 10,
          truncated: 'seeding',
          frontierConsumed: 1,
          frontierMaxSeq: '0',
        },
      })
    );
    const settleStageLedgerPartialBatch = vi.fn().mockResolvedValue(
      ok({
        processedByTable: [{ tableId: TABLE_ID_B, recordCount: 1 }],
        newFrontierRows: 1,
        retiredFrontierRows: 1,
      })
    );
    const enqueueOrMerge = vi.fn().mockResolvedValue(ok({ taskId: 'batch2', merged: false }));
    const markDone = vi.fn().mockResolvedValue(ok(true));
    const outbox = createOutboxStub({
      claimBatch: vi.fn().mockResolvedValue(ok([task])),
      enqueueOrMerge,
      markDone,
    });
    const worker = new ComputedUpdateWorker(
      outbox,
      {
        ...defaultComputedUpdateOutboxConfig,
        stageMaxSteps: 0,
        stageMaxFields: 0,
        stageMaxEdges: 0,
        stageMaxDirtyRecords: 10,
      },
      createUpdaterStub({ execute, settleStageLedgerPartialBatch }),
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
    // Self-referential single-step stages stay budgeted in plain partial mode.
    expect(execute.mock.calls[0][3]).toMatchObject({
      maxDirtyRecords: 10,
      dirtyBudgetMode: 'partial',
    });
    // Settlement appends rows NEW this batch to the queue tail (the next
    // generation's sources) and excludes every processed step-table row —
    // entirely inside the ledger.
    expect(settleStageLedgerPartialBatch.mock.calls[0][1]).toMatchObject({
      scopeId: task.id,
      appendFrontier: true,
      retireFrontierUpToSeq: '0',
    });
    const continuation = enqueueOrMerge.mock.calls[0][0];
    expect(continuation.ledgerScopeId).toBe(task.id);
    expect(continuation.extraSeedRecords).toEqual([]);
    // Fresh tasks ignore their broad input scope and start accumulation from
    // this batch's actual changes.
    expect(continuation.affectedFieldIds).toEqual([FIELD_ID_B]);
    expect(markDone).toHaveBeenCalledWith(task, expect.anything(), expect.anything());
  });

  it('normalizes implicit schema-update seeding to cursors on partial continuations', async () => {
    // No per-record seeds at all on an update plan: the seed table is implicitly
    // whole-table seeded. The continuation must carry an explicit seedAllTableIds
    // entry (reported by the batch itself) plus the advanced cursor.
    const task = createMockTask({
      seedRecordIds: [],
      extraSeedRecords: [],
      steps: [{ level: 0, tableId: TABLE_ID_C, fieldIds: [FIELD_ID_C] }],
      edges: [
        {
          fromFieldId: FIELD_ID,
          toFieldId: FIELD_ID_C,
          fromTableId: TABLE_ID,
          toTableId: TABLE_ID_C,
          linkFieldId: FIELD_ID_C,
          propagationMode: 'linkTraversal' as const,
          order: 0,
        },
      ],
      affectedTableIds: [TABLE_ID, TABLE_ID_C],
      affectedFieldIds: [FIELD_ID, FIELD_ID_C],
      runTotalSteps: 1,
    });
    const cursorRecordId = `rec${'m'.repeat(16)}`;
    const execute = vi.fn().mockResolvedValue(
      ok({
        changesByStep: [],
        dirtyBudget: {
          status: 'partial',
          propagatedDirtyRecords: 10,
          truncated: 'seeding',
          seedAllCursors: { [TABLE_ID]: cursorRecordId },
          wholeTableSeedTables: [TABLE_ID],
        },
      })
    );
    const settleStageLedgerPartialBatch = vi
      .fn()
      .mockResolvedValue(ok({ processedByTable: [], newFrontierRows: 0, retiredFrontierRows: 0 }));
    const enqueueOrMerge = vi.fn().mockResolvedValue(ok({ taskId: 'batch2', merged: false }));
    const markDone = vi.fn().mockResolvedValue(ok(true));
    const outbox = createOutboxStub({
      claimBatch: vi.fn().mockResolvedValue(ok([task])),
      enqueueOrMerge,
      markDone,
    });
    const worker = new ComputedUpdateWorker(
      outbox,
      {
        ...defaultComputedUpdateOutboxConfig,
        stageMaxSteps: 0,
        stageMaxFields: 0,
        stageMaxEdges: 0,
        stageMaxDirtyRecords: 10,
      },
      createUpdaterStub({ execute, settleStageLedgerPartialBatch }),
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
    // Only target (step) tables feed the exclusion ledger; sources use cursors.
    expect(
      settleStageLedgerPartialBatch.mock.calls[0][1].stepTableIds.map(
        (id: { toString(): string }) => id.toString()
      )
    ).toEqual([TABLE_ID_C]);

    const continuation = enqueueOrMerge.mock.calls[0][0];
    expect(continuation.seedAllTableIds).toEqual([TABLE_ID]);
    // Propagation completed (truncated: 'seeding'): the cursor advances.
    expect(continuation.seedAllCursors).toEqual({ [TABLE_ID]: cursorRecordId });
  });

  it('keeps the inherited ledger scope across partial continuations and retires the consumed head', async () => {
    const chainRootTaskId = 'cuoroot12345678901';
    const task = createMockTask({
      seedRecordIds: [],
      extraSeedRecords: [],
      ledgerScopeId: chainRootTaskId,
      steps: [{ level: 0, tableId: TABLE_ID_B, fieldIds: [FIELD_ID_B] }],
      edges: [
        {
          fromFieldId: FIELD_ID_B,
          toFieldId: FIELD_ID_B,
          fromTableId: TABLE_ID_B,
          toTableId: TABLE_ID_B,
          linkFieldId: FIELD_ID_B,
          propagationMode: 'linkTraversal' as const,
          order: 0,
        },
      ],
      affectedTableIds: [TABLE_ID_B],
      affectedFieldIds: [FIELD_ID],
      runTotalSteps: 1,
    });
    const execute = vi.fn().mockResolvedValue(
      ok({
        changesByStep: [
          {
            tableId: TABLE_ID_B,
            recordChanges: [
              {
                recordId: RECORD_ID,
                oldVersion: 1,
                changes: [{ fieldId: FIELD_ID_B, newValue: 'next-batch' }],
              },
            ],
          },
        ],
        dirtyBudget: {
          status: 'partial',
          propagatedDirtyRecords: 10,
          truncated: 'seeding',
          // The seeded queue head (seq up to 7) whose propagation completed.
          frontierConsumed: 2,
          frontierMaxSeq: '7',
        },
      })
    );
    const pushStageLedgerFrontierSeeds = vi.fn();
    const settleStageLedgerPartialBatch = vi.fn().mockResolvedValue(
      ok({
        processedByTable: [{ tableId: TABLE_ID_B, recordCount: 2 }],
        newFrontierRows: 1,
        retiredFrontierRows: 2,
      })
    );
    const enqueueOrMerge = vi.fn().mockResolvedValue(ok({ taskId: 'batch3', merged: false }));
    const markDone = vi.fn().mockResolvedValue(ok(true));
    const outbox = createOutboxStub({
      claimBatch: vi.fn().mockResolvedValue(ok([task])),
      enqueueOrMerge,
      markDone,
    });
    const worker = new ComputedUpdateWorker(
      outbox,
      {
        ...defaultComputedUpdateOutboxConfig,
        stageMaxSteps: 0,
        stageMaxFields: 0,
        stageMaxEdges: 0,
        stageMaxDirtyRecords: 10,
      },
      createUpdaterStub({
        execute,
        pushStageLedgerFrontierSeeds,
        settleStageLedgerPartialBatch,
      }),
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
    // A continuation inherits the chain root's scope: the ledger stays keyed to
    // one chain even across many batches (and never to the shared runId, which
    // parallel chunk-split tasks reuse).
    expect(execute.mock.calls[0][3]).toMatchObject({ ledgerScopeId: chainRootTaskId });
    // No seeds to migrate on a continuation.
    expect(pushStageLedgerFrontierSeeds).not.toHaveBeenCalled();
    // Propagation completed: exactly the consumed head (seq <= 7) retires.
    expect(settleStageLedgerPartialBatch.mock.calls[0][1]).toMatchObject({
      scopeId: chainRootTaskId,
      appendFrontier: true,
      retireFrontierUpToSeq: '7',
    });
    const continuation = enqueueOrMerge.mock.calls[0][0];
    expect(continuation.ledgerScopeId).toBe(chainRootTaskId);
    expect(continuation.affectedFieldIds).toEqual([FIELD_ID, FIELD_ID_B]);
  });

  it('keeps a small same-table formula chain in one transaction', async () => {
    const task = createMockTask({
      steps: [
        { level: 0, tableId: TABLE_ID, fieldIds: [FIELD_ID] },
        { level: 1, tableId: TABLE_ID, fieldIds: [FIELD_ID_B] },
        { level: 2, tableId: TABLE_ID, fieldIds: [FIELD_ID_C] },
      ],
      edges: [],
      dirtyStats: [{ tableId: TABLE_ID, recordCount: 1 }],
      estimatedComplexity: 6,
      affectedTableIds: [TABLE_ID],
      affectedFieldIds: [FIELD_ID, FIELD_ID_B, FIELD_ID_C],
      runTotalSteps: 3,
    });
    const execute = vi.fn().mockResolvedValue(ok({ changesByStep: [] }));
    const enqueueOrMerge = vi.fn();
    const markDone = vi.fn().mockResolvedValue(ok(true));
    const outbox = createOutboxStub({
      claimBatch: vi.fn().mockResolvedValue(ok([task])),
      enqueueOrMerge,
      markDone,
    });
    const worker = new ComputedUpdateWorker(
      outbox,
      defaultComputedUpdateOutboxConfig,
      createUpdaterStub({ execute }),
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
    expect(execute.mock.calls[0][0].steps.map((step: { level: number }) => step.level)).toEqual([
      0, 1, 2,
    ]);
    expect(enqueueOrMerge).not.toHaveBeenCalled();
    expect(markDone).toHaveBeenCalledWith(task, expect.anything(), expect.anything());
  });

  const threeLevelLinkTraversalFields = {
    steps: [
      { level: 0, tableId: TABLE_ID, fieldIds: [FIELD_ID] },
      { level: 1, tableId: TABLE_ID_B, fieldIds: [FIELD_ID_B] },
      { level: 2, tableId: TABLE_ID_C, fieldIds: [FIELD_ID_C] },
    ],
    edges: [
      {
        fromFieldId: FIELD_ID,
        toFieldId: FIELD_ID_B,
        fromTableId: TABLE_ID,
        toTableId: TABLE_ID_B,
        linkFieldId: FIELD_ID_B,
        propagationMode: 'linkTraversal' as const,
        order: 0,
      },
      {
        fromFieldId: FIELD_ID_B,
        toFieldId: FIELD_ID_C,
        fromTableId: TABLE_ID_B,
        toTableId: TABLE_ID_C,
        linkFieldId: FIELD_ID_C,
        propagationMode: 'linkTraversal' as const,
        order: 1,
      },
    ],
    affectedTableIds: [TABLE_ID, TABLE_ID_B, TABLE_ID_C],
    affectedFieldIds: [FIELD_ID, FIELD_ID_B, FIELD_ID_C],
    runTotalSteps: 3,
  };

  it('probes all dependency levels for an explicit-seed linkTraversal update', async () => {
    const task = createMockTask(threeLevelLinkTraversalFields);
    const execute = vi.fn().mockResolvedValue(ok({ changesByStep: [] }));
    const markDone = vi.fn().mockResolvedValue(ok(true));
    const worker = new ComputedUpdateWorker(
      createOutboxStub({
        claimBatch: vi.fn().mockResolvedValue(ok([task])),
        markDone,
      }),
      {
        ...defaultComputedUpdateOutboxConfig,
        stageMaxSteps: 10,
        stageMaxFields: 0,
        stageMaxEdges: 0,
        stageMaxDirtyRecords: 5000,
        stageSmallRunComplexityThreshold: 0,
      },
      createUpdaterStub({ execute }),
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
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0].steps.map((step: { level: number }) => step.level)).toEqual([
      0, 1, 2,
    ]);
    expect(execute.mock.calls[0][3]).toMatchObject({
      maxDirtyRecords: 5000,
      dirtyBudgetMode: 'abort',
    });
    expect(markDone).toHaveBeenCalledWith(task, expect.anything(), expect.anything());
  });

  it('probes all dependency levels for a small explicit-seed insert', async () => {
    const task = createMockTask({
      ...threeLevelLinkTraversalFields,
      changeType: 'insert',
    });
    const execute = vi.fn().mockResolvedValue(ok({ changesByStep: [] }));
    const markDone = vi.fn().mockResolvedValue(ok(true));
    const worker = new ComputedUpdateWorker(
      createOutboxStub({
        claimBatch: vi.fn().mockResolvedValue(ok([task])),
        markDone,
      }),
      {
        ...defaultComputedUpdateOutboxConfig,
        stageMaxSteps: 10,
        stageMaxFields: 0,
        stageMaxEdges: 0,
        stageMaxDirtyRecords: 5000,
        stageSmallRunComplexityThreshold: 0,
      },
      createUpdaterStub({ execute }),
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
    expect(execute.mock.calls[0][0].steps.map((step: { level: number }) => step.level)).toEqual([
      0, 1, 2,
    ]);
  });

  it('keeps the one-level clamp for delete cascades', async () => {
    const task = createMockTask({
      ...threeLevelLinkTraversalFields,
      changeType: 'delete',
    });
    const execute = vi.fn().mockResolvedValue(ok({ changesByStep: [] }));
    const enqueueOrMerge = vi.fn().mockResolvedValue(ok({ taskId: 'cont', merged: false }));
    const markDone = vi.fn().mockResolvedValue(ok(true));
    const worker = new ComputedUpdateWorker(
      createOutboxStub({
        claimBatch: vi.fn().mockResolvedValue(ok([task])),
        enqueueOrMerge,
        markDone,
      }),
      {
        ...defaultComputedUpdateOutboxConfig,
        stageMaxSteps: 10,
        stageMaxFields: 0,
        stageMaxEdges: 0,
        stageMaxDirtyRecords: 5000,
        stageSmallRunComplexityThreshold: 0,
      },
      createUpdaterStub({ execute }),
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
    expect(execute.mock.calls[0][0].steps.map((step: { level: number }) => step.level)).toEqual([
      0,
    ]);
    expect(enqueueOrMerge).toHaveBeenCalledTimes(1);
    expect(
      enqueueOrMerge.mock.calls[0][0].steps.map((step: { level: number }) => step.level)
    ).toEqual([1, 2]);
  });

  it('keeps the one-level clamp for bulk inserts', async () => {
    const task = createMockTask({
      ...threeLevelLinkTraversalFields,
      changeType: 'insert',
      seedRecordIds: Array.from(
        { length: 17 },
        (_, index) => `rec${String(index).padStart(16, '0')}`
      ),
    });
    const execute = vi.fn().mockResolvedValue(ok({ changesByStep: [] }));
    const enqueueOrMerge = vi.fn().mockResolvedValue(ok({ taskId: 'cont', merged: false }));
    const markDone = vi.fn().mockResolvedValue(ok(true));
    const worker = new ComputedUpdateWorker(
      createOutboxStub({
        claimBatch: vi.fn().mockResolvedValue(ok([task])),
        enqueueOrMerge,
        markDone,
      }),
      {
        ...defaultComputedUpdateOutboxConfig,
        stageMaxSteps: 10,
        stageMaxFields: 0,
        stageMaxEdges: 0,
        stageMaxDirtyRecords: 5000,
        stageSmallRunComplexityThreshold: 0,
      },
      createUpdaterStub({ execute }),
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
    expect(execute.mock.calls[0][0].steps.map((step: { level: number }) => step.level)).toEqual([
      0,
    ]);
    expect(enqueueOrMerge).toHaveBeenCalledTimes(1);
  });

  it('keeps the one-level clamp for small inserts whose dirty estimate exceeds the budget', async () => {
    // A probe that predictably overflows the abort budget only buys a
    // rolled-back transaction; fanout-split children carry a proportional
    // dirty share, so this also keeps high-fanout import chunks clamped.
    const task = createMockTask({
      ...threeLevelLinkTraversalFields,
      changeType: 'insert',
      dirtyStats: [{ tableId: TABLE_ID, recordCount: 6000 }],
    });
    const execute = vi.fn().mockResolvedValue(ok({ changesByStep: [] }));
    const enqueueOrMerge = vi.fn().mockResolvedValue(ok({ taskId: 'cont', merged: false }));
    const markDone = vi.fn().mockResolvedValue(ok(true));
    const worker = new ComputedUpdateWorker(
      createOutboxStub({
        claimBatch: vi.fn().mockResolvedValue(ok([task])),
        enqueueOrMerge,
        markDone,
      }),
      {
        ...defaultComputedUpdateOutboxConfig,
        stageMaxSteps: 10,
        stageMaxFields: 0,
        stageMaxEdges: 0,
        stageMaxDirtyRecords: 5000,
        stageSmallRunComplexityThreshold: 0,
      },
      createUpdaterStub({ execute }),
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
    expect(execute.mock.calls[0][0].steps.map((step: { level: number }) => step.level)).toEqual([
      0,
    ]);
    expect(enqueueOrMerge).toHaveBeenCalledTimes(1);
  });

  it('reclamps to one dependency level after a multi-level dirty-budget abort', async () => {
    const task = createMockTask(threeLevelLinkTraversalFields);
    const execute = vi
      .fn()
      .mockResolvedValueOnce(
        ok({ changesByStep: [], dirtyBudget: { status: 'exceeded', dirtyRecordsAtAbort: 42 } })
      )
      .mockResolvedValue(ok({ changesByStep: [] }));
    const enqueueOrMerge = vi.fn().mockResolvedValue(ok({ taskId: 'cont', merged: false }));
    const markDone = vi.fn().mockResolvedValue(ok(true));
    const worker = new ComputedUpdateWorker(
      createOutboxStub({
        claimBatch: vi.fn().mockResolvedValue(ok([task])),
        enqueueOrMerge,
        markDone,
      }),
      {
        ...defaultComputedUpdateOutboxConfig,
        stageMaxSteps: 10,
        stageMaxFields: 0,
        stageMaxEdges: 0,
        stageMaxDirtyRecords: 10,
        stageSmallRunComplexityThreshold: 0,
      },
      createUpdaterStub({ execute }),
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
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[0][0].steps.map((step: { level: number }) => step.level)).toEqual([
      0, 1, 2,
    ]);
    expect(execute.mock.calls[0][3]).toMatchObject({ dirtyBudgetMode: 'abort' });
    expect(execute.mock.calls[1][0].steps.map((step: { level: number }) => step.level)).toEqual([
      0,
    ]);
    expect(execute.mock.calls[1][3]).toMatchObject({ dirtyBudgetMode: 'partial' });
    expect(
      enqueueOrMerge.mock.calls[0][0].steps.map((step: { level: number }) => step.level)
    ).toEqual([1, 2]);
  });
});

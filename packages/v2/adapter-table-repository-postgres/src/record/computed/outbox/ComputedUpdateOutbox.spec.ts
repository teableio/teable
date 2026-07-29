import { FieldId, TableId, type IEventBus, type ILogger } from '@teable/v2-core';
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';
import { ok } from 'neverthrow';
import { describe, it, expect, vi } from 'vitest';

import {
  noopComputedActivityProjector,
  type IComputedActivityProjector,
} from '../activity/IComputedActivityProjector';
import { buildAdvisoryLockQuery, buildTryAdvisoryLockQuery } from '../ComputedUpdateLock';
import {
  buildTryOutboxAdvisoryLockQuery,
  ComputedUpdateOutbox,
  dedupeClaimRowsByScope,
} from './ComputedUpdateOutbox';
import type { ComputedUpdateOutboxItem } from './ComputedUpdateOutboxPayload';
import {
  defaultComputedUpdateOutboxConfig,
  type ComputedUpdateOutboxConfig,
} from './IComputedUpdateOutbox';

const BASE_ID = `bse${'a'.repeat(16)}`;
const TABLE_ID = `tbl${'b'.repeat(16)}`;
const FIELD_ID = `fld${'c'.repeat(16)}`;

// Create a mock logger
const createLogger = (): ILogger => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn().mockReturnThis(),
  scope: vi.fn().mockReturnThis(),
});

// Create a mock task
const createMockTask = (
  overrides: Partial<ComputedUpdateOutboxItem> = {}
): ComputedUpdateOutboxItem => ({
  id: 'cuo123456789012345',
  baseId: BASE_ID,
  seedTableId: TABLE_ID,
  seedRecordIds: ['rec123'],
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
  status: 'pending',
  attempts: 0,
  maxAttempts: 8,
  nextRunAt: new Date(),
  lockedAt: null,
  lockedBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MockDb = Kysely<any>;

const createMockExecutor = () => {
  const executor = {
    transformQuery: vi.fn((node) => node),
    compileQuery: vi.fn(() => ({ sql: 'select 1', parameters: [] })),
    withPlugins: vi.fn(() => executor),
  };
  return executor;
};

describe('ComputedUpdateOutbox', () => {
  describe('releaseForRetry', () => {
    it('returns a processing task to pending without incrementing attempts', async () => {
      const now = new Date('2026-01-05T12:00:00Z');
      const order: string[] = [];
      let updateValues: Record<string, unknown> | null = null;
      let selectedLeaseOwner: string | null = null;
      const selectedRows = [{ id: 'cuo123456789012345' }, undefined];
      const executor = {
        transformQuery: vi.fn((node) => node),
        compileQuery: vi.fn(() => ({ sql: 'select 1', parameters: [] })),
        withPlugins: vi.fn(() => executor),
      };

      const selectChain = {
        where: vi.fn().mockImplementation((_col, _op, value) => {
          if (String(value).startsWith('worker-')) {
            selectedLeaseOwner = String(value);
          }
          return selectChain;
        }),
        forUpdate: vi.fn().mockReturnValue({
          executeTakeFirst: vi.fn().mockImplementation(() => Promise.resolve(selectedRows.shift())),
        }),
      };
      const mockDb = {
        transaction: () => ({
          execute: async <T>(fn: (trx: unknown) => Promise<T>) => {
            const result = await fn(mockDb);
            order.push('commit');
            return result;
          },
        }),
        executeQuery: vi.fn().mockResolvedValue({ rows: [{ locked: true }] }),
        getExecutor: vi.fn(() => executor),
        selectFrom: vi.fn().mockReturnValue({
          selectAll: vi.fn().mockReturnValue(selectChain),
          select: vi.fn().mockReturnValue(selectChain),
        }),
        updateTable: vi.fn().mockReturnValue({
          set: vi.fn().mockImplementation((values) => {
            updateValues = values;
            return {
              where: vi.fn().mockReturnValue({
                execute: vi.fn().mockResolvedValue([]),
              }),
            };
          }),
        }),
      } as unknown as MockDb;

      const logger = createLogger();
      const taskBaseId = BASE_ID;
      const projection = {
        baseId: taskBaseId,
        fields: [
          {
            fieldId: FIELD_ID,
            tableId: TABLE_ID,
            baseId: taskBaseId,
            status: 'queued' as const,
            activeTaskCount: 1,
            processingTaskCount: 0,
            generation: 2,
            estimatedComplexity: 1,
            estimatedDirtyRecords: 1,
            hasAllTargetRecords: false,
            updatedAt: now.toISOString(),
          },
        ],
        tables: [],
      };
      const activityProjector: IComputedActivityProjector = {
        ...noopComputedActivityProjector,
        onTaskFailed: vi.fn().mockResolvedValue(ok(projection)),
      };
      const publish = vi.fn().mockImplementation(async () => {
        order.push('publish');
        return ok(undefined);
      });
      const eventBus = { publish } as unknown as IEventBus;
      const outbox = new ComputedUpdateOutbox(
        mockDb,
        defaultComputedUpdateOutboxConfig,
        logger,
        mockDb,
        undefined,
        activityProjector,
        eventBus
      );
      const task = createMockTask({
        status: 'processing',
        attempts: 3,
        lockedAt: now,
        lockedBy: 'worker-1:cuc_lock',
      });

      const result = await outbox.releaseForRetry({
        task,
        reason: 'lock busy',
        retryDelayMs: 250,
        now,
      });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(true);
      expect(selectedLeaseOwner).toBe('worker-1:cuc_lock');
      expect(updateValues).toMatchObject({
        status: 'pending',
        last_error: 'lock busy',
        locked_at: null,
        locked_by: null,
        updated_at: now,
      });
      expect(updateValues?.attempts).toBeUndefined();
      // Retry delays carry jitter across [0.5x, 1.5x) of the requested delay.
      const nextRunAtMs = (updateValues?.next_run_at as Date).getTime();
      expect(nextRunAtMs).toBeGreaterThanOrEqual(now.getTime() + 125);
      expect(nextRunAtMs).toBeLessThanOrEqual(now.getTime() + 375);
      expect(publish).toHaveBeenCalledOnce();
      expect(order).toEqual(['commit', 'publish']);
    });
  });

  describe('enqueue activity publication', () => {
    it('publishes only after the local transaction commits', async () => {
      const order: string[] = [];
      const selectChain = {
        where: vi.fn().mockReturnThis(),
        forUpdate: vi.fn().mockReturnValue({
          executeTakeFirst: vi.fn().mockResolvedValue(undefined),
        }),
      };
      const mockDb = {
        transaction: () => ({
          execute: async <T>(fn: (trx: unknown) => Promise<T>) => {
            const result = await fn(mockDb);
            order.push('commit');
            return result;
          },
        }),
        executeQuery: vi.fn().mockResolvedValue({ rows: [{ locked: true }] }),
        getExecutor: vi.fn(() => createMockExecutor()),
        selectFrom: vi.fn().mockReturnValue({
          selectAll: vi.fn().mockReturnValue(selectChain),
        }),
        insertInto: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockReturnValue({
              executeTakeFirstOrThrow: vi.fn().mockResolvedValue({ id: 'cuo-created' }),
            }),
          }),
        }),
      } as unknown as MockDb;
      const task = createMockTask({
        orchestration: {
          operationId: 'paste-operation',
          groupId: 'paste-operation',
          totalRecordCount: 900,
          totalChunkCount: 5,
          chunkIndex: 2,
          scope: 'chunk',
        },
      });
      const projection = {
        baseId: task.baseId,
        fields: [
          {
            fieldId: FIELD_ID,
            tableId: task.seedTableId,
            baseId: task.baseId,
            status: 'queued' as const,
            activeTaskCount: 1,
            processingTaskCount: 0,
            generation: 1,
            estimatedComplexity: 1,
            estimatedDirtyRecords: 1,
            hasAllTargetRecords: false,
            updatedAt: new Date().toISOString(),
          },
        ],
        tables: [],
      };
      const onTaskEnqueued = vi.fn().mockResolvedValue(ok(projection));
      const activityProjector: IComputedActivityProjector = {
        ...noopComputedActivityProjector,
        onTaskEnqueued,
      };
      const eventBus = {
        publish: vi.fn().mockImplementation(async () => {
          order.push('publish');
          return ok(undefined);
        }),
      } as unknown as IEventBus;
      const outbox = new ComputedUpdateOutbox(
        mockDb,
        defaultComputedUpdateOutboxConfig,
        createLogger(),
        mockDb,
        undefined,
        activityProjector,
        eventBus
      );

      const result = await outbox.enqueueOrMerge(task);
      if (result.isErr()) throw new Error(result.error.message);

      expect(result.isOk()).toBe(true);
      expect(onTaskEnqueued).toHaveBeenCalledWith(
        expect.objectContaining({
          metrics: expect.objectContaining({
            batchProgress: { groupId: 'paste-operation', total: 5, completed: 2 },
          }),
        }),
        undefined
      );
      expect(order).toEqual(['commit', 'publish']);
    });
  });

  describe('planned seed activity registration', () => {
    it('projects the discovered targets as processing before publishing', async () => {
      const order: string[] = [];
      const mockDb = {
        transaction: () => ({
          execute: async <T>(fn: (trx: unknown) => Promise<T>) => {
            const result = await fn(mockDb);
            order.push('commit');
            return result;
          },
        }),
        executeQuery: vi.fn().mockResolvedValue({ rows: [{ locked: true }] }),
        getExecutor: vi.fn(() => createMockExecutor()),
      } as unknown as MockDb;
      const now = new Date('2026-07-16T10:00:00.000Z');
      const fieldId = FieldId.create(FIELD_ID)._unsafeUnwrap();
      const tableId = TableId.create(TABLE_ID)._unsafeUnwrap();
      const queuedProjection = {
        baseId: BASE_ID,
        fields: [
          {
            fieldId: FIELD_ID,
            tableId: TABLE_ID,
            baseId: BASE_ID,
            status: 'queued' as const,
            activeTaskCount: 1,
            processingTaskCount: 0,
            generation: 1,
            estimatedComplexity: 7,
            estimatedDirtyRecords: 1,
            hasAllTargetRecords: false,
            updatedAt: now.toISOString(),
          },
        ],
        tables: [],
      };
      const runningProjection = {
        ...queuedProjection,
        fields: queuedProjection.fields.map((field) => ({
          ...field,
          status: 'running' as const,
          processingTaskCount: 1,
          generation: 2,
        })),
      };
      const onTaskEnqueued = vi.fn().mockImplementation(async () => {
        order.push('enqueue');
        return ok(queuedProjection);
      });
      const onTasksClaimed = vi.fn().mockImplementation(async () => {
        order.push('claim');
        return ok(runningProjection);
      });
      const activityProjector: IComputedActivityProjector = {
        ...noopComputedActivityProjector,
        onTaskEnqueued,
        onTasksClaimed,
      };
      const publish = vi.fn().mockImplementation(async () => {
        order.push('publish');
        return ok(undefined);
      });
      const eventBus = { publish } as unknown as IEventBus;
      const outbox = new ComputedUpdateOutbox(
        mockDb,
        defaultComputedUpdateOutboxConfig,
        createLogger(),
        mockDb,
        undefined,
        activityProjector,
        eventBus
      );
      const metrics = {
        estimatedComplexity: 7,
        estimatedDirtyRecords: 1,
        hasAllTargetRecords: false,
      };

      const result = await outbox.registerPlannedTaskActivity({
        taskId: 'cuo-seed',
        baseId: BASE_ID,
        targets: [{ tableId, fieldId }],
        metrics,
        now,
      });

      expect(result.isOk()).toBe(true);
      expect(onTaskEnqueued).toHaveBeenCalledWith(
        {
          taskId: 'cuo-seed',
          baseId: BASE_ID,
          targets: [{ tableId, fieldId }],
          metrics,
          now,
          trx: mockDb,
        },
        undefined
      );
      expect(onTasksClaimed).toHaveBeenCalledWith(
        {
          tasks: [{ taskId: 'cuo-seed', baseId: BASE_ID }],
          now,
          trx: mockDb,
        },
        undefined
      );
      expect(publish).toHaveBeenCalledTimes(2);
      expect(publish.mock.calls.map((call) => call[1].fields[0]?.generation)).toEqual([1, 2]);
      expect(order).toEqual(['enqueue', 'claim', 'commit', 'publish', 'publish']);
    });
  });

  describe('markFailed', () => {
    it('schedules retry with exponential backoff when attempts < maxAttempts', async () => {
      const updateCalls: Array<{ next_run_at: Date; attempts: number }> = [];

      const mockDb = {
        transaction: () => ({
          execute: async <T>(fn: (trx: unknown) => Promise<T>) => fn(mockDb),
        }),
        updateTable: vi.fn().mockReturnValue({
          set: vi.fn().mockImplementation((values) => {
            updateCalls.push({
              next_run_at: values.next_run_at,
              attempts: values.attempts,
            });
            return {
              where: vi.fn().mockReturnValue({
                execute: vi.fn().mockResolvedValue([]),
              }),
            };
          }),
        }),
      } as unknown as MockDb;

      const config: ComputedUpdateOutboxConfig = {
        ...defaultComputedUpdateOutboxConfig,
        baseBackoffMs: 5000,
        maxBackoffMs: 300000,
      };

      const logger = createLogger();
      const outbox = new ComputedUpdateOutbox(mockDb, config, logger);

      const task = createMockTask({ attempts: 2, maxAttempts: 8 });
      const result = await outbox.markFailed(task, 'Test error');

      expect(result.isOk()).toBe(true);
      expect(updateCalls.length).toBe(1);
      expect(updateCalls[0].attempts).toBe(3); // 2 + 1
    });

    it('calculates correct exponential backoff for each attempt', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-05T12:00:00Z'));
      const backoffs: number[] = [];
      try {
        const mockDb = {
          transaction: () => ({
            execute: async <T>(fn: (trx: unknown) => Promise<T>) => fn(mockDb),
          }),
          updateTable: vi.fn().mockReturnValue({
            set: vi.fn().mockImplementation((values) => {
              const now = new Date();
              const delay = values.next_run_at.getTime() - now.getTime();
              backoffs.push(delay);
              return {
                where: vi.fn().mockReturnValue({
                  execute: vi.fn().mockResolvedValue([]),
                }),
              };
            }),
          }),
        } as unknown as MockDb;

        const config: ComputedUpdateOutboxConfig = {
          ...defaultComputedUpdateOutboxConfig,
          baseBackoffMs: 1000,
          maxBackoffMs: 60000,
        };

        const logger = createLogger();
        const outbox = new ComputedUpdateOutbox(mockDb, config, logger);

        // Test backoff for different attempt numbers
        for (const attempts of [0, 1, 2, 3]) {
          const task = createMockTask({ attempts, maxAttempts: 8 });
          await outbox.markFailed(task, 'Test error');
        }

        // Exponential base: 1000 * 2^0..2^3, each spread by jitter across [0.5x, 1.5x).
        expect(backoffs[0]).toBeGreaterThanOrEqual(500);
        expect(backoffs[0]).toBeLessThan(1500);
        expect(backoffs[1]).toBeGreaterThanOrEqual(1000);
        expect(backoffs[1]).toBeLessThan(3000);
        expect(backoffs[2]).toBeGreaterThanOrEqual(2000);
        expect(backoffs[2]).toBeLessThan(6000);
        expect(backoffs[3]).toBeGreaterThanOrEqual(4000);
        expect(backoffs[3]).toBeLessThan(12000);
      } finally {
        vi.useRealTimers();
      }
    });

    it('moves task to dead letter queue when maxAttempts reached', async () => {
      let deadLetterInserted = false;
      let outboxDeleted = false;
      let seedDeleted = false;

      const mockDb = {
        transaction: () => ({
          execute: async <T>(fn: (trx: unknown) => Promise<T>) => fn(mockDb),
        }),
        insertInto: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            execute: vi.fn().mockImplementation(() => {
              deadLetterInserted = true;
              return Promise.resolve([]);
            }),
          }),
        }),
        deleteFrom: vi.fn().mockImplementation((table: string) => ({
          where: vi.fn().mockReturnValue({
            execute: vi.fn().mockImplementation(() => {
              if (table === 'computed_update_outbox') outboxDeleted = true;
              if (table === 'computed_update_outbox_seed') seedDeleted = true;
              return Promise.resolve([]);
            }),
          }),
        })),
      } as unknown as MockDb;

      const logger = createLogger();
      const outbox = new ComputedUpdateOutbox(mockDb, defaultComputedUpdateOutboxConfig, logger);

      const task = createMockTask({ attempts: 7, maxAttempts: 8 }); // Next attempt = 8 = maxAttempts
      const result = await outbox.markFailed(task, 'Final error');

      expect(result.isOk()).toBe(true);
      expect(deadLetterInserted).toBe(true);
      expect(outboxDeleted).toBe(true);
      expect(seedDeleted).toBe(true);
    });

    it('logs dead letter classification fields for alerting', async () => {
      const values = vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue([]),
      });
      const mockDb = {
        transaction: () => ({
          execute: async <T>(fn: (trx: unknown) => Promise<T>) => fn(mockDb),
        }),
        insertInto: vi.fn().mockReturnValue({
          values,
        }),
        deleteFrom: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            execute: vi.fn().mockResolvedValue([]),
          }),
        }),
      } as unknown as MockDb;

      const logger = createLogger();
      const outbox = new ComputedUpdateOutbox(mockDb, defaultComputedUpdateOutboxConfig, logger);

      const task = createMockTask({ attempts: 0, maxAttempts: 8 });
      const diagnostics = {
        version: 1 as const,
        failure: {
          kind: 'computed_code_bug',
          reason: 'postgres_sql_generation_error',
          retryable: false,
          directDeadLetter: true,
          phase: 'execute_plan',
        },
      };
      await outbox.markFailed(
        task,
        'cannot cast type jsonb to timestamp with time zone',
        undefined,
        {
          failureKind: 'computed_code_bug',
          failureReason: 'postgres_sql_generation_error',
          retryable: false,
          directDeadLetter: true,
          diagnostics,
        }
      );

      expect(values).toHaveBeenCalledWith(
        expect.objectContaining({
          attempts: 1,
          max_attempts: 8,
          trace_data: JSON.stringify(diagnostics),
        })
      );

      expect(logger.warn).toHaveBeenCalledWith(
        'computed:outbox:dead_letter',
        expect.objectContaining({
          taskId: task.id,
          baseId: task.baseId,
          seedTableId: task.seedTableId,
          taskType: 'computed',
          failureKind: 'computed_code_bug',
          failureReason: 'postgres_sql_generation_error',
          retryable: false,
          directDeadLetter: true,
          attempts: 1,
          maxAttempts: 8,
        })
      );
    });

    it('logs retry scheduled event', async () => {
      const mockDb = {
        transaction: () => ({
          execute: async <T>(fn: (trx: unknown) => Promise<T>) => fn(mockDb),
        }),
        updateTable: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              execute: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      } as unknown as MockDb;

      const logger = createLogger();
      const outbox = new ComputedUpdateOutbox(mockDb, defaultComputedUpdateOutboxConfig, logger);

      const task = createMockTask({ attempts: 1, maxAttempts: 8 });
      await outbox.markFailed(task, 'Test error');

      expect(logger.warn).toHaveBeenCalledWith(
        'computed:outbox:retry_scheduled',
        expect.objectContaining({
          taskId: task.id,
          attempts: 2,
        })
      );
    });
  });

  describe('upsertSeedRows', () => {
    it('inserts seeds in deterministic order to reduce deadlocks', async () => {
      const inserted: Array<{ table_id: string; record_id: string }> = [];

      const mockDb = {
        insertInto: vi.fn().mockReturnValue({
          values: vi.fn().mockImplementation((rows) => {
            inserted.push(
              ...rows.map((row: { table_id: string; record_id: string }) => ({
                table_id: row.table_id,
                record_id: row.record_id,
              }))
            );
            return {
              onConflict: vi.fn().mockReturnValue({
                execute: vi.fn().mockResolvedValue([]),
              }),
            };
          }),
        }),
      } as unknown as MockDb;

      const logger = createLogger();
      const outbox = new ComputedUpdateOutbox(mockDb, defaultComputedUpdateOutboxConfig, logger);
      const outboxAny = outbox as unknown as {
        upsertSeedRows: (
          trx: MockDb,
          taskId: string,
          seeds: Array<{ tableId: string; recordId: string }>
        ) => Promise<void>;
      };

      const seeds = [
        { tableId: 'tblSeedB', recordId: 'rec002' },
        { tableId: 'tblSeedA', recordId: 'rec010' },
        { tableId: 'tblSeedA', recordId: 'rec001' },
        { tableId: 'tblSeedB', recordId: 'rec001' },
        { tableId: 'tblSeedA', recordId: 'rec002' },
      ];

      await outboxAny.upsertSeedRows(mockDb, 'task-seed-1', seeds);

      expect(inserted).toEqual([
        { table_id: 'tblSeedA', record_id: 'rec001' },
        { table_id: 'tblSeedA', record_id: 'rec002' },
        { table_id: 'tblSeedA', record_id: 'rec010' },
        { table_id: 'tblSeedB', record_id: 'rec001' },
        { table_id: 'tblSeedB', record_id: 'rec002' },
      ]);
    });
  });

  describe('claimBatch', () => {
    it('deduplicates claimed rows by base and seed table lock scope', () => {
      const rows = [
        { id: 'first', base_id: 'bse1', seed_table_id: 'tbl1' },
        { id: 'same-scope', base_id: 'bse1', seed_table_id: 'tbl1' },
        { id: 'other-table', base_id: 'bse1', seed_table_id: 'tbl2' },
        { id: 'other-base', base_id: 'bse2', seed_table_id: 'tbl1' },
      ];

      expect(dedupeClaimRowsByScope(rows).map((row) => row.id)).toEqual([
        'first',
        'other-table',
        'other-base',
      ]);
    });

    it('checks stale processing before claiming pending work', async () => {
      const now = new Date('2026-01-05T12:00:00Z');
      const statuses: string[] = [];

      const createSelectChain = (rows: unknown[]) => ({
        selectAll: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation((col, _op, val) => {
            if (String(col).endsWith('status')) statuses.push(String(val));
            return {
              where: vi.fn().mockReturnThis(),
              orderBy: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnValue({
                forUpdate: vi.fn().mockReturnValue({
                  skipLocked: vi.fn().mockReturnValue({
                    execute: vi.fn().mockResolvedValue(rows),
                  }),
                }),
              }),
            };
          }),
        }),
      });
      const mockDb = {
        transaction: () => ({
          execute: async <T>(fn: (trx: unknown) => Promise<T>) => fn(mockDb),
        }),
        executeQuery: vi.fn().mockResolvedValue({ rows: [{ locked: true }] }),
        getExecutor: vi.fn(() => createMockExecutor()),
        selectFrom: vi
          .fn()
          .mockImplementationOnce(() => createSelectChain([]))
          .mockImplementationOnce(() => createSelectChain([])),
      } as unknown as MockDb;

      const logger = createLogger();
      const outbox = new ComputedUpdateOutbox(mockDb, defaultComputedUpdateOutboxConfig, logger);

      await outbox.claimBatch({ workerId: 'worker-1', limit: 10, now });

      expect(statuses).toEqual(['processing', 'pending']);
    });

    it('marks claimed tasks as processing', async () => {
      let updateStatus: string | null = null;
      let lockedBy: string | null = null;

      const mockRow = {
        id: 'cuo123',
        base_id: 'bse123',
        seed_table_id: 'tbl123',
        seed_record_ids: JSON.stringify([{ tableId: 'tbl123', recordIds: ['rec123'] }]),
        change_type: 'update',
        steps: JSON.stringify([]),
        edges: JSON.stringify([]),
        status: 'pending',
        attempts: 0,
        max_attempts: 8,
        next_run_at: new Date().toISOString(),
        locked_at: null,
        locked_by: null,
        last_error: null,
        estimated_complexity: 1,
        plan_hash: 'hash123',
        dirty_stats: JSON.stringify([]),
        run_id: 'run123',
        origin_run_ids: [],
        run_total_steps: 1,
        run_completed_steps_before: 0,
        affected_table_ids: [],
        affected_field_ids: [],
        sync_max_level: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const createSelectChain = (rows: unknown[]) => ({
        selectAll: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            const chain = {
              where: vi.fn().mockReturnThis(),
              orderBy: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnValue({
                forUpdate: vi.fn().mockReturnValue({
                  skipLocked: vi.fn().mockReturnValue({
                    execute: vi.fn().mockResolvedValue(rows),
                  }),
                }),
              }),
            };
            return chain;
          }),
        }),
      });
      const activeRowsChain = {
        where: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue([]),
      };

      const mockDb = {
        transaction: () => ({
          execute: async <T>(fn: (trx: unknown) => Promise<T>) => fn(mockDb),
        }),
        executeQuery: vi.fn().mockResolvedValue({ rows: [{ locked: true }] }),
        getExecutor: vi.fn(() => createMockExecutor()),
        selectFrom: vi
          .fn()
          .mockImplementationOnce(() => createSelectChain([]))
          .mockImplementationOnce(() => createSelectChain([mockRow]))
          .mockImplementationOnce(() => ({
            select: vi.fn().mockReturnValue(activeRowsChain),
          })),
        updateTable: vi.fn().mockReturnValue({
          set: vi.fn().mockImplementation((values) => {
            updateStatus = values.status;
            lockedBy = values.locked_by;
            return {
              where: vi.fn().mockReturnValue({
                execute: vi.fn().mockResolvedValue([]),
              }),
            };
          }),
        }),
      } as unknown as MockDb;

      const logger = createLogger();
      const outbox = new ComputedUpdateOutbox(mockDb, defaultComputedUpdateOutboxConfig, logger);

      await outbox.claimBatch({ workerId: 'worker-1', limit: 10 });

      expect(updateStatus).toBe('processing');
      expect(lockedBy).toContain('worker-1:');
    });
  });

  describe('markDone', () => {
    it('removes task from outbox and seed tables', async () => {
      const deletedTables: string[] = [];

      const mockDb = {
        transaction: () => ({
          execute: async <T>(fn: (trx: unknown) => Promise<T>) => fn(mockDb),
        }),
        deleteFrom: vi.fn().mockImplementation((table: string) => {
          deletedTables.push(table);
          if (table === 'computed_update_outbox') {
            return {
              where: vi.fn().mockReturnValue({
                returning: vi.fn().mockReturnValue({
                  execute: vi.fn().mockResolvedValue([{ id: 'cuo123' }]),
                }),
              }),
            };
          }
          return {
            where: vi.fn().mockReturnValue({
              execute: vi.fn().mockResolvedValue([]),
            }),
          };
        }),
      } as unknown as MockDb;

      const logger = createLogger();
      const outbox = new ComputedUpdateOutbox(mockDb, defaultComputedUpdateOutboxConfig, logger);

      const result = await outbox.markDone('cuo123');

      expect(result.isOk()).toBe(true);
      expect(deletedTables).toContain('computed_update_outbox');
      expect(deletedTables).toContain('computed_update_outbox_seed');
    });
  });
});

describe('retry jitter', () => {
  it('spreads lock-miss requeue delays across the [0.5x, 1.5x) envelope', async () => {
    const now = new Date('2026-01-05T12:00:00Z');
    const delays: number[] = [];
    let takeFirstCalls = 0;
    const executor = createMockExecutor();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const selectChain: Record<string, any> = {};
    selectChain.where = vi.fn().mockReturnValue(selectChain);
    selectChain.forUpdate = vi.fn().mockReturnValue({
      // Alternate ownership-check hit and pending-lookup miss for every release call.
      executeTakeFirst: vi.fn().mockImplementation(() => {
        takeFirstCalls += 1;
        return Promise.resolve(takeFirstCalls % 2 === 1 ? { id: 'cuo123456789012345' } : undefined);
      }),
    });
    const mockDb = {
      transaction: () => ({
        execute: async <T>(fn: (trx: unknown) => Promise<T>) => fn(mockDb),
      }),
      executeQuery: vi.fn().mockResolvedValue({ rows: [{ locked: true }] }),
      getExecutor: vi.fn(() => executor),
      selectFrom: vi.fn().mockReturnValue({
        selectAll: vi.fn().mockReturnValue(selectChain),
        select: vi.fn().mockReturnValue(selectChain),
      }),
      updateTable: vi.fn().mockReturnValue({
        set: vi.fn().mockImplementation((values) => {
          delays.push(new Date(values.next_run_at).getTime() - now.getTime());
          return {
            where: vi.fn().mockReturnValue({ execute: vi.fn().mockResolvedValue([]) }),
          };
        }),
      }),
    } as unknown as MockDb;

    const outbox = new ComputedUpdateOutbox(
      mockDb,
      defaultComputedUpdateOutboxConfig,
      createLogger(),
      mockDb
    );
    const task = createMockTask({
      status: 'processing',
      lockedAt: now,
      lockedBy: 'worker-1:cuc_lock',
    });

    for (let i = 0; i < 20; i += 1) {
      const result = await outbox.releaseForRetry({
        task,
        reason: 'lock busy',
        retryDelayMs: 250,
        now,
      });
      expect(result._unsafeUnwrap()).toBe(true);
    }

    expect(delays).toHaveLength(20);
    for (const delay of delays) {
      expect(delay).toBeGreaterThanOrEqual(125);
      expect(delay).toBeLessThan(375);
    }
    // 20 draws from a 250ms-wide uniform range collapsing to a single value would mean
    // the jitter is gone (fixed delays are what synchronize same-key retry waves).
    expect(new Set(delays).size).toBeGreaterThan(1);
  });
});

describe('advisory lock scope fingerprints', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const compileDb = new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (innerDb) => new PostgresIntrospector(innerDb),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });

  const structuralFingerprint = (query: string): string =>
    query
      // pg_stat_statements ignores aliases and constant values. Normalize both while
      // retaining function names, target arity, and constant kinds (text/number/boolean).
      .replace(/\s+as\s+\w+/gi, '')
      .replace(/'[^']*'/g, "'<text>'")
      .replace(/\b\d+\b/g, '<number>')
      .replace(/\b(?:true|false)\b/gi, '<boolean>')
      .replace(/\s+/g, ' ')
      .trim();

  it('emits structurally distinct SQL per lock scope', () => {
    const computedWait = buildAdvisoryLockQuery(compileDb, 'k').sql;
    const computedTry = buildTryAdvisoryLockQuery(compileDb, 'k').sql;
    const merge = buildTryOutboxAdvisoryLockQuery(compileDb, 'k', 'merge').sql;
    const claimGlobal = buildTryOutboxAdvisoryLockQuery(compileDb, 'k', 'claim_global').sql;
    const claimBase = buildTryOutboxAdvisoryLockQuery(compileDb, 'k', 'claim_base').sql;

    expect(computedWait).toContain("'computed' as lock_scope");
    expect(merge).toContain("'outbox_merge' as lock_scope");
    expect(claimGlobal).toContain('as lock_scope_outbox_claim_global');
    expect(claimBase).toContain('as lock_scope_outbox_claim_base');

    // pg_stat_statements queryid jumbles function identity, constant types, and target
    // arity — not aliases or constant values — so normalize the latter before comparing.
    const variants = [computedWait, computedTry, merge, claimGlobal, claimBase];
    const fingerprints = variants.map(structuralFingerprint);
    expect(new Set(fingerprints).size).toBe(fingerprints.length);
  });
});

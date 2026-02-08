import type { ILogger } from '@teable/v2-core';
import type { Kysely } from 'kysely';
import { describe, it, expect, vi } from 'vitest';

import { ComputedUpdateOutbox } from './ComputedUpdateOutbox';
import type { ComputedUpdateOutboxItem } from './ComputedUpdateOutboxPayload';
import {
  defaultComputedUpdateOutboxConfig,
  type ComputedUpdateOutboxConfig,
} from './IComputedUpdateOutbox';

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
  baseId: 'bseTestBase123456',
  seedTableId: 'tblTestTable123456',
  seedRecordIds: ['rec123'],
  extraSeedRecords: [],
  steps: [{ level: 0, tableId: 'tblTestTable123456', fieldIds: ['fld123'] }],
  edges: [],
  estimatedComplexity: 1,
  changeType: 'update',
  planHash: 'abc123',
  dirtyStats: [{ tableId: 'tblTestTable123456', recordCount: 1 }],
  runId: 'run123',
  originRunIds: ['run123'],
  runTotalSteps: 1,
  runCompletedStepsBefore: 0,
  affectedTableIds: ['tblTestTable123456'],
  affectedFieldIds: ['fld123'],
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

describe('ComputedUpdateOutbox', () => {
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

        // Expected: 1000 * 2^0 = 1000, 1000 * 2^1 = 2000, 1000 * 2^2 = 4000, 1000 * 2^3 = 8000
        expect(backoffs[0]).toBeGreaterThanOrEqual(1000);
        expect(backoffs[0]).toBeLessThan(2000);
        expect(backoffs[1]).toBeGreaterThanOrEqual(2000);
        expect(backoffs[1]).toBeLessThan(4000);
        expect(backoffs[2]).toBeGreaterThanOrEqual(4000);
        expect(backoffs[2]).toBeLessThan(8000);
        expect(backoffs[3]).toBeGreaterThanOrEqual(8000);
        expect(backoffs[3]).toBeLessThan(16000);
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
    it('only claims tasks with pending status and next_run_at <= now', async () => {
      const now = new Date('2026-01-05T12:00:00Z');
      let statusValue: string | null = null;

      const mockDb = {
        transaction: () => ({
          execute: async <T>(fn: (trx: unknown) => Promise<T>) => fn(mockDb),
        }),
        selectFrom: vi.fn().mockReturnValue({
          selectAll: vi.fn().mockReturnValue({
            where: vi.fn().mockImplementation((col, _op, val) => {
              if (col === 'status') statusValue = val;
              return {
                where: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    forUpdate: vi.fn().mockReturnValue({
                      skipLocked: vi.fn().mockReturnValue({
                        execute: vi.fn().mockResolvedValue([]),
                      }),
                    }),
                  }),
                }),
              };
            }),
          }),
        }),
      } as unknown as MockDb;

      const logger = createLogger();
      const outbox = new ComputedUpdateOutbox(mockDb, defaultComputedUpdateOutboxConfig, logger);

      await outbox.claimBatch({ workerId: 'worker-1', limit: 10, now });

      expect(statusValue).toBe('pending');
    });

    it('marks claimed tasks as processing', async () => {
      let updateStatus: string | null = null;

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

      const mockDb = {
        transaction: () => ({
          execute: async <T>(fn: (trx: unknown) => Promise<T>) => fn(mockDb),
        }),
        selectFrom: vi.fn().mockReturnValue({
          selectAll: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    forUpdate: vi.fn().mockReturnValue({
                      skipLocked: vi.fn().mockReturnValue({
                        execute: vi.fn().mockResolvedValue([mockRow]),
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
          select: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              execute: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
        updateTable: vi.fn().mockReturnValue({
          set: vi.fn().mockImplementation((values) => {
            updateStatus = values.status;
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

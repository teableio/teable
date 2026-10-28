import { v2DataDbTokens } from '@teable/v2-adapter-db-postgres-shared';
import type { Kysely } from 'kysely';
import { describe, expect, it } from 'vitest';

import {
  ComputedQueueSummaryUnavailableError,
  readComputedQueueSummary,
} from './computedQueueSummary';
import { createHeadlessRuntime, type IHeadlessRuntime } from './index';

const BASE_ID = 'bse_summary_fixture';
const SEED_TABLE_ID = 'tbl_summary_fixture';

const openRuntime = (): Promise<IHeadlessRuntime> =>
  createHeadlessRuntime({ backend: { kind: 'pglite', dataDir: 'memory://' } });

const dataDb = (runtime: IHeadlessRuntime): Kysely<unknown> =>
  runtime.container.resolve<Kysely<unknown>>(v2DataDbTokens.db);

const closeWithPendingFixtures = async (runtime: IHeadlessRuntime): Promise<void> => {
  await expect(runtime.close()).rejects.toMatchObject({ code: 'runtime.close_incomplete' });
};

type TaskSeed = {
  id: string;
  status: 'pending' | 'processing';
  nextRunAt?: Date;
  lockedAt?: Date;
};

const insertTask = async (runtime: IHeadlessRuntime, seed: TaskSeed): Promise<void> => {
  await dataDb(runtime)
    .insertInto('computed_update_outbox' as never)
    .values({
      id: seed.id,
      base_id: BASE_ID,
      seed_table_id: SEED_TABLE_ID,
      change_type: 'record_update',
      status: seed.status,
      plan_hash: `plan_${seed.id}`,
      run_id: `run_${seed.id}`,
      ...(seed.nextRunAt === undefined ? {} : { next_run_at: seed.nextRunAt }),
      ...(seed.lockedAt === undefined ? {} : { locked_at: seed.lockedAt }),
      ...(seed.lockedAt === undefined ? {} : { locked_by: 'worker-fixture' }),
    } as never)
    .execute();
};

const insertPauseScope = async (
  runtime: IHeadlessRuntime,
  scope: {
    id: string;
    scopeType: 'base' | 'table' | 'space';
    scopeId?: string;
    resumeAt: Date | null;
  }
): Promise<void> => {
  await dataDb(runtime)
    .insertInto('computed_update_pause_scope' as never)
    .values({
      id: scope.id,
      scope_type: scope.scopeType,
      scope_id: scope.scopeId ?? BASE_ID,
      resume_at: scope.resumeAt,
    } as never)
    .execute();
};

const insertBase = async (
  runtime: IHeadlessRuntime,
  base: { id: string; spaceId: string }
): Promise<void> => {
  await dataDb(runtime)
    .insertInto('base' as never)
    .values({
      id: base.id,
      space_id: base.spaceId,
      name: 'summary fixture base',
      order: 1,
      created_by: 'usr_summary_fixture',
    } as never)
    .execute();
};

const insertDeadLetter = async (runtime: IHeadlessRuntime, id: string): Promise<void> => {
  const failedAt = new Date();
  await dataDb(runtime)
    .insertInto('computed_update_dead_letter' as never)
    .values({
      id,
      base_id: BASE_ID,
      seed_table_id: SEED_TABLE_ID,
      change_type: 'record_update',
      status: 'dead',
      next_run_at: failedAt,
      plan_hash: `plan_${id}`,
      run_id: `run_${id}`,
      failed_at: failedAt,
      created_at: failedAt,
      updated_at: failedAt,
    } as never)
    .execute();
};

describe('readComputedQueueSummary', () => {
  it('reports an idle queue with no next run', async () => {
    const runtime = await openRuntime();
    try {
      const summary = await readComputedQueueSummary(dataDb(runtime));

      expect(summary).toEqual({
        pending: 0,
        scheduled: 0,
        processing: 0,
        paused: 0,
        deadLetter: 0,
        nextRunAt: null,
      });
    } finally {
      await runtime.close();
    }
  });

  it('counts a future task as scheduled and exposes its next run', async () => {
    const runtime = await openRuntime();
    const now = new Date('2026-10-26T00:00:00.000Z');
    const future = new Date('2026-10-26T01:00:00.000Z');
    try {
      await insertTask(runtime, { id: 'task-future', status: 'pending', nextRunAt: future });

      const summary = await readComputedQueueSummary(dataDb(runtime), now);

      expect(summary.pending).toBe(1);
      expect(summary.scheduled).toBe(1);
      expect(summary.processing).toBe(0);
      expect(summary.paused).toBe(0);
      expect(summary.deadLetter).toBe(0);
      expect(summary.nextRunAt?.toISOString()).toBe(future.toISOString());
    } finally {
      await closeWithPendingFixtures(runtime);
    }
  });

  it('counts a claimed task as processing instead of scheduled', async () => {
    const runtime = await openRuntime();
    const now = new Date('2026-10-26T00:00:00.000Z');
    try {
      await insertTask(runtime, {
        id: 'task-processing',
        status: 'processing',
        lockedAt: now,
      });

      const summary = await readComputedQueueSummary(dataDb(runtime), now);

      expect(summary.pending).toBe(1);
      expect(summary.processing).toBe(1);
      expect(summary.scheduled).toBe(0);
      expect(summary.paused).toBe(0);
      expect(summary.nextRunAt).toBeNull();
    } finally {
      await closeWithPendingFixtures(runtime);
    }
  });

  it('counts a pause-scoped task as paused and ignores an expired pause', async () => {
    const runtime = await openRuntime();
    const now = new Date('2026-10-26T00:00:00.000Z');
    try {
      await insertTask(runtime, { id: 'task-paused', status: 'pending' });
      await insertTask(runtime, { id: 'task-resumed', status: 'pending' });
      await insertPauseScope(runtime, { id: 'pause-active', scopeType: 'base', resumeAt: null });
      await insertPauseScope(runtime, {
        id: 'pause-expired',
        scopeType: 'table',
        resumeAt: new Date('2026-10-25T00:00:00.000Z'),
      });

      const summary = await readComputedQueueSummary(dataDb(runtime), now);

      expect(summary.pending).toBe(2);
      expect(summary.paused).toBe(2);
      expect(summary.scheduled).toBe(0);
      expect(summary.processing).toBe(0);
      expect(summary.nextRunAt).toBeNull();
    } finally {
      await closeWithPendingFixtures(runtime);
    }
  });

  it('counts dead-letter rows separately from the live queue', async () => {
    const runtime = await openRuntime();
    try {
      await insertTask(runtime, { id: 'task-live', status: 'pending' });
      await insertDeadLetter(runtime, 'task-dead');

      const summary = await readComputedQueueSummary(dataDb(runtime));

      expect(summary.pending).toBe(1);
      expect(summary.deadLetter).toBe(1);
    } finally {
      await closeWithPendingFixtures(runtime);
    }
  });

  it('ignores an expired table pause that matches no other scope', async () => {
    const runtime = await openRuntime();
    const now = new Date('2026-10-26T00:00:00.000Z');
    try {
      await insertTask(runtime, {
        id: 'task-only-expired',
        status: 'pending',
        nextRunAt: new Date('2026-10-25T00:00:00.000Z'),
      });
      await insertPauseScope(runtime, {
        id: 'pause-expired-only',
        scopeType: 'table',
        scopeId: SEED_TABLE_ID,
        resumeAt: new Date('2026-10-25T00:00:00.000Z'),
      });

      const summary = await readComputedQueueSummary(dataDb(runtime), now);

      expect(summary.pending).toBe(1);
      expect(summary.paused).toBe(0);
      expect(summary.scheduled).toBe(0);
      expect(summary.nextRunAt).not.toBeNull();
    } finally {
      await closeWithPendingFixtures(runtime);
    }
  });

  it('counts an active space pause through the base space', async () => {
    const runtime = await openRuntime();
    const now = new Date('2026-10-26T00:00:00.000Z');
    try {
      await insertBase(runtime, { id: BASE_ID, spaceId: 'spc_summary_fixture' });
      await insertTask(runtime, { id: 'task-space-paused', status: 'pending' });
      await insertPauseScope(runtime, {
        id: 'pause-space',
        scopeType: 'space',
        scopeId: 'spc_summary_fixture',
        resumeAt: null,
      });

      const summary = await readComputedQueueSummary(dataDb(runtime), now);

      expect(summary.pending).toBe(1);
      expect(summary.paused).toBe(1);
      expect(summary.scheduled).toBe(0);
      expect(summary.nextRunAt).toBeNull();
    } finally {
      await closeWithPendingFixtures(runtime);
    }
  });
  it('reports typed unavailable when an explicit schema has no queue tables', async () => {
    const runtime = await openRuntime();
    try {
      await expect(
        readComputedQueueSummary(dataDb(runtime), new Date(), { schema: 'missing_summary_schema' })
      ).rejects.toBeInstanceOf(ComputedQueueSummaryUnavailableError);
    } finally {
      await runtime.close();
    }
  });
});

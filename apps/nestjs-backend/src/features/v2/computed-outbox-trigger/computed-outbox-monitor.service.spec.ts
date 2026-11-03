import { Writable } from 'node:stream';

import { Logger } from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { Logger as PinoNestLogger, PinoLogger } from 'nestjs-pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { KyselyPGlite } from '../../../../../../packages/v2/adapter-db-postgres-pglite/src/kyselyPgliteBrowser';
import {
  assembleComputedOutboxBasePendingCapacityPage,
  buildComputedOutboxBasePendingCapacityQuery,
} from '../../../global/computed-outbox-maintenance-query';
import { ComputedOutboxMonitorService } from './computed-outbox-monitor.service';

let capacityClient: KyselyPGlite['client'];

beforeAll(async () => {
  capacityClient = (await KyselyPGlite.create('memory://')).client;
  await capacityClient.exec(`create table "base" (id text primary key, space_id text)`);
  await capacityClient.exec(`create table space_data_db_binding (space_id text, mode text)`);
  await capacityClient.exec(
    `create table computed_update_pause_scope (
       id text primary key, scope_type text not null, scope_id text not null, resume_at timestamptz
     )`
  );
  await capacityClient.exec(
    `create table computed_update_outbox (
       id text primary key, base_id text not null, seed_table_id text not null,
       affected_table_ids text[], status text not null, next_run_at timestamptz not null default now()
     )`
  );
});

afterAll(async () => {
  await capacityClient.close();
});

const pageCapacity = async (
  counts: Record<string, number>,
  request: { threshold: number; limit: number; afterBaseId?: string }
) => {
  await capacityClient.exec(
    `truncate "base", space_data_db_binding, computed_update_outbox;
     insert into space_data_db_binding (space_id, mode) values ('spc', 'default')`
  );
  const entries = Object.entries(counts);
  await capacityClient.query(
    `insert into "base" (id, space_id)
     select id, 'spc' from unnest($1::text[]) as id`,
    [entries.map(([baseId]) => baseId)]
  );
  const pendingBaseIds = entries.flatMap(([baseId, pending]) =>
    Array.from({ length: pending }, () => baseId)
  );
  await capacityClient.query(
    `insert into computed_update_outbox
       (id, base_id, seed_table_id, affected_table_ids, status)
     select 'task-' || ordinal::text, base_id, 'tbl', array['tbl']::text[], 'pending'
     from unnest($1::text[]) with ordinality as pending(base_id, ordinal)`,
    [pendingBaseIds]
  );
  const query = buildComputedOutboxBasePendingCapacityQuery({ storage: 'default' }, request);
  let next = 0;
  const result = await capacityClient.query<{ baseId: string; pending: number | string }>(
    query.sql.replaceAll('?', () => `$${(next += 1)}`),
    [...query.bindings]
  );
  return assembleComputedOutboxBasePendingCapacityPage(
    result.rows.map((row) => ({ baseId: row.baseId, pending: Number(row.pending) })),
    request
  );
};

vi.mock('../../../global/data-db-client-manager.service', () => ({
  DataDbClientManager: class DataDbClientManager {},
}));

const bullConfig = {
  producerEnabled: true,
  consumerEnabled: true,
  concurrency: 8,
  publishTimeoutMs: 1000,
  monitorConcurrency: 2,
  monitorIntervalMs: 30_000,
  redriveMaxPublishPerTarget: 200,
  claimConcurrencyPerBase: 2,
  claimConcurrencyPerSeedTable: 2,
  basePendingCapacityThreshold: 1000,
  basePendingCapacityQueryLimit: 50,
} as const;

const targets = [
  {
    cacheKey: 'default',
    url: 'postgres://hidden',
    isMetaFallback: true,
    storage: 'default',
  },
  {
    cacheKey: 'byodb',
    url: 'postgres://hidden-byodb',
    isMetaFallback: false,
    storage: 'byodb',
  },
] as const;

const createMetrics = () => ({
  getRuntimeSnapshot: vi.fn().mockReturnValue({ lastConsumeOutcome: 'processed' }),
  updateQueueSnapshot: vi.fn(),
  updateBacklogSnapshot: vi.fn(),
  recordMonitor: vi.fn(),
});

const idleMaintenanceSnapshot = {
  duePending: 0,
  scheduledPending: 0,
  pausedPending: 0,
  activeProcessing: 0,
  staleProcessing: 0,
  dead: 0,
  anomalyGroups: 0,
  oldestDueAgeMs: 0,
  oldestPausedAgeMs: 0,
  activePauseScopeCount: 0,
};

describe('ComputedOutboxMonitorService', () => {
  it('keeps the durable snapshot fresh', async () => {
    vi.useFakeTimers();
    const dataDbClientManager = {
      listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue([]),
      inspectComputedOutboxMaintenanceTarget: vi.fn(),
    };
    const service = new ComputedOutboxMonitorService(
      bullConfig,
      dataDbClientManager as never,
      createMetrics() as never
    );

    try {
      service.onApplicationBootstrap();
      await vi.advanceTimersByTimeAsync(0);
      expect(dataDbClientManager.listComputedOutboxMaintenanceTargets).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(bullConfig.monitorIntervalMs);
      expect(dataDbClientManager.listComputedOutboxMaintenanceTargets).toHaveBeenCalledTimes(2);
    } finally {
      await service.onModuleDestroy();
      vi.useRealTimers();
    }
  });

  it('combines BullMQ and durable outbox state without executing a worker', async () => {
    const queue = {
      getJobCounts: vi.fn().mockResolvedValue({
        waiting: 3,
        active: 2,
        delayed: 1,
        failed: 0,
        paused: 0,
        prioritized: 1,
        completed: 12,
      }),
      getWorkersCount: vi.fn().mockResolvedValue(2),
      getCompleted: vi.fn().mockResolvedValue([
        {
          data: {
            schemaVersion: 1,
            wakeupId: 'wake-secret',
            taskId: 'cuo123',
            baseId: 'bse123',
            availableAt: '2026-07-13T12:00:00.000Z',
            emittedAt: '2026-07-13T12:00:00.000Z',
            cause: 'created',
            secret: 'must-not-leak',
          },
          processedOn: 1000,
          finishedOn: 1125,
          attemptsMade: 1,
          returnvalue: { secret: 'must-not-leak' },
        },
      ]),
      getFailed: vi.fn().mockResolvedValue([
        {
          id: 'job-failed',
          data: {
            schemaVersion: 1,
            wakeupId: 'wake-failed-secret',
            taskId: 'cuo-failed',
            baseId: 'bse123',
            availableAt: '2026-07-13T11:00:00.000Z',
            emittedAt: '2026-07-13T11:00:00.000Z',
            cause: 'retry',
            secret: 'must-not-leak',
          },
          finishedOn: 900,
          attemptsMade: 3,
          failedReason: 'worker crashed: secret-must-stay',
        },
      ]),
    };
    const dataDbClientManager = {
      listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue(targets),
      inspectComputedOutboxMaintenanceTarget: vi
        .fn()
        .mockResolvedValueOnce({
          duePending: 1,
          scheduledPending: 2,
          pausedPending: 0,
          activeProcessing: 1,
          staleProcessing: 0,
          dead: 0,
          anomalyGroups: 3,
          oldestDueAgeMs: 1000,
          oldestPausedAgeMs: 0,
          activePauseScopeCount: 0,
        })
        .mockResolvedValueOnce({
          duePending: 2,
          scheduledPending: 3,
          pausedPending: 0,
          activeProcessing: 0,
          staleProcessing: 0,
          dead: 0,
          anomalyGroups: 1,
          oldestDueAgeMs: 2000,
          oldestPausedAgeMs: 0,
          activePauseScopeCount: 0,
        }),
    };
    const metrics = createMetrics();
    const service = new ComputedOutboxMonitorService(
      bullConfig,
      dataDbClientManager as never,
      metrics as never,
      queue as never
    );

    const result = await service.getOverview();

    expect(result.status).toBe('healthy');
    expect(result.queue).toMatchObject({
      reachable: true,
      workers: 2,
      waiting: 3,
      active: 2,
      completed: 12,
      completedRetentionLimit: 2000,
      failedRetentionLimit: 5000,
      recentCompleted: [
        {
          taskId: 'cuo123',
          baseId: 'bse123',
          cause: 'created',
          finishedAt: '1970-01-01T00:00:01.125Z',
          processingDurationMs: 125,
          attemptsMade: 1,
        },
      ],
      recentFailed: [
        {
          taskId: 'cuo-failed',
          baseId: 'bse123',
          cause: 'retry',
          failedAt: '1970-01-01T00:00:00.900Z',
          failedReason: 'worker crashed: secret-must-stay',
          attemptsMade: 3,
        },
      ],
    });
    expect(queue.getCompleted).toHaveBeenCalledWith(0, 9);
    expect(queue.getFailed).toHaveBeenCalledWith(0, 9);
    expect(JSON.stringify(result.queue.recentCompleted)).not.toContain('wake-secret');
    expect(JSON.stringify(result.queue.recentFailed)).not.toContain('wake-failed-secret');
    expect(result.outbox).toMatchObject({
      targetCount: 2,
      unavailableTargetCount: 0,
      duePending: 3,
      scheduledPending: 5,
      pausedPending: 0,
      activeProcessing: 1,
      oldestDueAgeMs: 2000,
      oldestPausedAgeMs: 0,
      activePauseScopeCount: 0,
      anomalyGroups: 4,
    });
    expect(result.outbox.storage).toHaveLength(2);
    expect(metrics.updateQueueSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ reachable: true, workers: 2, waiting: 3, completed: 12 })
    );
    expect(metrics.updateBacklogSnapshot).toHaveBeenCalled();
    expect(metrics.recordMonitor).toHaveBeenCalledWith('success');

    // Cached path only when force is false.
    await expect(service.getOverview({ force: false })).resolves.toBe(result);
    expect(dataDbClientManager.listComputedOutboxMaintenanceTargets).toHaveBeenCalledTimes(1);

    // Default/admin force path re-samples.
    dataDbClientManager.inspectComputedOutboxMaintenanceTarget
      .mockResolvedValueOnce({
        duePending: 0,
        scheduledPending: 0,
        pausedPending: 0,
        activeProcessing: 0,
        staleProcessing: 0,
        dead: 0,
        oldestDueAgeMs: 0,
        oldestPausedAgeMs: 0,
        activePauseScopeCount: 0,
      })
      .mockResolvedValueOnce({
        duePending: 0,
        scheduledPending: 0,
        pausedPending: 0,
        activeProcessing: 0,
        staleProcessing: 0,
        dead: 0,
        oldestDueAgeMs: 0,
        oldestPausedAgeMs: 0,
        activePauseScopeCount: 0,
      });
    await service.getOverview({ force: true });
    expect(dataDbClientManager.listComputedOutboxMaintenanceTargets).toHaveBeenCalledTimes(2);
  });

  it('reports paused computed backlog separately from actionable work', async () => {
    const dataDbClientManager = {
      listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue(targets),
      inspectComputedOutboxMaintenanceTarget: vi
        .fn()
        .mockResolvedValueOnce({
          duePending: 0,
          scheduledPending: 0,
          pausedPending: 40,
          activeProcessing: 0,
          staleProcessing: 0,
          dead: 0,
          oldestDueAgeMs: 0,
          oldestPausedAgeMs: 3_600_000,
          activePauseScopeCount: 2,
        })
        .mockResolvedValueOnce({
          duePending: 0,
          scheduledPending: 0,
          pausedPending: 2,
          activeProcessing: 0,
          staleProcessing: 0,
          dead: 0,
          oldestDueAgeMs: 0,
          oldestPausedAgeMs: 60_000,
          activePauseScopeCount: 1,
        }),
    };
    const service = new ComputedOutboxMonitorService(
      bullConfig,
      dataDbClientManager as never,
      createMetrics() as never,
      {
        getJobCounts: vi.fn().mockResolvedValue({}),
        getWorkersCount: vi.fn().mockResolvedValue(1),
        getCompleted: vi.fn().mockResolvedValue([]),
        getFailed: vi.fn().mockResolvedValue([]),
        isPaused: vi.fn().mockResolvedValue(false),
      } as never
    );

    const result = await service.getOverview();

    expect(result.status).toBe('degraded');
    expect(result.reasons).toContain('paused_backlog');
    expect(result.reasons).not.toContain('overdue_pending');
    expect(result.pauses).toEqual({
      activeScopeCount: 3,
      pausedPending: 42,
      oldestPausedAgeMs: 3_600_000,
    });
    expect(result.outbox.duePending).toBe(0);
    expect(result.outbox.pausedPending).toBe(42);
  });

  it('reports a globally paused BullMQ queue as critical, independently of scoped pauses', async () => {
    const dataDbClientManager = {
      listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue([]),
      inspectComputedOutboxMaintenanceTarget: vi.fn(),
    };
    const service = new ComputedOutboxMonitorService(
      bullConfig,
      dataDbClientManager as never,
      createMetrics() as never,
      {
        getJobCounts: vi.fn().mockResolvedValue({ paused: 7 }),
        getWorkersCount: vi.fn().mockResolvedValue(1),
        getCompleted: vi.fn().mockResolvedValue([]),
        getFailed: vi.fn().mockResolvedValue([]),
        isPaused: vi.fn().mockResolvedValue(true),
      } as never
    );

    const result = await service.getOverview();

    expect(result.status).toBe('critical');
    expect(result.reasons).toContain('queue_paused');
    expect(result.queue.isPaused).toBe(true);
    expect(result.queue.paused).toBe(7);
    expect(result.pauses).toEqual({ activeScopeCount: 0, pausedPending: 0, oldestPausedAgeMs: 0 });
  });

  it('drains the retained failed-job history in bounded clean batches', async () => {
    const queue = {
      clean: vi
        .fn()
        .mockResolvedValueOnce(Array.from({ length: 1000 }, (_, index) => `job-${index}`))
        .mockResolvedValueOnce(['job-last']),
    };
    const service = new ComputedOutboxMonitorService(
      bullConfig,
      { listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue([]) } as never,
      createMetrics() as never,
      queue as never
    );

    await expect(service.cleanFailedJobs()).resolves.toEqual({ cleaned: 1001 });
    expect(queue.clean).toHaveBeenCalledTimes(2);
    expect(queue.clean).toHaveBeenCalledWith(0, 1000, 'failed');
  });

  it('lists per-state job summaries with state-specific timestamps', async () => {
    const wire = (taskId: string, cause = 'created') => ({
      schemaVersion: 1,
      wakeupId: `wake-${taskId}`,
      taskId,
      baseId: 'bse123',
      availableAt: '2026-08-07T05:00:00.000Z',
      emittedAt: '2026-08-07T05:00:00.000Z',
      cause,
    });
    const queue = {
      getJobs: vi.fn().mockImplementation(async (types: string[]) => {
        if (types[0] === 'delayed') {
          return [
            {
              data: wire('cuo-delayed', 'retry'),
              timestamp: 10_000,
              delay: 5_000,
              attemptsMade: 1,
            },
          ];
        }
        if (types[0] === 'active') {
          return [
            { data: wire('cuo-active'), timestamp: 20_000, processedOn: 20_500, attemptsMade: 1 },
            // Malformed payloads on flowing states are dropped, not surfaced.
            { data: { junk: true }, timestamp: 21_000, attemptsMade: 0 },
          ];
        }
        if (types[0] === 'completed') {
          return [
            {
              data: wire('cuo-noop'),
              timestamp: 40_000,
              processedOn: 40_100,
              finishedOn: 40_150,
              attemptsMade: 1,
              returnvalue: { status: 'noop' },
            },
          ];
        }
        if (types[0] === 'failed') {
          return [
            {
              id: 'job-broken',
              data: { junk: true },
              timestamp: 30_000,
              processedOn: 30_100,
              finishedOn: 30_400,
              attemptsMade: 2,
              failedReason: 'boom',
            },
          ];
        }
        return [];
      }),
    };
    const service = new ComputedOutboxMonitorService(
      bullConfig,
      { listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue([]) } as never,
      createMetrics() as never,
      queue as never
    );

    const result = await service.listQueueJobs(['delayed', 'active', 'completed', 'failed']);

    expect(queue.getJobs).toHaveBeenCalledWith(['delayed'], 0, 999);
    expect(result.error).toBeUndefined();
    expect(result.jobs).toEqual([
      {
        taskId: 'cuo-delayed',
        baseId: 'bse123',
        cause: 'retry',
        state: 'delayed',
        attemptsMade: 1,
        createdAt: new Date(10_000).toISOString(),
        availableAt: '2026-08-07T05:00:00.000Z',
        emittedAt: '2026-08-07T05:00:00.000Z',
        scheduledFor: new Date(15_000).toISOString(),
      },
      {
        taskId: 'cuo-active',
        baseId: 'bse123',
        cause: 'created',
        state: 'active',
        attemptsMade: 1,
        createdAt: new Date(20_000).toISOString(),
        availableAt: '2026-08-07T05:00:00.000Z',
        emittedAt: '2026-08-07T05:00:00.000Z',
        startedAt: new Date(20_500).toISOString(),
      },
      {
        taskId: 'cuo-noop',
        baseId: 'bse123',
        cause: 'created',
        state: 'completed',
        attemptsMade: 1,
        createdAt: new Date(40_000).toISOString(),
        availableAt: '2026-08-07T05:00:00.000Z',
        emittedAt: '2026-08-07T05:00:00.000Z',
        startedAt: new Date(40_100).toISOString(),
        finishedAt: new Date(40_150).toISOString(),
        processingDurationMs: 50,
        outcome: 'noop',
      },
      {
        taskId: 'job-broken',
        baseId: 'unknown',
        state: 'failed',
        attemptsMade: 2,
        createdAt: new Date(30_000).toISOString(),
        startedAt: new Date(30_100).toISOString(),
        finishedAt: new Date(30_400).toISOString(),
        processingDurationMs: 300,
        failedReason: 'boom',
      },
    ]);
    expect(result.scan).toEqual([
      { state: 'delayed', scanned: 1, truncated: false },
      { state: 'active', scanned: 1, truncated: false },
      { state: 'completed', scanned: 1, truncated: false },
      { state: 'failed', scanned: 1, truncated: false },
    ]);
  });

  it('sweeps orphaned failed references and reports the remaining truth', async () => {
    const pipeline = {
      exists: vi.fn(),
      // orphan-1 and orphan-2 have no job hash left; live-1 does.
      exec: vi.fn().mockResolvedValue([
        [null, 0],
        [null, 1],
        [null, 0],
      ]),
    };
    const redis = {
      zrange: vi.fn().mockResolvedValue(['orphan-1', 'live-1', 'orphan-2']),
      pipeline: vi.fn(() => pipeline),
      zrem: vi.fn().mockResolvedValue(2),
    };
    const queue = {
      client: Promise.resolve(redis),
      toKey: (type: string) => `bull:test:${type}`,
      getJobCounts: vi.fn().mockResolvedValue({
        waiting: 0,
        active: 0,
        delayed: 0,
        failed: 3,
        paused: 0,
        prioritized: 0,
        completed: 0,
      }),
      getWorkersCount: vi.fn().mockResolvedValue(1),
      getCompleted: vi.fn().mockResolvedValue([]),
      getFailed: vi.fn().mockResolvedValue([]),
      isPaused: vi.fn().mockResolvedValue(false),
    };
    const service = new ComputedOutboxMonitorService(
      bullConfig,
      { listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue([]) } as never,
      createMetrics() as never,
      queue as never
    );

    const snapshot = await service.refresh();

    // Only the bare references go; the real failed job keeps its history.
    expect(pipeline.exists).toHaveBeenCalledWith('bull:test:orphan-1');
    expect(redis.zrem).toHaveBeenCalledWith('bull:test:failed', 'orphan-1', 'orphan-2');
    expect(snapshot.queue.failed).toBe(1);
    expect(snapshot.reasons).toContain('failed_jobs');

    // The scan touches every retained failed id, so refreshes inside the
    // throttle window skip it.
    await service.refresh();
    expect(redis.zrange).toHaveBeenCalledTimes(1);
  });

  it('reports orphaned references (id retained, job data gone) instead of silently dropping them', async () => {
    const queue = {
      getJobs: vi.fn().mockImplementation(async (types: string[]) => {
        if (types[0] !== 'failed') return [];
        return [
          // Job.fromId yields undefined when the job hash no longer exists.
          undefined,
          undefined,
          // A hash without a numeric timestamp is equally unlistable.
          { id: 'job-no-ts', data: { junk: true }, timestamp: Number.NaN },
          {
            id: 'job-ok',
            data: { junk: true },
            timestamp: 30_000,
            finishedOn: 30_400,
            attemptsMade: 1,
            failedReason: 'boom',
          },
        ];
      }),
    };
    const service = new ComputedOutboxMonitorService(
      bullConfig,
      { listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue([]) } as never,
      createMetrics() as never,
      queue as never
    );

    const result = await service.listQueueJobs(['failed', 'active']);

    expect(result.jobs.map((job) => job.taskId)).toEqual(['job-ok']);
    // Orphans surface per state so the UI can explain the tile/list gap; states
    // without orphans omit the field entirely.
    expect(result.scan).toEqual([
      { state: 'failed', scanned: 1, truncated: false, missing: 3 },
      { state: 'active', scanned: 0, truncated: false },
    ]);
  });

  it('pages the failed scan up to the retention cap so the browser covers every retained job', async () => {
    const wire = (taskId: string) => ({
      schemaVersion: 1,
      wakeupId: `wake-${taskId}`,
      taskId,
      baseId: 'bse123',
      availableAt: '2026-08-07T05:00:00.000Z',
      emittedAt: '2026-08-07T05:00:00.000Z',
      cause: 'created',
    });
    const failedJob = (index: number) => ({
      data: wire(`cuo-${index}`),
      timestamp: 30_000 + index,
      attemptsMade: 3,
      failedReason: 'boom',
    });
    const queue = {
      getJobs: vi.fn().mockImplementation(async (_types: string[], start: number, end: number) => {
        // 1500 retained failed jobs: a full first page, then a partial one.
        const available = 1500;
        const count = Math.max(0, Math.min(end + 1, available) - start);
        return Array.from({ length: count }, (_, offset) => failedJob(start + offset));
      }),
    };
    const service = new ComputedOutboxMonitorService(
      bullConfig,
      { listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue([]) } as never,
      createMetrics() as never,
      queue as never
    );

    const result = await service.listQueueJobs(['failed']);

    expect(queue.getJobs.mock.calls).toEqual([
      [['failed'], 0, 999],
      [['failed'], 1000, 1999],
    ]);
    expect(result.jobs).toHaveLength(1500);
    expect(result.scan).toEqual([{ state: 'failed', scanned: 1500, truncated: false }]);
  });

  it('does not mark failed truncated when the scan fills the retention cap', async () => {
    const queue = {
      getJobs: vi.fn().mockImplementation(async (_types: string[], start: number, end: number) =>
        Array.from({ length: end - start + 1 }, (_, offset) => ({
          data: {
            schemaVersion: 1,
            wakeupId: `wake-${start + offset}`,
            taskId: `cuo-${start + offset}`,
            baseId: 'bse123',
            availableAt: '2026-08-07T05:00:00.000Z',
            emittedAt: '2026-08-07T05:00:00.000Z',
            cause: 'created',
          },
          timestamp: 30_000 + start + offset,
          attemptsMade: 3,
          failedReason: 'boom',
        }))
      ),
    };
    const service = new ComputedOutboxMonitorService(
      bullConfig,
      { listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue([]) } as never,
      createMetrics() as never,
      queue as never
    );

    const result = await service.listQueueJobs(['failed', 'delayed']);

    // failed pages to its 5000-job retention cap, which is also the maximum
    // Redis keeps, so the scan is complete. delayed stays page-sized.
    expect(result.scan).toEqual([
      { state: 'failed', scanned: 5000, truncated: false },
      { state: 'delayed', scanned: 1000, truncated: true },
    ]);
  });

  it('reports an unavailable queue instead of throwing from the job browser', async () => {
    const service = new ComputedOutboxMonitorService(
      bullConfig,
      { listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue([]) } as never,
      createMetrics() as never
    );

    await expect(service.listQueueJobs(['active'])).resolves.toEqual({
      jobs: [],
      scan: [],
      error: 'BullMQ queue is not configured',
    });
  });

  it('reports zero cleaned failed jobs when no queue is configured', async () => {
    const service = new ComputedOutboxMonitorService(
      bullConfig,
      { listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue([]) } as never,
      createMetrics() as never
    );

    await expect(service.cleanFailedJobs()).resolves.toEqual({ cleaned: 0 });
  });

  it('reports consumer_unavailable when the cluster has zero workers even on producer-only roles', async () => {
    const dataDbClientManager = {
      listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue([targets[0]]),
      inspectComputedOutboxMaintenanceTarget: vi.fn().mockResolvedValue({
        duePending: 0,
        scheduledPending: 0,
        pausedPending: 0,
        activeProcessing: 0,
        staleProcessing: 0,
        dead: 0,
        oldestDueAgeMs: 0,
        oldestPausedAgeMs: 0,
        activePauseScopeCount: 0,
      }),
    };
    const service = new ComputedOutboxMonitorService(
      { ...bullConfig, consumerEnabled: false },
      dataDbClientManager as never,
      createMetrics() as never,
      {
        getJobCounts: vi.fn().mockResolvedValue({}),
        getWorkersCount: vi.fn().mockResolvedValue(0),
        getCompleted: vi.fn().mockResolvedValue([]),
        getFailed: vi.fn().mockResolvedValue([]),
      } as never
    );

    const result = await service.getOverview();

    expect(result.status).toBe('critical');
    expect(result.reasons).toContain('consumer_unavailable');
  });

  it('reports a critical snapshot and clears queue gauges when BullMQ is unavailable', async () => {
    const dataDbClientManager = {
      listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue([targets[0]]),
      inspectComputedOutboxMaintenanceTarget: vi.fn().mockResolvedValue({
        duePending: 0,
        scheduledPending: 0,
        pausedPending: 0,
        activeProcessing: 0,
        staleProcessing: 0,
        dead: 0,
        oldestDueAgeMs: 0,
        oldestPausedAgeMs: 0,
        activePauseScopeCount: 0,
      }),
    };
    const metrics = createMetrics();
    const service = new ComputedOutboxMonitorService(
      bullConfig,
      dataDbClientManager as never,
      metrics as never,
      {
        getJobCounts: vi.fn().mockRejectedValue(new Error('redis password leaked')),
        getWorkersCount: vi.fn(),
        getCompleted: vi.fn(),
        getFailed: vi.fn(),
      } as never
    );

    const result = await service.getOverview();

    expect(result.status).toBe('critical');
    expect(result.reasons).toContain('queue_unavailable');
    expect(result.queue).toMatchObject({ configured: true, reachable: false, workers: null });
    expect(result.queue.error).not.toContain('password');
    expect(metrics.updateQueueSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ reachable: false, workers: 0, waiting: 0 })
    );
    expect(metrics.recordMonitor).toHaveBeenCalledWith('partial');
  });

  it('returns a degraded partial snapshot when one BYODB target is unavailable', async () => {
    const dataDbClientManager = {
      listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue(targets),
      inspectComputedOutboxMaintenanceTarget: vi
        .fn()
        .mockResolvedValueOnce({
          duePending: 0,
          scheduledPending: 0,
          pausedPending: 0,
          activeProcessing: 0,
          staleProcessing: 0,
          dead: 0,
          oldestDueAgeMs: 0,
          oldestPausedAgeMs: 0,
          activePauseScopeCount: 0,
        })
        .mockRejectedValueOnce(new Error('secret connection failure')),
    };
    const metrics = createMetrics();
    const service = new ComputedOutboxMonitorService(
      bullConfig,
      dataDbClientManager as never,
      metrics as never,
      {
        getJobCounts: vi.fn().mockResolvedValue({}),
        getWorkersCount: vi.fn().mockResolvedValue(1),
        getCompleted: vi.fn().mockResolvedValue([]),
        getFailed: vi.fn().mockResolvedValue([]),
      } as never
    );

    const result = await service.getOverview();

    expect(result.status).toBe('degraded');
    expect(result.reasons).toContain('target_unavailable');
    expect(result.outbox.unavailableTargetCount).toBe(1);
    expect(result.outbox.error).not.toContain('secret');
    expect(metrics.recordMonitor).toHaveBeenCalledWith('partial');
  });

  it('reports target discovery failure instead of returning a healthy empty outbox', async () => {
    const metrics = createMetrics();
    const service = new ComputedOutboxMonitorService(
      bullConfig,
      {
        listComputedOutboxMaintenanceTargets: vi.fn().mockRejectedValue(new Error('db secret')),
        inspectComputedOutboxMaintenanceTarget: vi.fn(),
      } as never,
      metrics as never,
      {
        getJobCounts: vi.fn().mockResolvedValue({}),
        getWorkersCount: vi.fn().mockResolvedValue(1),
        getCompleted: vi.fn().mockResolvedValue([]),
        getFailed: vi.fn().mockResolvedValue([]),
      } as never
    );

    const result = await service.getOverview();

    expect(result.status).toBe('degraded');
    expect(result.reasons).toContain('target_unavailable');
    expect(result.outbox.error).not.toContain('secret');
    expect(metrics.recordMonitor).toHaveBeenCalledWith('partial');
  });

  it('warns once for an overdue backlog or a lock convoy, then logs recovery', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const idle = {
      duePending: 0,
      scheduledPending: 0,
      pausedPending: 0,
      activeProcessing: 0,
      staleProcessing: 0,
      dead: 0,
      anomalyGroups: 0,
      oldestDueAgeMs: 0,
      oldestPausedAgeMs: 0,
      activePauseScopeCount: 0,
    };
    const inspectLock = vi.fn().mockResolvedValue({
      lockWaiters: 4,
      idleTransactions: 1,
      oldestIdleTransactionMs: 120_000,
      sampleQuery: 'select 1',
    });
    const dataDb = {
      listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue([targets[0]]),
      inspectComputedOutboxMaintenanceTarget: vi.fn().mockResolvedValue({
        ...idle,
        duePending: 1,
        oldestDueAgeMs: 1_000,
      }),
      inspectComputedOutboxLockConvoy: inspectLock,
    };
    const service = new ComputedOutboxMonitorService(
      bullConfig,
      dataDb as never,
      createMetrics() as never,
      {
        getJobCounts: vi.fn().mockResolvedValue({ failed: 0 }),
        getWorkersCount: vi.fn().mockResolvedValue(1),
        getCompleted: vi.fn().mockResolvedValue([]),
        getFailed: vi.fn().mockResolvedValue([]),
        isPaused: vi.fn().mockResolvedValue(false),
      } as never
    );

    try {
      const quiet = await service.getOverview({ force: true });
      expect(quiet.reasons).not.toContain('overdue_pending');
      expect(warn).not.toHaveBeenCalled();

      dataDb.inspectComputedOutboxMaintenanceTarget.mockResolvedValue({
        ...idle,
        duePending: 4,
        oldestDueAgeMs: 7 * 60_000,
      });
      inspectLock.mockResolvedValue({
        lockWaiters: 8,
        idleTransactions: 1,
        oldestIdleTransactionMs: 120_000,
        sampleQuery: 'WITH matched AS (SELECT __id)',
      });
      const congested = await service.getOverview({ force: true });
      expect(congested.reasons).toContain('overdue_pending');
      expect(warn).toHaveBeenCalledWith(
        'computed:outbox:backlog_aged',
        expect.objectContaining({ duePending: 4, oldestDueAgeMs: 7 * 60_000 })
      );
      expect(warn).toHaveBeenCalledWith(
        'computed:outbox:lock_convoy',
        expect.objectContaining({ cacheKey: 'default', lockWaiters: 8, idleTransactions: 1 })
      );

      warn.mockClear();
      await service.getOverview({ force: true });
      expect(warn).not.toHaveBeenCalled();

      dataDb.inspectComputedOutboxMaintenanceTarget.mockResolvedValue(idle);
      inspectLock.mockResolvedValue({
        lockWaiters: 0,
        idleTransactions: 0,
        oldestIdleTransactionMs: 0,
        sampleQuery: null,
      });
      await service.getOverview({ force: true });
      expect(log).toHaveBeenCalledWith(
        'computed:outbox:backlog_recovered',
        expect.objectContaining({ duePending: 0 })
      );
      expect(log).toHaveBeenCalledWith(
        'computed:outbox:lock_convoy_cleared',
        expect.objectContaining({ cacheKey: 'default', lockWaiters: 0 })
      );
    } finally {
      warn.mockRestore();
      log.mockRestore();
    }
  });

  it('pages per base so the (N+1)th over-threshold base appears on a later sample', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-02T00:00:00.000Z'));
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const capacity = vi
      .fn()
      .mockResolvedValueOnce({
        threshold: 1000,
        limit: 1,
        afterBaseId: undefined,
        scannedThroughBaseId: 'bse-a',
        scannedToEnd: false,
        bases: [{ baseId: 'bse-a', pending: 2000 }],
        nextBaseId: 'bse-a',
        truncated: true,
      })
      .mockResolvedValueOnce({
        threshold: 1000,
        limit: 1,
        afterBaseId: 'bse-a',
        scannedThroughBaseId: 'bse-b',
        scannedToEnd: false,
        bases: [{ baseId: 'bse-b', pending: 2000 }],
        nextBaseId: 'bse-b',
        truncated: true,
      })
      .mockResolvedValueOnce({
        threshold: 1000,
        limit: 1,
        afterBaseId: 'bse-b',
        scannedToEnd: true,
        bases: [],
        truncated: false,
      })
      .mockResolvedValueOnce({
        threshold: 1000,
        limit: 1,
        afterBaseId: undefined,
        scannedToEnd: true,
        bases: [],
        truncated: false,
      });
    const service = new ComputedOutboxMonitorService(
      bullConfig,
      {
        listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue([targets[0]]),
        inspectComputedOutboxMaintenanceTarget: vi.fn().mockResolvedValue(idleMaintenanceSnapshot),
        inspectComputedOutboxBasePendingCapacity: capacity,
      } as never,
      createMetrics() as never
    );

    try {
      await service.getOverview({ force: true });
      await service.getOverview({ force: true });

      const warned = warn.mock.calls
        .map(([payload]) => payload as Record<string, unknown>)
        .filter(({ event }) => event === 'computed:outbox:base_pending_capacity');
      expect(warned).toEqual([
        expect.objectContaining({
          storage: 'default',
          baseId: 'bse-a',
          pending: 2000,
          threshold: 1000,
        }),
        expect.objectContaining({
          storage: 'default',
          baseId: 'bse-b',
          pending: 2000,
          threshold: 1000,
        }),
      ]);
      expect(capacity.mock.calls[1][1]).toMatchObject({ afterBaseId: 'bse-a' });
      expect(
        log.mock.calls
          .map(([payload]) => payload as Record<string, unknown>)
          .filter(({ event }) => event === 'computed:outbox:base_pending_capacity_recovered')
      ).toHaveLength(0);

      await service.getOverview({ force: true });
      // The wrap page (after bse-b, scannedToEnd) proves only ids above bse-b;
      // nothing at or below bse-b is covered by this page.
      expect(
        log.mock.calls
          .map(([payload]) => payload as Record<string, unknown>)
          .filter(({ event }) => event === 'computed:outbox:base_pending_capacity_recovered')
      ).toHaveLength(0);

      await service.getOverview({ force: true });
      expect(capacity.mock.calls[3][1]).toMatchObject({ afterBaseId: undefined });
      const recovered = log.mock.calls
        .map(([payload]) => payload as Record<string, unknown>)
        .filter(({ event }) => event === 'computed:outbox:base_pending_capacity_recovered');
      expect(recovered).toEqual([
        expect.objectContaining({ baseId: 'bse-a', pending: null }),
        expect.objectContaining({ baseId: 'bse-b', pending: null }),
      ]);
    } finally {
      await service.onModuleDestroy();
      warn.mockRestore();
      log.mockRestore();
      vi.useRealTimers();
    }
  });

  it('never reports recovery from a truncated page that merely omitted a base', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const capacity = vi
      .fn()
      .mockResolvedValueOnce({
        threshold: 1000,
        limit: 1,
        afterBaseId: undefined,
        scannedThroughBaseId: 'bse-hot',
        scannedToEnd: false,
        bases: [{ baseId: 'bse-hot', pending: 1500 }],
        nextBaseId: 'bse-hot',
        truncated: true,
      })
      .mockResolvedValueOnce({
        threshold: 1000,
        limit: 1,
        afterBaseId: 'bse-hot',
        scannedThroughBaseId: 'bse-other',
        scannedToEnd: false,
        bases: [{ baseId: 'bse-other', pending: 9000 }],
        nextBaseId: 'bse-other',
        truncated: true,
      });
    const service = new ComputedOutboxMonitorService(
      bullConfig,
      {
        listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue([targets[0]]),
        inspectComputedOutboxMaintenanceTarget: vi.fn().mockResolvedValue(idleMaintenanceSnapshot),
        inspectComputedOutboxBasePendingCapacity: capacity,
      } as never,
      createMetrics() as never
    );

    try {
      await service.getOverview({ force: true });
      log.mockClear();
      warn.mockClear();

      await service.getOverview({ force: true });

      expect(log).not.toHaveBeenCalledWith(
        expect.objectContaining({ event: 'computed:outbox:base_pending_capacity_recovered' })
      );
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'computed:outbox:base_pending_capacity_truncated',
          storage: 'default',
          threshold: 1000,
          limit: 50,
          afterBaseId: 'bse-hot',
          nextBaseId: 'bse-other',
        })
      );
    } finally {
      await service.onModuleDestroy();
      warn.mockRestore();
      log.mockRestore();
    }
  });

  it('keeps cursor and suppression state but reports nothing when the probe fails', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const capacity = vi
      .fn()
      .mockResolvedValueOnce({
        threshold: 1000,
        limit: 10,
        afterBaseId: undefined,
        scannedThroughBaseId: 'bse-hot',
        scannedToEnd: true,
        bases: [{ baseId: 'bse-hot', pending: 1500 }],
        truncated: false,
      })
      .mockRejectedValueOnce(new Error('db unavailable'))
      .mockResolvedValueOnce({
        threshold: 1000,
        limit: 10,
        afterBaseId: undefined,
        scannedToEnd: true,
        bases: [],
        truncated: false,
      });
    const service = new ComputedOutboxMonitorService(
      bullConfig,
      {
        listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue([targets[0]]),
        inspectComputedOutboxMaintenanceTarget: vi.fn().mockResolvedValue(idleMaintenanceSnapshot),
        inspectComputedOutboxBasePendingCapacity: capacity,
      } as never,
      createMetrics() as never
    );

    try {
      await service.getOverview({ force: true });
      log.mockClear();
      warn.mockClear();

      await service.getOverview({ force: true });
      expect(log).not.toHaveBeenCalledWith(
        expect.objectContaining({ event: 'computed:outbox:base_pending_capacity_recovered' })
      );

      await service.getOverview({ force: true });
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'computed:outbox:base_pending_capacity_recovered',
          baseId: 'bse-hot',
          pending: null,
        })
      );
    } finally {
      await service.onModuleDestroy();
      warn.mockRestore();
      log.mockRestore();
    }
  });

  it('recovers only the base a later real SQL page proves is below threshold', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-02T00:00:00.000Z'));
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const counts = Object.fromEntries([
      ['bse-A', 2],
      ['bse-B', 2],
    ]);
    const capacity = vi.fn(
      async (
        _target: unknown,
        request: { threshold: number; limit: number; afterBaseId?: string }
      ) => pageCapacity(counts, request)
    );
    const service = new ComputedOutboxMonitorService(
      { ...bullConfig, basePendingCapacityThreshold: 2, basePendingCapacityQueryLimit: 1 },
      {
        listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue([targets[0]]),
        inspectComputedOutboxMaintenanceTarget: vi.fn().mockResolvedValue(idleMaintenanceSnapshot),
        inspectComputedOutboxBasePendingCapacity: capacity,
      } as never,
      createMetrics() as never
    );

    try {
      await service.getOverview({ force: true });
      await service.getOverview({ force: true });
      expect(capacity.mock.calls[0][1]).toMatchObject({ limit: 1, afterBaseId: undefined });
      expect(capacity.mock.calls[1][1]).toMatchObject({ limit: 1, afterBaseId: 'bse-A' });
      await expect(capacity.mock.results[0].value).resolves.toMatchObject({
        bases: [{ baseId: 'bse-A', pending: 2 }],
        scannedToEnd: false,
      });
      await expect(capacity.mock.results[1].value).resolves.toMatchObject({
        bases: [{ baseId: 'bse-B', pending: 2 }],
        scannedToEnd: true,
      });
      counts['bse-A'] = 1;
      log.mockClear();

      await service.getOverview({ force: true });
      expect(capacity.mock.calls[2][1]).toMatchObject({ afterBaseId: undefined });
      const recovered = log.mock.calls
        .map(([payload]) => payload as Record<string, unknown>)
        .filter(({ event }) => event === 'computed:outbox:base_pending_capacity_recovered');
      expect(recovered).toEqual([
        expect.objectContaining({ storage: 'default', baseId: 'bse-A', pending: null }),
      ]);
    } finally {
      await service.onModuleDestroy();
      warn.mockRestore();
      log.mockRestore();
      vi.useRealTimers();
    }
  });

  it('keeps an alerted first-page identity while warning the 51st base', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-02T00:00:00.000Z'));
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const counts: Record<string, number> = Object.fromEntries(
      Array.from({ length: 51 }, (_, index) => [`bse-${String(index + 1).padStart(2, '0')}`, 2])
    );
    const capacity = vi.fn(
      async (
        _target: unknown,
        request: { threshold: number; limit: number; afterBaseId?: string }
      ) => pageCapacity(counts, request)
    );
    const service = new ComputedOutboxMonitorService(
      { ...bullConfig, basePendingCapacityThreshold: 2, basePendingCapacityQueryLimit: 50 },
      {
        listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue([targets[0]]),
        inspectComputedOutboxMaintenanceTarget: vi.fn().mockResolvedValue(idleMaintenanceSnapshot),
        inspectComputedOutboxBasePendingCapacity: capacity,
      } as never,
      createMetrics() as never
    );

    try {
      await service.getOverview({ force: true });
      await service.getOverview({ force: true });
      expect(capacity.mock.calls[1][1]).toMatchObject({ afterBaseId: 'bse-50' });
      counts['bse-01'] = 1;
      log.mockClear();

      await service.getOverview({ force: true });
      expect(capacity.mock.calls[2][1]).toMatchObject({ afterBaseId: undefined });
      const recovered = log.mock.calls
        .map(([payload]) => payload as Record<string, unknown>)
        .filter(({ event }) => event === 'computed:outbox:base_pending_capacity_recovered');
      expect(recovered).toEqual([
        expect.objectContaining({ storage: 'default', baseId: 'bse-01', pending: null }),
      ]);
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'computed:outbox:base_pending_capacity',
          baseId: 'bse-51',
          pending: 2,
        })
      );
    } finally {
      await service.onModuleDestroy();
      warn.mockRestore();
      log.mockRestore();
      vi.useRealTimers();
    }
  });

  it('drops state for a target that leaves the inventory without a false recovery', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const capacity = vi.fn().mockResolvedValue({
      threshold: 1000,
      limit: 10,
      afterBaseId: undefined,
      scannedThroughBaseId: 'bse-hot',
      scannedToEnd: true,
      bases: [{ baseId: 'bse-hot', pending: 1500 }],
      truncated: false,
    });
    const listTargets = vi
      .fn()
      .mockResolvedValueOnce([targets[0]])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([targets[0]]);
    const service = new ComputedOutboxMonitorService(
      bullConfig,
      {
        listComputedOutboxMaintenanceTargets: listTargets,
        inspectComputedOutboxMaintenanceTarget: vi.fn().mockResolvedValue(idleMaintenanceSnapshot),
        inspectComputedOutboxBasePendingCapacity: capacity,
      } as never,
      createMetrics() as never
    );

    try {
      await service.getOverview({ force: true });
      log.mockClear();

      await service.getOverview({ force: true });
      expect(log).not.toHaveBeenCalledWith(
        'computed:outbox:base_pending_capacity_recovered',
        expect.anything()
      );

      capacity.mockResolvedValue({
        threshold: 1000,
        limit: 10,
        afterBaseId: undefined,
        scannedToEnd: true,
        bases: [],
        truncated: false,
      });
      log.mockClear();
      await service.getOverview({ force: true });
      // State was pruned with the target, so the reappearing target cannot claim recovery.
      expect(log).not.toHaveBeenCalledWith(
        expect.objectContaining({ event: 'computed:outbox:base_pending_capacity_recovered' })
      );
    } finally {
      await service.onModuleDestroy();
      warn.mockRestore();
      log.mockRestore();
    }
  });

  it('emits capacity alert and recovery JSON with queryable root fields through Pino', async () => {
    const lines: string[] = [];
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const previousLogger = Reflect.get(Logger, 'staticInstanceRef');
    if (!previousLogger || typeof previousLogger !== 'object' || !('log' in previousLogger)) {
      throw new Error('Nest Logger has no restorable static logger');
    }
    const previousLoggerService = previousLogger as LoggerService;
    const pinoLogger = new PinoLogger({
      pinoHttp: [{ level: 'info' }, destination],
    });
    Logger.overrideLogger(new PinoNestLogger(pinoLogger, {}));

    const capacity = vi
      .fn()
      .mockResolvedValueOnce({
        threshold: 2,
        limit: 1,
        afterBaseId: undefined,
        scannedThroughBaseId: 'bse-A',
        scannedToEnd: false,
        bases: [{ baseId: 'bse-A', pending: 3 }],
        nextBaseId: 'bse-A',
        truncated: true,
      })
      .mockResolvedValueOnce({
        threshold: 2,
        limit: 1,
        afterBaseId: 'bse-A',
        scannedThroughBaseId: 'bse-B',
        scannedToEnd: true,
        bases: [{ baseId: 'bse-B', pending: 2 }],
        truncated: false,
      })
      .mockResolvedValueOnce({
        threshold: 2,
        limit: 1,
        afterBaseId: undefined,
        scannedThroughBaseId: 'bse-B',
        scannedToEnd: true,
        bases: [{ baseId: 'bse-B', pending: 2 }],
        truncated: false,
      });
    const service = new ComputedOutboxMonitorService(
      {
        ...bullConfig,
        basePendingCapacityThreshold: 2,
        basePendingCapacityQueryLimit: 1,
      },
      {
        listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue([targets[0]]),
        inspectComputedOutboxMaintenanceTarget: vi.fn().mockResolvedValue(idleMaintenanceSnapshot),
        inspectComputedOutboxBasePendingCapacity: capacity,
      } as never,
      createMetrics() as never
    );

    try {
      await service.getOverview({ force: true });
      await service.getOverview({ force: true });
      await service.getOverview({ force: true });
      const records = lines
        .join('')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      const capacityRecords = records.filter(({ event }) =>
        String(event).startsWith('computed:outbox:base_pending_capacity')
      );
      expect(capacityRecords).toEqual([
        expect.objectContaining({
          level: 40,
          context: 'ComputedOutboxMonitorService',
          event: 'computed:outbox:base_pending_capacity',
          msg: 'computed:outbox:base_pending_capacity',
          storage: 'default',
          baseId: 'bse-A',
          pending: 3,
          threshold: 2,
        }),
        expect.objectContaining({
          level: 40,
          context: 'ComputedOutboxMonitorService',
          event: 'computed:outbox:base_pending_capacity_truncated',
          msg: 'computed:outbox:base_pending_capacity_truncated',
          storage: 'default',
          threshold: 2,
          limit: 1,
        }),
        expect.objectContaining({
          level: 40,
          context: 'ComputedOutboxMonitorService',
          event: 'computed:outbox:base_pending_capacity',
          msg: 'computed:outbox:base_pending_capacity',
          storage: 'default',
          baseId: 'bse-B',
          pending: 2,
          threshold: 2,
        }),
        expect.objectContaining({
          level: 30,
          context: 'ComputedOutboxMonitorService',
          event: 'computed:outbox:base_pending_capacity_recovered',
          msg: 'computed:outbox:base_pending_capacity_recovered',
          storage: 'default',
          baseId: 'bse-A',
          pending: null,
          threshold: 2,
        }),
      ]);
    } finally {
      await service.onModuleDestroy();
      Logger.overrideLogger(previousLoggerService);
    }
  });
});

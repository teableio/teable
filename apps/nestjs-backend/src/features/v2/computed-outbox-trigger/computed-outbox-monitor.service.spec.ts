import { describe, expect, it, vi } from 'vitest';

import { ComputedOutboxMonitorService } from './computed-outbox-monitor.service';

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
});

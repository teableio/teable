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
    };
    const dataDbClientManager = {
      listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue(targets),
      inspectComputedOutboxMaintenanceTarget: vi
        .fn()
        .mockResolvedValueOnce({
          duePending: 1,
          scheduledPending: 2,
          activeProcessing: 1,
          staleProcessing: 0,
          dead: 0,
          oldestDueAgeMs: 1000,
        })
        .mockResolvedValueOnce({
          duePending: 2,
          scheduledPending: 3,
          activeProcessing: 0,
          staleProcessing: 0,
          dead: 0,
          oldestDueAgeMs: 2000,
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
    });
    expect(queue.getCompleted).toHaveBeenCalledWith(0, 9);
    expect(JSON.stringify(result.queue.recentCompleted)).not.toContain('secret');
    expect(JSON.stringify(result.queue.recentCompleted)).not.toContain('wake-secret');
    expect(result.outbox).toMatchObject({
      targetCount: 2,
      unavailableTargetCount: 0,
      duePending: 3,
      scheduledPending: 5,
      activeProcessing: 1,
      oldestDueAgeMs: 2000,
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
        activeProcessing: 0,
        staleProcessing: 0,
        dead: 0,
        oldestDueAgeMs: 0,
      })
      .mockResolvedValueOnce({
        duePending: 0,
        scheduledPending: 0,
        activeProcessing: 0,
        staleProcessing: 0,
        dead: 0,
        oldestDueAgeMs: 0,
      });
    await service.getOverview({ force: true });
    expect(dataDbClientManager.listComputedOutboxMaintenanceTargets).toHaveBeenCalledTimes(2);
  });

  it('reports consumer_unavailable when the cluster has zero workers even on producer-only roles', async () => {
    const dataDbClientManager = {
      listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue([targets[0]]),
      inspectComputedOutboxMaintenanceTarget: vi.fn().mockResolvedValue({
        duePending: 0,
        scheduledPending: 0,
        activeProcessing: 0,
        staleProcessing: 0,
        dead: 0,
        oldestDueAgeMs: 0,
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
        activeProcessing: 0,
        staleProcessing: 0,
        dead: 0,
        oldestDueAgeMs: 0,
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
          activeProcessing: 0,
          staleProcessing: 0,
          dead: 0,
          oldestDueAgeMs: 0,
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
      } as never
    );

    const result = await service.getOverview();

    expect(result.status).toBe('degraded');
    expect(result.reasons).toContain('target_unavailable');
    expect(result.outbox.error).not.toContain('secret');
    expect(metrics.recordMonitor).toHaveBeenCalledWith('partial');
  });
});

import {
  v2RecordRepositoryPostgresTokens,
  type OutboxTaskClaimEligibility,
} from '@teable/v2-adapter-table-repository-postgres';
import { v2CoreTokens } from '@teable/v2-core';
import { describe, expect, it, vi } from 'vitest';

import { createRoleAwareWakeupPublisher } from './computed-outbox-wakeup-producer.module';
import { ComputedOutboxWakeupHandler } from './computed-outbox-wakeup.handler';

vi.mock('../v2-container.service', () => ({
  V2ContainerService: class V2ContainerService {},
}));

describe('ComputedOutboxWakeupHandler', () => {
  const wakeup = {
    schemaVersion: 1 as const,
    wakeupId: 'cuw1234567890123456',
    taskId: 'cuo1234567890123456',
    baseId: 'bse1234567890123456',
    availableAt: new Date().toISOString(),
    emittedAt: new Date().toISOString(),
    cause: 'created' as const,
  };

  const createMetrics = () => ({
    recordConsume: vi.fn(),
    recordDeliveryLag: vi.fn(),
    recordExecutionDuration: vi.fn(),
  });

  const createPublisher = (publish = vi.fn()) => ({
    publish,
    runAsConsumer: <T>(operation: () => Promise<T>) => operation(),
  });

  const activePermit = { assertActive: vi.fn() };

  const createActiveAdmission = () =>
    ({
      runWithPermit: async (
        _baseId: string,
        operation: (permit: typeof activePermit) => Promise<unknown>
      ) => ({
        admitted: true as const,
        value: await operation(activePermit),
      }),
    }) as never;

  const createClaimMissHandler = (
    eligibility: Exclude<OutboxTaskClaimEligibility, { status: 'terminal' }>
  ) => {
    const publish = vi.fn().mockResolvedValue({ status: 'accepted' });
    const handler = new ComputedOutboxWakeupHandler(
      {
        getContainerForBase: vi.fn().mockResolvedValue({
          resolve: (token: unknown) => {
            if (token === v2RecordRepositoryPostgresTokens.computedUpdateWorker) {
              return {
                runTaskById: vi.fn().mockResolvedValue({ isErr: () => false, value: false }),
              };
            }
            return {
              getTaskClaimEligibility: vi.fn().mockResolvedValue({
                isErr: () => false,
                value: eligibility,
              }),
            };
          },
        }),
      } as never,
      createMetrics() as never,
      createPublisher(publish) as never,
      createActiveAdmission()
    );
    return { handler, publish };
  };

  it('holds the cluster permit until processing and follow-up draining finish', async () => {
    const runTaskById = vi.fn().mockResolvedValue({ isErr: () => false, value: true });
    const runOnce = vi.fn().mockResolvedValue({ isErr: () => false, value: 0 });
    const runWithPermit = vi.fn(
      async (_baseId: string, operation: (permit: typeof activePermit) => Promise<unknown>) => ({
        admitted: true as const,
        value: await operation(activePermit),
      })
    );
    const handler = new ComputedOutboxWakeupHandler(
      {
        getContainerForBase: vi.fn().mockResolvedValue({
          resolve: () => ({ runTaskById, runOnce }),
        }),
      } as never,
      createMetrics() as never,
      createPublisher() as never,
      { runWithPermit } as never
    );

    await expect(handler.handle(wakeup)).resolves.toEqual({ status: 'processed' });

    expect(runWithPermit).toHaveBeenCalledWith(wakeup.baseId, expect.any(Function));
    expect(runTaskById).toHaveBeenCalledOnce();
    expect(runOnce).toHaveBeenCalledOnce();
  });

  it('stops follow-up draining when the cluster permit is lost', async () => {
    const leaseError = new Error('admission lease lost');
    const assertActive = vi
      .fn()
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw leaseError;
      });
    const runTaskById = vi.fn().mockResolvedValue({ isErr: () => false, value: true });
    const runOnce = vi.fn().mockResolvedValue({ isErr: () => false, value: 1 });
    const handler = new ComputedOutboxWakeupHandler(
      {
        getContainerForBase: vi.fn().mockResolvedValue({
          resolve: () => ({ runTaskById, runOnce }),
        }),
      } as never,
      createMetrics() as never,
      createPublisher() as never,
      {
        runWithPermit: async (
          _baseId: string,
          operation: (permit: typeof activePermit) => Promise<unknown>
        ) => ({ admitted: true as const, value: await operation({ assertActive }) }),
      } as never
    );

    await expect(handler.handle(wakeup)).rejects.toBe(leaseError);
    expect(runTaskById).toHaveBeenCalledOnce();
    expect(runOnce).toHaveBeenCalledOnce();
  });

  it('defers before resolving a base container when cluster admission is full', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-05T12:00:00Z'));
    try {
      const getContainerForBase = vi.fn().mockResolvedValue({
        resolve: () => ({
          runTaskById: vi.fn().mockResolvedValue({ isErr: () => false, value: true }),
          runOnce: vi.fn().mockResolvedValue({ isErr: () => false, value: 0 }),
        }),
      });
      const publish = vi.fn().mockResolvedValue({ status: 'accepted' });
      const runWithPermit = vi.fn().mockResolvedValue({ admitted: false });
      const handler = new ComputedOutboxWakeupHandler(
        { getContainerForBase } as never,
        createMetrics() as never,
        createPublisher(publish) as never,
        { runWithPermit } as never
      );

      await expect(handler.handle(wakeup)).resolves.toEqual({ status: 'deferred' });

      expect(runWithPermit).toHaveBeenCalledWith(wakeup.baseId, expect.any(Function));
      expect(getContainerForBase).not.toHaveBeenCalled();
      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({
          wakeupId: expect.stringMatching(`^cuwd-admit-${wakeup.taskId}-`),
          taskId: wakeup.taskId,
          baseId: wakeup.baseId,
          cause: 'replay',
          availableAt: expect.any(Date),
        })
      );
      const deferredAt = publish.mock.calls[0][0].availableAt.getTime();
      expect(deferredAt - Date.now()).toBeGreaterThanOrEqual(500);
      expect(deferredAt - Date.now()).toBeLessThanOrEqual(1500);
    } finally {
      vi.useRealTimers();
    }
  });

  it('throws when admission replay publication fails without resolving a base container', async () => {
    const getContainerForBase = vi.fn();
    const publishError = new Error('Redis unavailable');
    const handler = new ComputedOutboxWakeupHandler(
      { getContainerForBase } as never,
      createMetrics() as never,
      createPublisher(vi.fn().mockRejectedValue(publishError)) as never,
      { runWithPermit: vi.fn().mockResolvedValue({ admitted: false }) } as never
    );

    await expect(handler.handle(wakeup)).rejects.toBe(publishError);
    expect(getContainerForBase).not.toHaveBeenCalled();
  });

  it('records an error when Redis admission fails before container resolution', async () => {
    const getContainerForBase = vi.fn();
    const metrics = createMetrics();
    const admissionError = new Error('Redis unavailable');
    const handler = new ComputedOutboxWakeupHandler(
      { getContainerForBase } as never,
      metrics as never,
      createPublisher() as never,
      { runWithPermit: vi.fn().mockRejectedValue(admissionError) } as never
    );

    await expect(handler.handle(wakeup)).rejects.toBe(admissionError);
    expect(getContainerForBase).not.toHaveBeenCalled();
    expect(metrics.recordDeliveryLag).toHaveBeenCalledOnce();
    expect(metrics.recordConsume).toHaveBeenCalledWith('error');
    expect(metrics.recordExecutionDuration).toHaveBeenCalledWith(expect.any(Number), 'error');
  });

  it('routes by base and executes the task without processing takeover', async () => {
    const runTaskById = vi.fn().mockResolvedValue({
      isErr: () => false,
      value: true,
    });
    const runOnce = vi.fn().mockResolvedValue({
      isErr: () => false,
      value: 0,
    });
    const tracer = { startSpan: vi.fn() };
    const resolve = vi.fn((token) => {
      if (token === v2RecordRepositoryPostgresTokens.computedUpdateWorker) {
        return { runTaskById, runOnce };
      }
      if (token === v2CoreTokens.tracer) return tracer;
      return undefined;
    });
    const getContainerForBase = vi.fn().mockResolvedValue({ resolve });
    const metrics = createMetrics();
    const handler = new ComputedOutboxWakeupHandler(
      { getContainerForBase } as never,
      metrics as never,
      createPublisher() as never,
      createActiveAdmission()
    );

    const outcome = await handler.handle(wakeup);

    expect(outcome).toEqual({ status: 'processed' });
    expect(getContainerForBase).toHaveBeenCalledWith('bse1234567890123456');
    expect(runTaskById).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'cuo1234567890123456',
        allowProcessingTakeover: false,
        tracer,
      })
    );
    expect(runOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 50,
      })
    );
  });

  it('drains follow-up outbox tasks after a successful targeted process', async () => {
    const runTaskById = vi.fn().mockResolvedValue({
      isErr: () => false,
      value: true,
    });
    const runOnce = vi
      .fn()
      .mockResolvedValueOnce({ isErr: () => false, value: 3 })
      .mockResolvedValueOnce({ isErr: () => false, value: 1 })
      .mockResolvedValueOnce({ isErr: () => false, value: 0 });
    const handler = new ComputedOutboxWakeupHandler(
      {
        getContainerForBase: vi.fn().mockResolvedValue({
          resolve: () => ({ runTaskById, runOnce }),
        }),
      } as never,
      createMetrics() as never,
      createPublisher() as never,
      createActiveAdmission()
    );

    await expect(handler.handle(wakeup)).resolves.toEqual({ status: 'processed' });
    expect(runOnce).toHaveBeenCalledTimes(3);
  });

  it('acknowledges a terminal no-op when the durable task is gone', async () => {
    const publish = vi.fn();
    const metrics = createMetrics();
    const handler = new ComputedOutboxWakeupHandler(
      {
        getContainerForBase: vi.fn().mockResolvedValue({
          resolve: (token: unknown) => {
            if (token === v2RecordRepositoryPostgresTokens.computedUpdateWorker) {
              return {
                runTaskById: vi.fn().mockResolvedValue({ isErr: () => false, value: false }),
              };
            }
            if (token === v2RecordRepositoryPostgresTokens.computedUpdateOutbox) {
              return {
                getTaskClaimEligibility: vi
                  .fn()
                  .mockResolvedValue({ isErr: () => false, value: null }),
              };
            }
            return undefined;
          },
        }),
      } as never,
      metrics as never,
      createPublisher(publish) as never,
      createActiveAdmission()
    );

    await expect(handler.handle(wakeup)).resolves.toEqual({ status: 'noop' });

    expect(publish).not.toHaveBeenCalled();
    expect(metrics.recordConsume).toHaveBeenCalledWith('noop');
    expect(metrics.recordExecutionDuration).toHaveBeenCalledWith(expect.any(Number), 'noop');
  });

  it('re-publishes a delayed wake-up when the claim miss is non-terminal', async () => {
    const publish = vi.fn().mockResolvedValue({ status: 'accepted' });
    const metrics = createMetrics();
    const nextRunAt = new Date(Date.now() + 10_000);
    const handler = new ComputedOutboxWakeupHandler(
      {
        getContainerForBase: vi.fn().mockResolvedValue({
          resolve: (token: unknown) => {
            if (token === v2RecordRepositoryPostgresTokens.computedUpdateWorker) {
              return {
                runTaskById: vi.fn().mockResolvedValue({ isErr: () => false, value: false }),
              };
            }
            if (token === v2RecordRepositoryPostgresTokens.computedUpdateOutbox) {
              return {
                getTaskClaimEligibility: vi.fn().mockResolvedValue({
                  isErr: () => false,
                  value: {
                    status: 'deferred',
                    reason: 'not_due',
                    retryAt: nextRunAt,
                  },
                }),
              };
            }
            return undefined;
          },
        }),
      } as never,
      metrics as never,
      createPublisher(publish) as never,
      createActiveAdmission()
    );

    await expect(handler.handle(wakeup)).resolves.toEqual({ status: 'deferred' });

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: wakeup.taskId,
        baseId: wakeup.baseId,
        cause: 'replay',
        availableAt: expect.any(Date),
      })
    );
    const published = publish.mock.calls[0][0] as { availableAt: Date };
    expect(published.availableAt.getTime()).toBeGreaterThanOrEqual(nextRunAt.getTime());
    expect(metrics.recordConsume).toHaveBeenCalledWith('deferred');
  });

  it('preserves the outbox retry time after a computed lock miss', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-05T12:00:00Z'));
    try {
      const retryAt = new Date(Date.now() + 250);
      const { handler, publish } = createClaimMissHandler({
        status: 'deferred',
        reason: 'not_due',
        retryAt,
      });

      await expect(handler.handle(wakeup)).resolves.toEqual({ status: 'deferred' });

      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: wakeup.taskId,
          availableAt: retryAt,
        })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries concurrency misses quickly instead of waiting for the processing lease', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-05T12:00:00Z'));
    try {
      const leaseExpiresAt = new Date(Date.now() + 120_000);
      const { handler, publish } = createClaimMissHandler({
        status: 'deferred',
        reason: 'concurrency',
        retryAt: leaseExpiresAt,
      });

      await expect(handler.handle(wakeup)).resolves.toEqual({ status: 'deferred' });

      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: wakeup.taskId,
          availableAt: new Date(Date.now() + 100),
        })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries an eligible claim race quickly', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-05T12:00:00Z'));
    try {
      const { handler, publish } = createClaimMissHandler({ status: 'eligible' });

      await expect(handler.handle(wakeup)).resolves.toEqual({ status: 'deferred' });

      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: wakeup.taskId,
          availableAt: new Date(Date.now() + 100),
        })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps active lease retries at the lease expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-05T12:00:00Z'));
    try {
      const leaseExpiresAt = new Date(Date.now() + 120_000);
      const { handler, publish } = createClaimMissHandler({
        status: 'deferred',
        reason: 'active_lease',
        retryAt: leaseExpiresAt,
      });

      await expect(handler.handle(wakeup)).resolves.toEqual({ status: 'deferred' });

      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: wakeup.taskId,
          availableAt: leaseExpiresAt,
        })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('parks indefinitely paused tasks without publishing another wakeup', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-05T12:00:00Z'));
    try {
      const publish = vi.fn().mockResolvedValue({ status: 'accepted' });
      const metrics = createMetrics();
      const handler = new ComputedOutboxWakeupHandler(
        {
          getContainerForBase: vi.fn().mockResolvedValue({
            resolve: (token: unknown) => {
              if (token === v2RecordRepositoryPostgresTokens.computedUpdateWorker) {
                return {
                  runTaskById: vi.fn().mockResolvedValue({ isErr: () => false, value: false }),
                };
              }
              if (token === v2RecordRepositoryPostgresTokens.computedUpdateOutbox) {
                return {
                  getTaskClaimEligibility: vi.fn().mockResolvedValue({
                    isErr: () => false,
                    value: { status: 'deferred', reason: 'paused', retryAt: null },
                  }),
                };
              }
              return undefined;
            },
          }),
        } as never,
        metrics as never,
        createPublisher(publish) as never,
        createActiveAdmission()
      );

      await expect(handler.handle(wakeup)).resolves.toEqual({ status: 'parked' });

      expect(publish).not.toHaveBeenCalled();
      expect(metrics.recordConsume).toHaveBeenCalledWith('parked');
      expect(metrics.recordExecutionDuration).toHaveBeenCalledWith(expect.any(Number), 'parked');
    } finally {
      vi.useRealTimers();
    }
  });

  it('schedules a finite pause exactly once at its resume time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-05T12:00:00Z'));
    try {
      const publish = vi.fn().mockResolvedValue({ status: 'accepted' });
      const resumeAt = new Date('2026-01-05T12:05:00Z');
      const handler = new ComputedOutboxWakeupHandler(
        {
          getContainerForBase: vi.fn().mockResolvedValue({
            resolve: (token: unknown) => {
              if (token === v2RecordRepositoryPostgresTokens.computedUpdateWorker) {
                return {
                  runTaskById: vi.fn().mockResolvedValue({ isErr: () => false, value: false }),
                };
              }
              if (token === v2RecordRepositoryPostgresTokens.computedUpdateOutbox) {
                return {
                  getTaskClaimEligibility: vi.fn().mockResolvedValue({
                    isErr: () => false,
                    value: { status: 'deferred', reason: 'paused', retryAt: resumeAt },
                  }),
                };
              }
              return undefined;
            },
          }),
        } as never,
        createMetrics() as never,
        createPublisher(publish) as never,
        createActiveAdmission()
      );

      await expect(handler.handle(wakeup)).resolves.toEqual({ status: 'deferred' });

      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({
          wakeupId: `cuwd-${wakeup.taskId}-${resumeAt.getTime()}`,
          availableAt: resumeAt,
        })
      );
      const firstWakeup = publish.mock.calls[0][0];
      await handler.handle({ ...wakeup, wakeupId: firstWakeup.wakeupId });
      expect(publish.mock.calls[1][0].wakeupId).not.toBe(firstWakeup.wakeupId);
    } finally {
      vi.useRealTimers();
    }
  });

  it('runs worker-created wakeups inside the consumer publish capability', async () => {
    const runAsConsumer = vi.fn(async (operation) => operation());
    const runTaskById = vi.fn().mockResolvedValue({ isErr: () => false, value: true });
    const runOnce = vi.fn().mockResolvedValue({ isErr: () => false, value: 0 });
    const handler = new ComputedOutboxWakeupHandler(
      {
        getContainerForBase: vi.fn().mockResolvedValue({
          resolve: () => ({ runTaskById, runOnce }),
        }),
      } as never,
      createMetrics() as never,
      { publish: vi.fn(), runAsConsumer } as never,
      createActiveAdmission()
    );

    await expect(handler.handle(wakeup)).resolves.toEqual({ status: 'processed' });

    expect(runAsConsumer).toHaveBeenCalledWith(expect.any(Function));
    expect(runTaskById).toHaveBeenCalledOnce();
    expect(runOnce).toHaveBeenCalledOnce();
  });

  it('publishes deferred replay wakeups from a consumer-only role', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-05T12:00:00Z'));
    try {
      const brokerPublish = vi.fn().mockResolvedValue({ status: 'accepted' });
      const roleAwarePublisher = createRoleAwareWakeupPublisher(
        { publish: brokerPublish } as never,
        {
          producerEnabled: false,
          consumerEnabled: true,
        }
      );
      const handler = new ComputedOutboxWakeupHandler(
        {
          getContainerForBase: vi.fn().mockResolvedValue({
            resolve: (token: unknown) => {
              if (token === v2RecordRepositoryPostgresTokens.computedUpdateWorker) {
                return {
                  runTaskById: vi.fn().mockResolvedValue({ isErr: () => false, value: false }),
                };
              }
              return {
                getTaskClaimEligibility: vi.fn().mockResolvedValue({
                  isErr: () => false,
                  value: { status: 'deferred', reason: 'concurrency', retryAt: null },
                }),
              };
            },
          }),
        } as never,
        createMetrics() as never,
        roleAwarePublisher,
        createActiveAdmission()
      );

      await expect(handler.handle(wakeup)).resolves.toEqual({ status: 'deferred' });
      await expect(handler.handle({ ...wakeup, wakeupId: 'cuw-duplicate' })).resolves.toEqual({
        status: 'deferred',
      });

      expect(brokerPublish).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: wakeup.taskId, cause: 'replay' })
      );
      expect(brokerPublish.mock.calls[0][0].wakeupId).toBe(brokerPublish.mock.calls[1][0].wakeupId);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rethrows worker errors so BullMQ can retry claim or persistence failures', async () => {
    const workerError = { code: 'infrastructure', message: 'database unavailable' };
    const metrics = createMetrics();
    const handler = new ComputedOutboxWakeupHandler(
      {
        getContainerForBase: vi.fn().mockResolvedValue({
          resolve: () => ({
            runTaskById: vi.fn().mockResolvedValue({ isErr: () => true, error: workerError }),
          }),
        }),
      } as never,
      metrics as never,
      createPublisher() as never,
      createActiveAdmission()
    );

    await expect(handler.handle(wakeup)).rejects.toBe(workerError);

    expect(metrics.recordConsume).toHaveBeenCalledWith('error');
    expect(metrics.recordExecutionDuration).toHaveBeenCalledWith(expect.any(Number), 'error');
  });
});

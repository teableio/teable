import { v2RecordRepositoryPostgresTokens } from '@teable/v2-adapter-table-repository-postgres';
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

  it('routes by base and executes the task without processing takeover', async () => {
    const runTaskById = vi.fn().mockResolvedValue({
      isErr: () => false,
      value: true,
    });
    const resolve = vi.fn((token) => {
      if (token === v2RecordRepositoryPostgresTokens.computedUpdateWorker) {
        return { runTaskById };
      }
      return undefined;
    });
    const getContainerForBase = vi.fn().mockResolvedValue({ resolve });
    const metrics = createMetrics();
    const handler = new ComputedOutboxWakeupHandler(
      { getContainerForBase } as never,
      metrics as never,
      createPublisher() as never
    );

    const outcome = await handler.handle(wakeup);

    expect(outcome).toEqual({ status: 'processed' });
    expect(getContainerForBase).toHaveBeenCalledWith('bse1234567890123456');
    expect(runTaskById).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'cuo1234567890123456',
        allowProcessingTakeover: false,
      })
    );
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
      createPublisher(publish) as never
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
      createPublisher(publish) as never
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

  it('backs off indefinitely paused tasks instead of re-publishing every two seconds', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-05T12:00:00Z'));
    try {
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
        createMetrics() as never,
        createPublisher(publish) as never
      );

      await expect(handler.handle(wakeup)).resolves.toEqual({ status: 'deferred' });

      const published = publish.mock.calls[0][0] as { availableAt: Date };
      expect(published.availableAt).toEqual(new Date('2026-01-05T12:00:30Z'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('runs worker-created wakeups inside the consumer publish capability', async () => {
    const runAsConsumer = vi.fn(async (operation) => operation());
    const runTaskById = vi.fn().mockResolvedValue({ isErr: () => false, value: true });
    const handler = new ComputedOutboxWakeupHandler(
      {
        getContainerForBase: vi.fn().mockResolvedValue({
          resolve: () => ({ runTaskById }),
        }),
      } as never,
      createMetrics() as never,
      { publish: vi.fn(), runAsConsumer } as never
    );

    await expect(handler.handle(wakeup)).resolves.toEqual({ status: 'processed' });

    expect(runAsConsumer).toHaveBeenCalledWith(expect.any(Function));
    expect(runTaskById).toHaveBeenCalledOnce();
  });

  it('publishes deferred replay wakeups from a consumer-only role', async () => {
    const brokerPublish = vi.fn().mockResolvedValue({ status: 'accepted' });
    const roleAwarePublisher = createRoleAwareWakeupPublisher({ publish: brokerPublish } as never, {
      producerEnabled: false,
      consumerEnabled: true,
    });
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
      roleAwarePublisher
    );

    await expect(handler.handle(wakeup)).resolves.toEqual({ status: 'deferred' });

    expect(brokerPublish).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: wakeup.taskId, cause: 'replay' })
    );
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
      createPublisher() as never
    );

    await expect(handler.handle(wakeup)).rejects.toBe(workerError);

    expect(metrics.recordConsume).toHaveBeenCalledWith('error');
    expect(metrics.recordExecutionDuration).toHaveBeenCalledWith(expect.any(Number), 'error');
  });
});

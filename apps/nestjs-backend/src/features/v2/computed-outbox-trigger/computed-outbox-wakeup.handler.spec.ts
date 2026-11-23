import { Writable } from 'node:stream';

import {
  v2RecordRepositoryPostgresTokens,
  type OutboxTaskClaimEligibility,
} from '@teable/v2-adapter-table-repository-postgres';
import { v2CoreTokens } from '@teable/v2-core';
import { Logger as PinoNestLogger, PinoLogger } from 'nestjs-pino';
import { pinoHttp } from 'pino-http';
import { describe, expect, it, vi } from 'vitest';

import {
  DataDbBaseNotFoundError,
  DataDbBindingNotReadyError,
  DataDbClientManager,
} from '../../../global/data-db-client-manager.service';
import { DataDbRuntimeCacheService } from '../../../global/data-db-runtime-cache.service';

import { BullMqComputedOutboxWakeupProcessor } from './bullmq-computed-outbox-wakeup.processor';
import { createRoleAwareWakeupPublisher } from './computed-outbox-wakeup-producer.module';
import { ComputedOutboxWakeupHandler } from './computed-outbox-wakeup.handler';
import { computedOutboxWakeupWireSchema } from './computed-outbox-wakeup.wire';

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
    onDeliveryRecovered: vi.fn(() => vi.fn()),
  });

  const activePermit = { signal: new AbortController().signal, assertActive: vi.fn() };
  const getComputedWriter = () => ({ key: 'writer-a', hasWaiters: () => false });
  const runWithWriterPermit = async (
    _baseId: string,
    _key: string,
    operation: (permit: typeof activePermit) => Promise<unknown>
  ) => ({ admitted: true as const, value: await operation(activePermit) });

  const createActiveAdmission = () =>
    ({
      runWithWriterPermit,
      runWithPermit: async (
        _baseId: string,
        operation: (permit: typeof activePermit) => Promise<unknown>
      ) => ({
        admitted: true as const,
        value: await operation(activePermit),
      }),
    }) as never;

  const createClaimMissHandler = (
    eligibility: Exclude<OutboxTaskClaimEligibility, { status: 'terminal' }>,
    admission = createActiveAdmission()
  ) => {
    const publish = vi.fn().mockResolvedValue({ status: 'accepted' });
    const getNextPendingWakeup = vi.fn().mockResolvedValue({ isErr: () => false, value: null });
    const runTaskById = vi.fn(async ({ onEmptyClaim }: { onEmptyClaim: () => void }) => {
      onEmptyClaim();
      return { isErr: () => false, value: false };
    });
    const handler = new ComputedOutboxWakeupHandler(
      {
        getComputedWriter,
        getContainerForBase: vi.fn().mockResolvedValue({
          resolve: (token: unknown) => {
            if (token === v2RecordRepositoryPostgresTokens.computedUpdateWorker) {
              return { runTaskById };
            }
            return {
              getNextPendingWakeup,
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
      admission
    );
    return { handler, publish, runTaskById, getNextPendingWakeup };
  };

  const createRoutingProcessor = (findUnique: () => Promise<null>) => {
    const manager = new DataDbClientManager(
      { base: { findUnique } } as never,
      {} as never,
      {} as never,
      new DataDbRuntimeCacheService(),
      {} as never
    );
    const metrics = createMetrics();
    const publish = vi.fn().mockResolvedValue({ status: 'accepted' });
    const publisher = createPublisher(publish);
    const handler = new ComputedOutboxWakeupHandler(
      {
        getContainerForBase: async (baseId: string) => {
          await manager.getDataDatabaseForBase(baseId);
          throw new Error('Unexpected container resolution');
        },
      } as never,
      metrics as never,
      publisher as never,
      createActiveAdmission()
    );
    const processor = new BullMqComputedOutboxWakeupProcessor(handler, metrics as never, publisher);
    return { processor, publish };
  };

  it('completes an orphan wakeup without re-arming it when base routing finds no base', async () => {
    const { processor, publish } = createRoutingProcessor(vi.fn().mockResolvedValue(null));

    await expect(
      processor.process({ data: wakeup, attemptsMade: 2, opts: { attempts: 3 } } as never)
    ).resolves.toEqual({ status: 'noop' });
    expect(publish).not.toHaveBeenCalled();
  });

  it('keeps routing query failures retryable even when their text resembles a missing base', async () => {
    const queryError = new Error(`Base ${wakeup.baseId} not found`);
    const { processor, publish } = createRoutingProcessor(vi.fn().mockRejectedValue(queryError));

    await expect(
      processor.process({ data: wakeup, attemptsMade: 2, opts: { attempts: 3 } } as never)
    ).rejects.toBe(queryError);
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: wakeup.taskId, baseId: wakeup.baseId, cause: 'replay' })
    );
  });

  it('does not acknowledge a missing-base error for a different base', async () => {
    const routingError = new DataDbBaseNotFoundError('bse9876543210987654');
    const { processor, publish } = createRoutingProcessor(vi.fn().mockRejectedValue(routingError));

    await expect(
      processor.process({ data: wakeup, attemptsMade: 2, opts: { attempts: 3 } } as never)
    ).rejects.toBe(routingError);
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: wakeup.taskId, baseId: wakeup.baseId, cause: 'replay' })
    );
  });

  it('defers a locator under writer pressure and processes it when capacity returns', async () => {
    let waiting = true;
    const runTaskById = vi.fn().mockResolvedValue({ isErr: () => false, value: true });
    const publish = vi.fn().mockResolvedValue({ status: 'accepted' });
    const handler = new ComputedOutboxWakeupHandler(
      {
        getComputedWriter: () => ({ key: 'shared', hasWaiters: () => waiting }),
        getContainerForBase: async () => ({ resolve: () => ({ runTaskById }) }),
      } as never,
      createMetrics() as never,
      createPublisher(publish) as never,
      createActiveAdmission()
    );
    await expect(handler.handle(wakeup)).resolves.toEqual({ status: 'deferred' });
    expect(runTaskById).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: wakeup.taskId, baseId: wakeup.baseId, cause: 'replay' })
    );
    waiting = false;
    await expect(handler.handle(publish.mock.calls[0][0])).resolves.toEqual({
      status: 'processed',
    });
    expect(runTaskById).toHaveBeenCalledWith(expect.objectContaining({ yieldAfterTask: true }));
  });

  it('publishes a single successor after releasing the base and writer permits', async () => {
    const runTaskById = vi.fn().mockResolvedValue({ isErr: () => false, value: true });
    const runOnce = vi.fn().mockResolvedValue({ isErr: () => false, value: 0 });
    const successor = {
      ...wakeup,
      taskId: 'cuo-successor',
      wakeupId: 'cuwp-cuo-successor',
      relayDueBeforeMs: Date.parse(wakeup.availableAt),
    };
    const getNextPendingWakeup = vi.fn().mockResolvedValue({ isErr: () => false, value: successor });
    const events: string[] = [];
    const publish = vi.fn(async () => events.push('publish'));
    const runWithPermit = vi.fn(
      async (_baseId: string, operation: (permit: typeof activePermit) => Promise<unknown>) => {
        const value = await operation(activePermit);
        events.push('release base');
        return { admitted: true as const, value };
      }
    );
    const handler = new ComputedOutboxWakeupHandler(
      {
        getComputedWriter,
        getContainerForBase: vi.fn().mockResolvedValue({
          resolve: () => ({ runTaskById, runOnce, getNextPendingWakeup }),
        }),
      } as never,
      createMetrics() as never,
      createPublisher(publish) as never,
      {
        runWithPermit,
        runWithWriterPermit: async (...args: Parameters<typeof runWithWriterPermit>) => {
          const result = await runWithWriterPermit(...args);
          events.push('release writer');
          return result;
        },
      } as never
    );

    const contended = { ...wakeup, eligibleClaimMisses: 1 };
    await expect(handler.handle(contended)).resolves.toEqual({ status: 'processed' });

    expect(runWithPermit).toHaveBeenCalledWith(wakeup.baseId, expect.any(Function));
    expect(runTaskById).toHaveBeenCalledOnce();
    expect(runOnce).not.toHaveBeenCalled();
    expect(getNextPendingWakeup).toHaveBeenCalledExactlyOnceWith(
      wakeup.baseId,
      new Date(wakeup.availableAt)
    );
    expect(publish).toHaveBeenCalledExactlyOnceWith(successor);
    expect(events).toEqual(['release writer', 'release base', 'publish']);
  });

  it('skips the successor lookup on an ordinary successful delivery', async () => {
    const { handler, runTaskById, getNextPendingWakeup } = createClaimMissHandler({
      status: 'eligible',
    });
    runTaskById.mockResolvedValueOnce({ isErr: () => false, value: true });
    await expect(handler.handle(wakeup)).resolves.toEqual({ status: 'processed' });
    expect(getNextPendingWakeup).not.toHaveBeenCalled();
  });

  it.each(['lookup', 'publish'])(
    'preserves completed work on a successor %s failure',
    async (failure) => {
      const { handler, publish, runTaskById, getNextPendingWakeup } = createClaimMissHandler({
        status: 'eligible',
      });
      runTaskById.mockResolvedValueOnce({ isErr: () => false, value: true });
      if (failure === 'lookup') {
        getNextPendingWakeup.mockResolvedValueOnce({
          isErr: () => true,
          error: new Error('lookup failed'),
        });
      } else {
        getNextPendingWakeup.mockResolvedValueOnce({
          isErr: () => false,
          value: { ...wakeup, taskId: 'cuo-sibling' },
        });
        publish.mockRejectedValueOnce(new Error('publish failed'));
      }
      const lines: string[] = [];
      const destination = new Writable({
        write(chunk, _encoding, callback) {
          lines.push(chunk.toString());
          callback();
        },
      });
      // Use this case's destination without initializing PinoLogger's shared root.
      const pinoLogger = Object.create(PinoLogger.prototype, {
        logger: { value: pinoHttp({ level: 'warn' }, destination).logger },
      }) as PinoLogger;
      const sink = vi
        .spyOn(handler['logger'], 'localInstance', 'get')
        .mockReturnValue(new PinoNestLogger(pinoLogger, {}));
      try {
        await expect(handler.handle({ ...wakeup, eligibleClaimMisses: 1 })).resolves.toEqual({
          status: 'processed',
        });
      } finally {
        sink.mockRestore();
      }
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0])).toMatchObject({
        level: 40,
        context: ComputedOutboxWakeupHandler.name,
        msg: 'computed:outbox:successor_wakeup_failed',
        baseId: wakeup.baseId,
        error: `${failure} failed`,
      });
      expect(runTaskById).toHaveBeenCalledOnce();
      expect(publish).toHaveBeenCalledTimes(failure === 'publish' ? 1 : 0);
    }
  );

  it('rejects a settlement observed after the cluster permit was lost', async () => {
    const leaseError = new Error('admission lease lost');
    const assertActive = vi
      .fn()
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw leaseError;
      });
    const runTaskById = vi.fn().mockResolvedValue({ isErr: () => false, value: true });
    const runOnce = vi.fn().mockResolvedValue({ isErr: () => false, value: 1 });
    const handler = new ComputedOutboxWakeupHandler(
      {
        getComputedWriter,
        getContainerForBase: vi.fn().mockResolvedValue({
          resolve: () => ({ runTaskById, runOnce }),
        }),
      } as never,
      createMetrics() as never,
      createPublisher() as never,
      {
        runWithWriterPermit,
        runWithPermit: async (
          _baseId: string,
          operation: (permit: typeof activePermit) => Promise<unknown>
        ) => ({
          admitted: true as const,
          value: await operation({ signal: activePermit.signal, assertActive }),
        }),
      } as never
    );

    await expect(handler.handle(wakeup)).rejects.toBe(leaseError);
    expect(runTaskById).toHaveBeenCalledOnce();
    expect(runOnce).not.toHaveBeenCalled();
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
      { getContainerForBase, getComputedWriter } as never,
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
    expect(runOnce).not.toHaveBeenCalled();
  });

  it('acknowledges a terminal no-op when the durable task is gone', async () => {
    const publish = vi.fn();
    const metrics = createMetrics();
    const handler = new ComputedOutboxWakeupHandler(
      {
        getComputedWriter,
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
        getComputedWriter,
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
      const relayDueBeforeMs = Date.now();
      await handler.handle({ ...wakeup, wakeupId: `cuwp-${wakeup.taskId}`, relayDueBeforeMs });
      expect(publish.mock.calls[1][0]).toMatchObject({
        availableAt: new Date(Date.now() + 100),
        relayDueBeforeMs,
      });
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

  it('bounds consecutive empty eligible replays across workers and resets after preparation', async () => {
    vi.useFakeTimers();
    try {
      const asDelivery = (event: unknown) =>
        computedOutboxWakeupWireSchema.parse(JSON.parse(JSON.stringify(event)));
      let delivery = computedOutboxWakeupWireSchema.parse(wakeup);
      for (const delayMs of [100, 200, 400, 800, 1600, 1600]) {
        const { handler, publish } = createClaimMissHandler({ status: 'eligible' });
        await expect(handler.handle(delivery)).resolves.toEqual({ status: 'deferred' });
        const replay = publish.mock.calls[0][0];
        expect(replay.availableAt.getTime() - Date.now()).toBe(delayMs);
        delivery = asDelivery(replay);
        vi.setSystemTime(replay.availableAt);
        if (delayMs === 400) {
          const capacity = createClaimMissHandler(
            { status: 'eligible' },
            { runWithPermit: vi.fn().mockResolvedValue({ admitted: false }) } as never
          );
          await expect(capacity.handler.handle(delivery)).resolves.toEqual({ status: 'deferred' });
          expect(capacity.runTaskById).not.toHaveBeenCalled();
          const deferred = capacity.publish.mock.calls[0][0];
          expect(deferred.availableAt.getTime() - Date.now()).toBeGreaterThanOrEqual(500);
          expect(deferred.availableAt.getTime() - Date.now()).toBeLessThanOrEqual(1500);
          delivery = asDelivery(deferred);
          expect(delivery.eligibleClaimMisses).toBe(3);
          const sibling = createClaimMissHandler({ status: 'eligible' });
          sibling.runTaskById.mockResolvedValueOnce({ isErr: () => false, value: false });
          await sibling.handler.handle({ ...delivery, wakeupId: wakeup.wakeupId });
          const nextPage = sibling.publish.mock.calls[0][0];
          expect(nextPage.wakeupId).not.toBe(deferred.wakeupId);
          expect(nextPage.availableAt.getTime() - Date.now()).toBe(100);
          expect(nextPage.eligibleClaimMisses).toBeUndefined();
          vi.setSystemTime(deferred.availableAt);
        }
      }
      expect(delivery.eligibleClaimMisses).toBe(5);

      const { handler, publish, runTaskById, getNextPendingWakeup } = createClaimMissHandler({
        status: 'eligible',
      });
      runTaskById.mockResolvedValueOnce({ isErr: () => false, value: false });
      await expect(handler.handle(delivery)).resolves.toEqual({ status: 'deferred' });
      const prepared = publish.mock.calls[0][0];
      expect(prepared.availableAt.getTime() - Date.now()).toBe(100);
      expect(prepared.eligibleClaimMisses).toBeUndefined();
      expect(prepared.relayDueBeforeMs).toBe(Date.parse(delivery.availableAt));

      vi.setSystemTime(prepared.availableAt);
      await handler.handle(asDelivery(prepared));
      const retry = publish.mock.calls[1][0];
      expect(retry.availableAt.getTime() - Date.now()).toBe(100);
      expect(retry.eligibleClaimMisses).toBe(1);
      expect(getNextPendingWakeup).not.toHaveBeenCalled();
      runTaskById.mockResolvedValueOnce({ isErr: () => false, value: true });
      await expect(handler.handle(asDelivery(retry))).resolves.toEqual({ status: 'processed' });
      expect(getNextPendingWakeup).toHaveBeenCalledExactlyOnceWith(
        wakeup.baseId,
        new Date(delivery.availableAt)
      );
      expect(publish).toHaveBeenCalledTimes(2);
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
          getComputedWriter,
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
          getComputedWriter,
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
        getComputedWriter,
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
    expect(runOnce).not.toHaveBeenCalled();
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
          getComputedWriter,
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
        getComputedWriter,
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

  it('absorbs read-only ledger failures into a per-base 1-minute sentinel', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-05T12:00:00Z'));
    try {
      const workerError = {
        code: 'infrastructure',
        message:
          'Outbox transaction failed: error: cannot execute SELECT FOR UPDATE in a read-only transaction',
      };
      const publish = vi.fn().mockResolvedValue({ status: 'accepted' });
      const metrics = createMetrics();
      const handler = new ComputedOutboxWakeupHandler(
        {
          getComputedWriter,
          getContainerForBase: vi.fn().mockResolvedValue({
            resolve: () => ({
              runTaskById: vi.fn().mockResolvedValue({ isErr: () => true, error: workerError }),
            }),
          }),
        } as never,
        metrics as never,
        createPublisher(publish) as never,
        createActiveAdmission()
      );

      await expect(handler.handle(wakeup)).resolves.toEqual({ status: 'deferred' });

      expect(publish).toHaveBeenCalledOnce();
      const published = publish.mock.calls[0][0] as { availableAt: Date; wakeupId: string };
      expect(published.availableAt).toEqual(new Date('2026-01-05T12:01:00Z'));
      expect(published.wakeupId).toBe(`cuwd-ro-${wakeup.baseId}-s0`);
      expect(metrics.recordConsume).toHaveBeenCalledWith('deferred');
      expect(metrics.recordConsume).not.toHaveBeenCalledWith('error');
    } finally {
      vi.useRealTimers();
    }
  });

  it('schedules one stepped sentinel per base from the health breaker', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-05T12:00:00Z'));
    try {
      const publish = vi.fn().mockResolvedValue({ status: 'accepted' });
      const runWithPermit = vi.fn();
      const getContainerForBase = vi.fn();
      const changedAt = new Date('2026-01-05T12:00:00Z');
      const dataDbHealth = {
        getHealthSnapshotForBase: vi.fn().mockResolvedValue({
          state: 'read_only',
          changedAt,
        }),
        probeAndRefreshForBase: vi.fn(),
        reportWriteFailure: vi.fn(),
      };
      const metrics = createMetrics();
      const handler = new ComputedOutboxWakeupHandler(
        { getContainerForBase } as never,
        metrics as never,
        createPublisher(publish) as never,
        { runWithPermit } as never,
        dataDbHealth as never
      );

      await expect(handler.handle(wakeup)).resolves.toEqual({ status: 'deferred' });

      expect(dataDbHealth.getHealthSnapshotForBase).toHaveBeenCalledWith(wakeup.baseId);
      expect(dataDbHealth.probeAndRefreshForBase).not.toHaveBeenCalled();
      expect(runWithPermit).not.toHaveBeenCalled();
      expect(getContainerForBase).not.toHaveBeenCalled();
      expect(publish).toHaveBeenCalledOnce();
      expect(publish.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          wakeupId: `cuwd-ro-${wakeup.baseId}-s0`,
          availableAt: new Date('2026-01-05T12:01:00Z'),
          cause: 'replay',
        })
      );
      expect(dataDbHealth.reportWriteFailure).not.toHaveBeenCalled();
      expect(metrics.recordConsume).toHaveBeenCalledWith('deferred');
    } finally {
      vi.useRealTimers();
    }
  });

  it('converges a second task on the same base sentinel when the job already exists', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-05T12:00:00Z'));
    try {
      const publish = vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error('Job already exists'), { name: 'JobIdAlreadyExistsError' })
        );
      const dataDbHealth = {
        getHealthSnapshotForBase: vi.fn().mockResolvedValue({
          state: 'read_only',
          changedAt: new Date('2026-01-05T12:00:00Z'),
        }),
        probeAndRefreshForBase: vi.fn(),
        reportWriteFailure: vi.fn(),
      };
      const handler = new ComputedOutboxWakeupHandler(
        { getContainerForBase: vi.fn() } as never,
        createMetrics() as never,
        createPublisher(publish) as never,
        { runWithPermit: vi.fn() } as never,
        dataDbHealth as never
      );

      await expect(handler.handle({ ...wakeup, taskId: 'cuoother0000000001' })).resolves.toEqual({
        status: 'deferred',
      });
      expect(publish).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('live-probes a read_only sentinel and steps to 5 minutes while still read-only', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-05T12:01:00Z'));
    try {
      const publish = vi.fn().mockResolvedValue({ status: 'accepted' });
      const probeAndRefreshForBase = vi.fn().mockResolvedValue('read_only');
      const dataDbHealth = {
        getHealthSnapshotForBase: vi.fn().mockResolvedValue({
          state: 'read_only',
          changedAt: new Date('2026-01-05T12:00:00Z'),
        }),
        probeAndRefreshForBase,
        reportWriteFailure: vi.fn(),
      };
      const handler = new ComputedOutboxWakeupHandler(
        { getContainerForBase: vi.fn() } as never,
        createMetrics() as never,
        createPublisher(publish) as never,
        { runWithPermit: vi.fn() } as never,
        dataDbHealth as never
      );

      await expect(
        handler.handle({
          ...wakeup,
          wakeupId: `cuwd-ro-${wakeup.baseId}-s0`,
          cause: 'replay',
        })
      ).resolves.toEqual({ status: 'deferred' });

      expect(probeAndRefreshForBase).toHaveBeenCalledWith(wakeup.baseId);
      expect(publish.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          wakeupId: `cuwd-ro-${wakeup.baseId}-s1`,
          availableAt: new Date('2026-01-05T12:05:00Z'),
        })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('resumes processing when a read_only sentinel probe finds the database writable', async () => {
    const runTaskById = vi.fn().mockResolvedValue({ isErr: () => false, value: true });
    const runOnce = vi.fn().mockResolvedValue({ isErr: () => false, value: 0 });
    const publish = vi.fn();
    const dataDbHealth = {
      getHealthSnapshotForBase: vi.fn().mockResolvedValue({
        state: 'read_only',
        changedAt: new Date('2026-01-05T12:00:00Z'),
      }),
      probeAndRefreshForBase: vi.fn().mockResolvedValue('healthy'),
      reportWriteFailure: vi.fn(),
    };
    const handler = new ComputedOutboxWakeupHandler(
      {
        getComputedWriter,
        getContainerForBase: vi.fn().mockResolvedValue({
          resolve: () => ({ runTaskById, runOnce }),
        }),
      } as never,
      createMetrics() as never,
      createPublisher(publish) as never,
      createActiveAdmission(),
      dataDbHealth as never
    );

    await expect(
      handler.handle({
        ...wakeup,
        wakeupId: `cuwd-ro-${wakeup.baseId}-s0`,
        cause: 'replay',
      })
    ).resolves.toEqual({ status: 'processed' });

    expect(runTaskById).toHaveBeenCalledOnce();
    expect(publish).not.toHaveBeenCalled();
  });

  it('absorbs data-db binding-not-ready into a per-base 1-minute sentinel', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-05T12:00:00Z'));
    try {
      const bindingError = new DataDbBindingNotReadyError('spcDisabled');
      const publish = vi.fn().mockResolvedValue({ status: 'accepted' });
      const metrics = createMetrics();
      const handler = new ComputedOutboxWakeupHandler(
        { getContainerForBase: vi.fn().mockRejectedValue(bindingError) } as never,
        metrics as never,
        createPublisher(publish) as never,
        createActiveAdmission()
      );

      await expect(handler.handle(wakeup)).resolves.toEqual({ status: 'deferred' });

      expect(publish).toHaveBeenCalledOnce();
      const published = publish.mock.calls[0][0] as { availableAt: Date; wakeupId: string };
      expect(published.availableAt).toEqual(new Date('2026-01-05T12:01:00Z'));
      expect(published.wakeupId).toBe(`cuwd-ro-${wakeup.baseId}-s0`);
      expect(metrics.recordConsume).toHaveBeenCalledWith('deferred');
      expect(metrics.recordConsume).not.toHaveBeenCalledWith('error');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not probe an unreachable connection and still schedules the base sentinel', async () => {
    const publish = vi.fn().mockResolvedValue({ status: 'accepted' });
    const probeAndRefreshForBase = vi.fn();
    const runWithPermit = vi.fn();
    const getContainerForBase = vi.fn();
    const dataDbHealth = {
      getHealthSnapshotForBase: vi.fn().mockResolvedValue({
        state: 'unreachable',
        changedAt: new Date('2026-01-05T12:00:00Z'),
      }),
      probeAndRefreshForBase,
      reportWriteFailure: vi.fn(),
    };
    const handler = new ComputedOutboxWakeupHandler(
      { getContainerForBase } as never,
      createMetrics() as never,
      createPublisher(publish) as never,
      { runWithPermit } as never,
      dataDbHealth as never
    );

    await expect(
      handler.handle({
        ...wakeup,
        wakeupId: `cuwd-ro-${wakeup.baseId}-s0`,
        cause: 'replay',
      })
    ).resolves.toEqual({ status: 'deferred' });

    expect(probeAndRefreshForBase).not.toHaveBeenCalled();
    expect(runWithPermit).not.toHaveBeenCalled();
    expect(getContainerForBase).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledOnce();
  });

  it('processes normally when health reports the base healthy', async () => {
    const runTaskById = vi.fn().mockResolvedValue({ isErr: () => false, value: true });
    const runOnce = vi.fn().mockResolvedValue({ isErr: () => false, value: 0 });
    const dataDbHealth = {
      getHealthSnapshotForBase: vi.fn().mockResolvedValue({
        state: 'healthy',
        changedAt: null,
      }),
      reportWriteFailure: vi.fn(),
    };
    const handler = new ComputedOutboxWakeupHandler(
      {
        getComputedWriter,
        getContainerForBase: vi.fn().mockResolvedValue({
          resolve: () => ({ runTaskById, runOnce }),
        }),
      } as never,
      createMetrics() as never,
      createPublisher() as never,
      createActiveAdmission(),
      dataDbHealth as never
    );

    await expect(handler.handle(wakeup)).resolves.toEqual({ status: 'processed' });
    expect(runTaskById).toHaveBeenCalledOnce();
  });

  it('fails the delivery when the read-only defer wakeup cannot be published', async () => {
    const workerError = {
      code: 'infrastructure',
      message: 'Outbox transaction failed: error: cannot execute UPDATE in a read-only transaction',
    };
    const publish = vi.fn().mockRejectedValue(new Error('redis unavailable'));
    const metrics = createMetrics();
    const handler = new ComputedOutboxWakeupHandler(
      {
        getComputedWriter,
        getContainerForBase: vi.fn().mockResolvedValue({
          resolve: () => ({
            runTaskById: vi.fn().mockResolvedValue({ isErr: () => true, error: workerError }),
          }),
        }),
      } as never,
      metrics as never,
      createPublisher(publish) as never,
      createActiveAdmission()
    );

    await expect(handler.handle(wakeup)).rejects.toBe(workerError);

    expect(metrics.recordConsume).toHaveBeenCalledWith('error');
  });

  it('short-circuits ineligible tasks before acquiring a writer permit and backs off repeat concurrency deferrals', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-05T12:00:00Z'));
    try {
      const publish = vi.fn().mockResolvedValue({ status: 'accepted' });
      const runWithWriterPermitSpy = vi.fn();
      const runTaskByIdSpy = vi.fn();
      const getTaskClaimEligibility = vi.fn().mockResolvedValue({
        isErr: () => false,
        value: { status: 'deferred', reason: 'concurrency', retryAt: null },
      });

      const handler = new ComputedOutboxWakeupHandler(
        {
          getComputedWriter,
          getContainerForBase: vi.fn().mockResolvedValue({
            resolve: (token: unknown) => {
              if (token === v2RecordRepositoryPostgresTokens.computedUpdateWorker) {
                return { runTaskById: runTaskByIdSpy };
              }
              return { getTaskClaimEligibility };
            },
          }),
        } as never,
        createMetrics() as never,
        createPublisher(publish) as never,
        {
          runWithWriterPermit: runWithWriterPermitSpy,
          runWithPermit: async (
            _baseId: string,
            operation: (permit: typeof activePermit) => Promise<unknown>
          ) => ({
            admitted: true as const,
            value: await operation(activePermit),
          }),
        } as never
      );

      await expect(handler.handle(wakeup)).resolves.toEqual({ status: 'deferred' });
      expect(runWithWriterPermitSpy).not.toHaveBeenCalled();
      expect(runTaskByIdSpy).not.toHaveBeenCalled();
      expect(publish.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          availableAt: new Date(Date.now() + 100),
        })
      );

      const firstDeferredWakeup = publish.mock.calls[0][0];
      await expect(
        handler.handle({ ...wakeup, wakeupId: firstDeferredWakeup.wakeupId })
      ).resolves.toEqual({ status: 'deferred' });
      expect(runWithWriterPermitSpy).not.toHaveBeenCalled();
      expect(runTaskByIdSpy).not.toHaveBeenCalled();
      expect(publish.mock.calls[1][0]).toEqual(
        expect.objectContaining({
          availableAt: new Date(Date.now() + 500),
        })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('forwards writer.maxConcurrency to runWithWriterPermit and defers on writer_capacity', async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    const runWithWriterPermit = vi.fn().mockResolvedValue({ admitted: false });
    const container = {
      resolve: vi.fn().mockReturnValue({
        getTaskClaimEligibility: vi.fn().mockResolvedValue({
          isErr: () => false,
          value: { status: 'eligible' },
        }),
      }),
    };
    const metrics = {
      recordDeliveryLag: vi.fn(),
      recordConsume: vi.fn(),
      recordExecutionDuration: vi.fn(),
      recordTaskSettlement: vi.fn(),
    };
    const baseAdmission = {
      runWithPermit: vi.fn(async (_baseId: string, fn: (permit: unknown) => Promise<unknown>) => ({
        admitted: true,
        value: await fn({ assertActive: vi.fn() }),
      })),
      runWithWriterPermit,
    };
    const handler = new ComputedOutboxWakeupHandler(
      {
        getContainerForBase: vi.fn().mockResolvedValue(container),
        getComputedWriter: () => ({
          key: 'writer-cap-key',
          maxConcurrency: 3,
          hasWaiters: () => false,
        }),
      } as never,
      metrics as never,
      {
        runAsConsumer: async (fn: () => Promise<unknown>) => fn(),
        publish,
      } as never,
      baseAdmission as never
    );

    const outcome = await handler.handle({
      schemaVersion: 1,
      wakeupId: 'cuw_writer_cap_1',
      taskId: 'cuo_writer_cap_1',
      baseId: 'bse_writer_cap_1',
      availableAt: new Date().toISOString(),
      emittedAt: new Date().toISOString(),
      cause: 'created',
    });

    expect(outcome).toEqual({ status: 'deferred' });
    expect(runWithWriterPermit).toHaveBeenCalledWith(
      'bse_writer_cap_1',
      'writer-cap-key',
      expect.any(Function),
      3
    );
    expect(publish).toHaveBeenCalledOnce();
    expect(metrics.recordConsume).toHaveBeenCalledWith('deferred');
  });
});

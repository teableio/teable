import type { ComputedOutboxWakeup } from '@teable/v2-adapter-table-repository-postgres';
import { describe, expect, it, vi } from 'vitest';

import {
  BullMqComputedOutboxWakeupPublisher,
  ComputedOutboxWakeupPublishTimeoutError,
  ComputedOutboxWakeupRecoveryInProgressError,
} from './bullmq-computed-outbox-wakeup.publisher';

describe('BullMqComputedOutboxWakeupPublisher', () => {
  const queue = (add: ReturnType<typeof vi.fn>) => ({
    add,
    client: Promise.resolve({ status: 'ready' }),
  });

  const createWakeup = (): ComputedOutboxWakeup => {
    const now = Date.now();
    return {
      schemaVersion: 1,
      wakeupId: 'cuw1234567890123456',
      taskId: 'cuo1234567890123456',
      baseId: 'bse1234567890123456',
      availableAt: new Date(now + 5000),
      emittedAt: new Date(now),
      cause: 'retry',
    };
  };

  it('publishes a delayed locator job without copying the outbox payload', async () => {
    const add = vi.fn().mockResolvedValue({ id: 'job-1' });
    const metrics = {
      recordPublish: vi.fn(),
      recordPublishDuration: vi.fn(),
    };
    const publisher = new BullMqComputedOutboxWakeupPublisher(
      queue(add) as never,
      metrics as never
    );
    const wakeup = createWakeup();

    const result = await publisher.publish(wakeup);

    expect(result).toEqual({ status: 'accepted' });
    expect(add).toHaveBeenCalledWith(
      'computed-outbox-wakeup',
      {
        schemaVersion: 1,
        wakeupId: wakeup.wakeupId,
        taskId: wakeup.taskId,
        baseId: wakeup.baseId,
        availableAt: wakeup.availableAt.toISOString(),
        emittedAt: wakeup.emittedAt.toISOString(),
        cause: 'retry',
      },
      expect.objectContaining({
        jobId: wakeup.wakeupId,
        delay: expect.any(Number),
      })
    );
    expect(add.mock.calls[0]?.[2].delay).toBeGreaterThan(0);
    expect(metrics.recordPublish).toHaveBeenCalledWith('accepted', 'retry');
  });

  it('records and propagates queue publication failures', async () => {
    const queueError = new Error('redis unavailable');
    const metrics = {
      recordPublish: vi.fn(),
      recordPublishDuration: vi.fn(),
    };
    const add = vi.fn().mockRejectedValueOnce(queueError).mockResolvedValue({ id: 'retry-job' });
    const publisher = new BullMqComputedOutboxWakeupPublisher(
      queue(add) as never,
      metrics as never,
      1000,
      1
    );

    await expect(publisher.publish(createWakeup())).rejects.toBe(queueError);

    expect(metrics.recordPublish).toHaveBeenCalledWith('error', 'retry');
    expect(metrics.recordPublishDuration).toHaveBeenCalledWith(expect.any(Number));
    await vi.waitFor(() => expect(add).toHaveBeenCalledTimes(2));
    expect(metrics.recordPublish).toHaveBeenCalledWith('accepted', 'retry');
  });

  it('uses deterministic redrive job ids without retaining failed redrive jobs', async () => {
    const add = vi.fn().mockResolvedValue({ id: 'redrive-job' });
    const publisher = new BullMqComputedOutboxWakeupPublisher(
      queue(add) as never,
      { recordPublish: vi.fn(), recordPublishDuration: vi.fn() } as never
    );

    await publisher.publish({ ...createWakeup(), wakeupId: 'cuwr-task-revision' });

    expect(add).toHaveBeenCalledWith(
      'computed-outbox-wakeup',
      expect.any(Object),
      expect.objectContaining({ jobId: 'cuwr-task-revision', removeOnFail: true })
    );
  });

  it('bounds publication time when Redis stops responding', async () => {
    const metrics = {
      recordPublish: vi.fn(),
      recordPublishDuration: vi.fn(),
    };
    const publisher = new BullMqComputedOutboxWakeupPublisher(
      queue(vi.fn().mockReturnValue(new Promise(() => undefined))) as never,
      metrics as never,
      1
    );

    await expect(publisher.publish(createWakeup())).rejects.toBeInstanceOf(
      ComputedOutboxWakeupPublishTimeoutError
    );

    expect(metrics.recordPublish).toHaveBeenCalledWith('timeout', 'retry');
  });

  it('opens a bounded recovery circuit and redrives after the single probe succeeds', async () => {
    let resolveAdd: ((value: { id: string }) => void) | undefined;
    const addOperation = new Promise<{ id: string }>((resolve) => {
      resolveAdd = resolve;
    });
    const add = vi.fn().mockReturnValue(addOperation);
    const publisher = new BullMqComputedOutboxWakeupPublisher(
      queue(add) as never,
      { recordPublish: vi.fn(), recordPublishDuration: vi.fn() } as never,
      1
    );
    const recovered = vi.fn();
    publisher.onDeliveryRecovered(recovered);

    await expect(publisher.publish(createWakeup())).rejects.toBeInstanceOf(
      ComputedOutboxWakeupPublishTimeoutError
    );
    await expect(publisher.publish(createWakeup())).rejects.toBeInstanceOf(
      ComputedOutboxWakeupRecoveryInProgressError
    );
    expect(add).toHaveBeenCalledTimes(1);

    resolveAdd?.({ id: 'eventually-added' });
    await vi.waitFor(() => expect(recovered).toHaveBeenCalledTimes(1));
  });

  it('forwards outbox-layer skip reasons to metrics', () => {
    const metrics = { recordPublishSkip: vi.fn() };
    const publisher = new BullMqComputedOutboxWakeupPublisher(
      queue(vi.fn()) as never,
      metrics as never
    );

    publisher.recordSkip('no_after_commit');

    expect(metrics.recordPublishSkip).toHaveBeenCalledWith('no_after_commit');
  });
});

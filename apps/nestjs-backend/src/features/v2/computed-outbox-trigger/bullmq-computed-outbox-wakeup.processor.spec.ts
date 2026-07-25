import { UnrecoverableError } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';

import { BullMqComputedOutboxWakeupProcessor } from './bullmq-computed-outbox-wakeup.processor';

vi.mock('./computed-outbox-wakeup.handler', () => ({
  ComputedOutboxWakeupHandler: class ComputedOutboxWakeupHandler {},
}));

describe('BullMqComputedOutboxWakeupProcessor', () => {
  it('validates and forwards a versioned wake-up payload', async () => {
    const handle = vi.fn().mockResolvedValue({ status: 'processed' });
    const processor = new BullMqComputedOutboxWakeupProcessor(
      { handle } as never,
      { recordConsume: vi.fn() } as never,
      { publish: vi.fn(), runAsConsumer: vi.fn() } as never
    );
    const data = {
      schemaVersion: 1,
      wakeupId: 'cuw1234567890123456',
      taskId: 'cuo1234567890123456',
      baseId: 'bse1234567890123456',
      availableAt: new Date().toISOString(),
      emittedAt: new Date().toISOString(),
      cause: 'created',
    };

    await processor.process({ data } as never);

    expect(handle).toHaveBeenCalledWith(data);
  });

  it('rejects an invalid payload without retrying it', async () => {
    const metrics = { recordConsume: vi.fn() };
    const processor = new BullMqComputedOutboxWakeupProcessor(
      { handle: vi.fn() } as never,
      metrics as never,
      { publish: vi.fn(), runAsConsumer: vi.fn() } as never
    );

    await expect(processor.process({ data: { schemaVersion: 2 } } as never)).rejects.toBeInstanceOf(
      UnrecoverableError
    );
    expect(metrics.recordConsume).toHaveBeenCalledWith('invalid');
  });

  it('re-arms a durable task after the final BullMQ execution attempt fails', async () => {
    const executionError = new Error('database unavailable');
    const publish = vi.fn().mockResolvedValue({ status: 'accepted' });
    const runAsConsumer = vi.fn(async (operation: () => Promise<unknown>) => await operation());
    const processor = new BullMqComputedOutboxWakeupProcessor(
      { handle: vi.fn().mockRejectedValue(executionError) } as never,
      { recordConsume: vi.fn() } as never,
      { publish, runAsConsumer } as never
    );
    const data = {
      schemaVersion: 1,
      wakeupId: 'cuw1234567890123456',
      taskId: 'cuo1234567890123456',
      baseId: 'bse1234567890123456',
      availableAt: new Date().toISOString(),
      emittedAt: new Date().toISOString(),
      cause: 'created',
    };

    await expect(
      processor.process({ data, attemptsMade: 2, opts: { attempts: 3 } } as never)
    ).rejects.toBe(executionError);

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: data.taskId, baseId: data.baseId, cause: 'replay' })
    );
    expect(runAsConsumer).toHaveBeenCalledTimes(1);
  });
});

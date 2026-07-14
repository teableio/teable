import { AsyncLocalStorage } from 'async_hooks';
import type { ILogger } from '@teable/v2-core';
import { ok } from 'neverthrow';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ComputedUpdatePollingService, defaultPollingConfig } from './ComputedUpdatePollingService';

const createLogger = (): ILogger => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn().mockReturnThis(),
  scope: vi.fn().mockReturnThis(),
});

describe('ComputedUpdatePollingService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('auto-starts and drains non-empty backlog immediately', async () => {
    vi.useFakeTimers();

    const worker = {
      runOnce: vi.fn().mockResolvedValueOnce(ok(1)).mockResolvedValue(ok(0)),
    };
    const logger = createLogger();

    const service = new ComputedUpdatePollingService(
      worker as never,
      {
        ...defaultPollingConfig,
        enabled: true,
        workerId: 'poll-test',
        batchSize: 10,
        pollIntervalMs: 1000,
      },
      logger
    );

    await vi.advanceTimersByTimeAsync(1);
    await service.stop();

    expect(worker.runOnce).toHaveBeenCalledWith({
      workerId: 'poll-test',
      limit: 10,
    });
    expect(worker.runOnce).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledWith(
      'computed:polling:started',
      expect.objectContaining({ workerId: 'poll-test' })
    );
    expect(logger.debug).toHaveBeenCalledWith(
      'computed:polling:continue_immediately',
      expect.objectContaining({ workerId: 'poll-test', processed: 1 })
    );
  });

  it('emits debug logs for idle polling cycles', async () => {
    vi.useFakeTimers();

    const worker = {
      runOnce: vi.fn().mockResolvedValue(ok(0)),
    };
    const logger = createLogger();

    const service = new ComputedUpdatePollingService(
      worker as never,
      {
        ...defaultPollingConfig,
        enabled: true,
        workerId: 'poll-debug',
        batchSize: 5,
        pollIntervalMs: 1000,
      },
      logger
    );

    await vi.advanceTimersByTimeAsync(1);
    await service.stop();

    expect(logger.debug).toHaveBeenCalledWith(
      'computed:polling:auto_start_scheduled',
      expect.objectContaining({ workerId: 'poll-debug' })
    );
    expect(logger.debug).toHaveBeenCalledWith(
      'computed:polling:tick',
      expect.objectContaining({ workerId: 'poll-debug', batchSize: 5 })
    );
    expect(logger.debug).toHaveBeenCalledWith(
      'computed:polling:idle',
      expect.objectContaining({ workerId: 'poll-debug', pollIntervalMs: 1000 })
    );
    expect(logger.debug).toHaveBeenCalledWith(
      'computed:polling:scheduled',
      expect.objectContaining({ workerId: 'poll-debug', delayMs: 1000 })
    );
  });

  it('runs auto-started polling outside the request async context that created it', async () => {
    vi.useFakeTimers();

    const storage = new AsyncLocalStorage<{ tableId: string }>();
    const seenContexts: Array<{ tableId: string } | undefined> = [];
    const worker = {
      runOnce: vi.fn().mockImplementation(() => {
        seenContexts.push(storage.getStore());
        return Promise.resolve(ok(seenContexts.length === 1 ? 5 : 0));
      }),
    };
    const logger = createLogger();

    let service: ComputedUpdatePollingService | undefined;
    storage.run({ tableId: 'tbl-from-request' }, () => {
      service = new ComputedUpdatePollingService(
        worker as never,
        {
          ...defaultPollingConfig,
          enabled: true,
          workerId: 'poll-detached',
          batchSize: 5,
          pollIntervalMs: 1000,
        },
        logger
      );
    });

    await vi.runOnlyPendingTimersAsync();
    await vi.runOnlyPendingTimersAsync();

    expect(seenContexts).toEqual([undefined, undefined]);

    await service?.stop();
  });
});

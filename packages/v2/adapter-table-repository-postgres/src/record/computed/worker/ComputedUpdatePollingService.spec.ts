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

  it('auto-starts and drains backlog when polling is enabled', async () => {
    vi.useFakeTimers();

    const worker = {
      runOnce: vi.fn().mockResolvedValue(ok(1)),
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
    expect(logger.info).toHaveBeenCalledWith(
      'computed:polling:started',
      expect.objectContaining({ workerId: 'poll-test' })
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
});

import { describe, expect, it, vi } from 'vitest';

import { ComputedOutboxRedriveService } from './computed-outbox-redrive.service';

vi.mock('../../../global/data-db-client-manager.service', () => ({
  DataDbClientManager: class DataDbClientManager {},
}));

const config = {
  producerEnabled: true,
  consumerEnabled: true,
  concurrency: 8,
  publishTimeoutMs: 1000,
  monitorConcurrency: 2,
  monitorIntervalMs: 30_000,
  redriveMaxPublishPerTarget: 1000,
  claimConcurrencyPerBase: 2,
  claimConcurrencyPerSeedTable: 2,
} as const;

describe('ComputedOutboxRedriveService', () => {
  it('publishes every durable non-terminal task under the cross-process lease', async () => {
    const targets = [
      {
        cacheKey: 'default',
        url: 'postgres://hidden',
        isMetaFallback: true,
        storage: 'default',
      },
    ] as const;
    const availableAt = new Date('2026-07-14T09:00:00.000Z');
    const iterateComputedOutboxWakeupCandidates = vi.fn(async function* () {
      yield [
        { taskId: 'cuo-1', baseId: 'bse-1', availableAt, revision: '1-0-1-0' },
        { taskId: 'cuo-2', baseId: 'bse-2', availableAt, revision: '2-0-2-0' },
      ];
    });
    const publish = vi.fn().mockResolvedValue({ status: 'accepted' });
    const withComputedOutboxRedriveLease = vi.fn(async (run: () => Promise<void>) => {
      await run();
      return true;
    });
    const service = new ComputedOutboxRedriveService(
      config,
      {
        withComputedOutboxRedriveLease,
        listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue(targets),
        iterateComputedOutboxWakeupCandidates,
        restoreOrphanedComputedOutboxDeferrals: vi.fn().mockResolvedValue(0),
      } as never,
      {
        publish,
        runAsConsumer: vi.fn(async (operation: () => Promise<unknown>) => await operation()),
      } as never
    );

    await service.runOnce();

    expect(withComputedOutboxRedriveLease).toHaveBeenCalledTimes(1);
    expect(iterateComputedOutboxWakeupCandidates).toHaveBeenCalledWith(
      targets[0],
      expect.any(Number)
    );
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        wakeupId: 'cuwr2-cuo-1-1-0-1-0',
        taskId: 'cuo-1',
        baseId: 'bse-1',
        availableAt,
      })
    );
  });

  it('stops publishing once the per-target redrive budget is reached', async () => {
    const targets = [
      {
        cacheKey: 'default',
        url: 'postgres://hidden',
        isMetaFallback: true,
        storage: 'default',
      },
    ] as const;
    const availableAt = new Date('2026-07-14T09:00:00.000Z');
    const iterateComputedOutboxWakeupCandidates = vi.fn(async function* () {
      yield [
        { taskId: 'cuo-1', baseId: 'bse-1', availableAt, revision: '1-0-1-0' },
        { taskId: 'cuo-2', baseId: 'bse-2', availableAt, revision: '2-0-2-0' },
        { taskId: 'cuo-3', baseId: 'bse-3', availableAt, revision: '3-0-3-0' },
      ];
      throw new Error('iterator should not be drained past the publish budget');
    });
    const publish = vi.fn().mockResolvedValue({ status: 'accepted' });
    const service = new ComputedOutboxRedriveService(
      { ...config, redriveMaxPublishPerTarget: 2 },
      {
        withComputedOutboxRedriveLease: vi.fn(async (run: () => Promise<void>) => {
          await run();
          return true;
        }),
        listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue(targets),
        iterateComputedOutboxWakeupCandidates,
        restoreOrphanedComputedOutboxDeferrals: vi.fn().mockResolvedValue(0),
      } as never,
      {
        publish,
        runAsConsumer: vi.fn(async (operation: () => Promise<unknown>) => await operation()),
      } as never
    );

    await service.runOnce();

    expect(publish).toHaveBeenCalledTimes(2);
  });

  it('skips an unhealthy byodb target without scanning or publishing wake-ups', async () => {
    const target = {
      cacheKey: 'dbcon-1',
      connectionId: 'dbcon-1',
      url: 'postgres://hidden',
      isMetaFallback: false,
      storage: 'byodb',
    } as const;
    const getHealthStateForConnection = vi.fn().mockResolvedValue('read_only');
    const iterateComputedOutboxWakeupCandidates = vi.fn(async function* () {
      yield [];
    });
    const publish = vi.fn();
    const service = new ComputedOutboxRedriveService(
      config,
      {
        withComputedOutboxRedriveLease: vi.fn(async (run: () => Promise<void>) => {
          await run();
          return true;
        }),
        listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue([target]),
        iterateComputedOutboxWakeupCandidates,
        restoreOrphanedComputedOutboxDeferrals: vi.fn().mockResolvedValue(0),
      } as never,
      {
        publish,
        runAsConsumer: vi.fn(async (operation: () => Promise<unknown>) => await operation()),
      } as never,
      { getHealthStateForConnection } as never
    );

    await service.runOnce();

    expect(getHealthStateForConnection).toHaveBeenCalledWith('dbcon-1');
    expect(iterateComputedOutboxWakeupCandidates).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('does not consult health for the default storage target', async () => {
    const target = {
      cacheKey: 'default',
      url: 'postgres://hidden',
      isMetaFallback: true,
      storage: 'default',
    } as const;
    const getHealthStateForConnection = vi.fn();
    const iterateComputedOutboxWakeupCandidates = vi.fn(async function* () {
      yield [];
    });
    const service = new ComputedOutboxRedriveService(
      config,
      {
        withComputedOutboxRedriveLease: vi.fn(async (run: () => Promise<void>) => {
          await run();
          return true;
        }),
        listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue([target]),
        iterateComputedOutboxWakeupCandidates,
        restoreOrphanedComputedOutboxDeferrals: vi.fn().mockResolvedValue(0),
      } as never,
      {
        publish: vi.fn(),
        runAsConsumer: vi.fn(async (operation: () => Promise<unknown>) => await operation()),
      } as never,
      { getHealthStateForConnection } as never
    );

    await service.runOnce();

    expect(getHealthStateForConnection).not.toHaveBeenCalled();
    expect(iterateComputedOutboxWakeupCandidates).toHaveBeenCalledTimes(1);
  });

  it('re-arms a recovered byodb target with a full scan even during actionable reconciliation', async () => {
    const target = {
      cacheKey: 'dbcon-1',
      connectionId: 'dbcon-1',
      url: 'postgres://hidden',
      isMetaFallback: false,
      storage: 'byodb',
    } as const;
    const getHealthStateForConnection = vi
      .fn()
      .mockResolvedValueOnce('read_only')
      .mockResolvedValue('healthy');
    const iterateComputedOutboxWakeupCandidates = vi.fn(async function* () {
      yield [];
    });
    const service = new ComputedOutboxRedriveService(
      config,
      {
        withComputedOutboxRedriveLease: vi.fn(async (run: () => Promise<void>) => {
          await run();
          return true;
        }),
        listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue([target]),
        iterateComputedOutboxWakeupCandidates,
        restoreOrphanedComputedOutboxDeferrals: vi.fn().mockResolvedValue(0),
      } as never,
      {
        publish: vi.fn(),
        runAsConsumer: vi.fn(async (operation: () => Promise<unknown>) => await operation()),
      } as never,
      { getHealthStateForConnection } as never
    );

    await service.runOnce({ actionableOnly: true });
    expect(iterateComputedOutboxWakeupCandidates).not.toHaveBeenCalled();

    await service.runOnce({ actionableOnly: true });
    expect(iterateComputedOutboxWakeupCandidates).toHaveBeenCalledTimes(1);
    expect(iterateComputedOutboxWakeupCandidates).toHaveBeenLastCalledWith(
      target,
      expect.any(Number)
    );

    // Once recovered, later actionable reconciliations stay actionable-only.
    await service.runOnce({ actionableOnly: true });
    expect(iterateComputedOutboxWakeupCandidates).toHaveBeenLastCalledWith(
      target,
      expect.any(Number),
      500,
      { actionableOnly: true }
    );
  });

  it('starts recovery in the background for a consumer-only process', async () => {
    const withComputedOutboxRedriveLease = vi.fn().mockResolvedValue(true);
    const service = new ComputedOutboxRedriveService(
      { ...config, producerEnabled: false },
      { withComputedOutboxRedriveLease } as never,
      {
        publish: vi.fn(),
        runAsConsumer: vi.fn(),
        onDeliveryRecovered: vi.fn(() => vi.fn()),
      } as never
    );

    expect(service.onApplicationBootstrap()).toBeUndefined();
    await vi.waitFor(() => expect(withComputedOutboxRedriveLease).toHaveBeenCalledTimes(1));
  });

  it('periodically reconciles parked tasks at a low frequency', async () => {
    vi.useFakeTimers();
    try {
      const withComputedOutboxRedriveLease = vi.fn(async (run: () => Promise<void>) => {
        await run();
        return true;
      });
      const target = {
        cacheKey: 'default',
        url: 'postgres://hidden',
        isMetaFallback: true,
        storage: 'default',
      } as const;
      const iterateComputedOutboxWakeupCandidates = vi.fn(async function* () {
        yield* [];
      });
      const service = new ComputedOutboxRedriveService(
        config,
        {
          withComputedOutboxRedriveLease,
          listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue([target]),
          iterateComputedOutboxWakeupCandidates,
        } as never,
        {
          publish: vi.fn(),
          runAsConsumer: vi.fn(),
          onDeliveryRecovered: vi.fn(() => vi.fn()),
        } as never
      );

      service.onApplicationBootstrap();
      await vi.advanceTimersByTimeAsync(1);
      expect(withComputedOutboxRedriveLease).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(299_998);
      expect(withComputedOutboxRedriveLease).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      expect(withComputedOutboxRedriveLease).toHaveBeenCalledTimes(2);
      expect(iterateComputedOutboxWakeupCandidates).toHaveBeenLastCalledWith(
        target,
        expect.any(Number),
        500,
        { actionableOnly: true }
      );
      service.onModuleDestroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('upgrades an actionable target retry when a full recovery also fails', async () => {
    vi.useFakeTimers();
    try {
      const target = {
        cacheKey: 'default',
        url: 'postgres://hidden',
        isMetaFallback: true,
        storage: 'default',
      } as const;
      let scanCalls = 0;
      const iterateComputedOutboxWakeupCandidates = vi.fn(async function* () {
        scanCalls += 1;
        if (scanCalls <= 2) throw new Error('database unavailable');
        yield* [];
      });
      const service = new ComputedOutboxRedriveService(
        config,
        {
          withComputedOutboxRedriveLease: vi.fn(async (run: () => Promise<void>) => {
            await run();
            return true;
          }),
          listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue([target]),
          iterateComputedOutboxWakeupCandidates,
        } as never,
        { publish: vi.fn(), runAsConsumer: vi.fn() } as never
      );

      await service.runOnce({ actionableOnly: true });
      await service.runOnce();
      await vi.advanceTimersByTimeAsync(1000);

      expect(iterateComputedOutboxWakeupCandidates).toHaveBeenLastCalledWith(
        target,
        expect.any(Number)
      );
      service.onModuleDestroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('restores pause-deferral orphans before scanning candidates', async () => {
    // T6648: a row future-dated by a pause defer whose restore never fired is
    // invisible to the next_run_at-keyed candidate query — the sweep must pull
    // it back to due first, and a restore failure must not abort the scan.
    const targets = [{ cacheKey: 'default', url: 'postgres://main', storage: 'default' }] as const;
    const calls: string[] = [];
    const restoreOrphanedComputedOutboxDeferrals = vi.fn(async () => {
      calls.push('restore');
      return 3;
    });
    const iterateComputedOutboxWakeupCandidates = vi.fn(async function* () {
      calls.push('scan');
    });
    const service = new ComputedOutboxRedriveService(
      config,
      {
        withComputedOutboxRedriveLease: vi.fn(async (run: () => Promise<void>) => {
          await run();
          return true;
        }),
        listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue(targets),
        iterateComputedOutboxWakeupCandidates,
        restoreOrphanedComputedOutboxDeferrals,
      } as never,
      {
        publish: vi.fn().mockResolvedValue({ status: 'accepted' }),
        runAsConsumer: vi.fn(async (operation: () => Promise<unknown>) => await operation()),
      } as never
    );

    await service.runOnce();

    expect(restoreOrphanedComputedOutboxDeferrals).toHaveBeenCalledWith(
      targets[0],
      expect.any(Number)
    );
    expect(calls).toEqual(['restore', 'scan']);

    // A restore failure downgrades to a warn and the scan still runs.
    restoreOrphanedComputedOutboxDeferrals.mockRejectedValueOnce(new Error('boom'));
    await service.runOnce();
    expect(iterateComputedOutboxWakeupCandidates).toHaveBeenCalledTimes(2);
  });

  it('does not redrive when both BullMQ roles are disabled', async () => {
    const withComputedOutboxRedriveLease = vi.fn();
    const service = new ComputedOutboxRedriveService(
      { ...config, producerEnabled: false, consumerEnabled: false },
      { withComputedOutboxRedriveLease } as never,
      { publish: vi.fn(), runAsConsumer: vi.fn() } as never
    );

    service.onApplicationBootstrap();

    expect(withComputedOutboxRedriveLease).not.toHaveBeenCalled();
  });

  it('re-arms immediately when a data-db connection recovers', async () => {
    const listeners: Array<() => void> = [];
    const onRecovered = vi.fn((listener: () => void) => {
      listeners.push(listener);
      return () => undefined;
    });
    const service = new ComputedOutboxRedriveService(
      config,
      { withComputedOutboxRedriveLease: vi.fn().mockResolvedValue(true) } as never,
      {
        publish: vi.fn(),
        runAsConsumer: vi.fn(),
        onDeliveryRecovered: vi.fn(() => vi.fn()),
      } as never,
      { onRecovered } as never
    );
    const runOnce = vi.spyOn(service, 'runOnce').mockResolvedValue(undefined);

    service.onApplicationBootstrap();
    await vi.waitFor(() => expect(runOnce).toHaveBeenCalledTimes(1));
    expect(onRecovered).toHaveBeenCalledOnce();

    listeners[0]?.();
    await vi.waitFor(() => expect(runOnce).toHaveBeenCalledTimes(2));

    service.onModuleDestroy();
  });
});

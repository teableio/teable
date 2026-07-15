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
        wakeupId: 'cuwr-cuo-1-1-0-1-0',
        taskId: 'cuo-1',
        baseId: 'bse-1',
        availableAt,
      })
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

  it('does not redrive when both BullMQ roles are disabled', async () => {
    const withComputedOutboxRedriveLease = vi.fn();
    const service = new ComputedOutboxRedriveService(
      { ...config, producerEnabled: false, consumerEnabled: false },
      { withComputedOutboxRedriveLease } as never,
      { publish: vi.fn(), runAsConsumer: vi.fn() } as never
    );

    service.onApplicationBootstrap();
    await Promise.resolve();

    expect(withComputedOutboxRedriveLease).not.toHaveBeenCalled();
  });
});

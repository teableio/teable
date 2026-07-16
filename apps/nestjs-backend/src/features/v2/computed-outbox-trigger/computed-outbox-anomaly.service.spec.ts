import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { ComputedOutboxAnomalyService } from './computed-outbox-anomaly.service';

const targets = [
  {
    cacheKey: 'meta-fallback',
    url: 'postgres://hidden',
    isMetaFallback: true,
    storage: 'default',
  },
  {
    cacheKey: 'dcn1',
    url: 'postgres://hidden-byodb',
    isMetaFallback: false,
    storage: 'byodb',
  },
] as const;

describe('ComputedOutboxAnomalyService', () => {
  it('aggregates recent anomalies without exposing target URLs', async () => {
    const listComputedOutboxMaintenanceAnomalies = vi
      .fn()
      .mockResolvedValueOnce({
        total: 2,
        items: [
          {
            kind: 'dead',
            taskId: 'cuo-old',
            baseId: 'bse1',
            seedTableId: 'tbl1',
            attempts: 8,
            maxAttempts: 8,
            lastError: 'timeout',
            occurredAt: new Date('2026-07-15T04:00:00.000Z'),
          },
        ],
      })
      .mockResolvedValueOnce({
        total: 1,
        items: [
          {
            kind: 'stale',
            taskId: 'cuo-new',
            baseId: 'bse2',
            seedTableId: 'tbl2',
            attempts: 1,
            maxAttempts: 8,
            lastError: null,
            occurredAt: new Date('2026-07-15T05:00:00.000Z'),
          },
        ],
      });
    const service = new ComputedOutboxAnomalyService(
      {
        listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue(targets),
        listComputedOutboxMaintenanceAnomalies,
      } as never,
      {} as never
    );

    const result = await service.list(20);

    expect(result.total).toBe(3);
    expect(result.unavailableTargetCount).toBe(0);
    expect(
      result.items.map(({ taskId, targetId, storage }) => ({ taskId, targetId, storage }))
    ).toEqual([
      { taskId: 'cuo-new', targetId: 'dcn1', storage: 'byodb' },
      { taskId: 'cuo-old', targetId: 'meta-fallback', storage: 'default' },
    ]);
    expect(result.items.some((item) => 'url' in item)).toBe(false);
  });

  it('restores a dead letter and publishes a BullMQ wake-up', async () => {
    const publish = vi.fn().mockResolvedValue({ status: 'accepted' });
    const recoverComputedOutboxMaintenanceAnomaly = vi
      .fn()
      .mockResolvedValue({ status: 'recovered', baseId: 'bse1' });
    const service = new ComputedOutboxAnomalyService(
      {
        listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue(targets),
        recoverComputedOutboxMaintenanceAnomaly,
      } as never,
      {
        publish,
        runAsConsumer: vi.fn(async (operation: () => Promise<unknown>) => await operation()),
      } as never
    );

    await expect(
      service.recover({ targetId: 'meta-fallback', taskId: 'cuo1', kind: 'dead' })
    ).resolves.toEqual({
      taskId: 'cuo1',
      kind: 'dead',
      recovered: true,
      delivery: 'accepted',
    });
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'cuo1', baseId: 'bse1', cause: 'replay' })
    );
  });

  it('keeps a restored durable task recoverable when immediate BullMQ delivery fails', async () => {
    const service = new ComputedOutboxAnomalyService(
      {
        listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue(targets),
        recoverComputedOutboxMaintenanceAnomaly: vi
          .fn()
          .mockResolvedValue({ status: 'recovered', baseId: 'bse1' }),
      } as never,
      {
        publish: vi.fn().mockRejectedValue(new Error('redis unavailable')),
        runAsConsumer: vi.fn(async (operation: () => Promise<unknown>) => await operation()),
      } as never
    );

    await expect(
      service.recover({ targetId: 'meta-fallback', taskId: 'cuo1', kind: 'dead' })
    ).resolves.toMatchObject({ recovered: true, delivery: 'deferred' });
  });

  it('rejects missing targets and conflicting dead-letter restores', async () => {
    const listComputedOutboxMaintenanceTargets = vi.fn().mockResolvedValue(targets);
    const recoverComputedOutboxMaintenanceAnomaly = vi
      .fn()
      .mockResolvedValue({ status: 'conflict' });
    const service = new ComputedOutboxAnomalyService(
      { listComputedOutboxMaintenanceTargets, recoverComputedOutboxMaintenanceAnomaly } as never,
      {} as never
    );

    await expect(
      service.recover({ targetId: 'missing', taskId: 'cuo1', kind: 'dead' })
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.recover({ targetId: 'meta-fallback', taskId: 'cuo1', kind: 'dead' })
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import {
  ComputedOutboxAnomalyService,
  groupComputedOutboxAnomalies,
} from './computed-outbox-anomaly.service';

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

const anomalyFields = {
  failedSql: null,
  failureKind: null,
  failurePhase: null,
  affectedTableName: null,
} as const;

describe('groupComputedOutboxAnomalies', () => {
  it('merges repeated root causes into groups and keeps recent samples', () => {
    const result = groupComputedOutboxAnomalies(
      [
        {
          targetId: 'meta-fallback',
          storage: 'default',
          kind: 'dead',
          taskId: 'cuo-2',
          baseId: 'bse1',
          seedTableId: 'tbl1',
          attempts: 8,
          maxAttempts: 8,
          lastError: 'statement timeout',
          failedSql: 'update t set x = 1',
          failureKind: 'statement_timeout',
          failurePhase: 'execute_plan',
          affectedTableName: 't',
          occurredAt: new Date('2026-07-15T05:00:00.000Z'),
        },
        {
          targetId: 'meta-fallback',
          storage: 'default',
          kind: 'dead',
          taskId: 'cuo-1',
          baseId: 'bse1',
          seedTableId: 'tbl1',
          attempts: 8,
          maxAttempts: 8,
          lastError: 'statement timeout',
          failedSql: null,
          failureKind: 'statement_timeout',
          failurePhase: 'execute_plan',
          affectedTableName: 't',
          occurredAt: new Date('2026-07-15T04:00:00.000Z'),
        },
        {
          targetId: 'dcn1',
          storage: 'byodb',
          kind: 'stale',
          taskId: 'cuo-3',
          baseId: 'bse2',
          seedTableId: 'tbl2',
          attempts: 1,
          maxAttempts: 8,
          lastError: null,
          ...anomalyFields,
          occurredAt: new Date('2026-07-15T06:00:00.000Z'),
        },
      ],
      { groupLimit: 10, sampleLimit: 12 }
    );

    expect(result.groupTotal).toBe(2);
    expect(result.groups).toHaveLength(2);
    expect(result.groups[0]).toMatchObject({
      kind: 'stale',
      count: 1,
      baseId: 'bse2',
    });
    expect(result.groups[1]).toMatchObject({
      kind: 'dead',
      count: 2,
      baseId: 'bse1',
      failedSql: 'update t set x = 1',
      items: [{ taskId: 'cuo-2' }, { taskId: 'cuo-1' }],
    });
  });
});

describe('ComputedOutboxAnomalyService', () => {
  it('aggregates recent anomalies into groups without exposing target URLs', async () => {
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
            ...anomalyFields,
            occurredAt: new Date('2026-07-15T04:00:00.000Z'),
          },
          {
            kind: 'dead',
            taskId: 'cuo-old-2',
            baseId: 'bse1',
            seedTableId: 'tbl1',
            attempts: 8,
            maxAttempts: 8,
            lastError: 'timeout',
            failedSql: 'select 1',
            failureKind: 'statement_timeout',
            failurePhase: 'execute_plan',
            affectedTableName: null,
            occurredAt: new Date('2026-07-15T03:00:00.000Z'),
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
            ...anomalyFields,
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
    expect(result.groupTotal).toBe(2);
    expect(result.unavailableTargetCount).toBe(0);
    expect(
      result.groups.map(({ count, items, targetId, storage }) => ({
        count,
        taskIds: items.map((item) => item.taskId),
        targetId,
        storage,
      }))
    ).toEqual([
      { count: 1, taskIds: ['cuo-new'], targetId: 'dcn1', storage: 'byodb' },
      {
        count: 2,
        taskIds: ['cuo-old', 'cuo-old-2'],
        targetId: 'meta-fallback',
        storage: 'default',
      },
    ]);
    expect(result.groups[1]?.failedSql).toBe('select 1');
    expect(JSON.stringify(result.groups)).not.toContain('postgres://');
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

import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { DataDbBindingNotReadyError } from '../../../global/data-db-client-manager.service';
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
    baseSpaceMapping: [{ baseId: 'bse2', spaceId: 'spc2' }],
  },
] as const;

const anomalyFields = {
  failedSql: null,
  failureKind: null,
  failurePhase: null,
  affectedTableName: null,
} as const;

const createMigrationGuard = () => ({ assertBaseWritable: vi.fn() });

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

  it('merges errors that differ only by volatile numeric identifiers', () => {
    const common = {
      targetId: 'meta-fallback',
      storage: 'default' as const,
      kind: 'dead' as const,
      baseId: 'bse1',
      seedTableId: 'tbl1',
      attempts: 3,
      maxAttempts: 3,
      ...anomalyFields,
      failureKind: 'transient',
      failurePhase: 'execute_plan',
    };
    const result = groupComputedOutboxAnomalies([
      {
        ...common,
        taskId: 'cuo-1',
        lastError:
          'Failed to create dirty table: error: could not create file "base/16385/t50_1262301": No space left on device',
        occurredAt: new Date('2026-07-15T05:00:00.000Z'),
      },
      {
        ...common,
        taskId: 'cuo-2',
        lastError:
          'Failed to create dirty table: error: could not create file "base/16385/t91_1262300": No space left on device',
        occurredAt: new Date('2026-07-15T04:00:00.000Z'),
      },
    ]);

    expect(result.groupTotal).toBe(1);
    expect(result.groups[0]).toMatchObject({
      count: 2,
      errorSignature:
        'Failed to create dirty table: error: could not create file "base/#/t#_#": No space left on device',
      // The headline keeps the latest raw error for debugging; only the group key normalizes.
      lastError:
        'Failed to create dirty table: error: could not create file "base/16385/t50_1262301": No space left on device',
    });
  });

  it('keeps identical root-cause signatures isolated by storage target', () => {
    const common = {
      kind: 'dead' as const,
      baseId: 'bse1',
      seedTableId: 'tbl1',
      attempts: 8,
      maxAttempts: 8,
      lastError: 'statement timeout',
      ...anomalyFields,
    };
    const result = groupComputedOutboxAnomalies([
      {
        ...common,
        targetId: 'meta-fallback',
        storage: 'default',
        taskId: 'cuo-default',
        occurredAt: new Date('2026-07-15T05:00:00.000Z'),
      },
      {
        ...common,
        targetId: 'dcn1',
        storage: 'byodb',
        taskId: 'cuo-byodb',
        occurredAt: new Date('2026-07-15T04:00:00.000Z'),
      },
    ]);

    expect(result.groupTotal).toBe(2);
    expect(result.groups.map((group) => group.targetId)).toEqual(['meta-fallback', 'dcn1']);
  });

  it('applies the group filter before the limit slice so older matches stay reachable', () => {
    const common = {
      kind: 'dead' as const,
      seedTableId: 'tbl1',
      attempts: 8,
      maxAttempts: 8,
      lastError: 'statement timeout',
      targetId: 'meta-fallback',
      storage: 'default' as const,
      ...anomalyFields,
    };
    const result = groupComputedOutboxAnomalies(
      [
        {
          ...common,
          baseId: 'bse-recent',
          taskId: 'cuo-recent',
          occurredAt: new Date('2026-07-15T06:00:00.000Z'),
        },
        {
          ...common,
          baseId: 'bse-old',
          taskId: 'cuo-old',
          occurredAt: new Date('2026-07-15T04:00:00.000Z'),
        },
      ],
      { groupLimit: 1, filter: (group) => group.baseId === 'bse-old' }
    );

    expect(result.groupTotal).toBe(2);
    expect(result.matchedGroupTotal).toBe(1);
    expect(result.groups.map((group) => group.baseId)).toEqual(['bse-old']);
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
        listByodbBoundBaseIds: vi.fn().mockResolvedValue([]),
        listComputedOutboxMaintenanceAnomalies,
      } as never,
      createMigrationGuard() as never,
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

  it('hides orphaned anomalies whose base routes to another storage target', async () => {
    const mappedTargets = [
      { ...targets[0] },
      { ...targets[1], baseSpaceMapping: [{ baseId: 'bseMoved', spaceId: 'spcMoved' }] },
    ];
    const listComputedOutboxMaintenanceAnomalies = vi
      .fn()
      // default target ledger: one healthy entry, one orphan (base migrated to byodb)
      .mockResolvedValueOnce({
        total: 2,
        items: [
          {
            kind: 'dead',
            taskId: 'cuo-kept',
            baseId: 'bse1',
            seedTableId: 'tbl1',
            attempts: 8,
            maxAttempts: 8,
            lastError: 'timeout',
            ...anomalyFields,
            occurredAt: new Date('2026-08-03T13:07:00.000Z'),
          },
          {
            kind: 'dead',
            taskId: 'cuo-orphan-default',
            baseId: 'bseMoved',
            seedTableId: 'tbl2',
            attempts: 8,
            maxAttempts: 8,
            lastError: 'Field not found',
            ...anomalyFields,
            occurredAt: new Date('2026-08-03T13:06:00.000Z'),
          },
        ],
      })
      // byodb target ledger: one orphan (base not in this target's mapping)
      .mockResolvedValueOnce({
        total: 1,
        items: [
          {
            kind: 'dead',
            taskId: 'cuo-orphan-byodb',
            baseId: 'bseElsewhere',
            seedTableId: 'tbl3',
            attempts: 8,
            maxAttempts: 8,
            lastError: 'timeout',
            ...anomalyFields,
            occurredAt: new Date('2026-08-03T13:05:00.000Z'),
          },
        ],
      });
    const service = new ComputedOutboxAnomalyService(
      {
        listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue(mappedTargets),
        listByodbBoundBaseIds: vi.fn().mockResolvedValue([]),
        listComputedOutboxMaintenanceAnomalies,
      } as never,
      createMigrationGuard() as never,
      {} as never
    );

    const result = await service.list(20);

    expect(result.total).toBe(1);
    expect(result.groupTotal).toBe(1);
    expect(result.groups.flatMap((group) => group.items.map((item) => item.taskId))).toEqual([
      'cuo-kept',
    ]);
  });

  it('hides default-storage leftovers when the base still has a disabled BYODB binding', async () => {
    const listComputedOutboxMaintenanceAnomalies = vi.fn().mockResolvedValue({
      total: 1,
      items: [
        {
          kind: 'dead',
          taskId: 'cuo-disabled-byodb',
          baseId: 'bseDisabled',
          seedTableId: 'tbl1',
          attempts: 8,
          maxAttempts: 8,
          lastError: 'statement timeout',
          ...anomalyFields,
          occurredAt: new Date('2026-08-03T13:07:00.000Z'),
        },
      ],
    });
    const service = new ComputedOutboxAnomalyService(
      {
        // Disabled BYODB connections are omitted from the queryable inventory,
        // so this base is absent from every target mapping.
        listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue(targets),
        listByodbBoundBaseIds: vi.fn().mockResolvedValue(['bseDisabled']),
        listComputedOutboxMaintenanceAnomalies,
      } as never,
      createMigrationGuard() as never,
      {} as never
    );

    const result = await service.list(20);

    expect(result.total).toBe(0);
    expect(result.groupTotal).toBe(0);
    expect(result.groups).toEqual([]);
  });

  it('rejects a single recovery from an orphaned storage target after a Base route change', async () => {
    const recoverComputedOutboxMaintenanceAnomaly = vi.fn();
    const service = new ComputedOutboxAnomalyService(
      {
        listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue(targets),
        peekComputedOutboxMaintenanceAnomalyBase: vi.fn().mockResolvedValue('bseMoved'),
        getDataDatabaseForBase: vi.fn().mockResolvedValue(targets[1]),
        recoverComputedOutboxMaintenanceAnomaly,
      } as never,
      createMigrationGuard() as never,
      {} as never
    );
    await expect(
      service.recover({ targetId: 'meta-fallback', taskId: 'cuo-orphan', kind: 'dead' })
    ).rejects.toBeInstanceOf(ConflictException);
    expect(recoverComputedOutboxMaintenanceAnomaly).not.toHaveBeenCalled();
  });

  it('rejects a single recovery when the anomaly row is already gone', async () => {
    const recoverComputedOutboxMaintenanceAnomaly = vi.fn();
    const service = new ComputedOutboxAnomalyService(
      {
        listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue(targets),
        peekComputedOutboxMaintenanceAnomalyBase: vi.fn().mockResolvedValue(null),
        recoverComputedOutboxMaintenanceAnomaly,
      } as never,
      createMigrationGuard() as never,
      {} as never
    );

    await expect(
      service.recover({ targetId: 'meta-fallback', taskId: 'cuo-gone', kind: 'dead' })
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(recoverComputedOutboxMaintenanceAnomaly).not.toHaveBeenCalled();
  });

  it('resolves durable ledger states across storage targets with dead taking priority', async () => {
    const lookupComputedOutboxMaintenanceTaskStates = vi
      .fn()
      .mockResolvedValueOnce(
        new Map([
          ['cuo-1', 'dead'],
          ['cuo-2', 'pending'],
        ])
      )
      .mockResolvedValueOnce(
        new Map([
          ['cuo-2', 'processing'],
          ['cuo-3', 'pending'],
        ])
      );
    const service = new ComputedOutboxAnomalyService(
      {
        listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue(targets),
        lookupComputedOutboxMaintenanceTaskStates,
      } as never,
      createMigrationGuard() as never,
      {} as never
    );

    const states = await service.resolveLedgerStates(['cuo-1', 'cuo-2', 'cuo-3', 'cuo-1']);

    expect(states.get('cuo-1')).toBe('dead');
    expect(states.get('cuo-2')).toBe('processing');
    expect(states.get('cuo-3')).toBe('pending');
    expect(states.has('cuo-missing')).toBe(false);
    expect(lookupComputedOutboxMaintenanceTaskStates).toHaveBeenCalledTimes(2);
    // Duplicate task ids are queried once.
    expect(lookupComputedOutboxMaintenanceTaskStates.mock.calls[0][1]).toEqual([
      'cuo-1',
      'cuo-2',
      'cuo-3',
    ]);
  });

  it('keeps resolving ledger states when one storage target is unreachable', async () => {
    const lookupComputedOutboxMaintenanceTaskStates = vi
      .fn()
      .mockResolvedValueOnce(new Map([['cuo-1', 'pending']]))
      .mockRejectedValueOnce(new Error('connection refused'));
    const service = new ComputedOutboxAnomalyService(
      {
        listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue(targets),
        lookupComputedOutboxMaintenanceTaskStates,
      } as never,
      createMigrationGuard() as never,
      {} as never
    );
    const states = await service.resolveLedgerStates(['cuo-1']);
    expect(states.get('cuo-1')).toBe('pending');
  });

  it('restores a dead letter and publishes a BullMQ wake-up', async () => {
    const publish = vi.fn().mockResolvedValue({ status: 'accepted' });
    const recoverComputedOutboxMaintenanceAnomaly = vi
      .fn()
      .mockResolvedValue({ status: 'recovered', baseId: 'bse1' });
    const service = new ComputedOutboxAnomalyService(
      {
        listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue(targets),
        peekComputedOutboxMaintenanceAnomalyBase: vi.fn().mockResolvedValue('bse1'),
        getDataDatabaseForBase: vi.fn().mockResolvedValue(targets[0]),
        recoverComputedOutboxMaintenanceAnomaly,
      } as never,
      createMigrationGuard() as never,
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

  it('recovers and delivers every task in one exact dead-letter group', async () => {
    const tasks = Array.from({ length: 12 }, (_, index) => ({
      taskId: `cuo-${index.toString().padStart(2, '0')}`,
      baseId: 'bse1',
    }));
    const publish = vi.fn().mockResolvedValue({ status: 'accepted' });
    const recoverComputedOutboxMaintenanceDeadLetterBatch = vi.fn().mockResolvedValue({
      tasks,
      inserted: 11,
      alreadyPending: 1,
    });
    const migrationGuard = createMigrationGuard();
    const service = new ComputedOutboxAnomalyService(
      {
        listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue(targets),
        getDataDatabaseForBase: vi.fn().mockResolvedValue(targets[0]),
        recoverComputedOutboxMaintenanceDeadLetterBatch,
      } as never,
      migrationGuard as never,
      {
        publish,
        runAsConsumer: vi.fn(async (operation: () => Promise<unknown>) => await operation()),
      } as never
    );

    await expect(
      service.recoverDeadLetterBatch({
        targetId: 'meta-fallback',
        baseId: 'bse1',
        seedTableId: 'tbl1',
        errorSignature: 'statement timeout',
      })
    ).resolves.toEqual({
      targetId: 'meta-fallback',
      recovered: 12,
      inserted: 11,
      alreadyPending: 1,
      deliveryAccepted: 12,
      deliveryDeferred: 0,
    });
    expect(recoverComputedOutboxMaintenanceDeadLetterBatch).toHaveBeenCalledWith(targets[0], {
      baseId: 'bse1',
      seedTableId: 'tbl1',
      errorSignature: 'statement timeout',
    });
    expect(publish.mock.calls.map(([wakeup]) => wakeup.taskId)).toEqual(
      tasks.map((task) => task.taskId)
    );
    expect(migrationGuard.assertBaseWritable).toHaveBeenCalledWith('bse1');
  });

  it('discards one exact dead-letter group without any base routing guard', async () => {
    const discardComputedOutboxMaintenanceDeadLetterBatch = vi
      .fn()
      .mockResolvedValue({ discarded: 62 });
    const migrationGuard = createMigrationGuard();
    const getDataDatabaseForBase = vi.fn();
    const service = new ComputedOutboxAnomalyService(
      {
        listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue(targets),
        getDataDatabaseForBase,
        discardComputedOutboxMaintenanceDeadLetterBatch,
      } as never,
      migrationGuard as never,
      {} as never
    );

    await expect(
      service.discardDeadLetterBatch({
        targetId: 'meta-fallback',
        baseId: 'bse1',
        seedTableId: 'tbl1',
        errorSignature: 'statement timeout',
      })
    ).resolves.toEqual({ targetId: 'meta-fallback', discarded: 62 });
    expect(discardComputedOutboxMaintenanceDeadLetterBatch).toHaveBeenCalledWith(targets[0], {
      baseId: 'bse1',
      seedTableId: 'tbl1',
      errorSignature: 'statement timeout',
    });
    // A deleted base resolves to no storage target and must still be discardable.
    expect(migrationGuard.assertBaseWritable).not.toHaveBeenCalled();
    expect(getDataDatabaseForBase).not.toHaveBeenCalled();
  });

  it('rejects a batch discard target outside the current storage inventory', async () => {
    const service = new ComputedOutboxAnomalyService(
      {
        listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue(targets),
      } as never,
      createMigrationGuard() as never,
      {} as never
    );

    await expect(
      service.discardDeadLetterBatch({
        targetId: 'missing',
        baseId: 'bse1',
        seedTableId: 'tbl1',
        errorSignature: 'statement timeout',
      })
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a batch recovery target outside the current storage inventory', async () => {
    const service = new ComputedOutboxAnomalyService(
      {
        listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue(targets),
      } as never,
      createMigrationGuard() as never,
      {} as never
    );

    await expect(
      service.recoverDeadLetterBatch({
        targetId: 'missing',
        baseId: 'bse1',
        seedTableId: 'tbl1',
        errorSignature: 'statement timeout',
      })
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects batch recovery while the Base is moving between data databases', async () => {
    const getDataDatabaseForBase = vi.fn();
    const recoverComputedOutboxMaintenanceDeadLetterBatch = vi.fn();
    const migrationGuard = {
      assertBaseWritable: vi.fn().mockRejectedValue(new ConflictException('migration active')),
    };
    const service = new ComputedOutboxAnomalyService(
      {
        listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue(targets),
        getDataDatabaseForBase,
        recoverComputedOutboxMaintenanceDeadLetterBatch,
      } as never,
      migrationGuard as never,
      {} as never
    );

    await expect(
      service.recoverDeadLetterBatch({
        targetId: 'meta-fallback',
        baseId: 'bse1',
        seedTableId: 'tbl1',
        errorSignature: 'statement timeout',
      })
    ).rejects.toBeInstanceOf(ConflictException);
    expect(getDataDatabaseForBase).not.toHaveBeenCalled();
    expect(recoverComputedOutboxMaintenanceDeadLetterBatch).not.toHaveBeenCalled();
  });

  it('rejects recovery from an orphaned storage target after a Base route change', async () => {
    const recoverComputedOutboxMaintenanceDeadLetterBatch = vi.fn();
    const service = new ComputedOutboxAnomalyService(
      {
        listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue(targets),
        getDataDatabaseForBase: vi.fn().mockResolvedValue(targets[1]),
        recoverComputedOutboxMaintenanceDeadLetterBatch,
      } as never,
      createMigrationGuard() as never,
      {} as never
    );

    await expect(
      service.recoverDeadLetterBatch({
        targetId: 'meta-fallback',
        baseId: 'bse1',
        seedTableId: 'tbl1',
        errorSignature: 'statement timeout',
      })
    ).rejects.toBeInstanceOf(ConflictException);
    expect(recoverComputedOutboxMaintenanceDeadLetterBatch).not.toHaveBeenCalled();
  });

  it('rejects batch recovery when the current data-db binding is not ready', async () => {
    const recoverComputedOutboxMaintenanceDeadLetterBatch = vi.fn();
    const service = new ComputedOutboxAnomalyService(
      {
        listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue(targets),
        getDataDatabaseForBase: vi
          .fn()
          .mockRejectedValue(new DataDbBindingNotReadyError('spcDisabled')),
        recoverComputedOutboxMaintenanceDeadLetterBatch,
      } as never,
      createMigrationGuard() as never,
      {} as never
    );

    await expect(
      service.recoverDeadLetterBatch({
        targetId: 'meta-fallback',
        baseId: 'bse1',
        seedTableId: 'tbl1',
        errorSignature: 'statement timeout',
      })
    ).rejects.toMatchObject({
      message: 'Computed outbox Base data database is not ready',
    });
    await expect(
      service.recoverDeadLetterBatch({
        targetId: 'meta-fallback',
        baseId: 'bse1',
        seedTableId: 'tbl1',
        errorSignature: 'statement timeout',
      })
    ).rejects.toBeInstanceOf(ConflictException);
    expect(recoverComputedOutboxMaintenanceDeadLetterBatch).not.toHaveBeenCalled();
  });

  it('rejects a single recovery when the current data-db binding is not ready', async () => {
    const recoverComputedOutboxMaintenanceAnomaly = vi.fn();
    const service = new ComputedOutboxAnomalyService(
      {
        listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue(targets),
        peekComputedOutboxMaintenanceAnomalyBase: vi.fn().mockResolvedValue('bse1'),
        getDataDatabaseForBase: vi
          .fn()
          .mockRejectedValue(new DataDbBindingNotReadyError('spcDisabled')),
        recoverComputedOutboxMaintenanceAnomaly,
      } as never,
      createMigrationGuard() as never,
      {} as never
    );

    await expect(
      service.recover({ targetId: 'meta-fallback', taskId: 'cuo-1', kind: 'dead' })
    ).rejects.toBeInstanceOf(ConflictException);
    expect(recoverComputedOutboxMaintenanceAnomaly).not.toHaveBeenCalled();
  });

  it('keeps a restored durable task recoverable when immediate BullMQ delivery fails', async () => {
    const service = new ComputedOutboxAnomalyService(
      {
        listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue(targets),
        peekComputedOutboxMaintenanceAnomalyBase: vi.fn().mockResolvedValue('bse1'),
        getDataDatabaseForBase: vi.fn().mockResolvedValue(targets[0]),
        recoverComputedOutboxMaintenanceAnomaly: vi
          .fn()
          .mockResolvedValue({ status: 'recovered', baseId: 'bse1' }),
      } as never,
      createMigrationGuard() as never,
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
      {
        listComputedOutboxMaintenanceTargets,
        peekComputedOutboxMaintenanceAnomalyBase: vi.fn().mockResolvedValue('bse1'),
        getDataDatabaseForBase: vi.fn().mockResolvedValue(targets[0]),
        recoverComputedOutboxMaintenanceAnomaly,
      } as never,
      createMigrationGuard() as never,
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

import { describe, expect, it, vi } from 'vitest';
import { DataDbHealthService } from './data-db-health.service';

const createPrismaMock = (overrides?: {
  connection?: Partial<{
    id: string;
    healthState: string;
    consecutiveHealthFailures: number;
    healthChangedAt: Date | null;
  }>;
  bindingMode?: 'byodb' | 'default';
}) => {
  const connection = {
    id: 'conn1',
    healthState: 'healthy',
    consecutiveHealthFailures: 0,
    ...overrides?.connection,
  };
  return {
    dataDbConnection: {
      findUnique: vi.fn().mockResolvedValue(connection),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue(connection),
    },
    base: {
      findUnique: vi.fn().mockResolvedValue({ spaceId: 'spc1' }),
    },
    spaceDataDbBinding: {
      findUnique: vi.fn().mockResolvedValue({
        mode: overrides?.bindingMode ?? 'byodb',
        dataDbConnection: connection,
      }),
    },
  };
};

describe('DataDbHealthService', () => {
  it('marks a connection read_only on a read-only transaction failure', async () => {
    const prisma = createPrismaMock();
    const service = new DataDbHealthService(prisma as never);

    await service.reportConnectionFailure({
      connectionId: 'conn1',
      message:
        'Outbox transaction failed: error: cannot execute SELECT FOR UPDATE in a read-only transaction',
    });

    expect(prisma.dataDbConnection.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'conn1' },
        data: expect.objectContaining({
          healthState: 'read_only',
          healthChangedAt: expect.any(Date),
        }),
      })
    );
  });

  it('marks a connection read_only when a preflight reports READ_ONLY_DATABASE', async () => {
    const prisma = createPrismaMock();
    const service = new DataDbHealthService(prisma as never);

    await service.reportConnectionFailure({
      connectionId: 'conn1',
      message: 'Data database preflight failed: READ_ONLY_DATABASE',
    });

    expect(prisma.dataDbConnection.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ healthState: 'read_only' }),
      })
    );
  });

  it('marks a connection unreachable on connection-level failures', async () => {
    const prisma = createPrismaMock();
    const service = new DataDbHealthService(prisma as never);

    await service.reportConnectionFailure({
      connectionId: 'conn1',
      message: 'connect ECONNREFUSED 10.0.0.1:5432',
    });

    expect(prisma.dataDbConnection.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ healthState: 'unreachable' }),
      })
    );
  });

  it('only counts unclassified failures until the degraded threshold', async () => {
    const prisma = createPrismaMock();
    const service = new DataDbHealthService(prisma as never);

    await service.reportConnectionFailure({ connectionId: 'conn1', message: 'weird error' });

    expect(prisma.dataDbConnection.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { consecutiveHealthFailures: 1, lastHealthCheckAt: expect.any(Date) },
      })
    );
  });

  it('degrades a connection after repeated unclassified failures', async () => {
    const prisma = createPrismaMock({ connection: { consecutiveHealthFailures: 2 } });
    const service = new DataDbHealthService(prisma as never);

    await service.reportConnectionFailure({ connectionId: 'conn1', message: 'weird error' });

    expect(prisma.dataDbConnection.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          healthState: 'degraded',
          consecutiveHealthFailures: 3,
        }),
      })
    );
  });

  it('restores health and resets the failure streak on recovery', async () => {
    const prisma = createPrismaMock({
      connection: { healthState: 'read_only', consecutiveHealthFailures: 5 },
    });
    const service = new DataDbHealthService(prisma as never);

    await service.reportConnectionRecovered('conn1');

    expect(prisma.dataDbConnection.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          healthState: 'healthy',
          healthReason: null,
          consecutiveHealthFailures: 0,
        }),
      })
    );
  });

  it('resolves the byodb connection for a base and throttles repeat reports', async () => {
    const prisma = createPrismaMock();
    const service = new DataDbHealthService(prisma as never);
    const message = 'cannot execute UPDATE in a read-only transaction';

    await service.reportWriteFailure({ baseId: 'bse1', message });
    await service.reportWriteFailure({ baseId: 'bse1', message });

    expect(prisma.base.findUnique).toHaveBeenCalledTimes(2);
    expect(prisma.dataDbConnection.update).toHaveBeenCalledTimes(1);
    expect(prisma.dataDbConnection.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ healthState: 'read_only' }),
      })
    );
  });

  it('ignores write failures for default-storage bases', async () => {
    const prisma = createPrismaMock({ bindingMode: 'default' });
    const service = new DataDbHealthService(prisma as never);

    await service.reportWriteFailure({ baseId: 'bse1', message: 'read-only transaction' });

    expect(prisma.dataDbConnection.update).not.toHaveBeenCalled();
  });

  it('serves hot-path lookups from cache within the TTL', async () => {
    const prisma = createPrismaMock({ connection: { healthState: 'read_only' } });
    const service = new DataDbHealthService(prisma as never);

    await expect(service.getHealthStateForBase('bse1')).resolves.toBe('read_only');
    await expect(service.getHealthStateForBase('bse1')).resolves.toBe('read_only');

    expect(prisma.base.findUnique).toHaveBeenCalledTimes(1);
  });

  it('reports untracked for default-storage bases and on lookup failure', async () => {
    const defaultPrisma = createPrismaMock({ bindingMode: 'default' });
    const service = new DataDbHealthService(defaultPrisma as never);
    await expect(service.getHealthStateForBase('bse1')).resolves.toBe('untracked');

    const failingPrisma = createPrismaMock();
    failingPrisma.base.findUnique.mockRejectedValue(new Error('meta db down'));
    const failingService = new DataDbHealthService(failingPrisma as never);
    await expect(failingService.getHealthStateForBase('bse1')).resolves.toBe('untracked');
  });

  it('flushes the hot-path cache on a state transition', async () => {
    const prisma = createPrismaMock({ connection: { healthState: 'read_only' } });
    const service = new DataDbHealthService(prisma as never);

    await expect(service.getHealthStateForConnection('conn1')).resolves.toBe('read_only');
    await service.reportConnectionRecovered('conn1');
    prisma.dataDbConnection.findUnique.mockResolvedValue({
      id: 'conn1',
      healthState: 'healthy',
      consecutiveHealthFailures: 0,
    });

    await expect(service.getHealthStateForConnection('conn1')).resolves.toBe('healthy');
  });

  it('never throws from health bookkeeping failures', async () => {
    const prisma = createPrismaMock();
    prisma.dataDbConnection.findUnique.mockRejectedValue(new Error('meta db down'));
    const service = new DataDbHealthService(prisma as never);

    await expect(
      service.reportConnectionFailure({ connectionId: 'conn1', message: 'read-only transaction' })
    ).resolves.toBeUndefined();
  });

  it('returns healthChangedAt on the hot-path snapshot', async () => {
    const changedAt = new Date('2026-01-05T12:00:00Z');
    const prisma = createPrismaMock({
      connection: { healthState: 'read_only', healthChangedAt: changedAt },
    });
    const service = new DataDbHealthService(prisma as never);

    await expect(service.getHealthSnapshotForBase('bse1')).resolves.toEqual({
      state: 'read_only',
      changedAt,
    });
  });

  it('notifies recovered listeners on a transition to healthy', async () => {
    const prisma = createPrismaMock({ connection: { healthState: 'read_only' } });
    const service = new DataDbHealthService(prisma as never);
    const recovered = vi.fn();
    const unsubscribe = service.onRecovered(recovered);

    await service.reportConnectionRecovered('conn1');
    expect(recovered).toHaveBeenCalledOnce();

    unsubscribe();
    await service.reportConnectionRecovered('conn1');
    expect(recovered).toHaveBeenCalledOnce();
  });
});

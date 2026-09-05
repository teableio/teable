import { ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ready: vi.fn(),
  destroy: vi.fn(),
  createDb: vi.fn(),
  table: vi.fn(),
  gauge: vi.fn(),
}));
vi.mock('../../../global/data-db-client-manager.service', () => ({
  DataDbClientManager: class {},
}));
vi.mock('./computed-reliability.metrics', () => ({
  reliabilityReconciliation: { add: vi.fn() },
  setReliabilitySnapshot: mocks.gauge,
}));
vi.mock('../../../cache/cache.service', () => ({ CacheService: class {} }));
vi.mock('../v2-container.service', () => ({ V2ContainerService: class {} }));
vi.mock('knex', () => ({ default: mocks.createDb }));
vi.mock('../../../global/computed-reliability-maintenance', () => ({
  applyComputedReliabilityBaseFilter: (query: unknown) => query,
  isComputedReliabilityReady: mocks.ready,
  reliabilityTable: mocks.table,
}));
import { ComputedReliabilityReconciliationService } from './computed-reliability-reconciliation.service';

const cache = {
  setnx: vi.fn().mockResolvedValue(true),
  setDetail: vi.fn().mockResolvedValue(undefined),
  getMany: vi.fn().mockResolvedValue([]),
};
const target = {
  cacheKey: 'default',
  storage: 'default' as const,
  url: 'postgres://local',
  isMetaFallback: true,
};
beforeEach(() => vi.stubEnv('COMPUTED_RELIABILITY_ENABLED', 'true'));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.clearAllMocks();
});
describe('computation reliability reconciliation', () => {
  it('honors the Base allowlist and never reconciles a Base routed away from default', async () => {
    vi.useFakeTimers();
    vi.stubEnv('COMPUTED_RELIABILITY_ENABLED', 'true');
    vi.stubEnv('COMPUTED_RELIABILITY_BASE_IDS', 'base-allowed');
    const reader = { getByTableId: vi.fn().mockResolvedValue(ok({})) };
    const containers = {
      getContainerForTable: vi.fn().mockResolvedValue({ resolve: () => reader }),
    };
    const service = new ComputedReliabilityReconciliationService(
      {} as never,
      containers as never,
      cache as never
    );
    expect(await service['reconcileCandidate'](target, 'base-denied', 'table', new Set())).toBe(0);
    expect(
      await service['reconcileCandidate'](
        target,
        'base-allowed',
        'table',
        new Set(['base-allowed'])
      )
    ).toBe(0);
    expect(containers.getContainerForTable).not.toHaveBeenCalled();
    expect(await service['reconcileCandidate'](target, 'base-allowed', 'table', new Set())).toBe(1);
    expect(reader.getByTableId).toHaveBeenCalledWith(undefined, 'table', 'base-allowed', {
      budgetMs: 5000,
    });
  });
  it.each([2000, 5000, 6000])(
    'deducts %i ms of routing time before starting the reader',
    async (routingMs) => {
      vi.useFakeTimers();
      vi.setSystemTime(0);
      vi.stubEnv('COMPUTED_RELIABILITY_BASE_IDS', 'base-allowed');
      const reader = { getByTableId: vi.fn().mockResolvedValue(ok({})) };
      const containers = {
        getContainerForTable: vi.fn().mockImplementation(async () => {
          vi.setSystemTime(routingMs);
          return { resolve: () => reader };
        }),
      };
      const service = new ComputedReliabilityReconciliationService(
        {} as never,
        containers as never,
        cache as never
      );
      const result = await service['reconcileCandidate'](
        target,
        'base-allowed',
        'table',
        new Set(),
        5000
      );
      if (routingMs >= 5000) {
        expect(result).toBe(0);
        expect(reader.getByTableId).not.toHaveBeenCalled();
      } else {
        expect(result).toBe(1);
        expect(reader.getByTableId).toHaveBeenCalledWith(undefined, 'table', 'base-allowed', {
          budgetMs: 5000 - routingMs,
        });
      }
    }
  );
  it('starts with a nonempty allowlist, stops timers on shutdown, and honors explicit disable', () => {
    vi.useFakeTimers();
    vi.stubEnv('COMPUTED_RELIABILITY_ENABLED', 'false');
    const service = new ComputedReliabilityReconciliationService(
      {} as never,
      {} as never,
      cache as never
    );
    const run = vi.spyOn(service, 'runOnce').mockResolvedValue(undefined);
    service.onApplicationBootstrap();
    vi.advanceTimersByTime(60000);
    expect(run).not.toHaveBeenCalled();
    vi.stubEnv('COMPUTED_RELIABILITY_ENABLED', 'true');
    vi.stubEnv('COMPUTED_RELIABILITY_RECONCILIATION_ENABLED', 'true');
    vi.stubEnv('COMPUTED_RELIABILITY_BASE_IDS', 'base-allowed');
    service.onApplicationBootstrap();
    vi.advanceTimersByTime(60000);
    expect(run).toHaveBeenCalledTimes(1);
    service.onModuleDestroy();
    vi.advanceTimersByTime(60000);
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('does not overlap sweeps and safely handles unavailable target inventory', async () => {
    let finish!: (targets: []) => void;
    const manager = {
      listComputedOutboxMaintenanceTargets: vi.fn(
        () =>
          new Promise<[]>((resolve) => {
            finish = resolve;
          })
      ),
      listByodbBoundBaseIds: vi.fn().mockResolvedValue([]),
    };
    const service = new ComputedReliabilityReconciliationService(
      manager as never,
      {} as never,
      cache as never
    );
    const first = service.runOnce();
    await service.runOnce();
    expect(manager.listComputedOutboxMaintenanceTargets).toHaveBeenCalledTimes(1);
    finish([]);
    await first;
    manager.listComputedOutboxMaintenanceTargets.mockRejectedValueOnce(new Error('offline'));
    await expect(service.runOnce()).resolves.toBeUndefined();
  });
  it('limits retention selection to closed issues older than 30 days', async () => {
    const query = {
      whereIn: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      forUpdate: vi.fn().mockReturnThis(),
      skipLocked: vi.fn().mockReturnThis(),
      select: vi.fn().mockResolvedValue([]),
      delete: vi.fn(),
    };
    mocks.table.mockReturnValue(query);
    const service = new ComputedReliabilityReconciliationService(
      {} as never,
      {} as never,
      cache as never
    );
    await service['cleanup']({ raw: vi.fn().mockResolvedValue(undefined) } as never, target, []);
    expect(query.whereIn).toHaveBeenCalledWith('status', ['resolved', 'not_applicable']);
    expect(query.where).toHaveBeenCalledWith('closed_at', '<', expect.any(Date));
    const cutoff = query.where.mock.calls[0][2] as Date;
    expect(Date.now() - cutoff.getTime()).toBeGreaterThanOrEqual(30 * 86400000);
    expect(query.limit).toHaveBeenCalledWith(100);
    expect(query.delete).not.toHaveBeenCalled();
  });

  it('runs retention with reconciliation disabled', async () => {
    vi.stubEnv('COMPUTED_RELIABILITY_RECONCILIATION_ENABLED', 'false');
    mocks.ready.mockResolvedValue(true);
    const trx = { raw: vi.fn().mockResolvedValue({ rows: [{ acquired: true }] }) };
    mocks.createDb.mockReturnValue({
      transaction: async (callback: (trx: unknown) => Promise<unknown>) => callback(trx),
      destroy: mocks.destroy,
    });
    const service = new ComputedReliabilityReconciliationService(
      {
        listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue([target]),
        listByodbBoundBaseIds: vi.fn().mockResolvedValue([]),
      } as never,
      {} as never,
      cache as never
    );
    const cleanup = vi.fn().mockResolvedValue(undefined);
    service['cleanup'] = cleanup;
    service['snapshot'] = async () => ({ count: 0, oldestAt: null });
    await service.runOnce();
    expect(cleanup).toHaveBeenCalledWith(trx, target, [], expect.any(Number));
  });

  it('skips an unmigrated or unreachable database and closes its client', async () => {
    mocks.destroy.mockResolvedValue(undefined);
    mocks.createDb.mockReturnValue({
      transaction: async (callback: (trx: unknown) => Promise<unknown>) =>
        callback({ raw: vi.fn().mockResolvedValue(undefined) }),
      destroy: mocks.destroy,
    });
    mocks.ready.mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('offline'));
    const manager = {
      listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue([target]),
      listByodbBoundBaseIds: vi.fn().mockResolvedValue([]),
    };
    const containers = { getContainerForTable: vi.fn() };
    const service = new ComputedReliabilityReconciliationService(
      manager as never,
      containers as never,
      cache as never
    );
    await service.runOnce();
    await service.runOnce();
    expect(containers.getContainerForTable).not.toHaveBeenCalled();
    expect(mocks.destroy).toHaveBeenCalledTimes(2);
  });
  it('paces staggered instances until TTL expiry and fails closed when cache is unavailable', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const claims = new Map<string, number>();
    const shared = {
      setnx: vi.fn(async (key: string, _value: string, ttl: number) => {
        if ((claims.get(key) ?? -1) > Date.now()) return false;
        claims.set(key, Date.now() + ttl * 1000);
        return true;
      }),
    };
    const trx = { raw: vi.fn().mockResolvedValue({ rows: [{ acquired: true }] }) };
    mocks.createDb.mockReturnValue({
      transaction: async (fn: (db: unknown) => Promise<unknown>) => fn(trx),
      destroy: mocks.destroy,
    });
    mocks.ready.mockResolvedValue(false);
    const first = new ComputedReliabilityReconciliationService(
      {} as never,
      {} as never,
      shared as never
    );
    const second = new ComputedReliabilityReconciliationService(
      {} as never,
      {} as never,
      shared as never
    );
    await first['maintainTarget'](target, []);
    vi.setSystemTime(30_000);
    await second['maintainTarget'](target, []);
    expect(mocks.createDb).toHaveBeenCalledTimes(1);
    vi.setSystemTime(60_000);
    await second['maintainTarget'](target, []);
    expect(mocks.createDb).toHaveBeenCalledTimes(2);
    shared.setnx.mockRejectedValueOnce(new Error('cache unavailable'));
    await first['maintainTarget'](target, []);
    expect(mocks.createDb).toHaveBeenCalledTimes(2);
  });

  it('sets readiness SQL budget before the query and stops after readiness consumes it', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const trx = { raw: vi.fn().mockResolvedValue({ rows: [{ acquired: true }] }) };
    mocks.createDb.mockReturnValue({
      transaction: async (fn: (db: unknown) => Promise<unknown>) => fn(trx),
      destroy: mocks.destroy,
    });
    mocks.ready.mockImplementationOnce(async () => {
      expect(trx.raw).toHaveBeenCalledWith("select set_config('statement_timeout', ?, true)", [
        '5000',
      ]);
      vi.setSystemTime(5000);
      return true;
    });
    const service = new ComputedReliabilityReconciliationService(
      {} as never,
      {} as never,
      cache as never
    );
    const cleanup = vi.fn().mockResolvedValue(undefined);
    service['cleanup'] = cleanup;
    await service['maintainTarget'](target, []);
    expect(cleanup).not.toHaveBeenCalled();
    expect(trx.raw).toHaveBeenCalledTimes(1);
  });

  it('rotates past slow targets and caps each sweep at ten targets', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const targets = Array.from({ length: 12 }, (_, index) => ({
      ...target,
      cacheKey: String(index),
    }));
    const manager = {
      listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue(targets),
      listByodbBoundBaseIds: vi.fn().mockResolvedValue([]),
    };
    const service = new ComputedReliabilityReconciliationService(
      manager as never,
      {} as never,
      cache as never
    );
    const visited: string[] = [];
    service['maintainTarget'] = async (candidate) => {
      visited.push(candidate.cacheKey);
      vi.setSystemTime(Date.now() + 5000);
    };
    await service.runOnce();
    expect(visited).toEqual(['0', '1', '2', '3']);
    await service.runOnce();
    expect(visited.slice(4)).toEqual(['4', '5', '6', '7']);
    service['maintainTarget'] = async (candidate) => {
      visited.push(candidate.cacheKey);
    };
    await service.runOnce();
    expect(visited.slice(8)).toHaveLength(10);
    expect(visited[8]).toBe('8');
  });

  it('commits maintenance before independently limited metrics fail', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.stubEnv('COMPUTED_RELIABILITY_RECONCILIATION_ENABLED', 'true');
    const events: string[] = [];
    const trx = { raw: vi.fn().mockResolvedValue({ rows: [{ acquired: true }] }) };
    mocks.createDb.mockReturnValue({
      transaction: async (fn: (db: unknown) => Promise<unknown>) => {
        try {
          const result = await fn(trx);
          events.push('commit');
          return result;
        } catch (error) {
          events.push('rollback');
          throw error;
        }
      },
      destroy: mocks.destroy,
    });
    mocks.ready.mockResolvedValue(true);
    const service = new ComputedReliabilityReconciliationService(
      {} as never,
      {} as never,
      cache as never
    );
    service['cleanup'] = async () => {
      events.push('cleanup');
    };
    service['reconcileTables'] = async () => {
      events.push('reconcile');
    };
    service['snapshot'] = async () => {
      events.push('metrics');
      throw new Error('statement timeout');
    };
    await service['maintainTarget'](target, []);
    expect(events).toEqual(['cleanup', 'reconcile', 'commit', 'metrics', 'rollback']);
    expect(trx.raw).toHaveBeenCalledWith("select set_config('statement_timeout', ?, true)", [
      '1000',
    ]);
  });
  it('starts automatically with unset master configuration', () => {
    vi.useFakeTimers();
    vi.stubEnv('COMPUTED_RELIABILITY_ENABLED', undefined);
    const service = new ComputedReliabilityReconciliationService(
      {} as never,
      {} as never,
      cache as never
    );
    const run = vi.spyOn(service, 'runOnce').mockResolvedValue(undefined);
    service.onApplicationBootstrap();
    vi.advanceTimersByTime(60_000);
    expect(run).toHaveBeenCalledTimes(1);
    service.onModuleDestroy();
  });

  it('shares a sample across pods despite maintenance pacing and rejects expired or missing snapshots', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const values = new Map<string, unknown>();
    const shared = {
      setnx: vi.fn(async (key: string) => key.includes(':metrics:')),
      setDetail: vi.fn(async (key: string, value: unknown) => {
        values.set(key, value);
      }),
      getMany: vi.fn(async (keys: string[]) => keys.map((key) => values.get(key))),
    };
    const trx = { raw: vi.fn().mockResolvedValue({ rows: [{ acquired: true }] }) };
    mocks.createDb.mockReturnValue({
      transaction: async (fn: (db: unknown) => Promise<unknown>) => fn(trx),
      destroy: mocks.destroy,
    });
    mocks.ready.mockResolvedValue(true);
    const manager = {
      listComputedOutboxMaintenanceTargets: vi.fn().mockResolvedValue([target]),
      listByodbBoundBaseIds: vi.fn().mockResolvedValue([]),
    };
    const first = new ComputedReliabilityReconciliationService(
      manager as never,
      {} as never,
      shared as never
    );
    first['snapshot'] = async () => ({ count: 7, oldestAt: 1000 });
    await first.runOnce();
    expect(shared.setDetail).toHaveBeenCalledWith(
      expect.any(String),
      { count: 7, oldestAt: 1000, sampledAt: 10000 },
      330
    );
    expect(mocks.gauge).toHaveBeenLastCalledWith(7, 9000);
    shared.setnx.mockResolvedValue(false);
    const second = new ComputedReliabilityReconciliationService(
      manager as never,
      {} as never,
      shared as never
    );
    vi.setSystemTime(20_000);
    await second.runOnce();
    expect(mocks.gauge).toHaveBeenLastCalledWith(7, 19000);
    expect(mocks.createDb).toHaveBeenCalledTimes(1);
    vi.setSystemTime(340_000);
    await second.runOnce();
    expect(mocks.gauge).toHaveBeenLastCalledWith(undefined, undefined);
    values.clear();
    await second.runOnce();
    expect(mocks.gauge).toHaveBeenLastCalledWith(undefined, undefined);
  });
  it('does not reserve the sampling lease when maintenance exhausts the budget', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let maintenanceClaimed = false;
    const shared = {
      setnx: vi.fn(async (key: string) => {
        if (key.includes(':metrics:')) return true;
        if (maintenanceClaimed) return false;
        maintenanceClaimed = true;
        return true;
      }),
      setDetail: vi.fn().mockResolvedValue(undefined),
    };
    const trx = { raw: vi.fn().mockResolvedValue({ rows: [{ acquired: true }] }) };
    mocks.createDb.mockReturnValue({
      transaction: async (fn: (db: unknown) => Promise<unknown>) => fn(trx),
      destroy: mocks.destroy,
    });
    mocks.ready.mockResolvedValue(true);
    const service = new ComputedReliabilityReconciliationService(
      {} as never,
      {} as never,
      shared as never
    );
    service['cleanup'] = async () => {
      vi.setSystemTime(5000);
    };
    const sample = vi.fn().mockResolvedValue({ count: 1, oldestAt: 0 });
    service['snapshot'] = sample;
    await service['maintainTarget'](target, []);
    expect(shared.setnx.mock.calls.filter(([key]) => key.includes(':metrics:'))).toHaveLength(0);
    expect(sample).not.toHaveBeenCalled();
    // A staggered pod/next visit can claim and sample immediately; no unused five-minute lease.
    await service['maintainTarget'](target, []);
    expect(shared.setnx.mock.calls.filter(([key]) => key.includes(':metrics:'))).toHaveLength(1);
    expect(sample).toHaveBeenCalledTimes(1);
    expect(shared.setDetail).toHaveBeenCalledTimes(1);
  });
});

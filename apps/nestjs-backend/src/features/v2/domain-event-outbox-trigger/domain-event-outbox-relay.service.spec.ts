import { createV2PostgresDb } from '@teable/v2-adapter-db-postgres-pg';
import type * as PgAdapter from '@teable/v2-adapter-db-postgres-pg';
import type * as TableRepositoryAdapter from '@teable/v2-adapter-table-repository-postgres';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IComputedOutboxMaintenanceTarget } from '../../../global/data-db-client-manager.service';
import { DomainEventOutboxRelayService } from './domain-event-outbox-relay.service';

vi.mock('../v2-container.service', () => ({ V2ContainerService: vi.fn() }));

vi.mock('@teable/v2-adapter-db-postgres-pg', async (importOriginal) => ({
  ...(await importOriginal<typeof PgAdapter>()),
  createV2PostgresDb: vi.fn(),
}));

vi.mock('@teable/v2-adapter-table-repository-postgres', async (importOriginal) => ({
  ...(await importOriginal<typeof TableRepositoryAdapter>()),
  DomainEventOutboxWorker: class {
    constructor(private readonly db: { maintain: () => Promise<unknown> }) {}

    maintainOnce() {
      return this.db.maintain();
    }
  },
}));

const targets: IComputedOutboxMaintenanceTarget[] = [
  {
    cacheKey: 'meta-fallback',
    url: 'postgresql://localhost/meta',
    isMetaFallback: true,
    storage: 'default',
  },
  {
    cacheKey: 'conn_byodb',
    url: 'postgresql://localhost/byodb',
    isMetaFallback: false,
    storage: 'byodb',
  },
];

const createAdmissionCache = () => {
  const expiresAt = new Map<string, number>();
  return {
    setnx: vi.fn(async (key: string, _value: string, ttl: number) => {
      if ((expiresAt.get(key) ?? 0) > Date.now()) return false;
      expiresAt.set(key, Date.now() + ttl * 1000);
      return true;
    }),
    del: vi.fn(async (key: string) => expiresAt.delete(key)),
  };
};

const services: DomainEventOutboxRelayService[] = [];

const createRelay = (cache = createAdmissionCache()) => {
  const deliveries: string[] = [];
  const maintenance: string[] = [];
  const poll = vi.fn(async (target: IComputedOutboxMaintenanceTarget) => {
    deliveries.push(target.cacheKey);
    return ok(1);
  });
  const maintain = vi.fn(async (target: IComputedOutboxMaintenanceTarget) => {
    maintenance.push(target.cacheKey);
    return ok({ reconciled: 1, purged: 1 });
  });
  const getContainerForMaintenanceTarget = vi.fn(
    async (target: IComputedOutboxMaintenanceTarget) => ({
      resolve: () => ({ pollOnce: () => poll(target) }),
    })
  );
  const resources: Array<{ destroyed: boolean; released: boolean }> = [];
  const acquire = vi.fn((connectionString: string) => {
    const target = targets.find((candidate) => candidate.url === connectionString)!;
    const resource = { destroyed: false, released: false };
    resources.push(resource);
    return {
      pool: {
        maintain: () => maintain(target),
        destroy: async () => {
          resource.destroyed = true;
        },
      },
      release: async () => {
        resource.released = true;
      },
    };
  });
  vi.mocked(createV2PostgresDb).mockImplementation(async (_config, dependencies) => {
    return dependencies?.pool as never;
  });
  const listComputedOutboxMaintenanceTargets = vi.fn(async () => targets);
  const peekDueDomainEventWork = vi.fn(async (_target: IComputedOutboxMaintenanceTarget) => false);
  const service = new DomainEventOutboxRelayService(
    { getContainerForMaintenanceTarget } as never,
    { listComputedOutboxMaintenanceTargets, peekDueDomainEventWork } as never,
    cache as never,
    { acquire } as never,
    {} as never
  );
  services.push(service);
  return {
    service,
    deliveries,
    maintenance,
    poll,
    maintain,
    cache,
    acquire,
    resources,
    getContainerForMaintenanceTarget,
    listComputedOutboxMaintenanceTargets,
    peekDueDomainEventWork,
  };
};

describe('DomainEventOutboxRelayService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-17T00:00:00Z'));
  });

  afterEach(() => {
    for (const service of services.splice(0)) service.onModuleDestroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('delivers only due targets without opening idle containers', async () => {
    const relay = createRelay();
    relay.peekDueDomainEventWork.mockImplementation(async (target) => target === targets[0]);
    relay.service.onModuleInit();

    await vi.advanceTimersByTimeAsync(5_000);

    expect(relay.deliveries).toEqual(['meta-fallback']);
    expect(relay.getContainerForMaintenanceTarget).not.toHaveBeenCalledWith(targets[1]);
    expect(relay.maintenance).toEqual([]);
  });

  it('does not overlap delivery scans and resumes after the pending scan completes', async () => {
    const relay = createRelay();
    let releasePeek!: (due: boolean) => void;
    relay.peekDueDomainEventWork
      .mockImplementation(async () => true)
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            releasePeek = resolve;
          })
      );
    relay.service.onModuleInit();

    await vi.advanceTimersByTimeAsync(15_000);
    expect(relay.deliveries).toEqual([]);
    releasePeek(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(relay.deliveries).toEqual(['meta-fallback', 'conn_byodb']);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(relay.deliveries).toEqual([
      'meta-fallback',
      'conn_byodb',
      'meta-fallback',
      'conn_byodb',
    ]);
  });

  it('maintains every idle target only on the first sixty-second tick', async () => {
    const relay = createRelay();
    relay.service.onModuleInit();

    await vi.advanceTimersByTimeAsync(59_999);
    expect(relay.maintenance).toEqual([]);
    expect(relay.getContainerForMaintenanceTarget).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(relay.maintenance).toEqual(['meta-fallback', 'conn_byodb']);
    expect(relay.deliveries).toEqual([]);
    expect(relay.resources).toEqual([
      { destroyed: true, released: true },
      { destroyed: true, released: true },
    ]);
  });

  it.each(['success', 'result failure', 'thrown failure', 'SQL lock contention'])(
    'retains shared pacing until expiry after %s, including when the owner shuts down',
    async (outcome) => {
      const cache = createAdmissionCache();
      const first = createRelay(cache);
      const second = createRelay(cache);
      if (outcome === 'result failure') {
        first.maintain.mockResolvedValue(err({ code: 'domain_event.purge_failed' }) as never);
      } else if (outcome === 'thrown failure') {
        first.maintain.mockRejectedValue(new Error('maintenance failed'));
      } else if (outcome === 'SQL lock contention') {
        first.maintain.mockResolvedValue(ok({ reconciled: 0, purged: 0 }));
      }
      first.service.onModuleInit();
      await vi.advanceTimersByTimeAsync(30_000);
      second.service.onModuleInit();

      await vi.advanceTimersByTimeAsync(30_000);
      first.service.onModuleDestroy();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(second.maintenance).toEqual([]);
      expect(second.getContainerForMaintenanceTarget).not.toHaveBeenCalled();
      expect(second.resources).toEqual([]);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(second.maintenance).toEqual(['meta-fallback', 'conn_byodb']);
    }
  );

  it('admits one of two simultaneous instances per target and admits again at TTL expiry', async () => {
    const cache = createAdmissionCache();
    const first = createRelay(cache);
    const second = createRelay(cache);
    first.service.onModuleInit();
    second.service.onModuleInit();

    await vi.advanceTimersByTimeAsync(60_000);
    expect([...first.maintenance, ...second.maintenance].sort()).toEqual([
      'conn_byodb',
      'meta-fallback',
    ]);
    await vi.advanceTimersByTimeAsync(59_999);
    expect([...first.maintenance, ...second.maintenance].sort()).toEqual([
      'conn_byodb',
      'meta-fallback',
    ]);
    await vi.advanceTimersByTimeAsync(1);
    expect([...first.maintenance, ...second.maintenance].sort()).toEqual([
      'conn_byodb',
      'conn_byodb',
      'meta-fallback',
      'meta-fallback',
    ]);
  });

  it('continues delivery while maintenance is pending without overlapping maintenance ticks', async () => {
    const relay = createRelay();
    let releaseMaintenance!: () => void;
    relay.maintain.mockImplementationOnce(async (target) => {
      await new Promise<void>((resolve) => {
        releaseMaintenance = resolve;
      });
      relay.maintenance.push(target.cacheKey);
      return ok({ reconciled: 1, purged: 1 });
    });
    relay.service.onModuleInit();
    await vi.advanceTimersByTimeAsync(60_000);
    relay.peekDueDomainEventWork.mockResolvedValue(true);

    await vi.advanceTimersByTimeAsync(65_000);
    expect(relay.deliveries.filter((key) => key === 'meta-fallback')).toHaveLength(13);
    expect(relay.deliveries.filter((key) => key === 'conn_byodb')).toHaveLength(13);
    expect(relay.maintenance).toEqual([]);

    releaseMaintenance();
    await vi.advanceTimersByTimeAsync(0);
    expect(relay.maintenance).toEqual(['meta-fallback', 'conn_byodb']);
  });

  it('does not delay maintenance behind a pending delivery scan', async () => {
    const relay = createRelay();
    let releasePeek!: (due: boolean) => void;
    relay.peekDueDomainEventWork.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          releasePeek = resolve;
        })
    );
    relay.service.onModuleInit();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(relay.maintenance).toEqual(['meta-fallback', 'conn_byodb']);
    expect(relay.deliveries).toEqual([]);
    releasePeek(false);
    await vi.advanceTimersByTimeAsync(0);
  });

  it('fails closed on cache errors without starving other targets or delivery', async () => {
    const relay = createRelay();
    relay.cache.setnx.mockRejectedValueOnce(new Error('cache unavailable'));
    relay.service.onModuleInit();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(relay.maintenance).toEqual(['conn_byodb']);
    expect(relay.getContainerForMaintenanceTarget).not.toHaveBeenCalledWith(targets[0]);

    relay.peekDueDomainEventWork.mockResolvedValue(true);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(relay.deliveries).toEqual(['meta-fallback', 'conn_byodb']);
    await vi.advanceTimersByTimeAsync(55_000);
    expect(relay.maintenance).toEqual(['conn_byodb', 'meta-fallback', 'conn_byodb']);
  });

  it.each(['connection failure', 'worker exception', 'error result'])(
    'continues to the next target after a maintenance %s',
    async (failure) => {
      const relay = createRelay();
      if (failure === 'connection failure') {
        relay.acquire.mockImplementationOnce(() => {
          throw new Error('unavailable');
        });
      } else if (failure === 'worker exception') {
        relay.maintain.mockRejectedValueOnce(new Error('SQL failed'));
      } else {
        relay.maintain.mockResolvedValueOnce(
          err({ code: 'domain_event.reconcile_failed' }) as never
        );
      }
      relay.service.onModuleInit();

      await vi.advanceTimersByTimeAsync(60_000);
      expect(relay.maintenance).toEqual(['conn_byodb']);
      expect(relay.resources.every((resource) => resource.destroyed && resource.released)).toBe(
        true
      );
      await vi.advanceTimersByTimeAsync(60_000);
      expect(relay.maintenance).toEqual(['conn_byodb', 'meta-fallback', 'conn_byodb']);
    }
  );

  it('releases the acquired pool when database construction fails and continues maintenance', async () => {
    const relay = createRelay();
    vi.mocked(createV2PostgresDb).mockRejectedValueOnce(new Error('database setup failed'));
    relay.service.onModuleInit();

    await vi.advanceTimersByTimeAsync(60_000);

    expect(relay.maintenance).toEqual(['conn_byodb']);
    expect(relay.resources).toEqual([
      { destroyed: false, released: true },
      { destroyed: true, released: true },
    ]);
  });

  it('releases the maintenance guard after target enumeration fails', async () => {
    const relay = createRelay();
    relay.service.onModuleInit();
    await vi.advanceTimersByTimeAsync(59_000);
    // Both independent timers enumerate at sixty seconds.
    relay.listComputedOutboxMaintenanceTargets
      .mockRejectedValueOnce(new Error('inventory unavailable'))
      .mockRejectedValueOnce(new Error('inventory unavailable'));

    await vi.advanceTimersByTimeAsync(1_000);
    expect(relay.maintenance).toEqual([]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(relay.maintenance).toEqual(['meta-fallback', 'conn_byodb']);
  });

  it('stops both timers at teardown', async () => {
    const relay = createRelay();
    relay.peekDueDomainEventWork.mockResolvedValue(true);
    relay.service.onModuleInit();
    await vi.advanceTimersByTimeAsync(60_000);
    const delivered = [...relay.deliveries];
    const maintained = [...relay.maintenance];

    relay.service.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(120_000);

    expect(relay.deliveries).toEqual(delivered);
    expect(relay.maintenance).toEqual(maintained);
  });
});

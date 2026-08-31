/* eslint-disable @typescript-eslint/naming-convention */
import type { Meter, ObservableCallback, ObservableGauge } from '@opentelemetry/api';
import { metrics } from '@opentelemetry/api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseClientPoolMetrics } from './database-client-pool.metrics';

describe('DatabaseClientPoolMetrics', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reports process-owned pool totals, usage, limits, waiters, and sharing references', () => {
    const callbacks = new Map<string, ObservableCallback>();
    const gauges = new Map<string, Pick<ObservableGauge, 'removeCallback'>>();
    const createObservableGauge = vi.fn((name: string) => {
      const gauge = {
        addCallback: vi.fn((callback: ObservableCallback) => callbacks.set(name, callback)),
        removeCallback: vi.fn(),
      };
      gauges.set(name, gauge);
      return gauge;
    });
    vi.spyOn(metrics, 'getMeter').mockReturnValue({ createObservableGauge } as unknown as Meter);
    const registry = {
      snapshot: vi.fn().mockReturnValue([
        {
          applicationName: 'teable-table-query-observation',
          database: 'teable',
          host: 'db.example.com',
          idle: 3,
          max: 12,
          port: 5432,
          poolName: 'table-query-observation',
          references: 4,
          total: 8,
          waiting: 2,
        },
      ]),
    };
    const service = new DatabaseClientPoolMetrics(registry as never);
    const observe = vi.fn();

    callbacks.get('teable.database.client.pool.connections')?.({ observe } as never);
    callbacks.get('teable.database.client.pool.waiting')?.({ observe } as never);
    callbacks.get('teable.database.client.pool.limit')?.({ observe } as never);
    callbacks.get('teable.database.client.pool.references')?.({ observe } as never);

    expect(observe).toHaveBeenCalledWith(
      8,
      expect.objectContaining({
        'db.client.application.name': 'teable-table-query-observation',
        'db.namespace': 'teable',
        'teable.database.pool.name': 'table-query-observation',
        state: 'total',
      })
    );
    expect(observe).toHaveBeenCalledWith(3, expect.objectContaining({ state: 'idle' }));
    expect(observe).toHaveBeenCalledWith(5, expect.objectContaining({ state: 'active' }));
    expect(observe).toHaveBeenCalledWith(
      2,
      expect.not.objectContaining({ state: expect.anything() })
    );
    expect(observe).toHaveBeenCalledWith(12, expect.any(Object));
    expect(observe).toHaveBeenCalledWith(4, expect.any(Object));

    service.onModuleDestroy();
    gauges.forEach((gauge) => expect(gauge.removeCallback).toHaveBeenCalledOnce());
  });
});

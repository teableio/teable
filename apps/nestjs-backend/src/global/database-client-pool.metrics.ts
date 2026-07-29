import type { OnModuleDestroy } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { ObservableCallback, ObservableGauge } from '@opentelemetry/api';
import { metrics } from '@opentelemetry/api';
import { PgPoolRegistry } from '@teable/db-main-prisma';

@Injectable()
export class DatabaseClientPoolMetrics implements OnModuleDestroy {
  private readonly registrations: Array<{
    callback: ObservableCallback;
    gauge: ObservableGauge;
  }> = [];
  private readonly meter = metrics.getMeter('teable-observability');

  constructor(private readonly registry: PgPoolRegistry) {
    this.registerConnections();
    this.registerGauge(
      'teable.database.client.pool.waiting',
      'Requests waiting for a process-owned PostgreSQL pool connection',
      (snapshot) => snapshot.waiting
    );
    this.registerGauge(
      'teable.database.client.pool.limit',
      'Configured maximum connections for a process-owned PostgreSQL pool',
      (snapshot) => snapshot.max
    );
    this.registerGauge(
      'teable.database.client.pool.references',
      'Runtime clients sharing a process-owned PostgreSQL pool',
      (snapshot) => snapshot.references
    );
  }

  onModuleDestroy(): void {
    for (const { callback, gauge } of this.registrations) {
      gauge.removeCallback(callback);
    }
    this.registrations.length = 0;
  }

  private registerConnections(): void {
    const gauge = this.meter.createObservableGauge('teable.database.client.pool.connections', {
      description: 'Process-owned PostgreSQL pool connections by state',
    });
    const callback: ObservableCallback = (observer) => {
      for (const snapshot of this.registry.snapshot()) {
        const attributes = this.attributes(snapshot);
        observer.observe(snapshot.total, { ...attributes, state: 'total' });
        observer.observe(snapshot.idle, { ...attributes, state: 'idle' });
        observer.observe(Math.max(0, snapshot.total - snapshot.idle), {
          ...attributes,
          state: 'active',
        });
      }
    };
    gauge.addCallback(callback);
    this.registrations.push({ callback, gauge });
  }

  private registerGauge(
    name: string,
    description: string,
    read: (snapshot: ReturnType<PgPoolRegistry['snapshot']>[number]) => number
  ): void {
    const gauge = this.meter.createObservableGauge(name, { description });
    const callback: ObservableCallback = (observer) => {
      for (const snapshot of this.registry.snapshot()) {
        observer.observe(read(snapshot), this.attributes(snapshot));
      }
    };
    gauge.addCallback(callback);
    this.registrations.push({ callback, gauge });
  }

  private attributes(snapshot: ReturnType<PgPoolRegistry['snapshot']>[number]) {
    return {
      'db.namespace': snapshot.database,
      'server.address': snapshot.host,
      ...(snapshot.port ? { 'server.port': snapshot.port } : {}),
    };
  }
}

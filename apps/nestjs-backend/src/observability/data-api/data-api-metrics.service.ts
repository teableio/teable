import type { OnModuleDestroy } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { ObservableCallback } from '@opentelemetry/api';
import { metrics } from '@opentelemetry/api';

export type DataApiOperation =
  | 'list'
  | 'get'
  | 'create'
  | 'update'
  | 'update_many'
  | 'delete'
  | 'delete_many'
  | 'form_submit'
  | 'duplicate';
export type DataApiImplementation = 'v1' | 'v2' | 'unknown';
export type DataApiOutcome =
  | 'success'
  | 'not_modified'
  | 'server_error'
  | 'client_error'
  | 'throttled'
  | 'aborted'
  | 'unexpected';

/**
 * Unsampled HTTP observations, not transaction receipts or proof of durable storage.
 * At most 9 operations x 3 implementations x 7 outcomes for the completion counter.
 * not_modified (304) is a served read, not a failure, and shares the latency histogram
 * with success: Express completes the handler, the body and its ETag before it decides
 * freshness, so the work is the same and dropping 304 would bias the tail optimistic.
 * Only 2xx and 304 have a latency histogram (7 finite buckets); no IDs, URLs, raw status
 * codes or error messages are metric attributes. Statuses no outcome explains (1xx and
 * 3xx other than 304) additionally bump teable.data_api.request.off_contract with a
 * bounded http_status, so `unexpected` stays diagnosable without a status dimension on
 * the completion counter. Including started, active and heartbeat, budget <600
 * series/pod (~26M samples/month at 60s export). Keep per-pod resource identity so
 * cumulative counters do not merge across writers.
 */
@Injectable()
export class DataApiMetricsService implements OnModuleDestroy {
  private readonly meter = metrics.getMeter('teable-observability');
  private readonly started = this.meter.createCounter('teable.data_api.request.started');
  private readonly completed = this.meter.createCounter('teable.data_api.request.completed');
  private readonly active = this.meter.createUpDownCounter('teable.data_api.request.active');
  private readonly duration = this.meter.createHistogram('teable.data_api.request.duration', {
    description: '2xx and 304 record HTTP response duration, from middleware entry to finish',
    unit: 'ms',
    advice: { explicitBucketBoundaries: [25, 100, 250, 500, 1000, 2000, 5000] },
  });
  private readonly offContract = this.meter.createCounter('teable.data_api.request.off_contract', {
    description:
      'Record API responses no contract outcome explains: 1xx and 3xx other than 304 (subset of outcome=unexpected)',
  });
  private readonly observerUp = this.meter.createObservableGauge('teable.data_api.observer.up', {
    description: 'Observer is registered; not a database health check',
  });
  private readonly observeUp: ObservableCallback = (observer) => observer.observe(1);

  constructor() {
    this.observerUp.addCallback(this.observeUp);
  }

  onModuleDestroy(): void {
    this.observerUp.removeCallback(this.observeUp);
  }

  recordStart(operation: DataApiOperation): void {
    this.started.add(1, { operation });
    this.active.add(1, { operation });
  }

  recordEnd(
    operation: DataApiOperation,
    implementation: DataApiImplementation,
    outcome: DataApiOutcome,
    durationMs: number
  ): void {
    this.active.add(-1, { operation });
    this.completed.add(1, { operation, implementation, outcome });
    if (outcome === 'success' || outcome === 'not_modified') {
      this.duration.record(durationMs, { operation, implementation });
    }
  }

  /**
   * A diagnostic subset of outcome=unexpected, never a count of its own: sum(off_contract)
   * <= completed{outcome="unexpected"}. The status arrives already bounded by the observer.
   */
  recordOffContract(
    operation: DataApiOperation,
    implementation: DataApiImplementation,
    httpStatus: string
  ): void {
    this.offContract.add(1, { operation, implementation, http_status: httpStatus });
  }
}

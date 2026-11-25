import { Injectable } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';

export type PeriodicRefreshMetricTrigger = 'manual' | 'scheduled' | 'lazy';

export type PeriodicRefreshMetricOutcome =
  | 'refreshed'
  | 'queued'
  | 'skipped_unchanged'
  | 'skipped_db_unhealthy'
  | 'deduped'
  | 'unsupported'
  | 'failed';

export type PeriodicRefreshMetricMode = 'sync' | 'async' | 'none';

export type PeriodicRefreshConfigOutcome = 'ok' | 'denied' | 'unsupported';

/**
 * Bounded-cardinality OpenTelemetry metrics for manual, scheduled, and lazy field refreshes.
 * Labels are strictly restricted to closed enums (never fieldId, tableId, baseId, or spaceId).
 */
@Injectable()
export class PeriodicRefreshMetricsService {
  private readonly meter = metrics.getMeter('teable-observability');

  private static readonly durationBucketsMs = [50, 200, 1000, 5000, 15000, 60000];

  private readonly runsTotal = this.meter.createCounter('periodic_refresh.runs.total', {
    description: 'Total field periodic refresh attempts, by trigger, outcome, and execution mode',
  });

  private readonly runDurationMs = this.meter.createHistogram('periodic_refresh.duration_ms', {
    description: 'Wall-clock duration of field periodic refresh executions in milliseconds',
    unit: 'ms',
    advice: { explicitBucketBoundaries: PeriodicRefreshMetricsService.durationBucketsMs },
  });

  private readonly configUpdatesTotal = this.meter.createCounter(
    'periodic_refresh.config_updates.total',
    {
      description: 'Total updates to field auto-refresh configuration, by enabled flag and outcome',
    }
  );

  recordRun(params: {
    trigger: PeriodicRefreshMetricTrigger;
    outcome: PeriodicRefreshMetricOutcome;
    mode: PeriodicRefreshMetricMode;
    durationMs: number;
  }): void {
    const attributes = {
      trigger: params.trigger,
      outcome: params.outcome,
      mode: params.mode,
    };
    this.runsTotal.add(1, attributes);
    this.runDurationMs.record(Math.max(0, params.durationMs), attributes);
  }

  recordConfigUpdate(enabled: boolean, outcome: PeriodicRefreshConfigOutcome): void {
    this.configUpdatesTotal.add(1, {
      enabled: enabled ? 'true' : 'false',
      outcome,
    });
  }
}

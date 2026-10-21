/* eslint-disable @typescript-eslint/naming-convention */
import { metrics } from '@opentelemetry/api';
import * as Sentry from '@sentry/nestjs';
import {
  createTableQueryMetricAttributes,
  type ITableQueryObservability,
  type SpanAttributes,
  type TableQueryObservabilityEvent,
  type TableQuerySearchValidationEvent,
} from '@teable/v2-core';

type SentryScopeLike = {
  setTag(key: string, value: string): void;
  setContext(key: string, value: Record<string, unknown>): void;
};

const parseAllowlist = (value: string | undefined): ReadonlySet<string> =>
  new Set(
    (value ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  );

const getSentryScopes = (): SentryScopeLike[] => {
  const sentryApi = Sentry as unknown as {
    getCurrentScope?: () => SentryScopeLike | undefined;
    getIsolationScope?: () => SentryScopeLike | undefined;
    getCurrentHub?: () => { getScope?: () => SentryScopeLike | undefined };
  };

  return [
    sentryApi.getCurrentScope?.(),
    sentryApi.getIsolationScope?.(),
    sentryApi.getCurrentHub?.()?.getScope?.(),
  ].filter((scope): scope is SentryScopeLike => Boolean(scope));
};

const setSentryTag = (
  scope: SentryScopeLike,
  key: string,
  value: string | number | boolean | undefined
) => {
  if (value == null || value === '') return;
  scope.setTag(key, String(value));
};

const tableQueryMeter = metrics.getMeter('teable-observability');

const requestTotal = tableQueryMeter.createCounter('teable.table_query.requests.total', {
  description: 'Table query requests by low-cardinality query and search access path attributes',
});

const errorTotal = tableQueryMeter.createCounter('teable.table_query.errors.total', {
  description: 'Table query errors by low-cardinality query and search access path attributes',
});

const fallbackTotal = tableQueryMeter.createCounter('teable.table_query.search.fallback.total', {
  description: 'Search access path fallback decisions by reason',
});

const validationTotal = tableQueryMeter.createCounter(
  'teable.table_query.search.validation.total',
  {
    description: 'Search vector validation attempts by status and access path',
  }
);

const requestDuration = tableQueryMeter.createHistogram('teable.table_query.duration.ms', {
  description: 'Table query application duration in milliseconds',
  unit: 'ms',
});

const dbParentDuration = tableQueryMeter.createHistogram(
  'teable.table_query.db_parent.duration.ms',
  {
    description: 'Parent application span duration for table-query database work',
    unit: 'ms',
  }
);

const validationDuration = tableQueryMeter.createHistogram(
  'teable.table_query.search.validation.duration.ms',
  {
    description: 'Search vector validation duration in milliseconds',
    unit: 'ms',
  }
);

const validationCostDelta = tableQueryMeter.createHistogram(
  'teable.table_query.search.cost_delta_pct',
  {
    description: 'Search vector validation cost delta percentage',
    unit: '%',
  }
);

export class TableQuerySearchMetricsService implements ITableQueryObservability {
  private readonly tableIdMetricAllowlist: ReadonlySet<string>;

  private readonly requestTotal = requestTotal;

  private readonly errorTotal = errorTotal;

  private readonly fallbackTotal = fallbackTotal;

  private readonly validationTotal = validationTotal;

  private readonly requestDuration = requestDuration;

  private readonly dbParentDuration = dbParentDuration;

  private readonly validationDuration = validationDuration;

  private readonly validationCostDelta = validationCostDelta;

  constructor(options?: { tableIdMetricAllowlist?: ReadonlySet<string> }) {
    this.tableIdMetricAllowlist =
      options?.tableIdMetricAllowlist ??
      parseAllowlist(process.env.TABLE_QUERY_OBSERVABILITY_TABLE_IDS);
  }

  recordRequest(event: TableQueryObservabilityEvent): void {
    const attrs = this.metricAttributes(event);
    this.requestTotal.add(1, attrs);
    if (event.durationMs != null) {
      this.requestDuration.record(event.durationMs, attrs);
      if (
        event.querySource === 'repository.record_find' ||
        event.querySource === 'repository.record_count'
      ) {
        this.dbParentDuration.record(event.durationMs, attrs);
      }
    }
    this.annotateSentry(event);
  }

  recordError(event: TableQueryObservabilityEvent): void {
    const attrs = this.metricAttributes(event);
    this.errorTotal.add(1, attrs);
    this.annotateSentry(event);
  }

  recordSearchFallback(event: TableQueryObservabilityEvent): void {
    this.fallbackTotal.add(1, this.metricAttributes(event));
    this.annotateSentry(event);
  }

  recordSearchValidation(event: TableQuerySearchValidationEvent): void {
    const attrs = this.metricAttributes({
      ...event,
      errorKind: event.errorKind ?? event.validationStatus,
    });
    this.validationTotal.add(1, attrs);
    if (event.durationMs != null) {
      this.validationDuration.record(event.durationMs, attrs);
    }
    if (event.costDeltaPct != null && Number.isFinite(event.costDeltaPct)) {
      this.validationCostDelta.record(event.costDeltaPct, attrs);
    }
    this.annotateSentry(event);
  }

  private metricAttributes(event: TableQueryObservabilityEvent): SpanAttributes {
    return createTableQueryMetricAttributes({
      ...event,
      includeTableId: event.tableId ? this.tableIdMetricAllowlist.has(event.tableId) : false,
    });
  }

  private annotateSentry(event: TableQueryObservabilityEvent): void {
    for (const scope of getSentryScopes()) {
      setSentryTag(scope, 'teable.query.kind', event.queryKind);
      setSentryTag(scope, 'teable.query.source', event.querySource);
      setSentryTag(scope, 'teable.search.access_path', event.accessPath);
      setSentryTag(scope, 'teable.search.mode', event.searchMode);
      setSentryTag(scope, 'teable.search.fallback_reason', event.fallbackReason);
      setSentryTag(scope, 'teable.table_id', event.tableId);
      scope.setContext('table_query_search', {
        queryKind: event.queryKind,
        querySource: event.querySource,
        tableId: event.tableId,
        viewId: event.viewId,
        searchMode: event.searchMode,
        accessPath: event.accessPath,
        searchScope: event.searchScope,
        languageConfig: event.languageConfig,
        fallbackReason: event.fallbackReason,
        hasFilter: event.hasFilter,
        hasSort: event.hasSort,
        hasGroup: event.hasGroup,
        includeTotal: event.includeTotal,
        errorKind: event.errorKind,
      });
    }
  }
}

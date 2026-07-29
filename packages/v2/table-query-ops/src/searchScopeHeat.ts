import { domainError, type DomainError } from '@teable/v2-core';
import { err, ok, type Result } from 'neverthrow';

import { stableHash, type TableQueryObservationWindow } from './domain';

export type SearchScopeHeatReason =
  | 'high_request_volume'
  | 'high_total_duration'
  | 'slow_query_volume'
  | 'large_table';

export type SearchScopeHeatPolicyConfig = {
  readonly minRequestCount: number;
  readonly minSlowCount: number;
  readonly minTotalDurationMs: number;
  readonly minEstimatedRows: number;
  readonly maxScopes: number;
};

export const defaultSearchScopeHeatPolicyConfig: SearchScopeHeatPolicyConfig = {
  minRequestCount: 100,
  minSlowCount: 20,
  minTotalDurationMs: 30_000,
  minEstimatedRows: 10_000,
  maxScopes: 5,
};

export type SearchScopeHeatEntry = {
  readonly scopeKey: string;
  readonly searchedFieldIds: readonly string[];
  readonly searchMode: 'ilike' | 'substring' | 'trigram' | 'full_text';
  readonly languageConfig?: string;
  readonly requestCount: number;
  readonly slowCount: number;
  readonly timeoutCount: number;
  readonly totalDurationMs: number;
  readonly maxDurationMs: number;
  readonly averageDurationMs: number;
  readonly heatScore: number;
  readonly hot: boolean;
  readonly reasonCodes: readonly SearchScopeHeatReason[];
  readonly nextAction: 'needs_plan_validation' | 'no_index_change';
};

export type SearchScopeHeatReportSnapshot = {
  readonly tableId: string;
  readonly estimatedRows: number;
  readonly scannedObservationCount: number;
  readonly scopes: readonly SearchScopeHeatEntry[];
};

export class SearchScopeHeatReport {
  private constructor(private readonly props: SearchScopeHeatReportSnapshot) {}

  static create(input: SearchScopeHeatReportSnapshot): Result<SearchScopeHeatReport, DomainError> {
    if (!input.tableId || input.estimatedRows < 0 || input.scannedObservationCount < 0) {
      return err(domainError.validation({ message: 'Invalid search scope heat report' }));
    }
    return ok(new SearchScopeHeatReport(input));
  }

  hotScopes(): readonly SearchScopeHeatEntry[] {
    return this.props.scopes.filter((scope) => scope.hot);
  }

  snapshot(): SearchScopeHeatReportSnapshot {
    return this.props;
  }
}

type MutableScopeAggregate = {
  searchedFieldIds: string[];
  searchMode: SearchScopeHeatEntry['searchMode'];
  languageConfig?: string;
  requestCount: number;
  slowCount: number;
  timeoutCount: number;
  totalDurationMs: number;
  maxDurationMs: number;
};

export class SearchScopeHeatPolicy {
  private readonly config: SearchScopeHeatPolicyConfig;

  constructor(config: Partial<SearchScopeHeatPolicyConfig> = {}) {
    this.config = { ...defaultSearchScopeHeatPolicyConfig, ...config };
  }

  evaluate(input: {
    readonly observations: readonly TableQueryObservationWindow[];
    readonly estimatedRows: number;
  }): Result<SearchScopeHeatReport, DomainError> {
    const tableId = input.observations[0]?.tableId();
    if (!tableId || input.estimatedRows < 0) {
      return err(
        domainError.validation({ message: 'Search scope heat input is empty or invalid' })
      );
    }

    const scopes = new Map<string, MutableScopeAggregate>();
    for (const observation of input.observations) {
      if (observation.tableId() !== tableId) continue;
      const shape = observation.shape().snapshot();
      const search = shape.searchShape;
      if (
        shape.queryKind !== 'search' ||
        search?.allFields !== false ||
        !search.searchedFieldIds?.length
      ) {
        continue;
      }
      const searchedFieldIds = Array.from(new Set(search.searchedFieldIds)).sort();
      const searchMode = search.searchMode ?? 'ilike';
      const scopeKey = stableHash({
        tableId,
        searchedFieldIds,
        searchMode,
        languageConfig: search.languageConfig,
      });
      const current = scopes.get(scopeKey) ?? {
        searchedFieldIds,
        searchMode,
        languageConfig: search.languageConfig,
        requestCount: 0,
        slowCount: 0,
        timeoutCount: 0,
        totalDurationMs: 0,
        maxDurationMs: 0,
      };
      current.requestCount += observation.requestCount();
      current.slowCount += observation.slowCount();
      current.timeoutCount += observation.timeoutCount();
      const snapshot = observation.snapshot();
      current.totalDurationMs += snapshot.totalDurationMs;
      current.maxDurationMs = Math.max(current.maxDurationMs, snapshot.maxDurationMs);
      scopes.set(scopeKey, current);
    }

    const entries = Array.from(scopes.entries())
      .map(([scopeKey, scope]): SearchScopeHeatEntry => {
        const reasonCodes: SearchScopeHeatReason[] = [];
        if (scope.requestCount >= this.config.minRequestCount) {
          reasonCodes.push('high_request_volume');
        }
        if (scope.totalDurationMs >= this.config.minTotalDurationMs) {
          reasonCodes.push('high_total_duration');
        }
        if (scope.slowCount >= this.config.minSlowCount) {
          reasonCodes.push('slow_query_volume');
        }
        if (input.estimatedRows >= this.config.minEstimatedRows) {
          reasonCodes.push('large_table');
        }
        const workloadQualified =
          scope.requestCount >= this.config.minRequestCount ||
          scope.slowCount >= this.config.minSlowCount;
        const costQualified = scope.totalDurationMs >= this.config.minTotalDurationMs;
        const hot =
          input.estimatedRows >= this.config.minEstimatedRows && workloadQualified && costQualified;
        const slowRatio = scope.requestCount > 0 ? scope.slowCount / scope.requestCount : 0;
        const heatScore = Math.min(
          100,
          Math.round(
            Math.min(25, Math.log2(scope.requestCount + 1) * 4) +
              Math.min(40, Math.log2(scope.totalDurationMs / 1000 + 1) * 8) +
              Math.min(20, slowRatio * 100) +
              (input.estimatedRows >= this.config.minEstimatedRows ? 15 : 0)
          )
        );
        return {
          scopeKey,
          searchedFieldIds: scope.searchedFieldIds,
          searchMode: scope.searchMode,
          ...(scope.languageConfig ? { languageConfig: scope.languageConfig } : {}),
          requestCount: scope.requestCount,
          slowCount: scope.slowCount,
          timeoutCount: scope.timeoutCount,
          totalDurationMs: scope.totalDurationMs,
          maxDurationMs: scope.maxDurationMs,
          averageDurationMs:
            scope.requestCount > 0 ? scope.totalDurationMs / scope.requestCount : 0,
          heatScore,
          hot,
          reasonCodes,
          nextAction: hot ? 'needs_plan_validation' : 'no_index_change',
        };
      })
      .sort(
        (left, right) =>
          Number(right.hot) - Number(left.hot) ||
          right.heatScore - left.heatScore ||
          right.totalDurationMs - left.totalDurationMs
      )
      .slice(0, this.config.maxScopes);

    return SearchScopeHeatReport.create({
      tableId,
      estimatedRows: input.estimatedRows,
      scannedObservationCount: input.observations.length,
      scopes: entries,
    });
  }
}

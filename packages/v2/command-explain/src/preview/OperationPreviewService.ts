import { createHash } from 'node:crypto';

import type { ComplexityAssessment } from '@teable/v2-complexity';
import { domainError, type DomainError, type IExecutionContext } from '@teable/v2-core';
import { err, ok, type Result } from 'neverthrow';
import type { IComplexityService } from '../service/ComplexityService';

import { PreviewPlannerRegistry } from './PreviewPlannerRegistry';
import type {
  IOperationPreviewService,
  OperationPreview,
  OperationPreviewPlan,
  OperationPreviewRequest,
  PreviewComplexityProjection,
  PreviewIssue,
  PreviewOptions,
  PreviewOutcome,
} from './types';

const DEFAULT_PREVIEW_OPTIONS: PreviewOptions = {
  detail: 'summary',
  includeComplexity: false,
  maxItems: 100,
};

const AUTHORIZATION_SCOPE_UNKNOWN_WARNING: PreviewIssue = {
  code: 'preview.complexity.authorization_scope_unknown',
  message:
    'Complexity analysis is restricted to the seed table because an authorized dependency scope was not supplied.',
};

const COMPLEXITY_SERVICE_UNAVAILABLE_WARNING: PreviewIssue = {
  code: 'preview.complexity.service_unavailable',
  message: 'Complexity analysis is not registered for this preview service.',
};

const COMPLEXITY_STATISTICS_UNKNOWN_WARNING: PreviewIssue = {
  code: 'preview.complexity.statistics_unknown',
  message:
    'Complexity workload is unknown because required catalog statistics or explicit assumptions are unavailable.',
};

const AUTHORIZATION_SCOPE_UNKNOWN_COVERAGE = 'complexity-authorized-dependency-scope';

type OperationPreviewServiceDependencies = {
  readonly now?: () => Date;
  readonly complexityService?: Pick<IComplexityService, 'assess'>;
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;

  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property || !('value' in property) || property.value === undefined) continue;
    normalized[key] = canonicalize(property.value);
  }
  return normalized;
};

const requestDigest = (request: OperationPreviewRequest): string => {
  const canonical = JSON.stringify(canonicalize(request));
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
};

const normalizeOptions = (
  input: OperationPreviewRequest['options']
): Result<PreviewOptions, DomainError> => {
  const options = { ...DEFAULT_PREVIEW_OPTIONS, ...input };
  if (!Number.isInteger(options.maxItems) || options.maxItems < 1 || options.maxItems > 1_000) {
    return err(
      domainError.validation({
        code: 'preview.options.max_items_invalid',
        message: 'Preview maxItems must be an integer between 1 and 1000',
      })
    );
  }
  return ok(options);
};

const outcomeFor = (input: {
  readonly blockers: ReadonlyArray<unknown>;
  readonly unknownCoverage: ReadonlyArray<string>;
}): PreviewOutcome => {
  if (input.blockers.length > 0) return 'blocked';
  if (input.unknownCoverage.length > 0) return 'incomplete';
  return 'ready';
};

const unique = (values: ReadonlyArray<string>): ReadonlyArray<string> => [...new Set(values)];

/** Merges a projection into the plan when complexity analysis cannot run at all. */
const withUnavailableComplexity = (
  plan: OperationPreviewPlan,
  projection: PreviewComplexityProjection,
  scopeUnknown: boolean
): OperationPreviewPlan => ({
  ...plan,
  warnings: [
    ...plan.warnings,
    ...projection.warnings,
    ...(scopeUnknown ? [AUTHORIZATION_SCOPE_UNKNOWN_WARNING] : []),
    COMPLEXITY_SERVICE_UNAVAILABLE_WARNING,
  ],
  coverage: {
    known: unique([...plan.coverage.known, ...projection.coverage.known]),
    unknown: unique([
      ...plan.coverage.unknown,
      ...projection.coverage.unknown,
      ...(scopeUnknown ? [AUTHORIZATION_SCOPE_UNKNOWN_COVERAGE] : []),
      'complexity-assessment',
    ]),
  },
});

/** Merges a projection plus the assessed workload into the plan. */
const withAssessedComplexity = (
  plan: OperationPreviewPlan,
  projection: PreviewComplexityProjection,
  scopeUnknown: boolean,
  assessment: ComplexityAssessment
): OperationPreviewPlan => {
  const workloadUnknown = assessment.workload.status === 'unknown';
  return {
    ...plan,
    warnings: [
      ...plan.warnings,
      ...projection.warnings,
      ...(scopeUnknown ? [AUTHORIZATION_SCOPE_UNKNOWN_WARNING] : []),
      ...(workloadUnknown ? [COMPLEXITY_STATISTICS_UNKNOWN_WARNING] : []),
    ],
    coverage: {
      known: unique([
        ...plan.coverage.known,
        ...projection.coverage.known,
        'complexity-assessment',
        ...(workloadUnknown ? [] : ['complexity-workload-estimate']),
      ]),
      unknown: unique([
        ...plan.coverage.unknown,
        ...projection.coverage.unknown,
        ...(scopeUnknown ? [AUTHORIZATION_SCOPE_UNKNOWN_COVERAGE] : []),
        ...(workloadUnknown ? ['complexity-statistics'] : []),
      ]),
    },
    complexity: assessment,
  };
};

export class OperationPreviewService implements IOperationPreviewService {
  private readonly now: () => Date;
  private readonly complexityService: Pick<IComplexityService, 'assess'> | undefined;

  constructor(
    private readonly registry: PreviewPlannerRegistry,
    dependencies: OperationPreviewServiceDependencies = {}
  ) {
    this.now = dependencies.now ?? (() => new Date());
    this.complexityService = dependencies.complexityService;
  }

  async preview(
    context: IExecutionContext,
    request: OperationPreviewRequest
  ): Promise<Result<OperationPreview, DomainError>> {
    const registration = this.registry.resolve(request.operation);
    if (registration.isErr()) return err(registration.error);

    const options = normalizeOptions(request.options);
    if (options.isErr()) return err(options.error);

    const planned = await registration.value.plan(context, request.input, options.value);
    if (planned.isErr()) return err(planned.error);

    const plan = await this.applyComplexity(context, planned.value, options.value);
    if (plan.isErr()) return err(plan.error);

    return ok({
      operation: registration.value.operation,
      outcome: outcomeFor({
        blockers: plan.value.blockers,
        unknownCoverage: plan.value.coverage.unknown,
      }),
      effects: plan.value.effects,
      blockers: plan.value.blockers,
      warnings: plan.value.warnings,
      coverage: plan.value.coverage,
      complexity: plan.value.complexity,
      authorization: plan.value.authorization,
      observedAt: this.now().toISOString(),
      consistency: plan.value.consistency,
      requestDigest: requestDigest({
        operation: registration.value.operation,
        input: request.input,
        options: options.value,
      }),
      implementation: {
        plannerVersion: registration.value.plannerVersion,
        executionPath: registration.value.executionPath,
      },
    });
  }

  private async applyComplexity(
    context: IExecutionContext,
    plan: OperationPreviewPlan,
    options: PreviewOptions
  ): Promise<Result<OperationPreviewPlan, DomainError>> {
    const projection = plan.complexityProjection;
    if (!options.includeComplexity || !projection) return ok(plan);

    const authorizedTableIds = projection.authorizedTableIds ?? [projection.tableId];
    const scopeUnknown = projection.authorizedTableIds === undefined;
    if (!this.complexityService) {
      return ok(withUnavailableComplexity(plan, projection, scopeUnknown));
    }

    const assessed = await this.complexityService.assess(context, {
      tableId: projection.tableId,
      operation: projection.operation,
      ...(projection.assumptions ? { assumptions: projection.assumptions } : {}),
      includeCatalogStats: projection.includeCatalogStats,
      assumeSingleRecordWhenSelectionUnknown: false,
      focusTableId: projection.tableId,
      authorizedTableIds,
    });
    if (assessed.isErr()) return err(assessed.error);

    return ok(withAssessedComplexity(plan, projection, scopeUnknown, assessed.value.assessment));
  }
}

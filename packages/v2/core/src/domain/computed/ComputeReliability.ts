import { z } from 'zod';

/** Unresolved incidents are independent of currently executing tasks. */
export const computeReliabilitySchema = z.object({
  unresolvedCount: z.number().int().nonnegative(),
  oldestUnresolvedAt: z.string().datetime().nullable(),
  scopeComplete: z.boolean(),
});
export type ComputeReliability = z.infer<typeof computeReliabilitySchema>;

export const emptyComputeReliability = (): ComputeReliability => ({
  unresolvedCount: 0,
  oldestUnresolvedAt: null,
  scopeComplete: true,
});

/** Structural equality. Key order and missing vs empty must not look like drift. */
export const sameComputeReliability = (
  left: ComputeReliability | undefined,
  right: ComputeReliability | undefined
): boolean => {
  const a = left ?? emptyComputeReliability();
  const b = right ?? emptyComputeReliability();
  return (
    a.unresolvedCount === b.unresolvedCount &&
    a.oldestUnresolvedAt === b.oldestUnresolvedAt &&
    a.scopeComplete === b.scopeComplete
  );
};

/** Counts represent field incidences, not distinct cross-field incidents. */
export const summarizeComputeReliability = (
  summaries: ReadonlyArray<ComputeReliability | undefined>
): ComputeReliability =>
  summaries.reduce<ComputeReliability>((total, item) => {
    if (!item) return total;
    return {
      unresolvedCount: total.unresolvedCount + item.unresolvedCount,
      oldestUnresolvedAt: !total.oldestUnresolvedAt
        ? item.oldestUnresolvedAt
        : !item.oldestUnresolvedAt
          ? total.oldestUnresolvedAt
          : total.oldestUnresolvedAt < item.oldestUnresolvedAt
            ? total.oldestUnresolvedAt
            : item.oldestUnresolvedAt,
      scopeComplete: total.scopeComplete && item.scopeComplete,
    };
  }, emptyComputeReliability());

const reliabilityIssueIdentitiesSchema = z.object({
  unresolved: z.array(z.string()),
});

/** Deduplicate cross-field incidents using server-only identities, after access filtering. */
export const summarizeFieldComputeReliability = (
  fields: ReadonlyArray<{ reliability?: ComputeReliability; extensions?: Record<string, unknown> }>
): ComputeReliability => {
  const summary = summarizeComputeReliability(fields.map((field) => field.reliability));
  const active = fields.filter((field) => (field.reliability?.unresolvedCount ?? 0) > 0);
  const identities = active.map((field) =>
    reliabilityIssueIdentitiesSchema.safeParse(field.extensions?.reliabilityIssueIdentities)
  );
  if (identities.some((identity) => !identity.success)) return summary;
  const unresolved = new Set<string>();
  for (const identity of identities) {
    if (!identity.success) continue;
    identity.data.unresolved.forEach((id) => unresolved.add(id));
  }
  return {
    ...summary,
    unresolvedCount: unresolved.size,
  };
};

/** Public diagnostics never include SQL, values, or provider error text. */
const FORMULA_BUDGET_CODES: Record<string, true> = {
  'validation.limit.formula_compile_nodes_max': true,
  'validation.limit.formula_compile_depth_max': true,
  'validation.limit.formula_reference_depth_max': true,
  'validation.limit.formula_bindings_max': true,
  'validation.limit.formula_compile_bytes_max': true,
  'validation.limit.formula_sql_bytes_max': true,
};
const PUBLIC_COMPUTE_LIMIT_CODES: Record<string, true> = {
  ...FORMULA_BUDGET_CODES,
  'computed.resource_limit': true,
};
const SAFE_METRICS: Record<string, true> = {
  visitedNodes: true,
  uniqueNodes: true,
  astDepth: true,
  referenceDepth: true,
  bindings: true,
  fragmentBytes: true,
  sqlBytes: true,
};
const safeNonnegative = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

export const isComputeSafetyLimitCode = (code: string | undefined): boolean =>
  code === 'validation.limit.computed_cell_value_max_bytes' ||
  code === 'computed.stage_depth_exhausted' ||
  Object.hasOwn(PUBLIC_COMPUTE_LIMIT_CODES, code ?? '');

export const publicComputeError = (
  error: { code?: string; message: string; context?: Record<string, unknown> } | null | undefined
) => {
  if (!error) return error;
  if (error.code === 'validation.limit.computed_cell_value_max_bytes') {
    const attempted = safeNonnegative(error.context?.attempted);
    const max = safeNonnegative(error.context?.max);
    return {
      code: error.code,
      message: 'Computed cell value exceeds the size limit',
      ...(attempted !== undefined && max !== undefined ? { context: { attempted, max } } : {}),
    };
  }
  if (Object.hasOwn(PUBLIC_COMPUTE_LIMIT_CODES, error.code ?? '')) {
    const attempted = safeNonnegative(error.context?.attempted);
    const max = safeNonnegative(error.context?.max);
    const metric = error.context?.metric;
    const policyVersion = error.context?.policyVersion;
    const context = {
      ...(Object.hasOwn(FORMULA_BUDGET_CODES, error.code ?? '') &&
      typeof metric === 'string' &&
      Object.hasOwn(SAFE_METRICS, metric)
        ? { metric }
        : {}),
      ...(attempted !== undefined ? { attempted } : {}),
      ...(max !== undefined ? { max } : {}),
      ...(typeof policyVersion === 'number' &&
      Number.isSafeInteger(policyVersion) &&
      policyVersion > 0
        ? { policyVersion }
        : {}),
    };
    return {
      code: error.code,
      message:
        error.code === 'computed.resource_limit'
          ? 'Computed results have not been updated due to a resource limit'
          : 'Formula compilation exceeds the computation limit',
      ...(Object.keys(context).length ? { context } : {}),
    };
  }
  if (error.code === 'computed.stage_depth_exhausted') {
    return {
      code: error.code,
      message: 'Computation did not finish; some results were not updated',
    };
  }
  return { code: 'computed.update_failed', message: 'Computed results have not been updated' };
};

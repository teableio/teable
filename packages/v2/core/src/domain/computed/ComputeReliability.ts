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
export const publicComputeError = (
  error: { code?: string; message: string; context?: Record<string, unknown> } | null | undefined
) => {
  if (!error) return error;
  if (error.code === 'validation.limit.computed_cell_value_max_bytes') {
    const attempted = error.context?.attempted;
    const max = error.context?.max;
    return {
      code: error.code,
      message: 'Computed cell value exceeds the size limit',
      ...(typeof attempted === 'number' &&
      Number.isFinite(attempted) &&
      attempted >= 0 &&
      typeof max === 'number' &&
      Number.isFinite(max) &&
      max >= 0
        ? { context: { attempted, max } }
        : {}),
    };
  }
  return { code: 'computed.update_failed', message: 'Computed results have not been updated' };
};

/**
 * Telemetry for a structured query that used its declared SQL fallback.
 *
 * The generated App client sends the fallback headers to `/base/:baseId/sql-query`.
 * Only a planned-structured query with `fallback=true` is an automatic fallback;
 * `mode: sql-query` is SQL by design and never sets this attribute.
 */

/** Error code reported by the structured executor, never SQL text or a literal. */
export const AUTO_FALLBACK_REASON_ATTRIBUTE = 'teable.data_query.auto_fallback_reason';
/** Shared with the structured query execution span; omitted when the header is unusable. */
export const AUTO_FALLBACK_QUERY_ID_ATTRIBUTE = 'teable.data_query.query_id';

const autoFallbackReasonPattern = /^data_query\.[a-z0-9_]{1,64}$/;
const queryIdPattern = /^[a-z_$][\w$]{0,127}$/i;

export type AutoFallbackObservation = {
  readonly plannedMode: 'structured' | 'sql-query';
  readonly fallback: boolean;
  /** Raw `x-teable-query-fallback-reason` value; the caller may have normalized it already. */
  readonly reason?: string;
  readonly queryId?: string;
};

/**
 * Map one `/sql-query` request to span attributes, or `{}` when it is SQL by design.
 *
 * The reason is bounded to this repository's error-code namespace. Anything else
 * (SQL text, a literal, an oversized value) becomes `unknown`, so the attribute
 * cannot become a high-cardinality carrier of user data.
 */
export const autoFallbackAttributes = (
  observation: AutoFallbackObservation
): Record<string, string> => {
  if (observation.plannedMode !== 'structured' || !observation.fallback) return {};
  const reason =
    observation.reason && autoFallbackReasonPattern.test(observation.reason)
      ? observation.reason
      : 'unknown';
  const queryId =
    observation.queryId && queryIdPattern.test(observation.queryId)
      ? observation.queryId
      : undefined;
  return {
    [AUTO_FALLBACK_REASON_ATTRIBUTE]: reason,
    ...(queryId ? { [AUTO_FALLBACK_QUERY_ID_ATTRIBUTE]: queryId } : {}),
  };
};

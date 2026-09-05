import { summarizeFieldComputeReliability } from '../domain/computed/ComputeReliability';
import {
  HIGH_COMPLEXITY_THRESHOLD,
  type TableComputeActivitySnapshot,
} from '../ports/ComputedActivityReader';
import type { RecordQueryPluginScope } from '../ports/RecordQueryPlugin';

/** Activity describes entire fields; conditional cell access cannot authorize it. */
export const filterComputeActivitySnapshot = (
  snapshot: TableComputeActivitySnapshot,
  scope: RecordQueryPluginScope | undefined
): TableComputeActivitySnapshot => {
  if (!scope?.readableFieldIds && !scope?.fieldMasks?.length && !scope?.recordSpec) return snapshot;
  const masked = new Set(scope.fieldMasks?.map(({ fieldId }) => fieldId));
  const fields = snapshot.fields.filter(
    ({ fieldId }) =>
      !scope.recordSpec && !masked.has(fieldId) && (scope.readableFieldIds?.has(fieldId) ?? true)
  );
  const readable = new Set(fields.map(({ fieldId }) => fieldId));
  const queuedFieldCount = fields.filter(({ status }) => status === 'queued').length;
  const calculatingFieldCount = fields.filter(({ status }) => status === 'running').length;
  return {
    ...snapshot,
    fields,
    table: snapshot.table
      ? {
          ...snapshot.table,
          status: queuedFieldCount + calculatingFieldCount > 0 ? 'calculating' : 'idle',
          queuedFieldCount,
          calculatingFieldCount,
          estimatedComplexity: fields.reduce(
            (sum, field) => sum + (field.estimatedComplexity ?? 0),
            0
          ),
          recentCompletions: snapshot.table.recentCompletions.filter(({ fieldId }) =>
            readable.has(fieldId)
          ),
        }
      : null,
    diagnostics: {
      ...snapshot.diagnostics,
      reliability:
        snapshot.reliabilityIsAccessScoped && fields.length === snapshot.fields.length
          ? snapshot.diagnostics.reliability
          : summarizeFieldComputeReliability(fields),
      activeFieldCount: queuedFieldCount + calculatingFieldCount,
      queuedFieldCount,
      calculatingFieldCount,
      failedFieldCount: fields.filter(
        (field) => field.status === 'failed' || (field.reliability?.unresolvedCount ?? 0) > 0
      ).length,
      highComplexityFieldCount: fields.filter(
        (field) => (field.estimatedComplexity ?? 0) >= HIGH_COMPLEXITY_THRESHOLD
      ).length,
      anomalies: snapshot.diagnostics.anomalies.filter(({ fieldId }) => readable.has(fieldId)),
      pause: {
        ...snapshot.diagnostics.pause,
        // Blocker identities, reasons and queue counts may refer to inaccessible scopes.
        blockers: [],
        queuedTaskCount: 0,
        oldestQueuedAt: null,
      },
    },
  };
};

import type { FieldComputeMetaDto, TableComputeMetaDto } from '@teable/v2-core';

export const toNumber = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const toIso = (value: unknown): string | null => {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return null;
};

const parseJson = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const parseLastError = (value: unknown): { code?: string; message: string } | null => {
  const parsed = parseJson(value);
  if (parsed == null) return null;
  if (typeof parsed === 'string') return { message: parsed };
  if (typeof parsed !== 'object' || !('message' in parsed)) return null;

  const record = parsed as { code?: unknown; message?: unknown };
  if (typeof record.message !== 'string') return null;
  return {
    message: record.message,
    ...(typeof record.code === 'string' ? { code: record.code } : {}),
  };
};

const parseRecentCompletions = (value: unknown): TableComputeMetaDto['recentCompletions'] => {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    if (
      typeof row.fieldId !== 'string' ||
      typeof row.durationMs !== 'number' ||
      typeof row.completedAt !== 'string'
    ) {
      return [];
    }
    return [
      {
        fieldId: row.fieldId,
        ...(typeof row.taskId === 'string' ? { taskId: row.taskId } : {}),
        durationMs: row.durationMs,
        completedAt: row.completedAt,
      },
    ];
  });
};

const parseExtensions = (value: unknown): Record<string, unknown> | undefined => {
  const parsed = parseJson(value);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : undefined;
};

export const fieldActivityRowToDto = (row: Record<string, unknown>): FieldComputeMetaDto => ({
  fieldId: String(row.field_id),
  tableId: String(row.table_id),
  baseId: String(row.base_id),
  status: String(row.status) as FieldComputeMetaDto['status'],
  activeTaskCount: toNumber(row.active_task_count),
  processingTaskCount: toNumber(row.processing_task_count),
  generation: toNumber(row.generation),
  estimatedComplexity: toNumber(row.estimated_complexity),
  estimatedDirtyRecords: toNumber(row.estimated_dirty_records),
  hasAllTargetRecords: row.has_all_target_records === true,
  queuedAt: toIso(row.queued_at),
  startedAt: toIso(row.started_at),
  updatedAt: toIso(row.updated_at) ?? new Date().toISOString(),
  lastCompletedAt: toIso(row.last_completed_at),
  lastDurationMs: row.last_duration_ms == null ? null : toNumber(row.last_duration_ms),
  lastError: parseLastError(row.last_error),
  extensions: parseExtensions(row.extensions),
});

export const tableActivityRowToDto = (row: Record<string, unknown>): TableComputeMetaDto => ({
  tableId: String(row.table_id),
  baseId: String(row.base_id),
  status: String(row.status) as TableComputeMetaDto['status'],
  calculatingFieldCount: toNumber(row.calculating_field_count),
  queuedFieldCount: toNumber(row.queued_field_count),
  estimatedComplexity: toNumber(row.estimated_complexity),
  recentCompletions: parseRecentCompletions(row.recent_completions),
  generation: toNumber(row.generation),
  updatedAt: toIso(row.updated_at) ?? new Date().toISOString(),
  computeMode: 'server',
});

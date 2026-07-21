import type {
  FieldComputeMetaDto,
  TableComputeActivitySnapshot,
  TableComputeMetaDto,
} from '@teable/v2-core';

import type { IFieldDto, ITableDto } from './dto';

const toPublicFieldComputeMeta = (field: FieldComputeMetaDto) => ({
  status: field.status,
  ...(field.estimatedComplexity ? { estimatedComplexity: field.estimatedComplexity } : {}),
  ...(field.estimatedDirtyRecords ? { estimatedDirtyRecords: field.estimatedDirtyRecords } : {}),
  ...(field.startedAt ? { startedAt: field.startedAt } : {}),
  ...(field.lastDurationMs != null ? { lastDurationMs: field.lastDurationMs } : {}),
  ...(field.lastError !== undefined ? { lastError: field.lastError } : {}),
});

const toPublicTableComputeMeta = (
  table: TableComputeMetaDto | null,
  fields: ReadonlyArray<FieldComputeMetaDto>
): ITableDto['computeMeta'] => {
  if (table) {
    return {
      status: table.status,
      calculatingFieldCount: table.calculatingFieldCount,
      queuedFieldCount: table.queuedFieldCount,
      ...(table.estimatedComplexity ? { estimatedComplexity: table.estimatedComplexity } : {}),
      recentCompletions: table.recentCompletions,
      computeMode: 'server',
    };
  }

  let calculating = 0;
  let queued = 0;
  for (const field of fields) {
    if (field.status === 'running') calculating += 1;
    if (field.status === 'queued') queued += 1;
  }
  if (calculating + queued === 0) {
    return {
      status: 'idle',
      calculatingFieldCount: 0,
      queuedFieldCount: 0,
      computeMode: 'server',
    };
  }
  return {
    status: 'calculating',
    calculatingFieldCount: calculating,
    queuedFieldCount: queued,
    computeMode: 'server',
  };
};

/**
 * Merge projected compute activity into a table DTO for API responses.
 */
export const enrichTableDtoWithComputeActivity = (
  table: ITableDto,
  activity: TableComputeActivitySnapshot | null | undefined
): ITableDto => {
  if (!activity) {
    return {
      ...table,
      computeMeta: table.computeMeta ?? {
        status: 'idle',
        calculatingFieldCount: 0,
        queuedFieldCount: 0,
        computeMode: 'server',
      },
    };
  }

  const byFieldId = new Map(activity.fields.map((field) => [field.fieldId, field]));
  const fields = table.fields.map((field): IFieldDto => {
    const meta = byFieldId.get(field.id);
    if (!meta) return field;
    return {
      ...field,
      computeMeta: toPublicFieldComputeMeta(meta),
    };
  });

  return {
    ...table,
    fields,
    computeMeta: toPublicTableComputeMeta(activity.table, activity.fields),
  };
};

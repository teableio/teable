import type { IDuplicateBaseProgressEvent } from '@teable/openapi';

const STRUCTURE_START_PERCENT = 1;
const STRUCTURE_END_PERCENT = 30;
const DATA_END_PERCENT = 95;
const ATTACHMENTS_PERCENT = 98;
const DONE_PERCENT = 100;

const PHASE_BASE_PROGRESS: Record<string, number> = {
  duplicate_started: STRUCTURE_START_PERCENT,
  structure_creating: 2,
  table_structure_validating: 3,
  table_structure_committing: 5,
  structure_created: STRUCTURE_END_PERCENT,
  creating_folders: STRUCTURE_END_PERCENT,
  restoring_base_nodes: STRUCTURE_END_PERCENT,
  table_data_start: STRUCTURE_END_PERCENT,
  attachments_copying: ATTACHMENTS_PERCENT,
  duplicate_done: DONE_PERCENT,
};

const clampPercent = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(value)));

const getTableStructurePercent = (progress: IDuplicateBaseProgressEvent) => {
  if (!progress.totalTables || progress.totalTables <= 0) {
    return undefined;
  }

  const tableIndex = progress.tableIndex ?? 0;
  const percent =
    STRUCTURE_START_PERCENT +
    (tableIndex / progress.totalTables) * (STRUCTURE_END_PERCENT - STRUCTURE_START_PERCENT);
  const phaseBaseProgress = PHASE_BASE_PROGRESS[progress.phase] ?? STRUCTURE_START_PERCENT;

  return clampPercent(
    Math.max(phaseBaseProgress, percent),
    STRUCTURE_START_PERCENT,
    STRUCTURE_END_PERCENT
  );
};

const getTableDataPercent = (progress: IDuplicateBaseProgressEvent) => {
  if (!progress.totalRows || progress.totalRows <= 0) {
    return undefined;
  }

  const processedRows = progress.processedRows ?? 0;
  const percent =
    STRUCTURE_END_PERCENT +
    (processedRows / progress.totalRows) * (DATA_END_PERCENT - STRUCTURE_END_PERCENT);

  return clampPercent(percent, STRUCTURE_END_PERCENT, DATA_END_PERCENT);
};

export const getDuplicateProgressPercent = (progress: IDuplicateBaseProgressEvent | null) => {
  if (!progress) {
    return 0;
  }

  if (progress.phase === 'duplicate_done') {
    return DONE_PERCENT;
  }

  if (progress.phase === 'attachments_copying') {
    return ATTACHMENTS_PERCENT;
  }

  const dataPercent = getTableDataPercent(progress);
  if (dataPercent != null) {
    return dataPercent;
  }

  const structurePercent = getTableStructurePercent(progress);
  if (structurePercent != null) {
    return structurePercent;
  }

  return PHASE_BASE_PROGRESS[progress.phase] ?? 0;
};

export const mergeDuplicateProgress = (
  previous: IDuplicateBaseProgressEvent | null,
  next: IDuplicateBaseProgressEvent
): IDuplicateBaseProgressEvent => {
  const hasRowsProgress = next.totalRows != null || next.processedRows != null;
  const hasTablesProgress = next.totalTables != null || next.tableIndex != null;
  if (!previous || hasRowsProgress || hasTablesProgress) {
    return next;
  }

  return {
    ...next,
    processedRows: previous.processedRows,
    totalRows: previous.totalRows,
    tableIndex: previous.tableIndex,
    totalTables: previous.totalTables,
  };
};

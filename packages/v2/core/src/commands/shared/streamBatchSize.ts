export const DEFAULT_SELECTION_STREAM_BATCH_SIZE = 200;
export const DEFAULT_RESTORE_RECORDS_BATCH_SIZE = 500;
export const MAX_SELECTION_STREAM_BATCH_SIZE = 1000;
export const TARGET_SELECTION_STREAM_CHUNK_COUNT = 20;

export const resolveSelectionStreamBatchSize = (
  totalCount: number,
  requestedBatchSize?: number
): number => {
  if (requestedBatchSize !== undefined) {
    return clampStreamBatchSize(requestedBatchSize);
  }

  if (totalCount <= 0) {
    return DEFAULT_SELECTION_STREAM_BATCH_SIZE;
  }

  const dynamicallySizedBatch = Math.ceil(totalCount / TARGET_SELECTION_STREAM_CHUNK_COUNT);
  return clampStreamBatchSize(Math.max(DEFAULT_SELECTION_STREAM_BATCH_SIZE, dynamicallySizedBatch));
};

export const resolveRestoreRecordsBatchSize = (totalCount: number): number => {
  if (totalCount <= 0) {
    return DEFAULT_RESTORE_RECORDS_BATCH_SIZE;
  }

  const dynamicallySizedBatch = Math.ceil(totalCount / TARGET_SELECTION_STREAM_CHUNK_COUNT);
  return clampStreamBatchSize(Math.max(DEFAULT_RESTORE_RECORDS_BATCH_SIZE, dynamicallySizedBatch));
};

const clampStreamBatchSize = (batchSize: number) =>
  Math.max(1, Math.min(MAX_SELECTION_STREAM_BATCH_SIZE, Math.floor(batchSize)));

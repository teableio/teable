export const DEFAULT_LARGE_RECORD_BATCH_REFRESH_THRESHOLD = 1000;

export const isLargeRecordBatchMutation = (
  size: number,
  threshold = DEFAULT_LARGE_RECORD_BATCH_REFRESH_THRESHOLD
) => size > threshold;

export const DEFAULT_LARGE_RECORD_BATCH_REFRESH_THRESHOLD = 1000;

export interface IRealtimeBatchMutationOrchestrationLike {
  readonly totalRecordCount: number;
  readonly totalChunkCount: number;
  readonly chunkIndex: number;
  readonly scope: 'operation' | 'chunk';
}

export const isLargeRecordBatchMutation = (
  size: number,
  threshold = DEFAULT_LARGE_RECORD_BATCH_REFRESH_THRESHOLD
) => size > threshold;

export const isStreamedBatchMutation = (
  orchestration?: IRealtimeBatchMutationOrchestrationLike
): boolean => {
  return (orchestration?.totalChunkCount ?? 1) > 1;
};

export const shouldSkipRealtimeBatchMutation = (
  size: number,
  _orchestration?: IRealtimeBatchMutationOrchestrationLike
): boolean => {
  return size >= DEFAULT_LARGE_RECORD_BATCH_REFRESH_THRESHOLD;
};

import type {
  IExecutionContext,
  IExecutionContextBatchMutation,
} from '../../ports/ExecutionContext';

export const buildOperationBatchMutation = (
  context: IExecutionContext,
  totalRecordCount: number
): IExecutionContextBatchMutation => {
  return (
    context.batchMutation ?? {
      operationId: context.requestId,
      groupId: context.requestId,
      totalRecordCount,
      totalChunkCount: 1,
      chunkIndex: 0,
      scope: 'operation',
    }
  );
};

export const withBatchMutation = (
  context: IExecutionContext,
  batchMutation: IExecutionContextBatchMutation
): IExecutionContext => ({
  ...context,
  batchMutation,
});

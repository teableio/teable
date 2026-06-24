import type { IBatchMutationOrchestration, IExecutionContext } from '../../ports/ExecutionContext';

export const buildOperationBatchMutation = (
  context: Pick<IExecutionContext, 'requestId'>,
  totalRecordCount: number
): IBatchMutationOrchestration => ({
  operationId: context.requestId,
  groupId: context.requestId,
  totalRecordCount,
  totalChunkCount: 1,
  chunkIndex: 0,
  scope: 'operation',
});

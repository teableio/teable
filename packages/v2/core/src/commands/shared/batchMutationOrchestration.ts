import type { IBatchMutationOrchestration } from '../../ports/BatchMutationOrchestration';

export const buildOperationBatchMutation = (
  operationId: string | undefined,
  totalRecordCount: number
): IBatchMutationOrchestration => ({
  operationId,
  groupId: operationId,
  totalRecordCount,
  totalChunkCount: 1,
  chunkIndex: 0,
  scope: 'operation',
});

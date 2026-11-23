import type { IVcsCloneRecordsHttpInput } from '@teable/v2-contract-http';
import type { IExecutionContext } from '@teable/v2-core';
import type { IVcsCloneRecordsChunk } from '@teable/v2-vcs';
import type { ListVcsTableRecordsChunkService } from '@teable/v2-vcs/server';

import { type IVcsEndpointErrorResult, toVcsEndpointError } from './shared';

export type ICloneVcsRecordsEndpointResult =
  | {
      readonly status: 200;
      readonly body: IVcsCloneRecordsChunk;
    }
  | IVcsEndpointErrorResult;

export const executeCloneVcsRecordsEndpoint = async (
  context: IExecutionContext,
  input: IVcsCloneRecordsHttpInput,
  listChunkService: ListVcsTableRecordsChunkService
): Promise<ICloneVcsRecordsEndpointResult> => {
  const parsedLimit = input.limit !== undefined ? Number(input.limit) : undefined;
  const res = await listChunkService.execute(context, {
    baseId: input.baseId,
    tableId: input.tableId,
    ...(input.cursor ? { cursor: input.cursor } : {}),
    ...(parsedLimit !== undefined && Number.isFinite(parsedLimit) ? { limit: parsedLimit } : {}),
  });
  if (res.isErr()) {
    return toVcsEndpointError(res.error);
  }
  return { status: 200, body: res.value };
};

import type { IVcsHeadHttpInput } from '@teable/v2-contract-http';
import type { IExecutionContext } from '@teable/v2-core';
import type { IVcsHeadInfo } from '@teable/v2-vcs';
import type { GetVcsHeadService } from '@teable/v2-vcs/server';

import { type IVcsEndpointErrorResult, toVcsEndpointError } from './shared';

export type IGetVcsHeadEndpointResult =
  | { readonly status: 200; readonly body: IVcsHeadInfo }
  | IVcsEndpointErrorResult;

export const executeGetVcsHeadEndpoint = async (
  context: IExecutionContext,
  input: IVcsHeadHttpInput,
  getHeadService: GetVcsHeadService
): Promise<IGetVcsHeadEndpointResult> => {
  const res = await getHeadService.execute(context, { baseId: input.baseId });
  if (res.isErr()) {
    return toVcsEndpointError(res.error);
  }
  return { status: 200, body: res.value };
};

import type { IVcsEnableHttpInput, IVcsEnableHttpOutput } from '@teable/v2-contract-http';
import type { IExecutionContext } from '@teable/v2-core';
import type { EnableBaseVcsService } from '@teable/v2-vcs/server';

import { type IVcsEndpointErrorResult, toVcsEndpointError } from './shared';

export type IEnableBaseVcsEndpointResult =
  | { readonly status: 200; readonly body: IVcsEnableHttpOutput }
  | IVcsEndpointErrorResult;

export const executeEnableBaseVcsEndpoint = async (
  context: IExecutionContext,
  input: IVcsEnableHttpInput,
  enableService: EnableBaseVcsService
): Promise<IEnableBaseVcsEndpointResult> => {
  const res = await enableService.execute(context, { baseId: input.baseId });
  if (res.isErr()) {
    return toVcsEndpointError(res.error);
  }
  return {
    status: 200,
    body: {
      baseId: input.baseId,
      enabled: true,
      headRevision: res.value.enabledAtRevision,
      enabledAtRevision: res.value.enabledAtRevision,
    },
  };
};

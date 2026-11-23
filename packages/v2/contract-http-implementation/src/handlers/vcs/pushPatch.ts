import type { IExecutionContext } from '@teable/v2-core';
import type { IVcsPushResult } from '@teable/v2-vcs';
import type { PushVcsPatchService } from '@teable/v2-vcs/server';

import { type IVcsEndpointErrorResult, toVcsEndpointError } from './shared';

export type IPushVcsPatchEndpointResult =
  | { readonly status: 200; readonly body: IVcsPushResult }
  | IVcsEndpointErrorResult;

export const executePushVcsPatchEndpoint = async (
  context: IExecutionContext,
  input: unknown,
  pushService: PushVcsPatchService
): Promise<IPushVcsPatchEndpointResult> => {
  const res = await pushService.execute(context, input);
  if (res.isErr()) {
    return toVcsEndpointError(res.error);
  }
  return { status: 200, body: res.value };
};

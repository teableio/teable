import type { IVcsCloneHttpInput } from '@teable/v2-contract-http';
import type { IExecutionContext } from '@teable/v2-core';
import type { IBaseVcsSnapshot, IVcsHeadInfo } from '@teable/v2-vcs';
import type { CloneVcsSnapshotService } from '@teable/v2-vcs/server';

import { type IVcsEndpointErrorResult, parseVcsTableIdsQuery, toVcsEndpointError } from './shared';

export type ICloneVcsSnapshotEndpointResult =
  | {
      readonly status: 200;
      readonly body: {
        readonly snapshot: IBaseVcsSnapshot;
        readonly remoteMode: IVcsHeadInfo['remoteMode'];
      };
    }
  | IVcsEndpointErrorResult;

const parseIncludeRecords = (raw: IVcsCloneHttpInput['includeRecords']): boolean | undefined => {
  if (typeof raw === 'boolean') return raw;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  return undefined;
};

export const executeCloneVcsSnapshotEndpoint = async (
  context: IExecutionContext,
  input: IVcsCloneHttpInput,
  cloneService: CloneVcsSnapshotService
): Promise<ICloneVcsSnapshotEndpointResult> => {
  const tableIds = parseVcsTableIdsQuery(input.tables, input.tableIds);
  const includeRecords = parseIncludeRecords(input.includeRecords);
  const res = await cloneService.execute(context, {
    baseId: input.baseId,
    ...(tableIds ? { tableIds } : {}),
    ...(includeRecords !== undefined ? { includeRecords } : {}),
  });
  if (res.isErr()) {
    return toVcsEndpointError(res.error);
  }
  return { status: 200, body: res.value };
};

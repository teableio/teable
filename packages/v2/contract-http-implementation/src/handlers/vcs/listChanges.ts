import type { IVcsChangesHttpInput } from '@teable/v2-contract-http';
import type { IExecutionContext } from '@teable/v2-core';
import type { IVcsIncrementalChanges } from '@teable/v2-vcs';
import type { ListVcsChangesService } from '@teable/v2-vcs/server';

import { type IVcsEndpointErrorResult, parseVcsTableIdsQuery, toVcsEndpointError } from './shared';

export type IListVcsChangesEndpointResult =
  | { readonly status: 200; readonly body: IVcsIncrementalChanges }
  | IVcsEndpointErrorResult;

const parseOptionalNonNegInt = (raw: unknown): number | undefined => {
  if (raw === undefined || raw === '') return undefined;
  const num = Number(raw);
  return Number.isInteger(num) && num >= 0 ? num : undefined;
};

export const executeListVcsChangesEndpoint = async (
  context: IExecutionContext,
  input: IVcsChangesHttpInput,
  listChangesService: ListVcsChangesService
): Promise<IListVcsChangesEndpointResult> => {
  const sinceRevision = parseOptionalNonNegInt(input.since);
  const limit = parseOptionalNonNegInt(input.limit);
  const tableIds = parseVcsTableIdsQuery(input.tables, input.tableIds);

  const res = await listChangesService.execute(context, {
    baseId: input.baseId,
    cursor: input.cursor,
    ...(sinceRevision !== undefined ? { sinceRevision } : {}),
    ...(limit !== undefined && limit > 0 ? { limit } : {}),
    ...(tableIds ? { tableIds } : {}),
  });
  if (res.isErr()) {
    return toVcsEndpointError(res.error);
  }
  return { status: 200, body: res.value };
};

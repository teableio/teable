import type { IListViewsEndpointResult } from '@teable/v2-contract-http';
import {
  mapDomainErrorToHttpError,
  mapDomainErrorToHttpStatus,
  mapListViewsResultToDto,
} from '@teable/v2-contract-http';
import { ListViewsQuery } from '@teable/v2-core';
import type { IExecutionContext, IQueryBus, ListViewsResult } from '@teable/v2-core';

export const executeListViewsEndpoint = async (
  context: IExecutionContext,
  rawInput: unknown,
  queryBus: IQueryBus
): Promise<IListViewsEndpointResult> => {
  const queryResult = ListViewsQuery.create(rawInput);
  if (queryResult.isErr()) {
    const error = queryResult.error;
    return {
      status: mapDomainErrorToHttpStatus(error),
      body: { ok: false, error: mapDomainErrorToHttpError(error) },
    };
  }

  const result = await queryBus.execute<ListViewsQuery, ListViewsResult>(
    context,
    queryResult.value
  );
  if (result.isErr()) {
    const error = result.error;
    return {
      status: mapDomainErrorToHttpStatus(error),
      body: { ok: false, error: mapDomainErrorToHttpError(error) },
    };
  }

  return {
    status: 200,
    body: {
      ok: true,
      data: mapListViewsResultToDto(result.value),
    },
  };
};

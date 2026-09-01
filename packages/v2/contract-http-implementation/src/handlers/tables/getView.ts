import type { IGetViewEndpointResult } from '@teable/v2-contract-http';
import {
  mapDomainErrorToHttpError,
  mapDomainErrorToHttpStatus,
  mapGetViewResultToDto,
} from '@teable/v2-contract-http';
import { GetViewQuery } from '@teable/v2-core';
import type { GetViewResult, IExecutionContext, IQueryBus } from '@teable/v2-core';

export const executeGetViewEndpoint = async (
  context: IExecutionContext,
  rawInput: unknown,
  queryBus: IQueryBus
): Promise<IGetViewEndpointResult> => {
  const queryResult = GetViewQuery.create(rawInput);
  if (queryResult.isErr()) {
    const error = queryResult.error;
    return {
      status: mapDomainErrorToHttpStatus(error),
      body: { ok: false, error: mapDomainErrorToHttpError(error) },
    };
  }

  const result = await queryBus.execute<GetViewQuery, GetViewResult>(context, queryResult.value);
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
      data: mapGetViewResultToDto(result.value),
    },
  };
};

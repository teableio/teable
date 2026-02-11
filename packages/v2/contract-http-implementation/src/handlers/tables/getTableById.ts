import type { IGetTableByIdEndpointResult } from '@teable/v2-contract-http';
import {
  mapDomainErrorToHttpError,
  mapDomainErrorToHttpStatus,
  mapGetTableByIdResultToDto,
} from '@teable/v2-contract-http';
import { GetTableByIdQuery } from '@teable/v2-core';
import type { GetTableByIdResult, IExecutionContext, IQueryBus } from '@teable/v2-core';

export const executeGetTableByIdEndpoint = async (
  context: IExecutionContext,
  rawInput: unknown,
  queryBus: IQueryBus
): Promise<IGetTableByIdEndpointResult> => {
  const queryResult = GetTableByIdQuery.create(rawInput);
  if (queryResult.isErr()) {
    const error = queryResult.error;
    return {
      status: mapDomainErrorToHttpStatus(error),
      body: { ok: false, error: mapDomainErrorToHttpError(error) },
    };
  }

  const result = await queryBus.execute<GetTableByIdQuery, GetTableByIdResult>(
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

  const mapped = mapGetTableByIdResultToDto(result.value);
  if (mapped.isErr()) {
    const error = mapped.error;
    return {
      status: mapDomainErrorToHttpStatus(error),
      body: { ok: false, error: mapDomainErrorToHttpError(error) },
    };
  }

  return {
    status: 200,
    body: {
      ok: true,
      data: mapped.value,
    },
  };
};

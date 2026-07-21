import type { IGetComputeActivityEndpointResult } from '@teable/v2-contract-http';
import {
  mapComputeActivitySnapshotToDto,
  mapDomainErrorToHttpError,
  mapDomainErrorToHttpStatus,
} from '@teable/v2-contract-http';
import { GetComputeActivityQuery } from '@teable/v2-core';
import type { GetComputeActivityResult, IExecutionContext, IQueryBus } from '@teable/v2-core';

export const executeGetComputeActivityEndpoint = async (
  context: IExecutionContext,
  rawInput: unknown,
  queryBus: IQueryBus
): Promise<IGetComputeActivityEndpointResult> => {
  const queryResult = GetComputeActivityQuery.create(rawInput);
  if (queryResult.isErr()) {
    const error = queryResult.error;
    return {
      status: mapDomainErrorToHttpStatus(error),
      body: { ok: false, error: mapDomainErrorToHttpError(error) },
    };
  }

  const result = await queryBus.execute<GetComputeActivityQuery, GetComputeActivityResult>(
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

  const mapped = mapComputeActivitySnapshotToDto(result.value.snapshot);
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

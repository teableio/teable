import type { IGetTableByIdEndpointResult } from '@teable/v2-contract-http';
import { mapGetTableByIdResultToDto } from '@teable/v2-contract-http';
import { GetTableByIdQuery } from '@teable/v2-core';
import type { GetTableByIdResult, IExecutionContext, IQueryBus } from '@teable/v2-core';

const isNotFoundError = (error: string): boolean =>
  error === 'Not found' || error === 'Table not found';

export const executeGetTableByIdEndpoint = async (
  context: IExecutionContext,
  rawInput: unknown,
  queryBus: IQueryBus
): Promise<IGetTableByIdEndpointResult> => {
  const queryResult = GetTableByIdQuery.create(rawInput);
  if (queryResult.isErr()) {
    return { status: 400, body: { ok: false, error: queryResult.error } };
  }

  const result = await queryBus.execute<GetTableByIdQuery, GetTableByIdResult>(
    context,
    queryResult.value
  );
  if (result.isErr()) {
    if (isNotFoundError(result.error)) {
      return { status: 404, body: { ok: false, error: result.error } };
    }
    return { status: 500, body: { ok: false, error: result.error } };
  }

  const mapped = mapGetTableByIdResultToDto(result.value);
  if (mapped.isErr()) {
    return { status: 500, body: { ok: false, error: mapped.error } };
  }

  return {
    status: 200,
    body: {
      ok: true,
      data: mapped.value,
    },
  };
};

import type { IListTablesEndpointResult } from '@teable/v2-contract-http';
import { mapListTablesResultToDto } from '@teable/v2-contract-http';
import { ListTablesQuery } from '@teable/v2-core';
import type { IExecutionContext, IQueryBus, ListTablesResult } from '@teable/v2-core';

export const executeListTablesEndpoint = async (
  context: IExecutionContext,
  rawInput: unknown,
  queryBus: IQueryBus
): Promise<IListTablesEndpointResult> => {
  const queryResult = ListTablesQuery.create(rawInput);
  if (queryResult.isErr()) {
    return { status: 400, body: { ok: false, error: queryResult.error } };
  }

  const result = await queryBus.execute<ListTablesQuery, ListTablesResult>(
    context,
    queryResult.value
  );
  if (result.isErr()) {
    return { status: 500, body: { ok: false, error: result.error } };
  }

  const mapped = mapListTablesResultToDto(result.value);
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

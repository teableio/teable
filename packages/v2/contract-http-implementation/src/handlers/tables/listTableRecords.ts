import type { IListTableRecordsEndpointResult } from '@teable/v2-contract-http';
import { mapListTableRecordsResultToDto } from '@teable/v2-contract-http';
import { ListTableRecordsQuery } from '@teable/v2-core';
import type { IExecutionContext, IQueryBus, ListTableRecordsResult } from '@teable/v2-core';

const isNotFoundError = (error: string): boolean =>
  error === 'Not found' || error === 'Table not found';

export const executeListTableRecordsEndpoint = async (
  context: IExecutionContext,
  rawInput: unknown,
  queryBus: IQueryBus
): Promise<IListTableRecordsEndpointResult> => {
  const queryResult = ListTableRecordsQuery.create(rawInput);
  if (queryResult.isErr()) {
    return { status: 400, body: { ok: false, error: queryResult.error } };
  }

  const result = await queryBus.execute<ListTableRecordsQuery, ListTableRecordsResult>(
    context,
    queryResult.value
  );
  if (result.isErr()) {
    if (isNotFoundError(result.error)) {
      return { status: 404, body: { ok: false, error: result.error } };
    }
    return { status: 500, body: { ok: false, error: result.error } };
  }

  const mapped = mapListTableRecordsResultToDto(result.value);
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

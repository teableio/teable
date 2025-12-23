import type { IDeleteTableEndpointResult } from '@teable/v2-contract-http';
import { mapDeleteTableResultToDto } from '@teable/v2-contract-http';
import { DeleteTableCommand } from '@teable/v2-core';
import type { DeleteTableResult, ICommandBus, IExecutionContext } from '@teable/v2-core';

const isNotFoundError = (error: string): boolean =>
  error === 'Not found' || error === 'Table not found';

export const executeDeleteTableEndpoint = async (
  context: IExecutionContext,
  rawBody: unknown,
  commandBus: ICommandBus
): Promise<IDeleteTableEndpointResult> => {
  const commandResult = DeleteTableCommand.create(rawBody);
  if (commandResult.isErr()) {
    return { status: 400, body: { ok: false, error: commandResult.error } };
  }

  const result = await commandBus.execute<DeleteTableCommand, DeleteTableResult>(
    context,
    commandResult.value
  );
  if (result.isErr()) {
    if (isNotFoundError(result.error)) {
      return { status: 404, body: { ok: false, error: result.error } };
    }
    return { status: 500, body: { ok: false, error: result.error } };
  }

  const mapped = mapDeleteTableResultToDto(result.value);
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

import type { IDeleteFieldEndpointResult } from '@teable/v2-contract-http';
import { mapDeleteFieldResultToDto } from '@teable/v2-contract-http';
import { DeleteFieldCommand } from '@teable/v2-core';
import type { DeleteFieldResult, ICommandBus, IExecutionContext } from '@teable/v2-core';

const isNotFoundError = (error: string): boolean =>
  error === 'Not found' || error === 'Table not found' || error === 'Field not found';

export const executeDeleteFieldEndpoint = async (
  context: IExecutionContext,
  rawBody: unknown,
  commandBus: ICommandBus
): Promise<IDeleteFieldEndpointResult> => {
  const commandResult = DeleteFieldCommand.create(rawBody);
  if (commandResult.isErr()) {
    return { status: 400, body: { ok: false, error: commandResult.error } };
  }

  const result = await commandBus.execute<DeleteFieldCommand, DeleteFieldResult>(
    context,
    commandResult.value
  );
  if (result.isErr()) {
    if (isNotFoundError(result.error)) {
      return { status: 404, body: { ok: false, error: result.error } };
    }
    return { status: 500, body: { ok: false, error: result.error } };
  }

  const mapped = mapDeleteFieldResultToDto(result.value);
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

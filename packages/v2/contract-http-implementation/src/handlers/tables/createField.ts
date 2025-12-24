import type { ICreateFieldEndpointResult } from '@teable/v2-contract-http';
import { mapCreateFieldResultToDto } from '@teable/v2-contract-http';
import { CreateFieldCommand } from '@teable/v2-core';
import type { CreateFieldResult, ICommandBus, IExecutionContext } from '@teable/v2-core';

const isNotFoundError = (error: string): boolean =>
  error === 'Not found' || error === 'Table not found';

export const executeCreateFieldEndpoint = async (
  context: IExecutionContext,
  rawBody: unknown,
  commandBus: ICommandBus
): Promise<ICreateFieldEndpointResult> => {
  const commandResult = CreateFieldCommand.create(rawBody);
  if (commandResult.isErr()) {
    return { status: 400, body: { ok: false, error: commandResult.error } };
  }

  const result = await commandBus.execute<CreateFieldCommand, CreateFieldResult>(
    context,
    commandResult.value
  );
  if (result.isErr()) {
    if (isNotFoundError(result.error)) {
      return { status: 404, body: { ok: false, error: result.error } };
    }
    return { status: 500, body: { ok: false, error: result.error } };
  }

  const mapped = mapCreateFieldResultToDto(result.value);
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

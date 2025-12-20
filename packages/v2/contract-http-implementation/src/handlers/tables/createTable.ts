import type { ICommandBus, IExecutionContext } from '@teable/v2-core';
import { CreateTableCommand, type CreateTableResult } from '@teable/v2-core';
import type { ICreateTableEndpointResult } from '@teable/v2-contract-http';
import { mapCreateTableResultToDto } from '@teable/v2-contract-http';

export const executeCreateTableEndpoint = async (
  context: IExecutionContext,
  rawBody: unknown,
  commandBus: ICommandBus
): Promise<ICreateTableEndpointResult> => {
  const commandResult = CreateTableCommand.create(rawBody);
  if (commandResult.isErr()) {
    return { status: 400, body: { ok: false, error: commandResult.error } };
  }

  const result = await commandBus.execute<CreateTableCommand, CreateTableResult>(
    context,
    commandResult.value
  );
  if (result.isErr()) {
    return { status: 500, body: { ok: false, error: result.error } };
  }

  const mapped = mapCreateTableResultToDto(result.value);
  if (mapped.isErr()) {
    return { status: 500, body: { ok: false, error: mapped.error } };
  }

  return {
    status: 201,
    body: {
      ok: true,
      data: mapped.value,
    },
  };
};

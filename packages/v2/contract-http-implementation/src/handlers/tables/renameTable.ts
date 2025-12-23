import type { IRenameTableEndpointResult } from '@teable/v2-contract-http';
import { mapRenameTableResultToDto } from '@teable/v2-contract-http';
import { RenameTableCommand } from '@teable/v2-core';
import type { ICommandBus, IExecutionContext, RenameTableResult } from '@teable/v2-core';

const isNotFoundError = (error: string): boolean =>
  error === 'Not found' || error === 'Table not found';

export const executeRenameTableEndpoint = async (
  context: IExecutionContext,
  rawBody: unknown,
  commandBus: ICommandBus
): Promise<IRenameTableEndpointResult> => {
  const commandResult = RenameTableCommand.create(rawBody);
  if (commandResult.isErr()) {
    return { status: 400, body: { ok: false, error: commandResult.error } };
  }

  const result = await commandBus.execute<RenameTableCommand, RenameTableResult>(
    context,
    commandResult.value
  );
  if (result.isErr()) {
    if (isNotFoundError(result.error)) {
      return { status: 404, body: { ok: false, error: result.error } };
    }
    return { status: 500, body: { ok: false, error: result.error } };
  }

  const mapped = mapRenameTableResultToDto(result.value);
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

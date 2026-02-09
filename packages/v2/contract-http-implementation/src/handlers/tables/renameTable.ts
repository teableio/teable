import type { IRenameTableEndpointResult } from '@teable/v2-contract-http';
import {
  mapDomainErrorToHttpError,
  mapDomainErrorToHttpStatus,
  mapRenameTableResultToDto,
} from '@teable/v2-contract-http';
import { RenameTableCommand } from '@teable/v2-core';
import type { ICommandBus, IExecutionContext, RenameTableResult } from '@teable/v2-core';

export const executeRenameTableEndpoint = async (
  context: IExecutionContext,
  rawBody: unknown,
  commandBus: ICommandBus
): Promise<IRenameTableEndpointResult> => {
  const commandResult = RenameTableCommand.create(rawBody);
  if (commandResult.isErr()) {
    const error = commandResult.error;
    return {
      status: mapDomainErrorToHttpStatus(error),
      body: { ok: false, error: mapDomainErrorToHttpError(error) },
    };
  }

  const result = await commandBus.execute<RenameTableCommand, RenameTableResult>(
    context,
    commandResult.value
  );
  if (result.isErr()) {
    const error = result.error;
    return {
      status: mapDomainErrorToHttpStatus(error),
      body: { ok: false, error: mapDomainErrorToHttpError(error) },
    };
  }

  const mapped = mapRenameTableResultToDto(result.value);
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

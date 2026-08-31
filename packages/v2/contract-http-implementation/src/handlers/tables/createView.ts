import type { ICreateViewEndpointResult } from '@teable/v2-contract-http';
import {
  mapCreateViewResultToDto,
  mapDomainErrorToHttpError,
  mapDomainErrorToHttpStatus,
} from '@teable/v2-contract-http';
import { CreateViewCommand } from '@teable/v2-core';
import type { CreateViewResult, ICommandBus, IExecutionContext } from '@teable/v2-core';

export const executeCreateViewEndpoint = async (
  context: IExecutionContext,
  rawBody: unknown,
  commandBus: ICommandBus
): Promise<ICreateViewEndpointResult> => {
  const commandResult = CreateViewCommand.create(rawBody);
  if (commandResult.isErr()) {
    const error = commandResult.error;
    return {
      status: mapDomainErrorToHttpStatus(error),
      body: { ok: false, error: mapDomainErrorToHttpError(error) },
    };
  }

  const result = await commandBus.execute<CreateViewCommand, CreateViewResult>(
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

  const mapped = mapCreateViewResultToDto(result.value);
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

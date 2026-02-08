import type { ICreateTableEndpointResult } from '@teable/v2-contract-http';
import {
  mapCreateTableResultToDto,
  mapDomainErrorToHttpError,
  mapDomainErrorToHttpStatus,
} from '@teable/v2-contract-http';
import { CreateTableCommand } from '@teable/v2-core';
import type { CreateTableResult, ICommandBus, IExecutionContext } from '@teable/v2-core';

export const executeCreateTableEndpoint = async (
  context: IExecutionContext,
  rawBody: unknown,
  commandBus: ICommandBus
): Promise<ICreateTableEndpointResult> => {
  const commandResult = CreateTableCommand.create(rawBody, { t: context.$t });
  if (commandResult.isErr()) {
    const error = commandResult.error;
    return {
      status: mapDomainErrorToHttpStatus(error),
      body: { ok: false, error: mapDomainErrorToHttpError(error) },
    };
  }

  const result = await commandBus.execute<CreateTableCommand, CreateTableResult>(
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

  const mapped = mapCreateTableResultToDto(result.value);
  if (mapped.isErr()) {
    const error = mapped.error;
    return {
      status: mapDomainErrorToHttpStatus(error),
      body: { ok: false, error: mapDomainErrorToHttpError(error) },
    };
  }

  return {
    status: 201,
    body: {
      ok: true,
      data: mapped.value,
    },
  };
};

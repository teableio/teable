import type { ICreateRecordsEndpointResult } from '@teable/v2-contract-http';
import {
  mapCreateRecordsResultToDto,
  mapDomainErrorToHttpError,
  mapDomainErrorToHttpStatus,
} from '@teable/v2-contract-http';
import { CreateRecordsCommand } from '@teable/v2-core';
import type { CreateRecordsResult, ICommandBus, IExecutionContext } from '@teable/v2-core';

export const executeCreateRecordsEndpoint = async (
  context: IExecutionContext,
  rawBody: unknown,
  commandBus: ICommandBus
): Promise<ICreateRecordsEndpointResult> => {
  const commandResult = CreateRecordsCommand.create(rawBody);
  if (commandResult.isErr()) {
    const error = commandResult.error;
    return {
      status: mapDomainErrorToHttpStatus(error),
      body: { ok: false, error: mapDomainErrorToHttpError(error) },
    };
  }

  const result = await commandBus.execute<CreateRecordsCommand, CreateRecordsResult>(
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

  const mapped = mapCreateRecordsResultToDto(result.value);
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

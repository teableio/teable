import type { IDuplicateTableEndpointResult } from '@teable/v2-contract-http';
import {
  mapDomainErrorToHttpError,
  mapDomainErrorToHttpStatus,
  mapDuplicateTableResultToDto,
} from '@teable/v2-contract-http';
import { DuplicateTableCommand } from '@teable/v2-core';
import type { DuplicateTableResult, ICommandBus, IExecutionContext } from '@teable/v2-core';

export const executeDuplicateTableEndpoint = async (
  context: IExecutionContext,
  rawBody: unknown,
  commandBus: ICommandBus
): Promise<IDuplicateTableEndpointResult> => {
  const commandResult = DuplicateTableCommand.create(rawBody);
  if (commandResult.isErr()) {
    const error = commandResult.error;
    return {
      status: mapDomainErrorToHttpStatus(error),
      body: { ok: false, error: mapDomainErrorToHttpError(error) },
    };
  }

  const result = await commandBus.execute<DuplicateTableCommand, DuplicateTableResult>(
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

  const mapped = mapDuplicateTableResultToDto(result.value);
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

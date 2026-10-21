import type { IDuplicateBaseEndpointResult } from '@teable/v2-contract-http';
import {
  mapDomainErrorToHttpError,
  mapDomainErrorToHttpStatus,
  mapDuplicateBaseResultToDto,
} from '@teable/v2-contract-http';
import { DuplicateBaseByIdCommand } from '@teable/v2-core';
import type { DuplicateBaseByIdResult, ICommandBus, IExecutionContext } from '@teable/v2-core';

export const executeDuplicateBaseEndpoint = async (
  context: IExecutionContext,
  rawBody: unknown,
  commandBus: ICommandBus
): Promise<IDuplicateBaseEndpointResult> => {
  const commandResult = DuplicateBaseByIdCommand.create(rawBody);
  if (commandResult.isErr()) {
    const error = commandResult.error;
    return {
      status: mapDomainErrorToHttpStatus(error),
      body: { ok: false, error: mapDomainErrorToHttpError(error) },
    };
  }

  const result = await commandBus.execute<DuplicateBaseByIdCommand, DuplicateBaseByIdResult>(
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

  const mapped = mapDuplicateBaseResultToDto(result.value);
  if (mapped.isErr()) {
    const error = mapped.error;
    return {
      status: mapDomainErrorToHttpStatus(error),
      body: { ok: false, error: mapDomainErrorToHttpError(error) },
    };
  }

  return { status: 201, body: { ok: true, data: mapped.value } };
};

import type { IDuplicateRecordEndpointResult } from '@teable/v2-contract-http';
import {
  mapDuplicateRecordResultToDto,
  mapDomainErrorToHttpError,
  mapDomainErrorToHttpStatus,
} from '@teable/v2-contract-http';
import { DuplicateRecordCommand } from '@teable/v2-core';
import type { DuplicateRecordResult, ICommandBus, IExecutionContext } from '@teable/v2-core';

export const executeDuplicateRecordEndpoint = async (
  context: IExecutionContext,
  rawBody: unknown,
  commandBus: ICommandBus
): Promise<IDuplicateRecordEndpointResult> => {
  const commandResult = DuplicateRecordCommand.create(rawBody);
  if (commandResult.isErr()) {
    const error = commandResult.error;
    return {
      status: mapDomainErrorToHttpStatus(error),
      body: { ok: false, error: mapDomainErrorToHttpError(error) },
    };
  }

  const command = commandResult.value;

  const result = await commandBus.execute<DuplicateRecordCommand, DuplicateRecordResult>(
    context,
    command
  );
  if (result.isErr()) {
    const error = result.error;
    return {
      status: mapDomainErrorToHttpStatus(error),
      body: { ok: false, error: mapDomainErrorToHttpError(error) },
    };
  }

  const mapped = mapDuplicateRecordResultToDto(result.value);
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

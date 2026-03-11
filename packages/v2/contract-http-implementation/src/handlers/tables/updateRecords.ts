import type { IUpdateRecordsEndpointResult } from '@teable/v2-contract-http';
import {
  mapDomainErrorToHttpError,
  mapDomainErrorToHttpStatus,
  mapUpdateRecordsResultToDto,
} from '@teable/v2-contract-http';
import { UpdateRecordsCommand } from '@teable/v2-core';
import type { ICommandBus, IExecutionContext, UpdateRecordsResult } from '@teable/v2-core';

export const executeUpdateRecordsEndpoint = async (
  context: IExecutionContext,
  rawBody: unknown,
  commandBus: ICommandBus
): Promise<IUpdateRecordsEndpointResult> => {
  const commandResult = UpdateRecordsCommand.create(rawBody);
  if (commandResult.isErr()) {
    const error = commandResult.error;
    return {
      status: mapDomainErrorToHttpStatus(error),
      body: { ok: false, error: mapDomainErrorToHttpError(error) },
    };
  }

  const result = await commandBus.execute<UpdateRecordsCommand, UpdateRecordsResult>(
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

  const mapped = mapUpdateRecordsResultToDto(result.value);
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

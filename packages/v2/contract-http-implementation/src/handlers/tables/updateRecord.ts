import type { IUpdateRecordEndpointResult } from '@teable/v2-contract-http';
import {
  mapDomainErrorToHttpError,
  mapDomainErrorToHttpStatus,
  mapUpdateRecordResultToDto,
} from '@teable/v2-contract-http';
import { UpdateRecordCommand } from '@teable/v2-core';
import type { ICommandBus, IExecutionContext, UpdateRecordResult } from '@teable/v2-core';

export const executeUpdateRecordEndpoint = async (
  context: IExecutionContext,
  rawBody: unknown,
  commandBus: ICommandBus
): Promise<IUpdateRecordEndpointResult> => {
  const commandResult = UpdateRecordCommand.create(rawBody);
  if (commandResult.isErr()) {
    const error = commandResult.error;
    return {
      status: mapDomainErrorToHttpStatus(error),
      body: { ok: false, error: mapDomainErrorToHttpError(error) },
    };
  }

  const result = await commandBus.execute<UpdateRecordCommand, UpdateRecordResult>(
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

  const mapped = mapUpdateRecordResultToDto(result.value);
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

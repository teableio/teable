import type { ISubmitRecordEndpointResult } from '@teable/v2-contract-http';
import {
  mapDomainErrorToHttpError,
  mapDomainErrorToHttpStatus,
  mapSubmitRecordResultToDto,
} from '@teable/v2-contract-http';
import { SubmitRecordCommand } from '@teable/v2-core';
import type { CreateRecordResult, ICommandBus, IExecutionContext } from '@teable/v2-core';

export const executeSubmitRecordEndpoint = async (
  context: IExecutionContext,
  rawBody: unknown,
  commandBus: ICommandBus
): Promise<ISubmitRecordEndpointResult> => {
  const commandResult = SubmitRecordCommand.create(rawBody);
  if (commandResult.isErr()) {
    const error = commandResult.error;
    return {
      status: mapDomainErrorToHttpStatus(error),
      body: { ok: false, error: mapDomainErrorToHttpError(error) },
    };
  }

  const command = commandResult.value;

  const result = await commandBus.execute<SubmitRecordCommand, CreateRecordResult>(
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

  const mapped = mapSubmitRecordResultToDto(result.value);
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

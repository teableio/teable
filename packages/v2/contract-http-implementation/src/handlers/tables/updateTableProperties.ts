import {
  mapDomainErrorToHttpError,
  mapDomainErrorToHttpStatus,
  mapUpdateTablePropertiesResultToDto,
  type IUpdateTablePropertiesEndpointResult,
} from '@teable/v2-contract-http';
import {
  UpdateTablePropertiesCommand,
  type ICommandBus,
  type IExecutionContext,
  type UpdateTablePropertiesResult,
} from '@teable/v2-core';

export const executeUpdateTablePropertiesEndpoint = async (
  context: IExecutionContext,
  rawBody: unknown,
  commandBus: ICommandBus
): Promise<IUpdateTablePropertiesEndpointResult> => {
  const commandResult = UpdateTablePropertiesCommand.create(rawBody);
  if (commandResult.isErr()) {
    const error = commandResult.error;
    return {
      status: mapDomainErrorToHttpStatus(error),
      body: { ok: false, error: mapDomainErrorToHttpError(error) },
    };
  }

  const result = await commandBus.execute<
    UpdateTablePropertiesCommand,
    UpdateTablePropertiesResult
  >(context, commandResult.value);
  if (result.isErr()) {
    const error = result.error;
    return {
      status: mapDomainErrorToHttpStatus(error),
      body: { ok: false, error: mapDomainErrorToHttpError(error) },
    };
  }

  const mapped = mapUpdateTablePropertiesResultToDto(result.value);
  if (mapped.isErr()) {
    const error = mapped.error;
    return {
      status: mapDomainErrorToHttpStatus(error),
      body: { ok: false, error: mapDomainErrorToHttpError(error) },
    };
  }

  return { status: 200, body: { ok: true, data: mapped.value } };
};

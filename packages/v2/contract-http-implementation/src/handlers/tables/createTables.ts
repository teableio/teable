import type { ICreateTablesEndpointResult } from '@teable/v2-contract-http';
import {
  mapCreateTablesResultToDto,
  mapDomainErrorToHttpError,
  mapDomainErrorToHttpStatus,
} from '@teable/v2-contract-http';
import { CreateTablesCommand } from '@teable/v2-core';
import type { CreateTablesResult, ICommandBus, IExecutionContext } from '@teable/v2-core';

export const executeCreateTablesEndpoint = async (
  context: IExecutionContext,
  rawBody: unknown,
  commandBus: ICommandBus
): Promise<ICreateTablesEndpointResult> => {
  const commandResult = CreateTablesCommand.create(rawBody, { t: context.$t });
  if (commandResult.isErr()) {
    const error = commandResult.error;
    return {
      status: mapDomainErrorToHttpStatus(error),
      body: { ok: false, error: mapDomainErrorToHttpError(error) },
    };
  }

  const result = await commandBus.execute<CreateTablesCommand, CreateTablesResult>(
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

  const mapped = mapCreateTablesResultToDto(result.value);
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

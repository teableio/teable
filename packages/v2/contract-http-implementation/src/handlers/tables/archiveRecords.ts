import type { IArchiveRecordsEndpointResult } from '@teable/v2-contract-http';
import {
  mapArchiveRecordsResultToDto,
  mapDomainErrorToHttpError,
  mapDomainErrorToHttpStatus,
} from '@teable/v2-contract-http';
import { ArchiveRecordsCommand } from '@teable/v2-core';
import type {
  ArchiveRecordsResult,
  IArchiveRecordsCommandOptions,
  ICommandBus,
  IExecutionContext,
} from '@teable/v2-core';

export const executeArchiveRecordsEndpoint = async (
  context: IExecutionContext,
  rawBody: unknown,
  commandBus: ICommandBus,
  // Internal-only options (operationId / undo group); never populated from the HTTP contract.
  options?: IArchiveRecordsCommandOptions
): Promise<IArchiveRecordsEndpointResult> => {
  const commandResult = ArchiveRecordsCommand.create(rawBody, options);
  if (commandResult.isErr()) {
    const error = commandResult.error;
    return {
      status: mapDomainErrorToHttpStatus(error),
      body: { ok: false, error: mapDomainErrorToHttpError(error) },
    };
  }

  const result = await commandBus.execute<ArchiveRecordsCommand, ArchiveRecordsResult>(
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

  const mapped = mapArchiveRecordsResultToDto(result.value);
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

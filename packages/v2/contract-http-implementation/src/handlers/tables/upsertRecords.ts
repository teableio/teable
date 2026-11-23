import type { IUpsertRecordsEndpointResult } from '@teable/v2-contract-http';
import {
  mapDomainErrorToHttpError,
  mapDomainErrorToHttpStatus,
  mapUpsertRecordsResultToDto,
} from '@teable/v2-contract-http';
import { UpsertRecordsCommand } from '@teable/v2-core';
import type { ICommandBus, IExecutionContext, RecordCreateSource, UpsertRecordsResult } from '@teable/v2-core';

export const executeUpsertRecordsEndpoint = async (
  context: IExecutionContext,
  rawBody: unknown,
  commandBus: ICommandBus,
  options?: { source?: RecordCreateSource }
): Promise<IUpsertRecordsEndpointResult> => {
  const command = UpsertRecordsCommand.create(rawBody, options);
  if (command.isErr()) {
    return {
      status: mapDomainErrorToHttpStatus(command.error),
      body: { ok: false, error: mapDomainErrorToHttpError(command.error) },
    };
  }
  const result = await commandBus.execute<UpsertRecordsCommand, UpsertRecordsResult>(context, command.value);
  if (result.isErr()) {
    return {
      status: mapDomainErrorToHttpStatus(result.error),
      body: { ok: false, error: mapDomainErrorToHttpError(result.error) },
    };
  }
  return { status: 200, body: { ok: true, data: mapUpsertRecordsResultToDto(result.value) } };
};

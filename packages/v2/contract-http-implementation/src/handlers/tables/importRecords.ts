import type { IImportRecordsEndpointResult } from '@teable/v2-contract-http';
import {
  mapDomainErrorToHttpError,
  mapDomainErrorToHttpStatus,
  mapImportRecordsResultToDto,
} from '@teable/v2-contract-http';
import { ImportRecordsCommand } from '@teable/v2-core';
import type { ICommandBus, IExecutionContext, ImportRecordsResult } from '@teable/v2-core';

export const executeImportRecordsEndpoint = async (
  context: IExecutionContext,
  rawBody: unknown,
  commandBus: ICommandBus
): Promise<IImportRecordsEndpointResult> => {
  const body = rawBody as {
    tableId: string;
    fileType: string;
    sourceColumnMap: Record<string, number | null>;
    options?: {
      batchSize?: number;
      skipFirstNLines?: number;
      sheetName?: string;
      typecast?: boolean;
      delimiter?: string;
    };
    csvData?: string;
    url?: string;
  };

  // Build the source from input
  const source = body.url
    ? { type: body.fileType, url: body.url }
    : { type: body.fileType, data: body.csvData };

  const commandResult = ImportRecordsCommand.create({
    tableId: body.tableId,
    source,
    sourceColumnMap: body.sourceColumnMap,
    options: body.options,
  });

  if (commandResult.isErr()) {
    const error = commandResult.error;
    return {
      status: mapDomainErrorToHttpStatus(error),
      body: { ok: false, error: mapDomainErrorToHttpError(error) },
    };
  }

  const result = await commandBus.execute<ImportRecordsCommand, ImportRecordsResult>(
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

  const mapped = mapImportRecordsResultToDto(result.value);
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

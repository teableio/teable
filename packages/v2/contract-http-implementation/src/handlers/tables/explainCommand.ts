import type { IExplainService } from '@teable/v2-command-explain';
import type { IExplainEndpointResult, IExplainResultDto } from '@teable/v2-contract-http';
import { mapDomainErrorToHttpError, mapDomainErrorToHttpStatus } from '@teable/v2-contract-http';
import {
  CreateRecordCommand,
  UpdateRecordCommand,
  DeleteRecordsCommand,
  RecordId,
  TableId,
} from '@teable/v2-core';
import type { IExecutionContext } from '@teable/v2-core';

export interface IExplainCreateRecordInput {
  tableId: string;
  fields: Record<string, unknown>;
  analyze?: boolean;
  includeSql?: boolean;
  includeGraph?: boolean;
  includeLocks?: boolean;
}

export interface IExplainUpdateRecordInput {
  tableId: string;
  recordId: string;
  fields: Record<string, unknown>;
  analyze?: boolean;
  includeSql?: boolean;
  includeGraph?: boolean;
  includeLocks?: boolean;
}

export interface IExplainDeleteRecordsInput {
  tableId: string;
  recordIds: string[];
  analyze?: boolean;
  includeSql?: boolean;
  includeGraph?: boolean;
  includeLocks?: boolean;
}

export const executeExplainCreateRecordEndpoint = async (
  context: IExecutionContext,
  input: IExplainCreateRecordInput,
  explainService: IExplainService
): Promise<IExplainEndpointResult> => {
  // Create the command
  const tableIdResult = TableId.create(input.tableId);
  if (tableIdResult.isErr()) {
    return {
      status: 400,
      body: {
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: tableIdResult.error.message,
          tags: ['validation'],
        },
      },
    };
  }

  const commandResult = CreateRecordCommand.create({
    tableId: input.tableId,
    fields: input.fields,
  });

  if (commandResult.isErr()) {
    const error = commandResult.error;
    return {
      status: mapDomainErrorToHttpStatus(error),
      body: { ok: false, error: mapDomainErrorToHttpError(error) },
    };
  }

  const result = await explainService.explain(context, commandResult.value, {
    analyze: input.analyze ?? false,
    includeSql: input.includeSql ?? true,
    includeGraph: input.includeGraph ?? false,
    includeLocks: input.includeLocks ?? true,
  });

  if (result.isErr()) {
    const error = result.error;
    return {
      status: mapDomainErrorToHttpStatus(error),
      body: { ok: false, error: mapDomainErrorToHttpError(error) },
    };
  }

  return {
    status: 200,
    body: {
      ok: true,
      data: result.value as IExplainResultDto,
    },
  };
};

export const executeExplainUpdateRecordEndpoint = async (
  context: IExecutionContext,
  input: IExplainUpdateRecordInput,
  explainService: IExplainService
): Promise<IExplainEndpointResult> => {
  const commandResult = UpdateRecordCommand.create({
    tableId: input.tableId,
    recordId: input.recordId,
    fields: input.fields,
  });

  if (commandResult.isErr()) {
    const error = commandResult.error;
    return {
      status: mapDomainErrorToHttpStatus(error),
      body: { ok: false, error: mapDomainErrorToHttpError(error) },
    };
  }

  const result = await explainService.explain(context, commandResult.value, {
    analyze: input.analyze ?? false,
    includeSql: input.includeSql ?? true,
    includeGraph: input.includeGraph ?? false,
    includeLocks: input.includeLocks ?? true,
  });

  if (result.isErr()) {
    const error = result.error;
    return {
      status: mapDomainErrorToHttpStatus(error),
      body: { ok: false, error: mapDomainErrorToHttpError(error) },
    };
  }

  return {
    status: 200,
    body: {
      ok: true,
      data: result.value as IExplainResultDto,
    },
  };
};

export const executeExplainDeleteRecordsEndpoint = async (
  context: IExecutionContext,
  input: IExplainDeleteRecordsInput,
  explainService: IExplainService
): Promise<IExplainEndpointResult> => {
  // Parse record IDs
  for (const idStr of input.recordIds) {
    const recordIdResult = RecordId.create(idStr);
    if (recordIdResult.isErr()) {
      return {
        status: 400,
        body: {
          ok: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: `Invalid record ID: ${idStr}`,
            tags: ['validation'],
          },
        },
      };
    }
  }

  const commandResult = DeleteRecordsCommand.create({
    tableId: input.tableId,
    recordIds: input.recordIds,
  });

  if (commandResult.isErr()) {
    const error = commandResult.error;
    return {
      status: mapDomainErrorToHttpStatus(error),
      body: { ok: false, error: mapDomainErrorToHttpError(error) },
    };
  }

  const result = await explainService.explain(context, commandResult.value, {
    analyze: input.analyze ?? false,
    includeSql: input.includeSql ?? true,
    includeGraph: input.includeGraph ?? false,
    includeLocks: input.includeLocks ?? true,
  });

  if (result.isErr()) {
    const error = result.error;
    return {
      status: mapDomainErrorToHttpStatus(error),
      body: { ok: false, error: mapDomainErrorToHttpError(error) },
    };
  }

  return {
    status: 200,
    body: {
      ok: true,
      data: result.value as IExplainResultDto,
    },
  };
};

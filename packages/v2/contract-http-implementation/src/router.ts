import { ORPCError, implement } from '@orpc/server';
import type { IExplainService } from '@teable/v2-command-explain';
import { v2CommandExplainTokens } from '@teable/v2-command-explain';
import type { IHandlerResolver } from '@teable/v2-contract-http';
import { v2Contract } from '@teable/v2-contract-http';
import {
  ActorId,
  type ICommandBus,
  type IExecutionContext,
  type IQueryBus,
  v2CoreTokens,
} from '@teable/v2-core';

import { executeCreateBaseEndpoint } from './handlers/bases/createBase';
import { executeListBasesEndpoint } from './handlers/bases/listBases';
import { executeCreateFieldEndpoint } from './handlers/tables/createField';
import { executeCreateRecordEndpoint } from './handlers/tables/createRecord';
import { executeSubmitRecordEndpoint } from './handlers/tables/submitRecord';
import { executeCreateRecordsEndpoint } from './handlers/tables/createRecords';
import { executeCreateTableEndpoint } from './handlers/tables/createTable';
import { executeCreateTablesEndpoint } from './handlers/tables/createTables';
import { executeDeleteFieldEndpoint } from './handlers/tables/deleteField';
import { executeDeleteRecordsEndpoint } from './handlers/tables/deleteRecords';
import { executeDeleteTableEndpoint } from './handlers/tables/deleteTable';
import {
  executeExplainCreateRecordEndpoint,
  executeExplainDeleteRecordsEndpoint,
  executeExplainUpdateRecordEndpoint,
} from './handlers/tables/explainCommand';
import { executeGetRecordByIdEndpoint } from './handlers/tables/getRecordById';
import { executeGetTableByIdEndpoint } from './handlers/tables/getTableById';
import { executeImportCsvEndpoint } from './handlers/tables/importCsv';
import { executeImportRecordsEndpoint } from './handlers/tables/importRecords';
import { executeListTableRecordsEndpoint } from './handlers/tables/listTableRecords';
import { executeListTablesEndpoint } from './handlers/tables/listTables';
import { executePasteEndpoint } from './handlers/tables/paste';
import { executeClearEndpoint } from './handlers/tables/clear';
import { executeDeleteByRangeEndpoint } from './handlers/tables/deleteByRange';
import { executeRenameTableEndpoint } from './handlers/tables/renameTable';
import { executeUpdateRecordEndpoint } from './handlers/tables/updateRecord';
import { executeReorderRecordsEndpoint } from './handlers/tables/reorderRecords';
import { executeDuplicateRecordEndpoint } from './handlers/tables/duplicateRecord';

export interface IV2OrpcRouterOptions {
  createContainer?: () => IHandlerResolver | Promise<IHandlerResolver>;
  createExecutionContext?: () => IExecutionContext | Promise<IExecutionContext>;
}

export const createV2OrpcRouter = (options: IV2OrpcRouterOptions = {}) => {
  let defaultContainerPromise: Promise<IHandlerResolver> | undefined;
  const createDefaultContainer = async (): Promise<IHandlerResolver> => {
    const { createV2NodePgContainer } = await import('@teable/v2-container-node');
    return createV2NodePgContainer();
  };
  const createContainer =
    options.createContainer ??
    (() => {
      if (!defaultContainerPromise) defaultContainerPromise = createDefaultContainer();
      return defaultContainerPromise;
    });
  const createExecutionContext =
    options.createExecutionContext ??
    (() => {
      const actorIdResult = ActorId.create('system');
      if (actorIdResult.isErr()) {
        throw new Error(actorIdResult.error.message);
      }
      return { actorId: actorIdResult.value };
    });

  const containerErrorMessage = 'Failed to create container';
  const executionContextErrorMessage = 'Failed to resolve execution context';

  const handleContainerError = (error: unknown): never => {
    let detail: string;
    if (error instanceof Error) {
      detail = error.message || error.stack || String(error);
    } else {
      detail = JSON.stringify(error, null, 2);
    }
    const message = `${containerErrorMessage}: ${detail}`;
    console.error(message, error);
    throw new ORPCError('INTERNAL_SERVER_ERROR', { message });
  };

  const resolveContainer = async (): Promise<IHandlerResolver> => {
    try {
      return await Promise.resolve(createContainer());
    } catch (error) {
      return handleContainerError(error);
    }
  };

  /**
   * Maps HTTP error response body to ORPCError with domain error info preserved.
   * Domain error code and tags are passed in the data property for extraction by the OpenAPI handler.
   */
  const throwDomainError = (
    orpcCode: 'BAD_REQUEST' | 'FORBIDDEN' | 'NOT_FOUND' | 'INTERNAL_SERVER_ERROR',
    errorBody: {
      message: string;
      code: string;
      tags: readonly string[];
      details?: Record<string, unknown>;
    }
  ): never => {
    throw new ORPCError(orpcCode, {
      message: errorBody.message,
      data: {
        domainCode: errorBody.code,
        domainTags: errorBody.tags,
        details: errorBody.details,
      },
    });
  };

  const os = implement(v2Contract);

  const basesCreate = os.bases.create.handler(async ({ input }) => {
    const container = await resolveContainer();

    let executionContext: IExecutionContext;
    try {
      executionContext = await createExecutionContext();
    } catch {
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: executionContextErrorMessage,
      });
    }

    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const result = await executeCreateBaseEndpoint(executionContext, input, commandBus);

    if (result.status === 201) return result.body;

    if (result.status === 400) {
      throwDomainError('BAD_REQUEST', result.body.error);
    }

    throwDomainError('INTERNAL_SERVER_ERROR', result.body.error);
  });

  const basesList = os.bases.list.handler(async ({ input }) => {
    const container = await resolveContainer();

    let executionContext: IExecutionContext;
    try {
      executionContext = await createExecutionContext();
    } catch {
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: executionContextErrorMessage,
      });
    }

    const queryBus = container.resolve<IQueryBus>(v2CoreTokens.queryBus);
    const result = await executeListBasesEndpoint(executionContext, input, queryBus);

    if (result.status === 200) return result.body;

    if (result.status === 400) {
      throwDomainError('BAD_REQUEST', result.body.error);
    }

    throwDomainError('INTERNAL_SERVER_ERROR', result.body.error);
  });

  const tablesCreate = os.tables.create.handler(async ({ input }) => {
    const container = await resolveContainer();

    let executionContext: IExecutionContext;
    try {
      executionContext = await createExecutionContext();
    } catch {
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: executionContextErrorMessage,
      });
    }

    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const result = await executeCreateTableEndpoint(executionContext, input, commandBus);

    if (result.status === 201) return result.body;

    if (result.status === 400) {
      throwDomainError('BAD_REQUEST', result.body.error);
    }

    throwDomainError('INTERNAL_SERVER_ERROR', result.body.error);
  });

  const tablesCreateTables = os.tables.createTables.handler(async ({ input }) => {
    const container = await resolveContainer();

    let executionContext: IExecutionContext;
    try {
      executionContext = await createExecutionContext();
    } catch {
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: executionContextErrorMessage,
      });
    }

    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const result = await executeCreateTablesEndpoint(executionContext, input, commandBus);

    if (result.status === 201) return result.body;

    if (result.status === 400) {
      throwDomainError('BAD_REQUEST', result.body.error);
    }

    throwDomainError('INTERNAL_SERVER_ERROR', result.body.error);
  });

  const tablesCreateField = os.tables.createField.handler(async ({ input }) => {
    const container = await resolveContainer();

    let executionContext: IExecutionContext;
    try {
      executionContext = await createExecutionContext();
    } catch {
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: executionContextErrorMessage,
      });
    }

    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const result = await executeCreateFieldEndpoint(executionContext, input, commandBus);

    if (result.status === 200) return result.body;

    if (result.status === 400) {
      throwDomainError('BAD_REQUEST', result.body.error);
    }

    if (result.status === 404) {
      throwDomainError('NOT_FOUND', result.body.error);
    }

    throwDomainError('INTERNAL_SERVER_ERROR', result.body.error);
  });

  const tablesCreateRecord = os.tables.createRecord.handler(async ({ input }) => {
    const container = await resolveContainer();

    let executionContext: IExecutionContext;
    try {
      executionContext = await createExecutionContext();
    } catch {
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: executionContextErrorMessage,
      });
    }

    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const result = await executeCreateRecordEndpoint(executionContext, input, commandBus);

    if (result.status === 201) return result.body;

    if (result.status === 400) {
      throwDomainError('BAD_REQUEST', result.body.error);
    }

    if (result.status === 404) {
      throwDomainError('NOT_FOUND', result.body.error);
    }

    throwDomainError('INTERNAL_SERVER_ERROR', result.body.error);
  });

  const tablesSubmitRecord = os.tables.submitRecord.handler(async ({ input }) => {
    const container = await resolveContainer();

    let executionContext: IExecutionContext;
    try {
      executionContext = await createExecutionContext();
    } catch {
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: executionContextErrorMessage,
      });
    }

    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const result = await executeSubmitRecordEndpoint(executionContext, input, commandBus);

    if (result.status === 201) return result.body;

    if (result.status === 400) {
      throwDomainError('BAD_REQUEST', result.body.error);
    }

    if (result.status === 403) {
      throwDomainError('FORBIDDEN', result.body.error);
    }

    if (result.status === 404) {
      throwDomainError('NOT_FOUND', result.body.error);
    }

    throwDomainError('INTERNAL_SERVER_ERROR', result.body.error);
  });

  const tablesCreateRecords = os.tables.createRecords.handler(async ({ input }) => {
    const container = await resolveContainer();

    let executionContext: IExecutionContext;
    try {
      executionContext = await createExecutionContext();
    } catch {
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: executionContextErrorMessage,
      });
    }

    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const result = await executeCreateRecordsEndpoint(executionContext, input, commandBus);

    if (result.status === 201) return result.body;

    if (result.status === 400) {
      throwDomainError('BAD_REQUEST', result.body.error);
    }

    if (result.status === 404) {
      throwDomainError('NOT_FOUND', result.body.error);
    }

    throwDomainError('INTERNAL_SERVER_ERROR', result.body.error);
  });

  const tablesUpdateRecord = os.tables.updateRecord.handler(async ({ input }) => {
    const container = await resolveContainer();

    let executionContext: IExecutionContext;
    try {
      executionContext = await createExecutionContext();
    } catch {
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: executionContextErrorMessage,
      });
    }

    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const result = await executeUpdateRecordEndpoint(executionContext, input, commandBus);

    if (result.status === 200) return result.body;

    if (result.status === 400) {
      throwDomainError('BAD_REQUEST', result.body.error);
    }

    if (result.status === 404) {
      throwDomainError('NOT_FOUND', result.body.error);
    }

    throwDomainError('INTERNAL_SERVER_ERROR', result.body.error);
  });

  const tablesReorderRecords = os.tables.reorderRecords.handler(async ({ input }) => {
    const container = await resolveContainer();

    let executionContext: IExecutionContext;
    try {
      executionContext = await createExecutionContext();
    } catch {
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: executionContextErrorMessage,
      });
    }

    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const result = await executeReorderRecordsEndpoint(executionContext, input, commandBus);

    if (result.status === 200) return result.body;

    if (result.status === 400) {
      throwDomainError('BAD_REQUEST', result.body.error);
    }

    if (result.status === 404) {
      throwDomainError('NOT_FOUND', result.body.error);
    }

    throwDomainError('INTERNAL_SERVER_ERROR', result.body.error);
  });

  const tablesDuplicateRecord = os.tables.duplicateRecord.handler(async ({ input }) => {
    const container = await resolveContainer();

    let executionContext: IExecutionContext;
    try {
      executionContext = await createExecutionContext();
    } catch {
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: executionContextErrorMessage,
      });
    }

    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const result = await executeDuplicateRecordEndpoint(executionContext, input, commandBus);

    if (result.status === 201) return result.body;

    if (result.status === 400) {
      throwDomainError('BAD_REQUEST', result.body.error);
    }

    if (result.status === 404) {
      throwDomainError('NOT_FOUND', result.body.error);
    }

    throwDomainError('INTERNAL_SERVER_ERROR', result.body.error);
  });

  const tablesPaste = os.tables.paste.handler(async ({ input }) => {
    const container = await resolveContainer();

    let executionContext: IExecutionContext;
    try {
      executionContext = await createExecutionContext();
    } catch {
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: executionContextErrorMessage,
      });
    }

    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const result = await executePasteEndpoint(executionContext, input, commandBus);

    if (result.status === 200) return result.body;

    if (result.status === 400) {
      throwDomainError('BAD_REQUEST', result.body.error);
    }

    if (result.status === 404) {
      throwDomainError('NOT_FOUND', result.body.error);
    }

    throwDomainError('INTERNAL_SERVER_ERROR', result.body.error);
  });

  const tablesClear = os.tables.clear.handler(async ({ input }) => {
    const container = await resolveContainer();

    let executionContext: IExecutionContext;
    try {
      executionContext = await createExecutionContext();
    } catch {
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: executionContextErrorMessage,
      });
    }

    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const result = await executeClearEndpoint(executionContext, input, commandBus);

    if (result.status === 200) return result.body;

    if (result.status === 400) {
      throwDomainError('BAD_REQUEST', result.body.error);
    }

    if (result.status === 404) {
      throwDomainError('NOT_FOUND', result.body.error);
    }

    throwDomainError('INTERNAL_SERVER_ERROR', result.body.error);
  });

  const tablesDeleteByRange = os.tables.deleteByRange.handler(async ({ input }) => {
    const container = await resolveContainer();

    let executionContext: IExecutionContext;
    try {
      executionContext = await createExecutionContext();
    } catch {
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: executionContextErrorMessage,
      });
    }

    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const result = await executeDeleteByRangeEndpoint(executionContext, input, commandBus);

    if (result.status === 200) return result.body;

    if (result.status === 400) {
      throwDomainError('BAD_REQUEST', result.body.error);
    }

    if (result.status === 404) {
      throwDomainError('NOT_FOUND', result.body.error);
    }

    throwDomainError('INTERNAL_SERVER_ERROR', result.body.error);
  });

  const tablesDeleteRecords = os.tables.deleteRecords.handler(async ({ input }) => {
    const container = await resolveContainer();

    let executionContext: IExecutionContext;
    try {
      executionContext = await createExecutionContext();
    } catch {
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: executionContextErrorMessage,
      });
    }

    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const result = await executeDeleteRecordsEndpoint(executionContext, input, commandBus);

    if (result.status === 200) return result.body;

    if (result.status === 400) {
      throwDomainError('BAD_REQUEST', result.body.error);
    }

    if (result.status === 404) {
      throwDomainError('NOT_FOUND', result.body.error);
    }

    throwDomainError('INTERNAL_SERVER_ERROR', result.body.error);
  });

  const tablesDeleteField = os.tables.deleteField.handler(async ({ input }) => {
    const container = await resolveContainer();

    let executionContext: IExecutionContext;
    try {
      executionContext = await createExecutionContext();
    } catch {
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: executionContextErrorMessage,
      });
    }

    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const result = await executeDeleteFieldEndpoint(executionContext, input, commandBus);

    if (result.status === 200) return result.body;

    if (result.status === 400) {
      throwDomainError('BAD_REQUEST', result.body.error);
    }

    if (result.status === 404) {
      throwDomainError('NOT_FOUND', result.body.error);
    }

    throwDomainError('INTERNAL_SERVER_ERROR', result.body.error);
  });

  const tablesGetById = os.tables.getById.handler(async ({ input }) => {
    const container = await resolveContainer();

    let executionContext: IExecutionContext;
    try {
      executionContext = await createExecutionContext();
    } catch {
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: executionContextErrorMessage,
      });
    }

    const queryBus = container.resolve<IQueryBus>(v2CoreTokens.queryBus);
    const result = await executeGetTableByIdEndpoint(executionContext, input, queryBus);

    if (result.status === 200) return result.body;

    if (result.status === 400) {
      throwDomainError('BAD_REQUEST', result.body.error);
    }

    if (result.status === 404) {
      throwDomainError('NOT_FOUND', result.body.error);
    }

    throwDomainError('INTERNAL_SERVER_ERROR', result.body.error);
  });

  const tablesGetRecord = os.tables.getRecord.handler(async ({ input }) => {
    const container = await resolveContainer();

    let executionContext: IExecutionContext;
    try {
      executionContext = await createExecutionContext();
    } catch {
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: executionContextErrorMessage,
      });
    }

    const queryBus = container.resolve<IQueryBus>(v2CoreTokens.queryBus);
    const result = await executeGetRecordByIdEndpoint(executionContext, input, queryBus);

    if (result.status === 200) return result.body;

    if (result.status === 400) {
      throwDomainError('BAD_REQUEST', result.body.error);
    }

    if (result.status === 404) {
      throwDomainError('NOT_FOUND', result.body.error);
    }

    throwDomainError('INTERNAL_SERVER_ERROR', result.body.error);
  });

  const tablesDelete = os.tables.delete.handler(async ({ input }) => {
    const container = await resolveContainer();

    let executionContext: IExecutionContext;
    try {
      executionContext = await createExecutionContext();
    } catch {
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: executionContextErrorMessage,
      });
    }

    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const result = await executeDeleteTableEndpoint(executionContext, input, commandBus);

    if (result.status === 200) return result.body;

    if (result.status === 400) {
      throwDomainError('BAD_REQUEST', result.body.error);
    }

    if (result.status === 404) {
      throwDomainError('NOT_FOUND', result.body.error);
    }

    throwDomainError('INTERNAL_SERVER_ERROR', result.body.error);
  });

  const tablesList = os.tables.list.handler(async ({ input }) => {
    const container = await resolveContainer();

    let executionContext: IExecutionContext;
    try {
      executionContext = await createExecutionContext();
    } catch {
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: executionContextErrorMessage,
      });
    }

    const queryBus = container.resolve<IQueryBus>(v2CoreTokens.queryBus);
    const result = await executeListTablesEndpoint(executionContext, input, queryBus);

    if (result.status === 200) return result.body;

    if (result.status === 400) {
      throwDomainError('BAD_REQUEST', result.body.error);
    }

    throwDomainError('INTERNAL_SERVER_ERROR', result.body.error);
  });

  const tablesListRecords = os.tables.listRecords.handler(async ({ input }) => {
    const container = await resolveContainer();

    let executionContext: IExecutionContext;
    try {
      executionContext = await createExecutionContext();
    } catch {
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: executionContextErrorMessage,
      });
    }

    const queryBus = container.resolve<IQueryBus>(v2CoreTokens.queryBus);
    const result = await executeListTableRecordsEndpoint(executionContext, input, queryBus);

    if (result.status === 200) return result.body;

    if (result.status === 400) {
      throwDomainError('BAD_REQUEST', result.body.error);
    }

    if (result.status === 404) {
      throwDomainError('NOT_FOUND', result.body.error);
    }

    throwDomainError('INTERNAL_SERVER_ERROR', result.body.error);
  });

  const tablesRename = os.tables.rename.handler(async ({ input }) => {
    const container = await resolveContainer();

    let executionContext: IExecutionContext;
    try {
      executionContext = await createExecutionContext();
    } catch {
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: executionContextErrorMessage,
      });
    }

    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const result = await executeRenameTableEndpoint(executionContext, input, commandBus);

    if (result.status === 200) return result.body;

    if (result.status === 400) {
      throwDomainError('BAD_REQUEST', result.body.error);
    }

    if (result.status === 404) {
      throwDomainError('NOT_FOUND', result.body.error);
    }

    throwDomainError('INTERNAL_SERVER_ERROR', result.body.error);
  });

  const tablesImportCsv = os.tables.importCsv.handler(async ({ input }) => {
    const container = await resolveContainer();

    let executionContext: IExecutionContext;
    try {
      executionContext = await createExecutionContext();
    } catch {
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: executionContextErrorMessage,
      });
    }

    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const result = await executeImportCsvEndpoint(executionContext, input, commandBus);

    if (result.status === 201) return result.body;

    if (result.status === 400) {
      throwDomainError('BAD_REQUEST', result.body.error);
    }

    if (result.status === 404) {
      throwDomainError('NOT_FOUND', result.body.error);
    }

    throwDomainError('INTERNAL_SERVER_ERROR', result.body.error);
  });

  const tablesImportRecords = os.tables.importRecords.handler(async ({ input }) => {
    const container = await resolveContainer();

    let executionContext: IExecutionContext;
    try {
      executionContext = await createExecutionContext();
    } catch {
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: executionContextErrorMessage,
      });
    }

    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const result = await executeImportRecordsEndpoint(executionContext, input, commandBus);

    if (result.status === 200) return result.body;

    if (result.status === 400) {
      throwDomainError('BAD_REQUEST', result.body.error);
    }

    if (result.status === 404) {
      throwDomainError('NOT_FOUND', result.body.error);
    }

    throwDomainError('INTERNAL_SERVER_ERROR', result.body.error);
  });

  const tablesExplainCreateRecord = os.tables.explainCreateRecord.handler(async ({ input }) => {
    const container = await resolveContainer();

    let executionContext: IExecutionContext;
    try {
      executionContext = await createExecutionContext();
    } catch {
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: executionContextErrorMessage,
      });
    }

    const explainService = container.resolve<IExplainService>(
      v2CommandExplainTokens.explainService
    );
    const result = await executeExplainCreateRecordEndpoint(
      executionContext,
      input,
      explainService
    );

    if (result.status === 200) return result.body;

    if (result.status === 400) {
      throwDomainError('BAD_REQUEST', result.body.error);
    }

    if (result.status === 404) {
      throwDomainError('NOT_FOUND', result.body.error);
    }

    throwDomainError('INTERNAL_SERVER_ERROR', result.body.error);
  });

  const tablesExplainUpdateRecord = os.tables.explainUpdateRecord.handler(async ({ input }) => {
    const container = await resolveContainer();

    let executionContext: IExecutionContext;
    try {
      executionContext = await createExecutionContext();
    } catch {
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: executionContextErrorMessage,
      });
    }

    const explainService = container.resolve<IExplainService>(
      v2CommandExplainTokens.explainService
    );
    const result = await executeExplainUpdateRecordEndpoint(
      executionContext,
      input,
      explainService
    );

    if (result.status === 200) return result.body;

    if (result.status === 400) {
      throwDomainError('BAD_REQUEST', result.body.error);
    }

    if (result.status === 404) {
      throwDomainError('NOT_FOUND', result.body.error);
    }

    throwDomainError('INTERNAL_SERVER_ERROR', result.body.error);
  });

  const tablesExplainDeleteRecords = os.tables.explainDeleteRecords.handler(async ({ input }) => {
    const container = await resolveContainer();

    let executionContext: IExecutionContext;
    try {
      executionContext = await createExecutionContext();
    } catch {
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: executionContextErrorMessage,
      });
    }

    const explainService = container.resolve<IExplainService>(
      v2CommandExplainTokens.explainService
    );
    const result = await executeExplainDeleteRecordsEndpoint(
      executionContext,
      input,
      explainService
    );

    if (result.status === 200) return result.body;

    if (result.status === 400) {
      throwDomainError('BAD_REQUEST', result.body.error);
    }

    if (result.status === 404) {
      throwDomainError('NOT_FOUND', result.body.error);
    }

    throwDomainError('INTERNAL_SERVER_ERROR', result.body.error);
  });

  return os.router({
    bases: {
      create: basesCreate,
      list: basesList,
    },
    tables: {
      create: tablesCreate,
      createTables: tablesCreateTables,
      createField: tablesCreateField,
      createRecord: tablesCreateRecord,
      submitRecord: tablesSubmitRecord,
      createRecords: tablesCreateRecords,
      updateRecord: tablesUpdateRecord,
      reorderRecords: tablesReorderRecords,
      duplicateRecord: tablesDuplicateRecord,
      paste: tablesPaste,
      clear: tablesClear,
      deleteByRange: tablesDeleteByRange,
      deleteRecords: tablesDeleteRecords,
      deleteField: tablesDeleteField,
      delete: tablesDelete,
      getById: tablesGetById,
      getRecord: tablesGetRecord,
      importCsv: tablesImportCsv,
      importRecords: tablesImportRecords,
      list: tablesList,
      listRecords: tablesListRecords,
      rename: tablesRename,
      explainCreateRecord: tablesExplainCreateRecord,
      explainUpdateRecord: tablesExplainUpdateRecord,
      explainDeleteRecords: tablesExplainDeleteRecords,
    },
  });
};

export type V2OrpcRouter = ReturnType<typeof createV2OrpcRouter>;

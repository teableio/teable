import { ORPCError, implement } from '@orpc/server';
import type { IHandlerResolver } from '@teable/v2-contract-http';
import { v2Contract } from '@teable/v2-contract-http';
import {
  ActorId,
  type ICommandBus,
  type IExecutionContext,
  type IQueryBus,
  v2CoreTokens,
} from '@teable/v2-core';

import { executeCreateFieldEndpoint } from './handlers/tables/createField';
import { executeCreateRecordEndpoint } from './handlers/tables/createRecord';
import { executeCreateRecordsEndpoint } from './handlers/tables/createRecords';
import { executeCreateTableEndpoint } from './handlers/tables/createTable';
import { executeDeleteFieldEndpoint } from './handlers/tables/deleteField';
import { executeDeleteTableEndpoint } from './handlers/tables/deleteTable';
import { executeGetTableByIdEndpoint } from './handlers/tables/getTableById';
import { executeImportCsvEndpoint } from './handlers/tables/importCsv';
import { executeListTableRecordsEndpoint } from './handlers/tables/listTableRecords';
import { executeListTablesEndpoint } from './handlers/tables/listTables';
import { executeRenameTableEndpoint } from './handlers/tables/renameTable';
import { executeUpdateRecordEndpoint } from './handlers/tables/updateRecord';

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

  const os = implement(v2Contract);

  const tablesCreate = os.tables.create.handler(async ({ input }) => {
    let container: IHandlerResolver;
    try {
      container = await createContainer();
    } catch {
      throw new ORPCError('INTERNAL_SERVER_ERROR', { message: containerErrorMessage });
    }

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
      throw new ORPCError('BAD_REQUEST', { message: result.body.error.message });
    }

    throw new ORPCError('INTERNAL_SERVER_ERROR', { message: result.body.error.message });
  });

  const tablesCreateField = os.tables.createField.handler(async ({ input }) => {
    let container: IHandlerResolver;
    try {
      container = await createContainer();
    } catch {
      throw new ORPCError('INTERNAL_SERVER_ERROR', { message: containerErrorMessage });
    }

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
      throw new ORPCError('BAD_REQUEST', { message: result.body.error.message });
    }

    if (result.status === 404) {
      throw new ORPCError('NOT_FOUND', { message: result.body.error.message });
    }

    throw new ORPCError('INTERNAL_SERVER_ERROR', { message: result.body.error.message });
  });

  const tablesCreateRecord = os.tables.createRecord.handler(async ({ input }) => {
    let container: IHandlerResolver;
    try {
      container = await createContainer();
    } catch {
      throw new ORPCError('INTERNAL_SERVER_ERROR', { message: containerErrorMessage });
    }

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
      throw new ORPCError('BAD_REQUEST', { message: result.body.error.message });
    }

    if (result.status === 404) {
      throw new ORPCError('NOT_FOUND', { message: result.body.error.message });
    }

    throw new ORPCError('INTERNAL_SERVER_ERROR', { message: result.body.error.message });
  });

  const tablesCreateRecords = os.tables.createRecords.handler(async ({ input }) => {
    let container: IHandlerResolver;
    try {
      container = await createContainer();
    } catch {
      throw new ORPCError('INTERNAL_SERVER_ERROR', { message: containerErrorMessage });
    }

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
      throw new ORPCError('BAD_REQUEST', { message: result.body.error.message });
    }

    if (result.status === 404) {
      throw new ORPCError('NOT_FOUND', { message: result.body.error.message });
    }

    throw new ORPCError('INTERNAL_SERVER_ERROR', { message: result.body.error.message });
  });

  const tablesUpdateRecord = os.tables.updateRecord.handler(async ({ input }) => {
    let container: IHandlerResolver;
    try {
      container = await createContainer();
    } catch {
      throw new ORPCError('INTERNAL_SERVER_ERROR', { message: containerErrorMessage });
    }

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
      throw new ORPCError('BAD_REQUEST', { message: result.body.error.message });
    }

    if (result.status === 404) {
      throw new ORPCError('NOT_FOUND', { message: result.body.error.message });
    }

    throw new ORPCError('INTERNAL_SERVER_ERROR', { message: result.body.error.message });
  });

  const tablesDeleteField = os.tables.deleteField.handler(async ({ input }) => {
    let container: IHandlerResolver;
    try {
      container = await createContainer();
    } catch {
      throw new ORPCError('INTERNAL_SERVER_ERROR', { message: containerErrorMessage });
    }

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
      throw new ORPCError('BAD_REQUEST', { message: result.body.error.message });
    }

    if (result.status === 404) {
      throw new ORPCError('NOT_FOUND', { message: result.body.error.message });
    }

    throw new ORPCError('INTERNAL_SERVER_ERROR', { message: result.body.error.message });
  });

  const tablesGetById = os.tables.getById.handler(async ({ input }) => {
    let container: IHandlerResolver;
    try {
      container = await createContainer();
    } catch {
      throw new ORPCError('INTERNAL_SERVER_ERROR', { message: containerErrorMessage });
    }

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
      throw new ORPCError('BAD_REQUEST', { message: result.body.error.message });
    }

    if (result.status === 404) {
      throw new ORPCError('NOT_FOUND', { message: result.body.error.message });
    }

    throw new ORPCError('INTERNAL_SERVER_ERROR', { message: result.body.error.message });
  });

  const tablesDelete = os.tables.delete.handler(async ({ input }) => {
    let container: IHandlerResolver;
    try {
      container = await createContainer();
    } catch {
      throw new ORPCError('INTERNAL_SERVER_ERROR', { message: containerErrorMessage });
    }

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
      throw new ORPCError('BAD_REQUEST', { message: result.body.error.message });
    }

    if (result.status === 404) {
      throw new ORPCError('NOT_FOUND', { message: result.body.error.message });
    }

    throw new ORPCError('INTERNAL_SERVER_ERROR', { message: result.body.error.message });
  });

  const tablesList = os.tables.list.handler(async ({ input }) => {
    let container: IHandlerResolver;
    try {
      container = await createContainer();
    } catch {
      throw new ORPCError('INTERNAL_SERVER_ERROR', { message: containerErrorMessage });
    }

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
      throw new ORPCError('BAD_REQUEST', { message: result.body.error.message });
    }

    throw new ORPCError('INTERNAL_SERVER_ERROR', { message: result.body.error.message });
  });

  const tablesListRecords = os.tables.listRecords.handler(async ({ input }) => {
    let container: IHandlerResolver;
    try {
      container = await createContainer();
    } catch {
      throw new ORPCError('INTERNAL_SERVER_ERROR', { message: containerErrorMessage });
    }

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
      throw new ORPCError('BAD_REQUEST', { message: result.body.error.message });
    }

    if (result.status === 404) {
      throw new ORPCError('NOT_FOUND', { message: result.body.error.message });
    }

    throw new ORPCError('INTERNAL_SERVER_ERROR', { message: result.body.error.message });
  });

  const tablesRename = os.tables.rename.handler(async ({ input }) => {
    let container: IHandlerResolver;
    try {
      container = await createContainer();
    } catch {
      throw new ORPCError('INTERNAL_SERVER_ERROR', { message: containerErrorMessage });
    }

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
      throw new ORPCError('BAD_REQUEST', { message: result.body.error.message });
    }

    if (result.status === 404) {
      throw new ORPCError('NOT_FOUND', { message: result.body.error.message });
    }

    throw new ORPCError('INTERNAL_SERVER_ERROR', { message: result.body.error.message });
  });

  const tablesImportCsv = os.tables.importCsv.handler(async ({ input }) => {
    let container: IHandlerResolver;
    try {
      container = await createContainer();
    } catch {
      throw new ORPCError('INTERNAL_SERVER_ERROR', { message: containerErrorMessage });
    }

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
      throw new ORPCError('BAD_REQUEST', { message: result.body.error.message });
    }

    if (result.status === 404) {
      throw new ORPCError('NOT_FOUND', { message: result.body.error.message });
    }

    throw new ORPCError('INTERNAL_SERVER_ERROR', { message: result.body.error.message });
  });

  return os.router({
    tables: {
      create: tablesCreate,
      createField: tablesCreateField,
      createRecord: tablesCreateRecord,
      createRecords: tablesCreateRecords,
      updateRecord: tablesUpdateRecord,
      deleteField: tablesDeleteField,
      delete: tablesDelete,
      getById: tablesGetById,
      importCsv: tablesImportCsv,
      list: tablesList,
      listRecords: tablesListRecords,
      rename: tablesRename,
    },
  });
};

export type V2OrpcRouter = ReturnType<typeof createV2OrpcRouter>;

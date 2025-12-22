import { ORPCError, implement } from '@orpc/server';
import { createV2NodePgContainer } from '@teable/v2-container-node';
import type { IHandlerResolver } from '@teable/v2-contract-http';
import { v2Contract } from '@teable/v2-contract-http';
import {
  ActorId,
  type ICommandBus,
  type IExecutionContext,
  type IQueryBus,
  v2CoreTokens,
} from '@teable/v2-core';

import { executeCreateTableEndpoint } from './handlers/tables/createTable';
import { executeGetTableByIdEndpoint } from './handlers/tables/getTableById';
import { executeListTablesEndpoint } from './handlers/tables/listTables';

export interface IV2OrpcRouterOptions {
  createContainer?: () => IHandlerResolver | Promise<IHandlerResolver>;
  createExecutionContext?: () => IExecutionContext | Promise<IExecutionContext>;
}

export const createV2OrpcRouter = (options: IV2OrpcRouterOptions = {}) => {
  let defaultContainerPromise: Promise<IHandlerResolver> | undefined;
  const createContainer =
    options.createContainer ??
    (() => {
      if (!defaultContainerPromise) defaultContainerPromise = createV2NodePgContainer();
      return defaultContainerPromise;
    });
  const createExecutionContext =
    options.createExecutionContext ??
    (() => {
      const actorIdResult = ActorId.create('system');
      if (actorIdResult.isErr()) {
        throw new Error(actorIdResult.error);
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
      throw new ORPCError('BAD_REQUEST', { message: result.body.error });
    }

    throw new ORPCError('INTERNAL_SERVER_ERROR', { message: result.body.error });
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
      throw new ORPCError('BAD_REQUEST', { message: result.body.error });
    }

    if (result.status === 404) {
      throw new ORPCError('NOT_FOUND', { message: result.body.error });
    }

    throw new ORPCError('INTERNAL_SERVER_ERROR', { message: result.body.error });
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
      throw new ORPCError('BAD_REQUEST', { message: result.body.error });
    }

    throw new ORPCError('INTERNAL_SERVER_ERROR', { message: result.body.error });
  });

  return os.router({
    tables: {
      create: tablesCreate,
      getById: tablesGetById,
      list: tablesList,
    },
  });
};

export type V2OrpcRouter = ReturnType<typeof createV2OrpcRouter>;

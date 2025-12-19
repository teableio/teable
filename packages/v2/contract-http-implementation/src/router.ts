import { createV2NodePgContainer } from '@teable/v2-container-node';
import type { IHandlerResolver } from '@teable/v2-contract-http';
import { v2Contract } from '@teable/v2-contract-http';
import { ActorId, CreateTableHandler, type IExecutionContext } from '@teable/v2-core';
import { ORPCError, implement } from '@orpc/server';

import { executeCreateTableEndpoint } from './handlers/tables/createTable';

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

  const os = implement(v2Contract);

  const tablesCreate = os.tables.create.handler(async ({ input }) => {
    let container: IHandlerResolver;
    try {
      container = await createContainer();
    } catch {
      throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'Failed to create container' });
    }

    let executionContext: IExecutionContext;
    try {
      executionContext = await createExecutionContext();
    } catch {
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: 'Failed to resolve execution context',
      });
    }

    const handler = container.resolve(CreateTableHandler);
    const result = await executeCreateTableEndpoint(executionContext, input, handler);

    if (result.status === 201) return result.body;

    if (result.status === 400) {
      throw new ORPCError('BAD_REQUEST', { message: result.body.error });
    }

    throw new ORPCError('INTERNAL_SERVER_ERROR', { message: result.body.error });
  });

  return os.router({
    tables: {
      create: tablesCreate,
    },
  });
};

export type V2OrpcRouter = ReturnType<typeof createV2OrpcRouter>;

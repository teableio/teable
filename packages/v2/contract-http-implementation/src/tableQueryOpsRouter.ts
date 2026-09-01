import { ORPCError, implement } from '@orpc/server';
import {
  type HttpErrorStatus,
  type IApiErrorResponseDto,
  type IHandlerResolver,
  v2TableQueryOpsContract,
} from '@teable/v2-contract-http';
import {
  ActorId,
  type IExecutionContext,
  type ITableRepository,
  v2CoreTokens,
} from '@teable/v2-core';
import type {
  TableSearchAccessPathCapabilityReader,
  TableSearchAccessPathReconciler,
  TableSearchVectorStatusReader,
} from '@teable/v2-table-query-ops';
import { v2TableOpsTokens } from '@teable/v2-table-query-ops';

import {
  executeGetSearchAccessPathCapabilitiesEndpoint,
  executeGetSearchAccessPathStatusEndpoint,
  executeReconcileSearchAccessPathEndpoint,
} from './handlers/tableQueryOps/searchAccessPath';

export interface IV2TableQueryOpsOrpcRouterOptions {
  createContainer?: () => IHandlerResolver | Promise<IHandlerResolver>;
  createExecutionContext?: () => IExecutionContext | Promise<IExecutionContext>;
  allowSearchAccessPathMutation?: boolean;
}

export const createV2TableQueryOpsOrpcRouter = (
  options: IV2TableQueryOpsOrpcRouterOptions = {}
) => {
  let defaultContainerPromise: Promise<IHandlerResolver> | undefined;
  const createContainer =
    options.createContainer ??
    (() => {
      if (!defaultContainerPromise) {
        defaultContainerPromise = import('@teable/v2-container-node').then(
          ({ createV2NodePgContainer }) => createV2NodePgContainer()
        );
      }
      return defaultContainerPromise;
    });
  const createExecutionContext =
    options.createExecutionContext ??
    (() => {
      const actorIdResult = ActorId.create('system');
      if (actorIdResult.isErr()) throw actorIdResult.error;
      return { actorId: actorIdResult.value };
    });

  const resolveContainer = async (): Promise<IHandlerResolver> => {
    try {
      return await Promise.resolve(createContainer());
    } catch (error) {
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: `Failed to create table-query-ops container: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  };

  const resolveExecutionContext = async (): Promise<IExecutionContext> => {
    try {
      return await Promise.resolve(createExecutionContext());
    } catch {
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: 'Failed to resolve table-query-ops execution context',
      });
    }
  };

  const throwEndpointError = (status: HttpErrorStatus, body: IApiErrorResponseDto): never => {
    const code =
      status === 400
        ? 'BAD_REQUEST'
        : status === 401
          ? 'UNAUTHORIZED'
          : status === 403
            ? 'FORBIDDEN'
            : status === 404
              ? 'NOT_FOUND'
              : status === 501
                ? 'NOT_IMPLEMENTED'
                : 'INTERNAL_SERVER_ERROR';
    throw new ORPCError(code, {
      message: body.error.message,
      data: {
        domainCode: body.error.code,
        domainTags: body.error.tags,
        details: body.error.details,
        localization: body.error.localization,
      },
    });
  };

  const os = implement(v2TableQueryOpsContract);

  const getStatus = os.searchAccessPath.getStatus.handler(async ({ input }) => {
    const [container, context] = await Promise.all([resolveContainer(), resolveExecutionContext()]);
    const result = await executeGetSearchAccessPathStatusEndpoint(
      context,
      input,
      container.resolve<ITableRepository>(v2CoreTokens.tableRepository),
      container.resolve<TableSearchVectorStatusReader>(v2TableOpsTokens.searchVectorStatusReader)
    );
    if (result.status === 200) return result.body;
    return throwEndpointError(result.status, result.body);
  });

  const getCapabilities = os.searchAccessPath.getCapabilities.handler(async () => {
    const [container, context] = await Promise.all([resolveContainer(), resolveExecutionContext()]);
    const result = await executeGetSearchAccessPathCapabilitiesEndpoint(
      context,
      container.resolve<TableSearchAccessPathCapabilityReader>(
        v2TableOpsTokens.searchAccessPathCapabilityReader
      )
    );
    if (result.status === 200) return result.body;
    return throwEndpointError(result.status, result.body);
  });

  const reconcile = os.searchAccessPath.reconcile.handler(async ({ input }) => {
    const [container, context] = await Promise.all([resolveContainer(), resolveExecutionContext()]);
    const result = await executeReconcileSearchAccessPathEndpoint(
      context,
      input,
      container.resolve<ITableRepository>(v2CoreTokens.tableRepository),
      container.resolve<TableSearchAccessPathReconciler>(
        v2TableOpsTokens.searchAccessPathReconciler
      ),
      options.allowSearchAccessPathMutation ?? false
    );
    if (result.status === 200) return result.body;
    return throwEndpointError(result.status, result.body);
  });

  return os.router({
    searchAccessPath: {
      getStatus,
      getCapabilities,
      reconcile,
    },
  });
};

export type V2TableQueryOpsOrpcRouter = ReturnType<typeof createV2TableQueryOpsOrpcRouter>;

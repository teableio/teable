import { ORPCError, implement } from '@orpc/server';
import type { Router } from '@orpc/server';
import {
  type HttpErrorStatus,
  type IApiErrorResponseDto,
  type IHandlerResolver,
  type V2VcsContract,
  v2VcsContract,
} from '@teable/v2-contract-http';
import { ActorId, type IExecutionContext } from '@teable/v2-core';
import {
  type BaseVcsHistoryService,
  type CloneVcsSnapshotService,
  type EnableBaseVcsService,
  type GetVcsHeadService,
  type ListVcsChangesService,
  type ListVcsTableRecordsChunkService,
  type PushVcsPatchService,
  v2VcsServerTokens,
} from '@teable/v2-vcs/server';

import {
  executeCloneVcsRecordsEndpoint,
  executeCloneVcsSnapshotEndpoint,
  executeEnableBaseVcsEndpoint,
  executeGetVcsHeadEndpoint,
  executeListVcsChangesEndpoint,
  executePushVcsPatchEndpoint,
  toVcsEndpointResult,
} from './handlers/vcs';

export interface IV2VcsOrpcRouterOptions {
  createContainer?: () => IHandlerResolver | Promise<IHandlerResolver>;
  createExecutionContext?: () => IExecutionContext | Promise<IExecutionContext>;
}

export type V2VcsOrpcRouter = Router<V2VcsContract, Record<never, never>>;

const httpStatusToOrpcCode = (status: HttpErrorStatus): string => {
  switch (status) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 501:
      return 'NOT_IMPLEMENTED';
    case 503:
      return 'SERVICE_UNAVAILABLE';
    case 504:
      return 'GATEWAY_TIMEOUT';
    default:
      return 'INTERNAL_SERVER_ERROR';
  }
};

export const createV2VcsOrpcRouter = (options: IV2VcsOrpcRouterOptions = {}): V2VcsOrpcRouter => {
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
        message: `Failed to create VCS container: ${
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
        message: 'Failed to resolve VCS execution context',
      });
    }
  };

  const throwEndpointError = (status: HttpErrorStatus, body: IApiErrorResponseDto): never => {
    throw new ORPCError(httpStatusToOrpcCode(status), {
      message: body.error.message,
      data: {
        domainCode: body.error.code,
        domainTags: body.error.tags,
        details: body.error.details,
        localization: body.error.localization,
      },
    });
  };

  const os = implement<V2VcsContract>(v2VcsContract);

  const enable = os.enable.handler(async ({ input }) => {
    const [container, context] = await Promise.all([resolveContainer(), resolveExecutionContext()]);
    const result = await executeEnableBaseVcsEndpoint(
      context,
      input,
      container.resolve<EnableBaseVcsService>(v2VcsServerTokens.enableBaseVcsService)
    );
    if (result.status !== 200) return throwEndpointError(result.status, result.body);
    return result.body;
  });

  const head = os.head.handler(async ({ input }) => {
    const [container, context] = await Promise.all([resolveContainer(), resolveExecutionContext()]);
    const result = await executeGetVcsHeadEndpoint(
      context,
      input,
      container.resolve<GetVcsHeadService>(v2VcsServerTokens.getVcsHeadService)
    );
    if (result.status !== 200) return throwEndpointError(result.status, result.body);
    return result.body;
  });

  const clone = os.clone.handler(async ({ input }) => {
    const [container, context] = await Promise.all([resolveContainer(), resolveExecutionContext()]);
    const result = await executeCloneVcsSnapshotEndpoint(
      context,
      input,
      container.resolve<CloneVcsSnapshotService>(v2VcsServerTokens.cloneVcsSnapshotService)
    );
    if (result.status !== 200) return throwEndpointError(result.status, result.body);
    return result.body;
  });

  const cloneRecords = os.cloneRecords.handler(async ({ input }) => {
    const [container, context] = await Promise.all([resolveContainer(), resolveExecutionContext()]);
    const result = await executeCloneVcsRecordsEndpoint(
      context,
      input,
      container.resolve<ListVcsTableRecordsChunkService>(
        v2VcsServerTokens.listVcsTableRecordsChunkService
      )
    );
    if (result.status !== 200) return throwEndpointError(result.status, result.body);
    return result.body;
  });

  const changes = os.changes.handler(async ({ input }) => {
    const [container, context] = await Promise.all([resolveContainer(), resolveExecutionContext()]);
    const result = await executeListVcsChangesEndpoint(
      context,
      input,
      container.resolve<ListVcsChangesService>(v2VcsServerTokens.listVcsChangesService)
    );
    if (result.status !== 200) return throwEndpointError(result.status, result.body);
    return result.body;
  });

  const resolveHistory = async () => {
    const [container, context] = await Promise.all([resolveContainer(), resolveExecutionContext()]);
    return {
      context,
      history: container.resolve<BaseVcsHistoryService>(v2VcsServerTokens.historyService),
    };
  };

  const checkout = os.checkout.handler(async ({ input }) => {
    const { context, history } = await resolveHistory();
    const result = toVcsEndpointResult(await history.checkout(context, input));
    if (result.status !== 200) return throwEndpointError(result.status, result.body);
    return result.body;
  });

  const diff = os.diff.handler(async ({ input }) => {
    const { context, history } = await resolveHistory();
    const result = toVcsEndpointResult(await history.diff(context, input));
    if (result.status !== 200) return throwEndpointError(result.status, result.body);
    return result.body;
  });

  const rollback = os.rollback.handler(async ({ input }) => {
    const { context, history } = await resolveHistory();
    const result = toVcsEndpointResult(await history.rollback(context, input));
    if (result.status !== 200) return throwEndpointError(result.status, result.body);
    return result.body;
  });

  const push = os.push.handler(async ({ input }) => {
    const [container, context] = await Promise.all([resolveContainer(), resolveExecutionContext()]);
    const result = await executePushVcsPatchEndpoint(
      context,
      input,
      container.resolve<PushVcsPatchService>(v2VcsServerTokens.pushVcsPatchService)
    );
    if (result.status !== 200) return throwEndpointError(result.status, result.body);
    return result.body;
  });

  return os.router({
    enable,
    head,
    clone,
    cloneRecords,
    changes,
    checkout,
    diff,
    rollback,
    push,
  });
};

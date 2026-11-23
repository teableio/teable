import { AsyncLocalStorage } from 'node:async_hooks';

import { registerV2VcsPostgresAdapter } from '@teable/v2-adapter-vcs-postgres';
import { createV2HonoMiddleware } from '@teable/v2-contract-http-hono';
import { createV2VcsOrpcRouter } from '@teable/v2-contract-http-implementation/vcs';
import {
  createDataQueryFetchHandler,
  createV2OpenApiFetchHandler,
} from '@teable/v2-contract-http-openapi';
import {
  ActorId,
  BackgroundTaskTracker,
  compileDurableSubscriptionCatalog,
  DomainWriteTransaction,
  FieldCreated,
  FieldUpdated,
  NoopLogger,
  NoopProjectionMessageJournal,
  ProjectionMessageCodecRegistry,
  RecordCreated,
  RecordReordered,
  RecordsBatchCreated,
  RecordsBatchUpdated,
  RecordsDeleted,
  recordProjectionCodecs,
  RecordUpdated,
  TableCreated,
  TargetedLegacyEventDispatcher,
  v2CoreTokens,
  type IExecutionContext,
  type IImportEventSpoolFactory,
  type ILogger,
  type IQueryBus,
  type IRealtimeEngine,
  type ISameTxProjectionDispatcher,
  type ITransactionalProjectionMessageJournal,
  type IUnitOfWork,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import type { IHeadlessRuntime } from '@teable/v2-headless-runtime';
import {
  AllowAllVcsAccessPolicy,
  BASE_VCS_TRACKED_EVENTS,
  ReadOnlyVcsAccessPolicy,
  registerV2VcsServerModule,
  v2VcsServerTokens,
} from '@teable/v2-vcs/server';
import { Hono, type Context, type Next } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import { registerHeadlessOpenApiCompatRoutes } from './openApiCompatRoutes';
import { registerHeadlessVcsRoutes } from './vcsRoutes';

export { createV2HttpClient as createHeadlessClient } from '@teable/v2-contract-http-client';
export type HeadlessIdentityResolution =
  | { status: 'accepted'; actorId: string }
  | { status: 'rejected'; statusCode?: number };

export interface IHeadlessHttpOptions {
  /** Header used to identify the caller when resolveActorId is not supplied. */
  actorHeader?: string;
  /** Actor used when the request has no actor header. */
  defaultActorId?: string;
  /** Default base id exposed for local OpenAPI compatibility routes. */
  defaultBaseId?: string;
  /** Default base name exposed by `GET /api/base/:baseId`. */
  defaultBaseName?: string;
  /** Opt in to the legacy anonymous `system` actor when no actor is supplied. */
  allowAnonymousActor?: boolean;
  /** Host hook for authenticated identity; auth itself stays outside the runtime. */
  resolveActorId?: (request: Request) => string | undefined | Promise<string | undefined>;
  /** Rejectable identity seam. Rejections never fall back to headers or system. */
  resolveIdentity?: (
    request: Request
  ) => HeadlessIdentityResolution | Promise<HeadlessIdentityResolution>;
  /** Opt in to VCS write endpoints (`POST /vcs/enable`, `POST /vcs/push`). Defaults to read-only. */
  allowVcsWrite?: boolean;
}

const resolveActor = async (
  request: Request,
  options: IHeadlessHttpOptions
): Promise<HeadlessIdentityResolution> => {
  if (options.resolveIdentity) return options.resolveIdentity(request);
  const resolved = await options.resolveActorId?.(request);
  if (resolved !== undefined) return { status: 'accepted', actorId: resolved };
  const headerActor = request.headers.get(options.actorHeader ?? 'x-teable-actor');
  if (headerActor !== null) return { status: 'accepted', actorId: headerActor };
  if (options.defaultActorId !== undefined) {
    return { status: 'accepted', actorId: options.defaultActorId };
  }
  if (options.allowAnonymousActor) return { status: 'accepted', actorId: 'system' };
  return { status: 'rejected', statusCode: 401 };
};

/**
 * Actor resolution happens before the contract middleware, so a rejected actor
 * must still answer with the contract's `{ ok: false, error }` envelope instead
 * of a bare text response a machine client would have to special-case.
 */
const invalidActorBody = {
  ok: false as const,
  error: {
    code: 'validation.actor.invalid',
    message: 'Invalid actor',
    tags: ['validation'] as const,
  },
};

const internalErrorBody = {
  ok: false as const,
  error: {
    code: 'runtime.internal_error',
    message: 'Internal runtime error',
    tags: ['unexpected'] as const,
  },
};

const pgliteVcsCatalogPatchedContainers = new WeakSet<DependencyContainer>();

const PGLITE_BASE_EVENTS = [
  RecordCreated,
  RecordsBatchCreated,
  RecordUpdated,
  RecordsBatchUpdated,
  RecordsDeleted,
  RecordReordered,
  TableCreated,
  FieldCreated,
  FieldUpdated,
] as const;

const patchPgliteVcsDurableCatalog = (c: DependencyContainer): void => {
  if (pgliteVcsCatalogPatchedContainers.has(c)) {
    return;
  }
  pgliteVcsCatalogPatchedContainers.add(c);

  const events = Array.from(new Set([...PGLITE_BASE_EVENTS, ...BASE_VCS_TRACKED_EVENTS]));
  const catalogRes = compileDurableSubscriptionCatalog(events);
  if (catalogRes.isErr()) {
    throw new Error(catalogRes.error.message);
  }
  const codecRes = ProjectionMessageCodecRegistry.create(recordProjectionCodecs);
  if (codecRes.isErr()) {
    throw new Error(codecRes.error.message);
  }

  c.registerInstance(v2CoreTokens.durableSubscriptionCatalog, catalogRes.value);
  const logger = c.isRegistered(v2CoreTokens.logger)
    ? c.resolve<ILogger>(v2CoreTokens.logger)
    : new NoopLogger();
  const unitOfWork = c.resolve<IUnitOfWork>(v2CoreTokens.unitOfWork);
  const journal = c.isRegistered(v2CoreTokens.projectionMessageJournal)
    ? c.resolve<ITransactionalProjectionMessageJournal>(v2CoreTokens.projectionMessageJournal)
    : new NoopProjectionMessageJournal();
  const sameTxDispatcher = c.resolve<ISameTxProjectionDispatcher>(
    v2CoreTokens.sameTxProjectionDispatcher
  );
  const eventBus = c.isRegistered(v2CoreTokens.eventBus)
    ? c.resolve<{ recordPublished?(events: readonly unknown[]): void }>(v2CoreTokens.eventBus)
    : undefined;
  const existingTx = c.isRegistered(v2CoreTokens.domainWriteTransaction)
    ? (c.resolve(v2CoreTokens.domainWriteTransaction) as {
        importEventSpoolFactory?: IImportEventSpoolFactory;
      })
    : undefined;

  c.registerInstance(
    v2CoreTokens.domainWriteTransaction,
    new DomainWriteTransaction(
      unitOfWork,
      codecRes.value,
      catalogRes.value,
      journal,
      new TargetedLegacyEventDispatcher(c, logger),
      sameTxDispatcher,
      logger,
      c.resolve(BackgroundTaskTracker),
      undefined,
      eventBus,
      existingTx?.importEventSpoolFactory
    )
  );
};

const ensureVcsServerRegistered = <TRealtime extends IRealtimeEngine>(
  runtime: IHeadlessRuntime<TRealtime>,
  options: IHeadlessHttpOptions
): void => {
  if (!runtime.container.isRegistered(v2VcsServerTokens.logRepository)) {
    registerV2VcsPostgresAdapter(runtime.container);
  }
  if (!runtime.container.isRegistered(v2VcsServerTokens.accessPolicy)) {
    const queryBus = runtime.container.resolve<IQueryBus>(v2CoreTokens.queryBus);
    runtime.container.registerInstance(
      v2VcsServerTokens.accessPolicy,
      options.allowVcsWrite
        ? new AllowAllVcsAccessPolicy(queryBus)
        : new ReadOnlyVcsAccessPolicy(queryBus)
    );
  }
  if (!runtime.container.isRegistered(v2VcsServerTokens.pushVcsPatchService)) {
    registerV2VcsServerModule(runtime.container);
  }
  if (runtime.backend === 'pglite') {
    patchPgliteVcsDurableCatalog(runtime.container);
  }
};

/**
 * Creates a Hono app over the runtime's command/query container. The host owns
 * authentication; this adapter only maps a request to an actor id.
 */
export const createHeadlessHttpApp = <TRealtime extends IRealtimeEngine>(
  runtime: IHeadlessRuntime<TRealtime>,
  options: IHeadlessHttpOptions = {}
): Hono => {
  ensureVcsServerRegistered(runtime, options);
  if (options.resolveActorId && options.resolveIdentity) {
    throw new Error('Configure either resolveIdentity or resolveActorId, not both');
  }
  const fallbackActor = ActorId.create(options.defaultActorId ?? 'system');
  if (fallbackActor.isErr()) {
    throw new Error(`Invalid default actor: ${String(fallbackActor.error)}`);
  }

  const storage = new AsyncLocalStorage<IExecutionContext>();
  const fallbackContext: IExecutionContext = { actorId: fallbackActor.value };
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true as const, data: { status: 'live' as const } }));
  app.get('/ready', async (c) => {
    try {
      await runtime.ready();
      return c.json({ ok: true as const, data: { status: 'ready' as const } });
    } catch {
      return c.json(
        {
          ok: false as const,
          error: {
            code: 'runtime.not_ready',
            message: 'Runtime is not ready',
            tags: ['unavailable'] as const,
          },
        },
        503
      );
    }
  });

  app.use('*', async (c, next) => {
    if (c.req.path === '/health' || c.req.path === '/ready') return next();
    let identity: HeadlessIdentityResolution;
    try {
      identity = await resolveActor(c.req.raw, options);
    } catch {
      return c.json(internalErrorBody, 500);
    }
    if (identity.status === 'rejected') {
      return c.json(
        {
          ok: false as const,
          error: {
            code: 'identity.rejected',
            message: 'Identity rejected',
            tags: ['forbidden'] as const,
          },
        },
        (identity.statusCode && identity.statusCode >= 400 && identity.statusCode < 500
          ? identity.statusCode
          : 403) as ContentfulStatusCode
      );
    }
    const actorId = ActorId.create(identity.actorId);
    if (actorId.isErr()) return c.json(invalidActorBody, 400);
    await storage.run({ actorId: actorId.value }, next);
  });

  // Computed-queue and realtime drains are runtime operations, not part of the
  // v2 table contract. They mount before the contract middleware so a remote
  // agent can drain them without owning the runtime object.
  app.post('/runtime/flushComputed', async (c) => {
    try {
      return c.json({ ok: true as const, data: await runtime.flushComputed() });
    } catch {
      return c.json(internalErrorBody, 500);
    }
  });

  app.post('/runtime/flushRealtime', async (c) => {
    try {
      return c.json({ ok: true as const, data: await runtime.flushRealtime() });
    } catch {
      return c.json(internalErrorBody, 500);
    }
  });

  app.post('/runtime/flushBackground', async (c) => {
    try {
      return c.json({ ok: true as const, data: await runtime.flushBackground() });
    } catch {
      return c.json(internalErrorBody, 500);
    }
  });

  const queryPrefix = '/api/v2';
  const dataQuery = createDataQueryFetchHandler({
    service: runtime.dataQuery,
    createExecutionContext: () => {
      const context = storage.getStore();
      if (!context) throw new Error('Headless execution context is missing');
      return context;
    },
  });
  app.use(`${queryPrefix}/queries/*`, async (c, next) => {
    const url = new URL(c.req.url);
    url.pathname = url.pathname.slice(queryPrefix.length);
    const result = await dataQuery.handle(new Request(url, c.req.raw));
    if (result.matched) return result.response;
    return next();
  });

  const v2Middleware = createV2HonoMiddleware({
    createContainer: () => runtime.container,
    createExecutionContext: () => storage.getStore() ?? fallbackContext,
  });
  const vcsOpenApiHandler = createV2OpenApiFetchHandler(
    createV2VcsOrpcRouter({
      createContainer: () => runtime.container,
      createExecutionContext: () => storage.getStore() ?? fallbackContext,
    })
  );
  const vcsMiddleware = async (c: Context, next: Next) => {
    const result = await vcsOpenApiHandler.handle(c.req.raw, { context: {} });
    if (result.matched) return c.newResponse(result.response.body, result.response);
    return next();
  };
  const v2SubApp = new Hono();
  const unmatchedV2Header = 'x-teable-v2-unmatched';
  v2SubApp.use('*', vcsMiddleware);
  v2SubApp.use('*', v2Middleware);
  v2SubApp.all('*', (c) => c.body(null, 404, { [unmatchedV2Header]: '1' }));

  const mutatingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

  registerHeadlessVcsRoutes(app, runtime, () => storage.getStore() ?? fallbackContext);

  registerHeadlessOpenApiCompatRoutes(app, runtime, () => storage.getStore() ?? fallbackContext, {
    defaultBaseId: options.defaultBaseId,
    defaultBaseName: options.defaultBaseName,
  });

  app.all('/api/v2/*', async (c, next) => {
    const rewrittenUrl = new URL(c.req.url);
    rewrittenUrl.pathname = rewrittenUrl.pathname.replace(/^\/api\/v2(?=\/|$)/, '') || '/';
    const method = c.req.method.toUpperCase();
    const hasBody = method !== 'GET' && method !== 'HEAD';
    const body = hasBody ? await c.req.raw.arrayBuffer() : undefined;
    const rewrittenReq = new Request(rewrittenUrl.toString(), {
      method,
      headers: c.req.raw.headers,
      ...(hasBody ? { body } : {}),
    });

    const v2Res = await v2SubApp.fetch(rewrittenReq);
    if (v2Res.headers.get(unmatchedV2Header) === '1') {
      return next();
    }

    if (mutatingMethods.has(method) && v2Res.status < 400) {
      await runtime.flushComputed();
    }

    const headers = new Headers(v2Res.headers);
    headers.delete(unmatchedV2Header);
    return new Response(v2Res.body, {
      status: v2Res.status,
      statusText: v2Res.statusText,
      headers,
    });
  });

  app.use('*', vcsMiddleware);
  app.use('*', v2Middleware);

  app.notFound((c) =>
    c.json(
      {
        ok: false as const,
        error: {
          code: 'route.not_found',
          message: 'Route not found',
          tags: ['not_found'] as const,
        },
      },
      404
    )
  );
  app.onError((_error, c) => c.json(internalErrorBody, 500));

  return app;
};

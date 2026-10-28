import { AsyncLocalStorage } from 'node:async_hooks';

import { createV2HonoMiddleware } from '@teable/v2-contract-http-hono';
import { ActorId, type IExecutionContext, type IRealtimeEngine } from '@teable/v2-core';
import type { IHeadlessRuntime } from '@teable/v2-headless-runtime';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export { createV2HttpClient as createHeadlessClient } from '@teable/v2-contract-http-client';
export type HeadlessIdentityResolution =
  | { status: 'accepted'; actorId: string }
  | { status: 'rejected'; statusCode?: number };

export interface IHeadlessHttpOptions {
  /** Header used to identify the caller when resolveActorId is not supplied. */
  actorHeader?: string;
  /** Actor used when the request has no actor header. */
  defaultActorId?: string;
  /** Opt in to the legacy anonymous `system` actor when no actor is supplied. */
  allowAnonymousActor?: boolean;
  /** Host hook for authenticated identity; auth itself stays outside the runtime. */
  resolveActorId?: (request: Request) => string | undefined | Promise<string | undefined>;
  /** Rejectable identity seam. Rejections never fall back to headers or system. */
  resolveIdentity?: (
    request: Request
  ) => HeadlessIdentityResolution | Promise<HeadlessIdentityResolution>;
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

/**
 * Creates a Hono app over the runtime's command/query container. The host owns
 * authentication; this adapter only maps a request to an actor id.
 */
export const createHeadlessHttpApp = <TRealtime extends IRealtimeEngine>(
  runtime: IHeadlessRuntime<TRealtime>,
  options: IHeadlessHttpOptions = {}
): Hono => {
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

  app.use(
    '*',
    createV2HonoMiddleware({
      createContainer: () => runtime.container,
      createExecutionContext: () => storage.getStore() ?? fallbackContext,
    })
  );

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

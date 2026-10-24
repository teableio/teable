import { AsyncLocalStorage } from 'node:async_hooks';

import { createV2HonoMiddleware } from '@teable/v2-contract-http-hono';
import { ActorId, type IExecutionContext, type IRealtimeEngine } from '@teable/v2-core';
import type { IHeadlessRuntime } from '@teable/v2-headless-runtime';
import { Hono } from 'hono';

export { createV2HttpClient as createHeadlessClient } from '@teable/v2-contract-http-client';

export interface IHeadlessHttpOptions {
  /** Header used to identify the caller when resolveActorId is not supplied. */
  actorHeader?: string;
  /** Actor used when the request has no actor header. */
  defaultActorId?: string;
  /** Host hook for authenticated identity; auth itself stays outside the runtime. */
  resolveActorId?: (request: Request) => string | undefined | Promise<string | undefined>;
}

const resolveActor = async (request: Request, options: IHeadlessHttpOptions): Promise<string> => {
  const resolved = await options.resolveActorId?.(request);
  return (
    resolved ??
    request.headers.get(options.actorHeader ?? 'x-teable-actor') ??
    options.defaultActorId ??
    'system'
  );
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

const flushFailureBody = (error: unknown) => ({
  ok: false as const,
  error: {
    code: 'runtime.flush_failed',
    message: error instanceof Error ? error.message : String(error),
    tags: ['unexpected'] as const,
  },
});

/**
 * Creates a Hono app over the runtime's command/query container. The host owns
 * authentication; this adapter only maps a request to an actor id.
 */
export const createHeadlessHttpApp = <TRealtime extends IRealtimeEngine>(
  runtime: IHeadlessRuntime<TRealtime>,
  options: IHeadlessHttpOptions = {}
): Hono => {
  const fallbackActor = ActorId.create(options.defaultActorId ?? 'system');
  if (fallbackActor.isErr()) {
    throw new Error(`Invalid default actor: ${String(fallbackActor.error)}`);
  }

  const storage = new AsyncLocalStorage<IExecutionContext>();
  const fallbackContext: IExecutionContext = { actorId: fallbackActor.value };
  const app = new Hono();

  app.use('*', async (c, next) => {
    const actor = await resolveActor(c.req.raw, options);
    const actorId = ActorId.create(actor);
    if (actorId.isErr()) {
      return c.json(invalidActorBody, 400);
    }
    await storage.run({ actorId: actorId.value }, next);
  });

  // Computed-queue and realtime drains are runtime operations, not part of the
  // v2 table contract. They mount before the contract middleware so a remote
  // agent can drain them without owning the runtime object.
  app.post('/runtime/flushComputed', async (c) => {
    try {
      const processed = await runtime.flushComputed();
      return c.json({ ok: true as const, data: { processed } });
    } catch (error) {
      return c.json(flushFailureBody(error), 500);
    }
  });

  app.post('/runtime/flushRealtime', async (c) => {
    try {
      await runtime.flushRealtime();
      return c.json({ ok: true as const, data: {} });
    } catch (error) {
      return c.json(flushFailureBody(error), 500);
    }
  });

  app.use(
    '*',
    createV2HonoMiddleware({
      createContainer: () => runtime.container,
      createExecutionContext: () => storage.getStore() ?? fallbackContext,
    })
  );

  return app;
};

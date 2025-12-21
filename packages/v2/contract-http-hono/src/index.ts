import type { IHandlerResolver } from '@teable/v2-contract-http';
import { createV2OrpcRouter } from '@teable/v2-contract-http-implementation';
import { createV2OpenApiFetchHandler } from '@teable/v2-contract-http-openapi';
import type { IExecutionContext } from '@teable/v2-core';
import { Hono } from 'hono';
import type { Context, Next } from 'hono';

export interface IV2HonoRouterOptions {
  createContainer?: () => IHandlerResolver | Promise<IHandlerResolver>;
  createExecutionContext?: () => IExecutionContext | Promise<IExecutionContext>;
}

export const createV2HonoMiddleware = (options: IV2HonoRouterOptions = {}) => {
  const orpcRouter = createV2OrpcRouter({
    createContainer: options.createContainer,
    createExecutionContext: options.createExecutionContext,
  });
  const handler = createV2OpenApiFetchHandler(orpcRouter);

  return async (c: Context, next: Next) => {
    const result = await handler.handle(c.req.raw, { context: {} });
    if (result.matched) return c.newResponse(result.response.body, result.response);
    return next();
  };
};

export const createV2HonoApp = (options: IV2HonoRouterOptions = {}) => {
  const app = new Hono();
  app.use('*', createV2HonoMiddleware(options));
  return app;
};

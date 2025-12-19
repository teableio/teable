import type { IHandlerResolver } from '@teable/v2-contract-http';
import { createV2OrpcRouter } from '@teable/v2-contract-http-implementation';
import { createV2OpenApiNodeHandler } from '@teable/v2-contract-http-openapi';
import type { IExecutionContext } from '@teable/v2-core';
import * as express from 'express';

export interface IV2ExpressRouterOptions {
  createContainer?: () => IHandlerResolver | Promise<IHandlerResolver>;
  createExecutionContext?: () => IExecutionContext | Promise<IExecutionContext>;
}

export const createV2ExpressRouter = (options: IV2ExpressRouterOptions = {}): express.Router => {
  const router = express.Router();
  const orpcRouter = createV2OrpcRouter({
    createContainer: options.createContainer,
    createExecutionContext: options.createExecutionContext,
  });
  const handler = createV2OpenApiNodeHandler(orpcRouter);

  router.use(async (req, res, next) => {
    const result = await handler.handle(req, res, { context: {} });
    if (result.matched) return;
    next();
  });

  return router;
};

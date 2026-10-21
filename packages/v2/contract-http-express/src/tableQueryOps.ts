import type { IHandlerResolver } from '@teable/v2-contract-http';
import { createV2TableQueryOpsOrpcRouter } from '@teable/v2-contract-http-implementation/table-query-ops';
import { createV2OpenApiNodeHandler } from '@teable/v2-contract-http-openapi';
import type { IExecutionContext } from '@teable/v2-core';
import * as express from 'express';

export interface IV2TableQueryOpsExpressRouterOptions {
  createContainer?: () => IHandlerResolver | Promise<IHandlerResolver>;
  createExecutionContext?: () => IExecutionContext | Promise<IExecutionContext>;
  allowSearchAccessPathMutation?: boolean;
}

export const createV2TableQueryOpsExpressRouter = (
  options: IV2TableQueryOpsExpressRouterOptions = {}
): express.Router => {
  const router = express.Router();
  const orpcRouter = createV2TableQueryOpsOrpcRouter({
    createContainer: options.createContainer,
    createExecutionContext: options.createExecutionContext,
    allowSearchAccessPathMutation: options.allowSearchAccessPathMutation,
  });
  const handler = createV2OpenApiNodeHandler(orpcRouter);

  router.use(async (req, res, next) => {
    const result = await handler.handle(req, res, { context: {} });
    if (result.matched) return;
    next();
  });

  return router;
};

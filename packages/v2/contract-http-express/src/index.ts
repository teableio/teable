import { createV2OrpcRouter, type IV2OrpcRouterOptions } from '@teable/v2-contract-http-implementation';
import { createV2OpenApiNodeHandler } from '@teable/v2-contract-http-openapi';
import * as express from 'express';

export type IV2ExpressRouterOptions = IV2OrpcRouterOptions;

export const createV2ExpressRouter = (options: IV2ExpressRouterOptions = {}): express.Router => {
  const router = express.Router();
  const orpcRouter = createV2OrpcRouter(options);
  const handler = createV2OpenApiNodeHandler(orpcRouter);

  router.use(async (req, res, next) => {
    const result = await handler.handle(req, res, { context: {} });
    if (result.matched) return;
    next();
  });

  return router;
};

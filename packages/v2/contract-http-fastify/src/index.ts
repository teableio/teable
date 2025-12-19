import type { IHandlerResolver } from '@teable/v2-contract-http';
import { createV2OrpcRouter } from '@teable/v2-contract-http-implementation';
import { createV2OpenApiNodeHandler } from '@teable/v2-contract-http-openapi';
import type { IExecutionContext } from '@teable/v2-core';
import type { FastifyPluginCallback } from 'fastify';

export interface IV2FastifyRouterOptions {
  createContainer?: () => IHandlerResolver | Promise<IHandlerResolver>;
  createExecutionContext?: () => IExecutionContext | Promise<IExecutionContext>;
}

export const createV2FastifyPlugin = (
  options: IV2FastifyRouterOptions = {}
): FastifyPluginCallback => {
  const orpcRouter = createV2OrpcRouter({
    createContainer: options.createContainer,
    createExecutionContext: options.createExecutionContext,
  });
  const handler = createV2OpenApiNodeHandler(orpcRouter);

  return (fastify, _opts, done) => {
    fastify.addContentTypeParser('*', (_request, _payload, next) => {
      next(null, undefined);
    });

    fastify.all('/*', async (request, reply) => {
      const result = await handler.handle(request.raw, reply.raw, { context: {} });
      if (result.matched) return;
      reply.status(404).send({ ok: false, error: 'Not found' });
    });
    done();
  };
};

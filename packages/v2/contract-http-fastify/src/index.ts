import { mapDomainErrorToHttpError, mapDomainErrorToHttpStatus } from '@teable/v2-contract-http';
import type { IHandlerResolver } from '@teable/v2-contract-http';
import { createV2OrpcRouter } from '@teable/v2-contract-http-implementation';
import { createV2OpenApiFastifyHandler } from '@teable/v2-contract-http-openapi';
import type { IExecutionContext } from '@teable/v2-core';
import { domainError } from '@teable/v2-core';
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
  const handler = createV2OpenApiFastifyHandler(orpcRouter);

  return (fastify, _opts, done) => {
    fastify.all('/*', async (request, reply) => {
      const result = await handler.handle(request, reply, { context: {} });
      if (result.matched) return;
      const notFoundError = domainError.notFound({
        code: 'route.not_found',
        message: 'Not found',
      });
      reply.status(mapDomainErrorToHttpStatus(notFoundError)).send({
        ok: false,
        error: mapDomainErrorToHttpError(notFoundError),
      });
    });
    done();
  };
};

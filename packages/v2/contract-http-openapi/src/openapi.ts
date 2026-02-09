/* eslint-disable @typescript-eslint/naming-convention */
import type { AnyContractRouter } from '@orpc/contract';
import { OpenAPIHandler as FastifyOpenAPIHandler } from '@orpc/openapi/fastify';
import { OpenAPIHandler as FetchOpenAPIHandler } from '@orpc/openapi/fetch';
import { OpenAPIHandler as NodeOpenAPIHandler } from '@orpc/openapi/node';
import type { Context, Router } from '@orpc/server';
import { ORPCError, ValidationError, onError } from '@orpc/server';

const INVALID_REQUEST_MESSAGE = 'Invalid request';
const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Unknown error';

interface DomainErrorData {
  domainCode?: string;
  domainTags?: string[];
  details?: Record<string, unknown>;
}

const getDomainErrorData = (error: unknown): DomainErrorData | undefined => {
  if (error instanceof ORPCError && error.data && typeof error.data === 'object') {
    return error.data as DomainErrorData;
  }
  return undefined;
};

const getErrorCode = (error: unknown) => {
  const domainData = getDomainErrorData(error);
  if (domainData?.domainCode) {
    return domainData.domainCode;
  }
  if (error instanceof ORPCError) {
    return error.code;
  }
  return 'INTERNAL_SERVER_ERROR';
};

const getErrorTags = (error: unknown): string[] => {
  const domainData = getDomainErrorData(error);
  if (domainData?.domainTags) {
    return domainData.domainTags;
  }
  return [];
};

const getErrorDetails = (error: unknown): Record<string, unknown> | undefined => {
  const domainData = getDomainErrorData(error);
  return domainData?.details;
};

const encodeErrorResponse = (error: unknown) => ({
  ok: false as const,
  error: {
    code: getErrorCode(error),
    message: getErrorMessage(error),
    tags: getErrorTags(error),
    details: getErrorDetails(error),
  },
});

export const createV2OpenApiNodeHandler = <TContext extends Context>(
  router: Router<AnyContractRouter, TContext>
) => {
  return new NodeOpenAPIHandler<TContext>(router, {
    interceptors: [
      onError((error: unknown) => {
        if (
          error instanceof ORPCError &&
          error.code === 'BAD_REQUEST' &&
          error.cause instanceof ValidationError
        ) {
          throw new ORPCError('BAD_REQUEST', {
            message: INVALID_REQUEST_MESSAGE,
            cause: error.cause,
          });
        }
      }),
    ],
    customErrorResponseBodyEncoder: encodeErrorResponse,
  });
};

export const createV2OpenApiFastifyHandler = <TContext extends Context>(
  router: Router<AnyContractRouter, TContext>
) => {
  return new FastifyOpenAPIHandler<TContext>(router, {
    interceptors: [
      onError((error: unknown) => {
        if (
          error instanceof ORPCError &&
          error.code === 'BAD_REQUEST' &&
          error.cause instanceof ValidationError
        ) {
          throw new ORPCError('BAD_REQUEST', {
            message: INVALID_REQUEST_MESSAGE,
            cause: error.cause,
          });
        }
      }),
    ],
    customErrorResponseBodyEncoder: encodeErrorResponse,
  });
};

export const createV2OpenApiFetchHandler = <TContext extends Context>(
  router: Router<AnyContractRouter, TContext>
) => {
  return new FetchOpenAPIHandler<TContext>(router, {
    interceptors: [
      onError((error: unknown) => {
        if (
          error instanceof ORPCError &&
          error.code === 'BAD_REQUEST' &&
          error.cause instanceof ValidationError
        ) {
          throw new ORPCError('BAD_REQUEST', {
            message: INVALID_REQUEST_MESSAGE,
            cause: error.cause,
          });
        }
      }),
    ],
    customErrorResponseBodyEncoder: encodeErrorResponse,
  });
};

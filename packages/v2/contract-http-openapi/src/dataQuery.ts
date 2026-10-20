import {
  DATA_QUERY_EXECUTE_PATH,
  type ExplainDataQueryResponseDto,
  DATA_QUERY_EXPLAIN_PATH,
  type ExecuteDataQueryResponseDto,
  DATA_QUERY_VALIDATE_PATH,
  type ValidateDataQueryResponseDto,
} from '@teable/v2-contract-http';
import { explainDataQueryEndpoint } from '@teable/v2-contract-http-implementation/data-query-explain';
import {
  executeDataQueryEndpoint,
  validateDataQueryEndpoint,
} from '@teable/v2-contract-http-implementation/data-query';
import {
  domainError,
  isDomainError,
  isForbiddenError,
  isUnauthorizedError,
  type IExecutionContext,
} from '@teable/v2-core';
import type { QueryExecutionService, QueryExplainExecutionService } from '@teable/v2-data-query';

export interface IDataQueryFetchHandlerOptions {
  service: Pick<QueryExecutionService, 'execute' | 'validate'>;
  /**
   * Opt-in explain handler. Omitting it keeps /queries/explain unmounted, which
   * is how a disabled deployment stays route-absent.
   */
  explainService?: Pick<QueryExplainExecutionService, 'explain'>;
  /** Authenticate the original request; throw an unauthorized/forbidden DomainError to deny access. */
  createExecutionContext: (request: Request) => IExecutionContext | Promise<IExecutionContext>;
}

export type DataQueryFetchHandlerResult =
  | { matched: false }
  | { matched: true; response: Response };

export type DataQueryFetchHandler = {
  handle(request: Request): Promise<DataQueryFetchHandlerResult>;
};

const respond = (
  status: number,
  body: ExecuteDataQueryResponseDto | ValidateDataQueryResponseDto | ExplainDataQueryResponseDto,
  headers?: HeadersInit
): DataQueryFetchHandlerResult => ({
  matched: true,
  response: Response.json(body, { status, headers }),
});

const authenticationFailure = (error: unknown): DataQueryFetchHandlerResult => {
  if (isDomainError(error) && (isUnauthorizedError(error) || isForbiddenError(error))) {
    const forbidden = isForbiddenError(error);
    return respond(forbidden ? 403 : 401, {
      ok: false,
      error: {
        code: forbidden ? 'data_query.forbidden' : 'data_query.unauthorized',
        message: forbidden
          ? 'Data query access denied'
          : 'Unable to authenticate data query request',
        tags: [forbidden ? 'forbidden' : 'unauthorized'],
      },
    });
  }
  return respond(500, {
    ok: false,
    error: {
      code: 'data_query.context_failed',
      message: 'Unable to resolve data query execution context',
      tags: ['unexpected'],
    },
  });
};

/**
 * Explicitly mounted adapter, separate from the default v2 routes.
 * Matches /queries/execute and /queries/validate exactly. The host strips its API
 * prefix (normally /api/v2) before calling handle. The context resolver receives
 * that original Request, before its body is consumed, to authenticate the caller.
 * Never derive actor or scope from its JSON body. Mount only when V2_DATA_QUERY_ENABLED is true.
 */
export const createDataQueryFetchHandler = (
  options: IDataQueryFetchHandlerOptions
): DataQueryFetchHandler => ({
  async handle(request: Request): Promise<DataQueryFetchHandlerResult> {
    const path = new URL(request.url).pathname;
    const isExplain = path === DATA_QUERY_EXPLAIN_PATH;
    if (isExplain && !options.explainService) return { matched: false };
    if (path !== DATA_QUERY_EXECUTE_PATH && path !== DATA_QUERY_VALIDATE_PATH && !isExplain)
      return { matched: false };
    if (request.method !== 'POST') {
      return respond(
        405,
        {
          ok: false,
          error: {
            code: 'data_query.method_not_allowed',
            message: 'Only POST is supported',
            tags: ['validation'],
          },
        },
        { Allow: 'POST' }
      );
    }

    let context: IExecutionContext;
    try {
      context = await options.createExecutionContext(request);
      if (!context?.actorId) {
        throw domainError.unauthorized({ message: 'Missing authenticated actor' });
      }
    } catch (error) {
      return authenticationFailure(error);
    }

    let rawInput: unknown;
    try {
      rawInput = await request.json();
    } catch {
      return respond(400, {
        ok: false,
        error: {
          code: 'data_query.invalid_request',
          message: 'Invalid data query request',
          tags: ['validation'],
        },
      });
    }

    try {
      const result = isExplain
        ? await explainDataQueryEndpoint(context, rawInput, options.explainService!)
        : path === DATA_QUERY_VALIDATE_PATH
          ? await validateDataQueryEndpoint(context, rawInput, options.service)
          : await executeDataQueryEndpoint(context, rawInput, options.service);
      return respond(result.status, result.body);
    } catch {
      return respond(500, {
        ok: false,
        error: {
          code: 'data_query.execution_failed',
          message: 'Unable to execute data query',
          tags: ['unexpected'],
        },
      });
    }
  },
});

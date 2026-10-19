import {
  DATA_QUERY_EXECUTE_PATH,
  DATA_QUERY_VALIDATE_PATH,
  executeDataQueryResponseDtoSchema,
  validateDataQueryResponseDtoSchema,
  type ExecuteDataQueryResponseDto,
  type ValidateDataQueryResponseDto,
} from '@teable/v2-contract-http';
import {
  executeDataQueryRequestSchema,
  validateDataQueryRequestSchema,
  type ExecuteDataQueryRequest,
  type ValidateDataQueryRequest,
} from '@teable/v2-data-query';

import type { IV2HttpClientOptions } from './index';

export type DataQueryHttpClient = {
  execute(request: ExecuteDataQueryRequest): Promise<ExecuteDataQueryResponseDto>;
  validate(request: ValidateDataQueryRequest): Promise<ValidateDataQueryResponseDto>;
};

type QueryResponse = ExecuteDataQueryResponseDto | ValidateDataQueryResponseDto;

/** Opt-in fetch transport; baseUrl is the v2 API root, never the operation URL. */
export const createDataQueryHttpClient = (options: IV2HttpClientOptions): DataQueryHttpClient => {
  const post = async <T extends QueryResponse>(
    path: string,
    request: unknown,
    requestSchema: { parse(value: unknown): unknown },
    responseSchema: { parse(value: unknown): T }
  ): Promise<T | Extract<QueryResponse, { ok: false }>> => {
    let body: string;
    try {
      body = JSON.stringify(requestSchema.parse(request));
    } catch {
      return {
        ok: false,
        error: {
          code: 'data_query.invalid_request',
          message: 'Invalid data query request',
          tags: ['validation'],
        },
      };
    }
    let response: Response;
    try {
      const headers = new Headers(
        typeof options.headers === 'function' ? await options.headers() : options.headers
      );
      headers.set('Content-Type', 'application/json');
      headers.set('Accept', 'application/json');
      response = await (options.fetch ?? fetch)(`${options.baseUrl.replace(/\/+$/, '')}${path}`, {
        method: 'POST',
        headers,
        body,
      });
    } catch {
      return {
        ok: false,
        error: {
          code: 'data_query.transport_failed',
          message: 'Unable to reach data query endpoint',
          tags: ['infrastructure'],
        },
      };
    }
    try {
      const parsed = responseSchema.parse(await response.json());
      if (response.ok !== parsed.ok) throw new Error('Inconsistent response status');
      return parsed;
    } catch {
      return {
        ok: false,
        error: {
          code: 'data_query.invalid_response',
          message: 'Invalid data query response',
          tags: ['unexpected'],
        },
      };
    }
  };
  return {
    execute: (request) =>
      post(
        DATA_QUERY_EXECUTE_PATH,
        request,
        executeDataQueryRequestSchema,
        executeDataQueryResponseDtoSchema
      ),
    validate: (request) =>
      post(
        DATA_QUERY_VALIDATE_PATH,
        request,
        validateDataQueryRequestSchema,
        validateDataQueryResponseDtoSchema
      ),
  };
};

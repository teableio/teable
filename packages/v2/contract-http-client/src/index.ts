/* eslint-disable sonarjs/cognitive-complexity */
/* eslint-disable @typescript-eslint/naming-convention */
import { createORPCErrorFromJson, createORPCClient, isORPCErrorJson } from '@orpc/client';
import type { ContractRouterClient } from '@orpc/contract';
import { OpenAPILink } from '@orpc/openapi-client/fetch';
import { apiErrorResponseDtoSchema, v2Contract } from '@teable/v2-contract-http';

export { v2Contract } from '@teable/v2-contract-http';

export interface IV2HttpClientOptions {
  baseUrl: string;
  headers?:
    | Record<string, string>
    | (() => Record<string, string> | Promise<Record<string, string>>);
  fetch?: typeof fetch;
}

const inferErrorCode = (status: number): string => {
  if (status === 400) return 'BAD_REQUEST';
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 405) return 'METHOD_NOT_SUPPORTED';
  if (status === 408) return 'TIMEOUT';
  if (status === 409) return 'CONFLICT';
  if (status === 412) return 'PRECONDITION_FAILED';
  if (status === 413) return 'PAYLOAD_TOO_LARGE';
  if (status === 415) return 'UNSUPPORTED_MEDIA_TYPE';
  if (status === 422) return 'UNPROCESSABLE_CONTENT';
  if (status === 429) return 'TOO_MANY_REQUESTS';
  if (status === 499) return 'CLIENT_CLOSED_REQUEST';
  if (status === 501) return 'NOT_IMPLEMENTED';
  if (status === 502) return 'BAD_GATEWAY';
  if (status === 503) return 'SERVICE_UNAVAILABLE';
  if (status === 504) return 'GATEWAY_TIMEOUT';
  if (status >= 500) return 'INTERNAL_SERVER_ERROR';
  return 'INTERNAL_SERVER_ERROR';
};

export const createV2HttpClient = (
  options: IV2HttpClientOptions
): ContractRouterClient<typeof v2Contract> => {
  const link = new OpenAPILink(v2Contract, {
    url: options.baseUrl,
    headers: options.headers,
    fetch: options.fetch,
    customErrorResponseBodyDecoder: (body, response) => {
      if (isORPCErrorJson(body)) {
        return createORPCErrorFromJson(body);
      }

      const parsedError = apiErrorResponseDtoSchema.safeParse(body);
      if (parsedError.success) {
        return createORPCErrorFromJson({
          defined: false,
          code: inferErrorCode(response.status),
          status: response.status,
          message: parsedError.data.error.message,
          data: {
            domainErrorCode: parsedError.data.error.code,
            tags: parsedError.data.error.tags,
            details: parsedError.data.error.details,
          },
        });
      }

      if (
        body &&
        typeof body === 'object' &&
        'ok' in body &&
        body.ok === false &&
        'error' in body &&
        typeof body.error === 'string'
      ) {
        return createORPCErrorFromJson({
          defined: false,
          code: inferErrorCode(response.status),
          status: response.status,
          message: body.error,
          data: {},
        });
      }

      return null;
    },
  });

  return createORPCClient(link) as ContractRouterClient<typeof v2Contract>;
};

export type V2HttpClient = ContractRouterClient<typeof v2Contract>;

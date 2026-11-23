/* eslint-disable @typescript-eslint/naming-convention */
import { createORPCErrorFromJson, isORPCErrorJson } from '@orpc/client';
import { apiErrorResponseDtoSchema } from '@teable/v2-contract-http';

const STATUS_ERROR_CODES: Readonly<Record<number, string>> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  402: 'PAYMENT_REQUIRED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_SUPPORTED',
  408: 'TIMEOUT',
  409: 'CONFLICT',
  412: 'PRECONDITION_FAILED',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE_CONTENT',
  429: 'TOO_MANY_REQUESTS',
  499: 'CLIENT_CLOSED_REQUEST',
  501: 'NOT_IMPLEMENTED',
  502: 'BAD_GATEWAY',
  503: 'SERVICE_UNAVAILABLE',
  504: 'GATEWAY_TIMEOUT',
};

export const inferErrorCode = (status: number): string =>
  STATUS_ERROR_CODES[status] ?? 'INTERNAL_SERVER_ERROR';

export const decodeStandardV2ErrorBody = (body: unknown, status: number) => {
  if (isORPCErrorJson(body)) {
    return createORPCErrorFromJson(body);
  }

  const parsedError = apiErrorResponseDtoSchema.safeParse(body);
  if (parsedError.success) {
    return createORPCErrorFromJson({
      defined: false,
      code: inferErrorCode(status),
      status,
      message: parsedError.data.error.message,
      data: {
        domainErrorCode: parsedError.data.error.code,
        tags: parsedError.data.error.tags,
        details: parsedError.data.error.details,
        localization: parsedError.data.error.localization,
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
      code: inferErrorCode(status),
      status,
      message: body.error,
      data: {},
    });
  }

  return null;
};

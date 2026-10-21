import { Catch, HttpException } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { ExecuteDataQueryResponseDto, IEndpointResult } from '@teable/v2-contract-http';
import {
  executeDataQueryResponseDtoSchema,
  mapDomainErrorToHttpError,
  mapDomainErrorToHttpStatus,
} from '@teable/v2-contract-http';
import { domainError, type DomainError } from '@teable/v2-core';
import type { Response } from 'express';

/** Only static public labels cross the Nest authentication/resource-check boundary. */
export const dataQueryHostError = (error: unknown): DomainError => {
  const status = error instanceof HttpException ? error.getStatus() : 500;
  switch (status) {
    case 400:
      return domainError.validation({
        code: 'data_query.invalid_request',
        message: 'Invalid data query request',
        cause: error,
      });
    case 401:
      return domainError.unauthorized({
        code: 'data_query.unauthorized',
        message: 'Authentication required',
        cause: error,
      });
    case 403:
      return domainError.forbidden({
        code: 'data_query.forbidden',
        message: 'Data query access denied',
        cause: error,
      });
    case 404:
      return domainError.notFound({
        code: 'data_query.not_found',
        message: 'Data query resource not found',
        cause: error,
      });
    default:
      return domainError.infrastructure({
        code: 'data_query.execution_failed',
        message: 'Unable to execute data query',
        cause: error,
      });
  }
};

export const dataQueryErrorResponse = (
  error: DomainError
): IEndpointResult<ExecuteDataQueryResponseDto> => ({
  status: mapDomainErrorToHttpStatus(error),
  body: executeDataQueryResponseDtoSchema.parse({
    ok: false,
    error: mapDomainErrorToHttpError(error),
  }),
});

/** Global authentication guards must return the same envelope as the query use case. */
@Catch()
export class V2DataQueryExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (response.headersSent) return;
    const result = dataQueryErrorResponse(dataQueryHostError(error));
    response.status(result.status).json(result.body);
  }
}

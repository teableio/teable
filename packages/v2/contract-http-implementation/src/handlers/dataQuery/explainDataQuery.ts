import {
  type IEndpointResult,
  explainDataQueryResponseDtoSchema,
  mapDomainErrorToHttpError,
  mapDomainErrorToHttpStatus,
  type ExplainDataQueryResponseDto,
} from '@teable/v2-contract-http';
import {
  domainError,
  isConflictError,
  isForbiddenError,
  isNotFoundError,
  isUnauthorizedError,
  isValidationError,
  type DomainError,
  type IExecutionContext,
} from '@teable/v2-core';
import type { QueryExplainExecutionService } from '@teable/v2-data-query';

/** Exactly the same public error classes as execute; no driver text or SQLSTATE leaves. */
const publicExplainError = (error: DomainError): DomainError => {
  if (error.code === 'data_query.timeout') {
    return domainError.infrastructure({
      code: 'data_query.timeout',
      message: 'Data query exceeded its statement timeout',
      cause: error,
    });
  }
  if (
    isValidationError(error) ||
    isUnauthorizedError(error) ||
    isForbiddenError(error) ||
    isNotFoundError(error) ||
    isConflictError(error)
  )
    return error;
  return domainError.unexpected({
    code: 'data_query.explain_failed',
    message: 'Unable to explain data query',
    cause: error,
  });
};

const failure = (error: DomainError): IEndpointResult<ExplainDataQueryResponseDto> => ({
  status: mapDomainErrorToHttpStatus(error),
  body: explainDataQueryResponseDtoSchema.parse({
    ok: false,
    error: mapDomainErrorToHttpError(error),
  }),
});

/** The host must supply an authenticated context; raw input never supplies authority. */
export const explainDataQueryEndpoint = async (
  context: IExecutionContext,
  rawInput: unknown,
  service: Pick<QueryExplainExecutionService, 'explain'>
): Promise<IEndpointResult<ExplainDataQueryResponseDto>> => {
  const result = await service.explain(context, rawInput);
  if (result.isErr()) {
    const error = publicExplainError(result.error);
    return {
      status: error.code === 'data_query.timeout' ? 504 : mapDomainErrorToHttpStatus(error),
      body: explainDataQueryResponseDtoSchema.parse({
        ok: false,
        error: mapDomainErrorToHttpError(error),
      }),
    };
  }
  const parsed = explainDataQueryResponseDtoSchema.safeParse({ ok: true, data: result.value });
  if (!parsed.success) {
    return failure(
      domainError.unexpected({
        code: 'data_query.invalid_response',
        message: 'Invalid data query explain response',
      })
    );
  }
  return { status: 200, body: parsed.data };
};

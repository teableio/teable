import {
  type ExecuteDataQueryResponseDto,
  type IEndpointResult,
  executeDataQueryResponseDtoSchema,
  validateDataQueryResponseDtoSchema,
  type ValidateDataQueryResponseDto,
  mapDomainErrorToHttpError,
  mapDomainErrorToHttpStatus,
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
import type { QueryExecutionService } from '@teable/v2-data-query';

/** Repository and plugin errors can contain raw driver diagnostics even when returned as Result.Err. */
const publicQueryError = (error: DomainError): DomainError => {
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
    code: 'data_query.execution_failed',
    message: 'Unable to execute data query',
    cause: error,
  });
};

/** The host must supply authenticated context; raw input never supplies authority. */
export const executeDataQueryEndpoint = async (
  context: IExecutionContext,
  rawInput: unknown,
  service: Pick<QueryExecutionService, 'execute'>
): Promise<IEndpointResult<ExecuteDataQueryResponseDto>> => {
  const result = await service.execute(context, rawInput);
  if (result.isErr()) {
    const error = publicQueryError(result.error);
    return {
      status: error.code === 'data_query.timeout' ? 504 : mapDomainErrorToHttpStatus(error),
      body: executeDataQueryResponseDtoSchema.parse({
        ok: false,
        error: mapDomainErrorToHttpError(error),
      }),
    };
  }

  const parsed = executeDataQueryResponseDtoSchema.safeParse({ ok: true, data: result.value });
  if (!parsed.success) {
    const error = domainError.unexpected({
      code: 'data_query.invalid_response',
      message: 'Invalid data query response',
    });
    return {
      status: mapDomainErrorToHttpStatus(error),
      body: executeDataQueryResponseDtoSchema.parse({
        ok: false,
        error: mapDomainErrorToHttpError(error),
      }),
    };
  }
  return { status: 200, body: parsed.data };
};

/** Live schema/permission validation; the service never invokes its record executor. */
export const validateDataQueryEndpoint = async (
  context: IExecutionContext,
  rawInput: unknown,
  service: Pick<QueryExecutionService, 'validate'>
): Promise<IEndpointResult<ValidateDataQueryResponseDto>> => {
  const result = await service.validate(context, rawInput);
  if (result.isErr()) {
    const error = publicQueryError(result.error);
    return {
      status: mapDomainErrorToHttpStatus(error),
      body: validateDataQueryResponseDtoSchema.parse({
        ok: false,
        error: mapDomainErrorToHttpError(error),
      }),
    };
  }
  const parsed = validateDataQueryResponseDtoSchema.safeParse({ ok: true, data: result.value });
  if (!parsed.success) {
    const error = domainError.unexpected({
      code: 'data_query.invalid_response',
      message: 'Invalid data query response',
    });
    return {
      status: mapDomainErrorToHttpStatus(error),
      body: validateDataQueryResponseDtoSchema.parse({
        ok: false,
        error: mapDomainErrorToHttpError(error),
      }),
    };
  }
  return { status: 200, body: parsed.data };
};

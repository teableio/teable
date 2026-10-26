import type { IComplexityService } from '@teable/v2-command-explain';
import {
  mapDomainErrorToHttpError,
  mapDomainErrorToHttpStatus,
  type HttpErrorStatus,
  type IApiErrorResponseDto,
  type IComplexityAssessInputDto,
  type IComplexityAssessOkResponseDto,
  type IComplexityAssessResultDto,
} from '@teable/v2-contract-http';
import type { IExecutionContext } from '@teable/v2-core';

/**
 * HTTP adapter for complexity assessment. Business validation and catalog reads
 * live in IComplexityService; this layer only maps domain errors to the API.
 */
export type IComplexityEndpointResult =
  | { readonly status: 200; readonly body: IComplexityAssessOkResponseDto }
  | { readonly status: HttpErrorStatus; readonly body: IApiErrorResponseDto };

export const executeComplexityAssessEndpoint = async (
  context: IExecutionContext,
  input: IComplexityAssessInputDto,
  service: IComplexityService
): Promise<IComplexityEndpointResult> => {
  const result = await service.assess(context, input);

  if (result.isErr()) {
    const error = result.error;
    return {
      status: mapDomainErrorToHttpStatus(error),
      body: { ok: false, error: mapDomainErrorToHttpError(error) },
    };
  }

  return {
    status: 200,
    body: {
      ok: true,
      data: result.value as unknown as IComplexityAssessResultDto,
    },
  };
};

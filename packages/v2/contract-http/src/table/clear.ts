import type { IClearCommandInput, ClearResult, DomainError } from '@teable/v2-core';
import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import {
  apiErrorResponseDtoSchema,
  apiOkResponseDtoSchema,
  type HttpErrorStatus,
  type IApiErrorResponseDto,
  type IApiOkResponseDto,
  type IApiResponseDto,
} from '../shared/http';

export type IClearRequestDto = IClearCommandInput;

export interface IClearResponseDataDto {
  /** Number of records cleared (updated with null values) */
  updatedCount: number;
}

export type IClearResponseDto = IApiResponseDto<IClearResponseDataDto>;

export type IClearOkResponseDto = IApiOkResponseDto<IClearResponseDataDto>;
export type IClearErrorResponseDto = IApiErrorResponseDto;

export type IClearEndpointResult =
  | { status: 200; body: IClearOkResponseDto }
  | { status: HttpErrorStatus; body: IClearErrorResponseDto };

export const clearResponseDataSchema = z.object({
  updatedCount: z.number().int().min(0),
});

export const clearOkResponseSchema = apiOkResponseDtoSchema(clearResponseDataSchema);

export const clearErrorResponseSchema = apiErrorResponseDtoSchema;

export const mapClearResultToDto = (
  result: ClearResult
): Result<IClearResponseDataDto, DomainError> => {
  return ok({
    updatedCount: result.updatedCount,
  });
};

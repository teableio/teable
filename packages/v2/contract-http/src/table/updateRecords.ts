import type { IUpdateRecordsCommandInput, UpdateRecordsResult, DomainError } from '@teable/v2-core';
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

export type IUpdateRecordsRequestDto = IUpdateRecordsCommandInput;

export interface IUpdateRecordsResponseDataDto {
  updatedCount: number;
}

export type IUpdateRecordsResponseDto = IApiResponseDto<IUpdateRecordsResponseDataDto>;

export type IUpdateRecordsOkResponseDto = IApiOkResponseDto<IUpdateRecordsResponseDataDto>;
export type IUpdateRecordsErrorResponseDto = IApiErrorResponseDto;

export type IUpdateRecordsEndpointResult =
  | { status: 200; body: IUpdateRecordsOkResponseDto }
  | { status: HttpErrorStatus; body: IUpdateRecordsErrorResponseDto };

export const updateRecordsResponseDataSchema = z.object({
  updatedCount: z.number().int().min(0),
});

export const updateRecordsOkResponseSchema = apiOkResponseDtoSchema(
  updateRecordsResponseDataSchema
);

export const updateRecordsErrorResponseSchema = apiErrorResponseDtoSchema;

export const mapUpdateRecordsResultToDto = (
  result: UpdateRecordsResult
): Result<IUpdateRecordsResponseDataDto, DomainError> => {
  return ok({
    updatedCount: result.updatedCount,
  });
};

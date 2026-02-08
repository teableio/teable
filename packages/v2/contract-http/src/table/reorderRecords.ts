import type {
  ReorderRecordsResult,
  IReorderRecordsCommandInput,
  DomainError,
} from '@teable/v2-core';
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

export type IReorderRecordsRequestDto = IReorderRecordsCommandInput;

export interface IReorderRecordsResponseDataDto {
  updatedRecordIds: Array<string>;
}

export type IReorderRecordsResponseDto = IApiResponseDto<IReorderRecordsResponseDataDto>;

export type IReorderRecordsOkResponseDto = IApiOkResponseDto<IReorderRecordsResponseDataDto>;
export type IReorderRecordsErrorResponseDto = IApiErrorResponseDto;

export type IReorderRecordsEndpointResult =
  | { status: 200; body: IReorderRecordsOkResponseDto }
  | { status: HttpErrorStatus; body: IReorderRecordsErrorResponseDto };

export const reorderRecordsResponseDataSchema = z.object({
  updatedRecordIds: z.array(z.string()),
});

export const reorderRecordsOkResponseSchema = apiOkResponseDtoSchema(
  reorderRecordsResponseDataSchema
);

export const reorderRecordsErrorResponseSchema = apiErrorResponseDtoSchema;

export const mapReorderRecordsResultToDto = (
  result: ReorderRecordsResult
): Result<IReorderRecordsResponseDataDto, DomainError> => {
  return ok({
    updatedRecordIds: [...result.updatedRecordIds],
  });
};

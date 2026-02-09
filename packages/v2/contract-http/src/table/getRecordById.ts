import type { GetRecordByIdResult, DomainError } from '@teable/v2-core';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import {
  apiErrorResponseDtoSchema,
  apiOkResponseDtoSchema,
  type IApiErrorResponseDto,
  type IApiOkResponseDto,
  type IApiResponseDto,
  type HttpErrorStatus,
} from '../shared/http';
import type { ITableRecordDto } from './recordDto';
import { mapTableRecordToDto, tableRecordDtoSchema } from './recordDto';

export interface IGetRecordByIdResponseDataDto {
  record: ITableRecordDto;
}

export type IGetRecordByIdResponseDto = IApiResponseDto<IGetRecordByIdResponseDataDto>;

export type IGetRecordByIdOkResponseDto = IApiOkResponseDto<IGetRecordByIdResponseDataDto>;
export type IGetRecordByIdErrorResponseDto = IApiErrorResponseDto;

export type IGetRecordByIdEndpointResult =
  | { status: 200; body: IGetRecordByIdOkResponseDto }
  | { status: HttpErrorStatus; body: IGetRecordByIdErrorResponseDto };

export const getRecordByIdResponseDataSchema = z.object({
  record: tableRecordDtoSchema,
});

export const getRecordByIdOkResponseSchema = apiOkResponseDtoSchema(
  getRecordByIdResponseDataSchema
);

export const getRecordByIdErrorResponseSchema = apiErrorResponseDtoSchema;

export const mapGetRecordByIdResultToDto = (
  result: GetRecordByIdResult
): Result<IGetRecordByIdResponseDataDto, DomainError> => {
  return mapTableRecordToDto(result.record).map((record) => ({ record }));
};

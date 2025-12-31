import type { GetTableByIdResult, IGetTableByIdQueryInput, DomainError } from '@teable/v2-core';
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
import type { ITableDto } from './dto';
import { mapTableToDto, tableDtoSchema } from './dto';

export type IGetTableByIdRequestDto = IGetTableByIdQueryInput;

export interface IGetTableByIdResponseDataDto {
  table: ITableDto;
}

export type IGetTableByIdResponseDto = IApiResponseDto<IGetTableByIdResponseDataDto>;

export type IGetTableByIdOkResponseDto = IApiOkResponseDto<IGetTableByIdResponseDataDto>;
export type IGetTableByIdErrorResponseDto = IApiErrorResponseDto;

export type IGetTableByIdEndpointResult =
  | { status: 200; body: IGetTableByIdOkResponseDto }
  | { status: HttpErrorStatus; body: IGetTableByIdErrorResponseDto };

export const getTableByIdResponseDataSchema = z.object({
  table: tableDtoSchema,
});

export const getTableByIdOkResponseSchema = apiOkResponseDtoSchema(getTableByIdResponseDataSchema);

export const getTableByIdErrorResponseSchema = apiErrorResponseDtoSchema;

export const mapGetTableByIdResultToDto = (
  result: GetTableByIdResult
): Result<IGetTableByIdResponseDataDto, DomainError> => {
  return mapTableToDto(result.table).map((table) => ({ table }));
};

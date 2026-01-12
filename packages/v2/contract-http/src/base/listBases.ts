import type { ListBasesResult, DomainError } from '@teable/v2-core';
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
import { sequenceResults } from '../shared/neverthrow';
import type { IBaseDto } from './dto';
import { mapBaseToDto, baseDtoSchema } from './dto';

export interface IListBasesRequestDto {
  limit?: number;
  offset?: number;
}

export const paginationDtoSchema = z.object({
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export type IPaginationDto = z.infer<typeof paginationDtoSchema>;

export interface IListBasesResponseDataDto {
  bases: IBaseDto[];
  pagination: IPaginationDto;
}

export type IListBasesResponseDto = IApiResponseDto<IListBasesResponseDataDto>;

export type IListBasesOkResponseDto = IApiOkResponseDto<IListBasesResponseDataDto>;
export type IListBasesErrorResponseDto = IApiErrorResponseDto;

export type IListBasesEndpointResult =
  | { status: 200; body: IListBasesOkResponseDto }
  | { status: HttpErrorStatus; body: IListBasesErrorResponseDto };

export const listBasesResponseDataSchema = z.object({
  bases: z.array(baseDtoSchema),
  pagination: paginationDtoSchema,
});

export const listBasesOkResponseSchema = apiOkResponseDtoSchema(listBasesResponseDataSchema);

export const listBasesErrorResponseSchema = apiErrorResponseDtoSchema;

export const mapListBasesResultToDto = (
  result: ListBasesResult
): Result<IListBasesResponseDataDto, DomainError> => {
  return sequenceResults(result.bases.map(mapBaseToDto)).map((bases) => ({
    bases: [...bases],
    pagination: {
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    },
  }));
};

import type { IListTablesQueryInput, ListTablesResult, DomainError } from '@teable/v2-core';
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
import type { ITableDto } from './dto';
import { mapTableToDto, tableDtoSchema } from './dto';

export type IListTablesRequestDto = IListTablesQueryInput;

export interface IListTablesResponseDataDto {
  tables: ITableDto[];
}

export type IListTablesResponseDto = IApiResponseDto<IListTablesResponseDataDto>;

export type IListTablesOkResponseDto = IApiOkResponseDto<IListTablesResponseDataDto>;
export type IListTablesErrorResponseDto = IApiErrorResponseDto;

export type IListTablesEndpointResult =
  | { status: 200; body: IListTablesOkResponseDto }
  | { status: HttpErrorStatus; body: IListTablesErrorResponseDto };

export const listTablesResponseDataSchema = z.object({
  tables: z.array(tableDtoSchema),
});

export const listTablesOkResponseSchema = apiOkResponseDtoSchema(listTablesResponseDataSchema);

export const listTablesErrorResponseSchema = apiErrorResponseDtoSchema;

export const mapListTablesResultToDto = (
  result: ListTablesResult
): Result<IListTablesResponseDataDto, DomainError> => {
  return sequenceResults(result.tables.map(mapTableToDto)).map((tables) => ({
    tables: [...tables],
  }));
};

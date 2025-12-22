import type { IListTablesQueryInput, ListTablesResult } from '@teable/v2-core';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import {
  apiErrorResponseDtoSchema,
  apiOkResponseDtoSchema,
  type IApiErrorResponseDto,
  type IApiOkResponseDto,
  type IApiResponseDto,
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
  | { status: 400; body: IListTablesErrorResponseDto }
  | { status: 500; body: IListTablesErrorResponseDto };

export const listTablesResponseDataSchema = z.object({
  tables: z.array(tableDtoSchema),
});

export const listTablesOkResponseSchema = apiOkResponseDtoSchema(listTablesResponseDataSchema);

export const listTablesErrorResponseSchema = apiErrorResponseDtoSchema;

export const mapListTablesResultToDto = (
  result: ListTablesResult
): Result<IListTablesResponseDataDto, string> => {
  return sequenceResults(result.tables.map(mapTableToDto)).map((tables) => ({
    tables: [...tables],
  }));
};

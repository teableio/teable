import type { IListTableRecordsQueryInput, ListTableRecordsResult } from '@teable/v2-core';
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
import type { ITableRecordDto } from './recordDto';
import { mapTableRecordToDto, tableRecordDtoSchema } from './recordDto';

export type IListTableRecordsRequestDto = IListTableRecordsQueryInput;

export interface IListTableRecordsResponseDataDto {
  records: ITableRecordDto[];
}

export type IListTableRecordsResponseDto = IApiResponseDto<IListTableRecordsResponseDataDto>;

export type IListTableRecordsOkResponseDto = IApiOkResponseDto<IListTableRecordsResponseDataDto>;
export type IListTableRecordsErrorResponseDto = IApiErrorResponseDto;

export type IListTableRecordsEndpointResult =
  | { status: 200; body: IListTableRecordsOkResponseDto }
  | { status: 400; body: IListTableRecordsErrorResponseDto }
  | { status: 404; body: IListTableRecordsErrorResponseDto }
  | { status: 500; body: IListTableRecordsErrorResponseDto };

export const listTableRecordsResponseDataSchema = z.object({
  records: z.array(tableRecordDtoSchema),
});

export const listTableRecordsOkResponseSchema = apiOkResponseDtoSchema(
  listTableRecordsResponseDataSchema
);

export const listTableRecordsErrorResponseSchema = apiErrorResponseDtoSchema;

export const mapListTableRecordsResultToDto = (
  result: ListTableRecordsResult
): Result<IListTableRecordsResponseDataDto, string> => {
  return sequenceResults(result.records.map(mapTableRecordToDto)).map((records) => ({
    records: [...records],
  }));
};

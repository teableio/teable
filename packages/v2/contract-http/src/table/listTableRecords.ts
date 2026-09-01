import type {
  IListTableRecordsQueryInput,
  ListTableRecordsResult,
  DomainError,
} from '@teable/v2-core';
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
import type { ITableRecordDto } from './recordDto';
import { mapTableRecordToDto, tableRecordDtoSchema } from './recordDto';

export type IListTableRecordsRequestDto = IListTableRecordsQueryInput;

/** Pagination metadata for list records response */
export interface IListTableRecordsPaginationDto {
  /** Total number of records matching the query */
  total: number;
  /** Current offset (number of records skipped) */
  offset: number;
  /** Page size limit */
  limit: number;
  /** Whether there are more records after this page */
  hasMore: boolean;
}

export interface IListTableRecordsResponseDataDto {
  records: ITableRecordDto[];
  /** Pagination metadata */
  pagination: IListTableRecordsPaginationDto;
  /** Ordered leaf group buckets, included only when explicitly requested. */
  groups?: IListTableRecordsGroupDto[];
  /** Search match indexes, included only when explicitly requested. */
  searchMatches?: IListTableRecordsSearchMatchDto[];
}

export interface IListTableRecordsGroupDto {
  fields: Record<string, unknown>;
  count: number;
}

export interface IListTableRecordsSearchMatchDto {
  index: number;
  fieldId: string;
  recordId: string;
}

export type IListTableRecordsResponseDto = IApiResponseDto<IListTableRecordsResponseDataDto>;

export type IListTableRecordsOkResponseDto = IApiOkResponseDto<IListTableRecordsResponseDataDto>;
export type IListTableRecordsErrorResponseDto = IApiErrorResponseDto;

export type IListTableRecordsEndpointResult =
  | { status: 200; body: IListTableRecordsOkResponseDto }
  | { status: HttpErrorStatus; body: IListTableRecordsErrorResponseDto };

export const listTableRecordsPaginationSchema = z.object({
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  hasMore: z.boolean(),
});

export const listTableRecordsGroupSchema = z.object({
  fields: z.record(z.string(), z.unknown()),
  count: z.number().int().nonnegative(),
});

export const listTableRecordsSearchMatchSchema = z.object({
  index: z.number().int().positive(),
  fieldId: z.string().min(1),
  recordId: z.string().min(1),
});

export const listTableRecordsResponseDataSchema = z.object({
  records: z.array(tableRecordDtoSchema),
  pagination: listTableRecordsPaginationSchema,
  groups: z.array(listTableRecordsGroupSchema).optional(),
  searchMatches: z.array(listTableRecordsSearchMatchSchema).optional(),
});

export const listTableRecordsOkResponseSchema = apiOkResponseDtoSchema(
  listTableRecordsResponseDataSchema
);

export const listTableRecordsErrorResponseSchema = apiErrorResponseDtoSchema;

export const mapListTableRecordsResultToDto = (
  result: ListTableRecordsResult
): Result<IListTableRecordsResponseDataDto, DomainError> => {
  return sequenceResults(result.records.map(mapTableRecordToDto)).map((records) => ({
    records: [...records],
    pagination: {
      total: result.total,
      offset: result.offset,
      limit: result.limit,
      hasMore: result.offset + records.length < result.total,
    },
    ...(result.groups
      ? { groups: result.groups.map(({ fields, count }) => ({ fields: { ...fields }, count })) }
      : {}),
    ...(result.searchMatches
      ? {
          searchMatches: result.searchMatches.map(({ index, fieldId, recordId }) => ({
            index,
            fieldId: fieldId.toString(),
            recordId: recordId.toString(),
          })),
        }
      : {}),
  }));
};

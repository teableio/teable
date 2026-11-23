import type { IUpsertRecordsCommandInput, UpsertRecordsResult } from '@teable/v2-core';
import { z } from 'zod';

import {
  apiOkResponseDtoSchema,
  type HttpErrorStatus,
  type IApiErrorResponseDto,
  type IApiOkResponseDto,
} from '../shared/http';

export { upsertRecordsInputSchema } from '@teable/v2-core';
export { apiErrorResponseDtoSchema as upsertRecordsErrorResponseSchema } from '../shared/http';

export type IUpsertRecordsRequestDto = IUpsertRecordsCommandInput;

export const upsertRecordsResponseDataSchema = z.object({
  requested: z.number(),
  created: z.number(),
  updated: z.number(),
  unchanged: z.number(),
  skipped: z.number(),
  results: z.array(z.object({
    index: z.number(),
    status: z.enum(['created', 'updated', 'unchanged', 'skipped']),
    recordId: z.string().optional(),
  })),
});

export type IUpsertRecordsResponseDataDto = z.infer<typeof upsertRecordsResponseDataSchema>;
export const upsertRecordsOkResponseSchema = apiOkResponseDtoSchema(upsertRecordsResponseDataSchema);
export type IUpsertRecordsEndpointResult =
  | { status: 200; body: IApiOkResponseDto<IUpsertRecordsResponseDataDto> }
  | { status: HttpErrorStatus; body: IApiErrorResponseDto };

export const mapUpsertRecordsResultToDto = (result: UpsertRecordsResult): IUpsertRecordsResponseDataDto => ({
  ...result.summary,
  results: result.results.map(({ index, status, recordId }) => ({ index, status, recordId })),
});

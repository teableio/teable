import type { IDeleteByRangeCommandInput, DeleteByRangeResult, DomainError } from '@teable/v2-core';
import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import type { IDomainEventDto } from '../shared/domainEvent';
import { domainEventDtoSchema, mapDomainEventToDto } from '../shared/domainEvent';
import {
  apiErrorResponseDtoSchema,
  apiOkResponseDtoSchema,
  type HttpErrorStatus,
  type IApiErrorResponseDto,
  type IApiOkResponseDto,
  type IApiResponseDto,
} from '../shared/http';

export type IDeleteByRangeRequestDto = IDeleteByRangeCommandInput;

export interface IDeleteByRangeResponseDataDto {
  /** Number of records deleted */
  deletedCount: number;
  /** IDs of deleted records */
  deletedRecordIds: Array<string>;
  /** Domain events emitted */
  events: Array<IDomainEventDto>;
}

export type IDeleteByRangeResponseDto = IApiResponseDto<IDeleteByRangeResponseDataDto>;

export type IDeleteByRangeOkResponseDto = IApiOkResponseDto<IDeleteByRangeResponseDataDto>;
export type IDeleteByRangeErrorResponseDto = IApiErrorResponseDto;

export type IDeleteByRangeEndpointResult =
  | { status: 200; body: IDeleteByRangeOkResponseDto }
  | { status: HttpErrorStatus; body: IDeleteByRangeErrorResponseDto };

export const deleteByRangeResponseDataSchema = z.object({
  deletedCount: z.number().int().min(0),
  deletedRecordIds: z.array(z.string()),
  events: z.array(domainEventDtoSchema),
});

export const deleteByRangeOkResponseSchema = apiOkResponseDtoSchema(
  deleteByRangeResponseDataSchema
);

export const deleteByRangeErrorResponseSchema = apiErrorResponseDtoSchema;

export const mapDeleteByRangeResultToDto = (
  result: DeleteByRangeResult
): Result<IDeleteByRangeResponseDataDto, DomainError> => {
  return ok({
    deletedCount: result.deletedCount,
    deletedRecordIds: [...result.deletedRecordIds],
    events: result.events.map(mapDomainEventToDto),
  });
};

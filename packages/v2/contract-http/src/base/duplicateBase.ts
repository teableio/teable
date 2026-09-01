import type {
  DomainError,
  DuplicateBaseByIdResult,
  IDuplicateBaseByIdCommandInput,
} from '@teable/v2-core';
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
import type { IBaseDto } from './dto';
import { baseDtoSchema, mapBaseToDto } from './dto';

export type IDuplicateBaseRequestDto = IDuplicateBaseByIdCommandInput;

export interface IDuplicateBaseResponseDataDto {
  base: IBaseDto;
  tableIdMap: Record<string, string>;
  fieldIdMap: Record<string, string>;
  viewIdMap: Record<string, string>;
  recordsLength: number;
  events: Array<IDomainEventDto>;
}

export type IDuplicateBaseResponseDto = IApiResponseDto<IDuplicateBaseResponseDataDto>;
export type IDuplicateBaseOkResponseDto = IApiOkResponseDto<IDuplicateBaseResponseDataDto>;
export type IDuplicateBaseErrorResponseDto = IApiErrorResponseDto;

export type IDuplicateBaseEndpointResult =
  | { status: 201; body: IDuplicateBaseOkResponseDto }
  | { status: HttpErrorStatus; body: IDuplicateBaseErrorResponseDto };

export const duplicateBaseResponseDataSchema = z.object({
  base: baseDtoSchema,
  tableIdMap: z.record(z.string(), z.string()),
  fieldIdMap: z.record(z.string(), z.string()),
  viewIdMap: z.record(z.string(), z.string()),
  recordsLength: z.number().int().nonnegative(),
  events: z.array(domainEventDtoSchema),
});

export const duplicateBaseOkResponseSchema = apiOkResponseDtoSchema(
  duplicateBaseResponseDataSchema
);
export const duplicateBaseErrorResponseSchema = apiErrorResponseDtoSchema;

export const mapDuplicateBaseResultToDto = (
  result: DuplicateBaseByIdResult
): Result<IDuplicateBaseResponseDataDto, DomainError> =>
  mapBaseToDto(result.base).map((base) => ({
    base,
    tableIdMap: { ...result.tableIdMap },
    fieldIdMap: { ...result.fieldIdMap },
    viewIdMap: { ...result.viewIdMap },
    recordsLength: result.recordsLength,
    events: result.events.map(mapDomainEventToDto),
  }));

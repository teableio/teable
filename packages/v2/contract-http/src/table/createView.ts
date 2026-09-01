import type { CreateViewResult, DomainError, ICreateViewCommandInput } from '@teable/v2-core';
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
import type { ITableDto } from './dto';
import { mapTableToDto, tableDtoSchema } from './dto';

export type ICreateViewRequestDto = ICreateViewCommandInput;

export interface ICreateViewResponseDataDto {
  table: ITableDto;
  viewId: string;
  events: Array<IDomainEventDto>;
}

export type ICreateViewResponseDto = IApiResponseDto<ICreateViewResponseDataDto>;

export type ICreateViewOkResponseDto = IApiOkResponseDto<ICreateViewResponseDataDto>;
export type ICreateViewErrorResponseDto = IApiErrorResponseDto;

export type ICreateViewEndpointResult =
  | { status: 200; body: ICreateViewOkResponseDto }
  | { status: HttpErrorStatus; body: ICreateViewErrorResponseDto };

export const createViewResponseDataSchema = z.object({
  table: tableDtoSchema,
  viewId: z.string(),
  events: z.array(domainEventDtoSchema),
});

export const createViewOkResponseSchema = apiOkResponseDtoSchema(createViewResponseDataSchema);

export const createViewErrorResponseSchema = apiErrorResponseDtoSchema;

export const mapCreateViewResultToDto = (
  result: CreateViewResult
): Result<ICreateViewResponseDataDto, DomainError> => {
  return mapTableToDto(result.table).map((table) => ({
    table,
    viewId: result.viewId.toString(),
    events: result.events.map(mapDomainEventToDto),
  }));
};

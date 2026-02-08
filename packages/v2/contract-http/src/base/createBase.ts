import type { CreateBaseResult, ICreateBaseCommandInput, DomainError } from '@teable/v2-core';
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
import { mapBaseToDto, baseDtoSchema } from './dto';

export type ICreateBaseRequestDto = ICreateBaseCommandInput;

export interface ICreateBaseResponseDataDto {
  base: IBaseDto;
  events: Array<IDomainEventDto>;
}

export type ICreateBaseResponseDto = IApiResponseDto<ICreateBaseResponseDataDto>;

export type ICreateBaseOkResponseDto = IApiOkResponseDto<ICreateBaseResponseDataDto>;
export type ICreateBaseErrorResponseDto = IApiErrorResponseDto;

export type ICreateBaseEndpointResult =
  | { status: 201; body: ICreateBaseOkResponseDto }
  | { status: HttpErrorStatus; body: ICreateBaseErrorResponseDto };

export const createBaseResponseDataSchema = z.object({
  base: baseDtoSchema,
  events: z.array(domainEventDtoSchema),
});

export const createBaseOkResponseSchema = apiOkResponseDtoSchema(createBaseResponseDataSchema);

export const createBaseErrorResponseSchema = apiErrorResponseDtoSchema;

export const mapCreateBaseResultToDto = (
  result: CreateBaseResult
): Result<ICreateBaseResponseDataDto, DomainError> => {
  return mapBaseToDto(result.base).map((base) => ({
    base,
    events: result.events.map(mapDomainEventToDto),
  }));
};

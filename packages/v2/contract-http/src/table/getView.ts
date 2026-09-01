import type { GetViewResult, IGetViewQueryInput } from '@teable/v2-core';
import { z } from 'zod';

import {
  apiErrorResponseDtoSchema,
  apiOkResponseDtoSchema,
  type HttpErrorStatus,
  type IApiErrorResponseDto,
  type IApiOkResponseDto,
  type IApiResponseDto,
} from '../shared/http';
import type { IViewReadDto } from './viewReadDto';
import { viewReadDtoSchema } from './viewReadDto';

export type IGetViewRequestDto = IGetViewQueryInput;

export interface IGetViewResponseDataDto {
  view: IViewReadDto;
}

export type IGetViewResponseDto = IApiResponseDto<IGetViewResponseDataDto>;
export type IGetViewOkResponseDto = IApiOkResponseDto<IGetViewResponseDataDto>;
export type IGetViewErrorResponseDto = IApiErrorResponseDto;

export type IGetViewEndpointResult =
  | { status: 200; body: IGetViewOkResponseDto }
  | { status: HttpErrorStatus; body: IGetViewErrorResponseDto };

export const getViewResponseDataSchema = z.object({
  view: viewReadDtoSchema,
});

export const getViewOkResponseSchema = apiOkResponseDtoSchema(getViewResponseDataSchema);
export const getViewErrorResponseSchema = apiErrorResponseDtoSchema;

export const mapGetViewResultToDto = (result: GetViewResult): IGetViewResponseDataDto => ({
  view: result.view,
});

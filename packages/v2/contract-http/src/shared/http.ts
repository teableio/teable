import { z } from 'zod';

export interface IApiErrorResponseDto {
  ok: false;
  error: string;
}

export interface IApiOkResponseDto<T> {
  ok: true;
  data: T;
}

export type IApiResponseDto<T> = IApiOkResponseDto<T> | IApiErrorResponseDto;

export interface IEndpointResult<TBody, TStatus extends number = number> {
  status: TStatus;
  body: TBody;
}

export const apiErrorResponseDtoSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
});

export const apiOkResponseDtoSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    ok: z.literal(true),
    data: dataSchema,
  });

export const apiResponseDtoSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.union([apiOkResponseDtoSchema(dataSchema), apiErrorResponseDtoSchema]);

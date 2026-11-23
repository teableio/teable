import { z } from 'zod';

import {
  apiOkResponseDtoSchema,
  type IApiErrorResponseDto,
  type IApiResponseDto,
} from '../shared/http';

export const createBaseInputSchema = z.object({
  spaceId: z.string(),
  name: z.string().optional(),
  icon: z.string().optional(),
});

export type ICreateBaseRequestDto = z.infer<typeof createBaseInputSchema>;

export const createBaseResponseDataSchema = z.object({
  base: z.object({
    id: z.string(),
    name: z.string().nullable(),
    spaceId: z.string(),
    icon: z.string().nullable().optional(),
  }),
});

export type ICreateBaseResponseDataDto = z.infer<typeof createBaseResponseDataSchema>;
export type ICreateBaseResponseDto = IApiResponseDto<ICreateBaseResponseDataDto>;
export const createBaseOkResponseSchema = apiOkResponseDtoSchema(createBaseResponseDataSchema);
export type ICreateBaseOkResponseDto = z.infer<typeof createBaseOkResponseSchema>;
export type ICreateBaseErrorResponseDto = IApiErrorResponseDto;

export { apiErrorResponseDtoSchema as createBaseErrorResponseSchema } from '../shared/http';

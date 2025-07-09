import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { IConvertFieldRo } from '@teable/core';
import { convertFieldRoSchema } from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { planFieldVoSchema } from './plan';

export const PLAN_FIELD_CONVERT = '/table/{tableId}/field/{fieldId}/plan';

export const planFieldConvertVoSchema = planFieldVoSchema.partial().merge(
  z.object({
    skip: z.boolean().optional(),
  })
);

export type IPlanFieldConvertVo = z.infer<typeof planFieldConvertVoSchema>;

export const planFieldConvertRoute: RouteConfig = registerRoute({
  method: 'put',
  path: PLAN_FIELD_CONVERT,
  description: 'Generate calculation plan for converting the field',
  request: {
    params: z.object({
      tableId: z.string(),
      fieldId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: convertFieldRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Returns the calculation plan',
      content: {
        'application/json': {
          schema: planFieldConvertVoSchema,
        },
      },
    },
  },
  tags: ['plan'],
});

export const planFieldConvert = async (
  tableId: string,
  fieldId: string,
  fieldRo: IConvertFieldRo
) => {
  return axios.put<IPlanFieldConvertVo>(
    urlBuilder(PLAN_FIELD_CONVERT, {
      tableId,
      fieldId,
    }),
    fieldRo
  );
};
